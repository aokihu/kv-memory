/**
 * Search Service
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */

import type { Database } from "bun:sqlite";
import { getDatabase, getDatabaseConfig, initDatabase } from "../libs/kv/db";
import { KVMemory } from "../libs/kv";
import {
  appendMemoryStateFilter,
  type MemoryStateFilter,
  type QueryMemoryState,
  sortLinksByCombinedScore,
} from "../libs/kv/db/query";
import type { Memory, MemoryLinkValue } from "../type";

type SearchOperator = "AND" | "OR";

export type SearchStateFilterInput = QueryMemoryState | QueryMemoryState[] | MemoryStateFilter;

type SearchRow = {
  key: string;
  summary: string;
  text: string;
  rank: number | null;
  excerpt: string | null;
};

type SearchCountRow = {
  total: number;
};

export type SearchResultItem = {
  key: string;
  summary: string;
  excerpt: string;
  relevance: number;
  score: number;
  links: MemoryLinkValue[];
};

export type SearchPagination = {
  total: number;
  limit: number;
  offset: number;
};

export type SearchResult = {
  results: SearchResultItem[];
  pagination: SearchPagination;
};

export class SearchService {
  private readonly kv: KVMemory;
  private readonly database: Database;
  private readonly searchEnabled: boolean;

  constructor(kv: KVMemory) {
    this.kv = kv;
    this.database = initDatabase(getDatabase());
    this.searchEnabled = getDatabaseConfig().searchEnabled;
  }

  /**
   * 基础关键词搜索。
   *
   * Debug hint: 如果结果为空，先检查 `query` 是否被 normalize 为空，
   * 再检查 `KVDB_SEARCH_ENABLED` 与 FTS 对象是否存在。
   */
  async search(
    query: string,
    limit = 10,
    offset = 0,
    namespace?: string,
    statusFilter?: SearchStateFilterInput,
    sortLinks = true,
  ): Promise<SearchResult> {
    this.validateSearchQuery(query);
    const paging = this.normalizePagination(limit, offset);

    if (!this.searchEnabled) {
      return this.emptyResult(paging.limit, paging.offset);
    }

    const matchQuery = this.buildSearchQueryFromText(query);
    return this.executeSearch(matchQuery, paging.limit, paging.offset, namespace, statusFilter, sortLinks);
  }

  /**
   * 全文搜索，支持多关键词 AND/OR 组合。
   *
   * Debug hint: 若组合查询报错，优先检查 `operator` 和关键词数组中空字符串。
   */
  async fulltextSearch(
    keywords: string[],
    operator: SearchOperator = "OR",
    limit = 10,
    offset = 0,
    namespace?: string,
    statusFilter?: SearchStateFilterInput,
    sortLinks = true,
  ): Promise<SearchResult> {
    this.validateKeywords(keywords);
    this.validateOperator(operator);
    const paging = this.normalizePagination(limit, offset);

    if (!this.searchEnabled) {
      return this.emptyResult(paging.limit, paging.offset);
    }

    const matchQuery = this.buildSearchQueryFromKeywords(keywords, operator);
    return this.executeSearch(matchQuery, paging.limit, paging.offset, namespace, statusFilter, sortLinks);
  }

  /**
   * 执行 FTS 查询并格式化结果。
   */
  private async executeSearch(
    matchQuery: string,
    limit: number,
    offset: number,
    namespace?: string,
    statusFilter?: SearchStateFilterInput,
    sortLinks = true,
  ): Promise<SearchResult> {
    try {
      const namespacePrefix = namespace?.trim() ? `${namespace.trim()}:` : null;
      const memoryStateFilter = this.normalizeStatusFilter(statusFilter);
      const requiresMemoryJoin = Boolean(memoryStateFilter);
      const fromClause = requiresMemoryJoin
        ? "FROM memories_fts INNER JOIN memories ON memories.key = memories_fts.key"
        : "FROM memories_fts";

      const baseParams: Array<number | string> = [matchQuery];
      const namespaceSql = namespacePrefix ? " AND memories_fts.key LIKE ?" : "";
      if (namespacePrefix) {
        baseParams.push(`${namespacePrefix}%`);
      }

      const baseRowsSql = `SELECT memories_fts.key AS key, memories_fts.summary AS summary, memories_fts.text AS text,
                                  bm25(memories_fts) AS rank,
                                  snippet(memories_fts, 2, '<mark>', '</mark>', '...', 18) AS excerpt
                             ${fromClause}
                            WHERE memories_fts MATCH ?${namespaceSql}`;
      const rowsClause = appendMemoryStateFilter(baseRowsSql, baseParams, memoryStateFilter);
      const rows = this.database
        .query(`${rowsClause.sql} ORDER BY rank LIMIT ? OFFSET ?`)
        .all(...rowsClause.params, limit, offset) as SearchRow[];

      const baseCountSql = `SELECT COUNT(1) AS total
                              ${fromClause}
                             WHERE memories_fts MATCH ?${namespaceSql}`;
      const countClause = appendMemoryStateFilter(baseCountSql, baseParams, memoryStateFilter);
      const countRow = this.database.query(countClause.sql).get(...countClause.params) as SearchCountRow | null;

      const results = await Promise.all(rows.map((row) => this.formatResultRow(row, sortLinks)));

      return {
        results,
        pagination: {
          total: countRow?.total ?? 0,
          limit,
          offset,
        },
      };
    } catch (error) {
      console.error("SearchService: executeSearch failed", error);
      if (error instanceof Error && /state filter|statusFilter|score/i.test(error.message)) {
        throw new Error(`SearchService: invalid statusFilter - ${error.message}`);
      }

      throw new Error("SearchService: search query execution failed");
    }
  }

  /**
   * 规范化状态过滤输入。
   *
   * Debug hint: 若请求端报参数错误，先检查调用方传入的 `statusFilter` 结构。
   */
  private normalizeStatusFilter(statusFilter?: SearchStateFilterInput): MemoryStateFilter | undefined {
    if (statusFilter === undefined) {
      return undefined;
    }

    if (typeof statusFilter === "string") {
      return { states: statusFilter };
    }

    if (Array.isArray(statusFilter)) {
      return { states: statusFilter };
    }

    if (typeof statusFilter === "object" && statusFilter !== null) {
      if (
        statusFilter.states === undefined &&
        statusFilter.excludeStates === undefined &&
        statusFilter.scoreMin === undefined &&
        statusFilter.scoreMax === undefined
      ) {
        return undefined;
      }

      return statusFilter;
    }

    throw new Error("SearchService: statusFilter must be state string, state array, or MemoryStateFilter object");
  }

  /**
   * 格式化单条搜索结果。
   */
  private async formatResultRow(row: SearchRow, sortLinks: boolean): Promise<SearchResultItem> {
    const memory = (await this.kv.get(row.key)) as Memory | undefined;
    const memoryLinks = await this.kv.getLinks(row.key);
    const summary = memory?.summary ?? row.summary;
    const sourceText = memory?.text ?? row.text;
    const excerpt = this.normalizeExcerpt(row.excerpt, sourceText);
    const relevance = this.toRelevance(row.rank ?? 0);
    const links = sortLinks ? await this.sortResultLinks(memoryLinks) : memoryLinks;

    return {
      key: row.key,
      summary,
      excerpt,
      relevance,
      score: relevance,
      links,
    };
  }

  /**
   * 对搜索结果中的 links 按综合得分排序。
   *
   * Debug hint: 若排序结果异常，优先检查 link.key 对应记忆是否存在以及 score 是否缺失回退。
   */
  private async sortResultLinks(links: MemoryLinkValue[]): Promise<MemoryLinkValue[]> {
    if (links.length <= 1) {
      return links;
    }

    const linkedKeys = [...new Set(links.map((link) => link.key).filter((key): key is string => Boolean(key)))];
    const linkedMemories = await Promise.all(
      linkedKeys.map(async (key) => {
        const linkedMemory = await this.kv.get(key);
        return [key, linkedMemory] as const;
      }),
    );

    const linkedMemoriesByKey: Record<string, Memory | undefined> = Object.fromEntries(linkedMemories);
    return sortLinksByCombinedScore(links, linkedMemoriesByKey);
  }

  /**
   * 将自由文本转为 FTS 查询表达式。
   */
  private buildSearchQueryFromText(query: string): string {
    const tokens = this.tokenize(query);
    if (tokens.length === 0) {
      throw new Error("SearchService: query must contain at least one keyword");
    }

    return tokens.map((token) => this.escapeToken(token)).join(" OR ");
  }

  /**
   * 将关键词数组转为 FTS 查询表达式。
   */
  private buildSearchQueryFromKeywords(keywords: string[], operator: SearchOperator): string {
    const normalizedKeywords = keywords
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length > 0);

    if (normalizedKeywords.length === 0) {
      throw new Error("SearchService: keywords must contain at least one non-empty value");
    }

    return normalizedKeywords.map((keyword) => this.escapeToken(keyword)).join(` ${operator} `);
  }

  /**
   * 校验基础搜索参数。
   */
  private validateSearchQuery(query: string): void {
    if (typeof query !== "string" || query.trim().length === 0) {
      throw new Error("SearchService: query is required and must be a non-empty string");
    }
  }

  /**
   * 校验关键词数组。
   */
  private validateKeywords(keywords: string[]): void {
    if (!Array.isArray(keywords) || keywords.length === 0) {
      throw new Error("SearchService: keywords are required and must be a non-empty string array");
    }
  }

  /**
   * 校验操作符。
   */
  private validateOperator(operator: SearchOperator): void {
    if (operator !== "AND" && operator !== "OR") {
      throw new Error("SearchService: operator must be AND or OR");
    }
  }

  /**
   * 统一分页参数，避免负值和过大分页带来的异常行为。
   */
  private normalizePagination(limit: number, offset: number): { limit: number; offset: number } {
    if (!Number.isFinite(limit) || limit < 1) {
      throw new Error("SearchService: limit must be a positive number");
    }

    if (!Number.isFinite(offset) || offset < 0) {
      throw new Error("SearchService: offset must be a non-negative number");
    }

    return {
      limit: Math.min(Math.trunc(limit), 100),
      offset: Math.trunc(offset),
    };
  }

  /**
   * 分词：按空白切分基础搜索词。
   */
  private tokenize(query: string): string[] {
    return query
      .trim()
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }

  /**
   * FTS token 转义，避免关键字符破坏 MATCH 语句。
   */
  private escapeToken(token: string): string {
    const escaped = token.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  /**
   * 将 bm25 排名转换为 0~1 相关度分数，数值越大相关度越高。
   */
  private toRelevance(rank: number): number {
    const safeRank = Number.isFinite(rank) ? Math.abs(rank) : 0;
    const relevance = 1 / (1 + safeRank);
    return Number(relevance.toFixed(6));
  }

  /**
   * 生成摘录；无 snippet 时使用正文前缀并做长度收敛。
   */
  private normalizeExcerpt(excerpt: string | null, text: string): string {
    const cleanedExcerpt = (excerpt ?? "").trim();
    if (cleanedExcerpt.length > 0) {
      return cleanedExcerpt;
    }

    const cleanedText = text.trim();
    if (cleanedText.length <= 160) {
      return cleanedText;
    }

    return `${cleanedText.slice(0, 157)}...`;
  }

  /**
   * 搜索关闭时返回统一空结构。
   */
  private emptyResult(limit: number, offset: number): SearchResult {
    return {
      results: [],
      pagination: {
        total: 0,
        limit,
        offset,
      },
    };
  }
}
