/**
 * KV Servcice
 * @author aokihu <aokihu@gmail.com>
 * @license MIT
 */
import { KVMemory } from "../libs/kv";
import { sortLinksByCombinedScore } from "../libs/kv/db/query";
import { SearchService, type SearchResult } from "./searchService";
import {
  type MemoryLinkValue,
  type Memory,
  type MemoryMeta,
  type MemoryNoMeta,
} from "../type";

export type MemoryLinkWithSummary = MemoryLinkValue & {
  summary: string;
};

export type MemoryNoMetaWithLinkSummary = Omit<Memory, "meta"> & {
  links: MemoryLinkWithSummary[];
};

export type KVMemoryServiceDependencies = {
  kv?: KVMemory;
  searchService?: SearchService;
};

export type GetMemorySortLinks = {
  sortLinks?: boolean;
};

export type SearchMemoryParams = {
  query: string;
  limit?: number;
  offset?: number;
  namespace?: string;
  sortLinks?: boolean;
};

export type FulltextSearchMemoryParams = {
  keywords: string[];
  operator?: "AND" | "OR";
  limit?: number;
  offset?: number;
  namespace?: string;
  sortLinks?: boolean;
};

export class KVMemoryService {
  private readonly kv: KVMemory;
  readonly searchService: SearchService;

  constructor(dependencies: KVMemoryServiceDependencies = {}) {
    this.kv = dependencies.kv ?? new KVMemory();
    this.searchService = dependencies.searchService ?? new SearchService(this.kv);
  }

  /**
   * 添加记忆
   * @param namespace 记忆命名空间
   * @param key 记忆的key
   * @param arg 记忆的value
   * @description 增加访问次数和最后访问时间
   */
  async addMemory(
    key: string,
    arg: MemoryNoMeta,
    links: MemoryLinkValue[] = [],
  ) {
    await this.kv.add(key, arg, links);
  }

  /**
   * 获取记忆
   * @param key 记忆的key
   * @returns 记忆的value
   * @description 增加访问次数和最后访问时间
   */
  async getMemory(key: string, sortLinks?: boolean): Promise<MemoryNoMetaWithLinkSummary | undefined>;
  async getMemory(namespace: string, key: string, sortLinks?: boolean): Promise<MemoryNoMetaWithLinkSummary | undefined>;
  async getMemory(
    keyOrNamespace: string,
    keyOrSortLinks: string | boolean = true,
    maybeSortLinks = true,
  ): Promise<MemoryNoMetaWithLinkSummary | undefined> {
    const key = typeof keyOrSortLinks === "string" ? keyOrSortLinks : keyOrNamespace;
    const sortLinks = typeof keyOrSortLinks === "boolean" ? keyOrSortLinks : maybeSortLinks;

    const value = await this.kv.get(key);
    if (!value) return undefined;

    const memory = value as Memory;
    const meta: MemoryMeta = memory.meta;

    meta.access_count += 1;
    meta.last_accessed_at = Date.now();
    await this.kv.setMeta(key, meta);

    const { meta: _meta, ...baseMemory } = memory;

    const memoryLinks = await this.kv.getLinks(key);

    if (memoryLinks.length === 0) {
      return {
        ...baseMemory,
        links: [],
      };
    }

    try {
      const linkedKeys = [...new Set(memoryLinks.map((link) => link.key).filter((value): value is string => Boolean(value)))];
      const linkedMemories = await Promise.all(
        linkedKeys.map(async (linkedKey) => {
          const linkedValue = await this.kv.get(linkedKey);
          return [linkedKey, linkedValue as Memory | undefined] as const;
        }),
      );

      const linkedMemoriesByKey: Record<string, Memory | undefined> = Object.fromEntries(linkedMemories);
      const sortedLinks = sortLinks
        ? sortLinksByCombinedScore(memoryLinks, linkedMemoriesByKey)
        : memoryLinks;

      const links = sortedLinks.map((link) => {
        const linkedMemory = link.key ? linkedMemoriesByKey[link.key] : undefined;

        if (!linkedMemory) {
          return {
            ...link,
            summary: "关联记忆不存在",
          };
        }

        return {
          ...link,
          summary: linkedMemory.summary ?? "关联记忆不存在",
        };
      });

      return {
        ...baseMemory,
        links,
      };
    } catch {
      return {
        ...baseMemory,
        links: memoryLinks.map((link) => ({
          ...link,
          summary: "关联记忆不存在",
        })),
      };
    }
  }

  /**
   * 更新记忆
   * @param key 记忆的key
   * @param arg 记忆的value
   * @description 用户手动更新记忆内容
   */
  async updateMemory(
    key: string,
    arg: Partial<MemoryNoMeta>,
    links?: MemoryLinkValue[],
  ) {
    await this.kv.update(key, arg, links);
  }

  /**
   * 更新记忆的key
   * @param oldKey 旧的记忆key
   * @param newKey 新的记忆key
   */
  async updateKey(oldKey: string, newKey: string) {
    await this.kv.updateKey(oldKey, newKey);
  }

  /**
   * 代理基础关键词搜索。
   * Debug hint: 若返回空结果，先检查 SearchService 内部 `searchEnabled` 配置。
   */
  async searchMemory(
    query: string,
    limit = 10,
    offset = 0,
    namespace?: string,
    sortLinks = true,
  ): Promise<SearchResult> {
    return this.searchService.search(query, limit, offset, namespace, undefined, sortLinks);
  }

  /**
   * 代理多关键词全文搜索。
   * Debug hint: 查询报错时优先检查 `operator` 与关键词数组是否包含空值。
   */
  async fulltextSearchMemory(
    keywords: string[],
    operator: "AND" | "OR" = "OR",
    limit = 10,
    offset = 0,
    namespace?: string,
    sortLinks = true,
  ): Promise<SearchResult> {
    return this.searchService.fulltextSearch(
      keywords,
      operator,
      limit,
      offset,
      namespace,
      undefined,
      sortLinks,
    );
  }

  /**
   * 遍历记忆
   * @param key 记忆的key
   * @returns 记忆的value
   * @description 增加遍历次数和最后遍历时间
   */
  async traverseMemory(key: string): Promise<Memory | undefined> {
    const kv = this.kv;
    if (!kv) {
      return undefined;
    }
    const value = await kv.get(key);
    if (!value) {
      // throw new Error(`KVMemory: traverse: key ${key} not found`)
      return undefined;
    }

    const memory = value as Memory;
    const meta: MemoryMeta = memory.meta;

    meta.traverse_count += 1;
    meta.last_linked_at = Date.now();
    await kv.setMeta(key, meta);

    return {
      ...memory,
      meta,
    };
  }
}
