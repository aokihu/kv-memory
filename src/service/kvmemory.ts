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

export type BulkReadMemoryParams = {
  depth?: number;
  breadth?: number;
  total?: number;
};

export type BulkReadResolvedParams = {
  depth: number;
  breadth: number;
  total: number;
};

export type BulkReadMetadata = {
  depthReached: number;
  totalRetrieved: number;
  duplicatesSkipped: number;
};

export type BulkReadMemoryItem = MemoryNoMetaWithLinkSummary & {
  key: string;
  depth: number;
  combinedScore: number;
};

export type BulkReadResult = {
  targetMemory: MemoryNoMetaWithLinkSummary & { key: string };
  associatedMemories: BulkReadMemoryItem[];
  metadata: BulkReadMetadata;
  limits: BulkReadResolvedParams;
};

export const BULK_READ_DEFAULTS: BulkReadResolvedParams = {
  depth: 3,
  breadth: 5,
  total: 20,
};

export const BULK_READ_LIMITS_MAX: BulkReadResolvedParams = {
  depth: 6,
  breadth: 20,
  total: 50,
};

export class KVMemoryService {
  private readonly kv: KVMemory;
  readonly searchService: SearchService;

  constructor(dependencies: KVMemoryServiceDependencies = {}) {
    this.kv = dependencies.kv ?? new KVMemory();
    this.searchService = dependencies.searchService ?? new SearchService(this.kv);
  }

  /**
   * Wrap write operations to keep service-level error logs consistent.
   *
   * Debug hint: if a write fails without context, inspect this wrapper log first.
   */
  private async executeWriteOperation(operationName: string, handler: () => Promise<void>): Promise<void> {
    try {
      await handler();
    } catch (error) {
      console.error(`KVMemoryService: ${operationName} failed`, error);
      throw error;
    }
  }

  /**
   * Normalize and validate bulk-read limits.
   *
   * Debug hint: if request rejects valid-looking values, inspect caller types
   * and verify they are finite integers before this normalization step.
   */
  static resolveBulkReadParams(params: BulkReadMemoryParams = {}): BulkReadResolvedParams {
    const resolve = (
      value: number | undefined,
      fallback: number,
      fieldName: "depth" | "breadth" | "total",
    ): number => {
      if (value === undefined) {
        return fallback;
      }

      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        throw new Error(`${fieldName} must be an integer`);
      }

      if (value < 1) {
        throw new Error(`${fieldName} must be greater than or equal to 1`);
      }

      const max = BULK_READ_LIMITS_MAX[fieldName];
      if (value > max) {
        throw new Error(`${fieldName} must be less than or equal to ${max}`);
      }

      return value;
    };

    return {
      depth: resolve(params.depth, BULK_READ_DEFAULTS.depth, "depth"),
      breadth: resolve(params.breadth, BULK_READ_DEFAULTS.breadth, "breadth"),
      total: resolve(params.total, BULK_READ_DEFAULTS.total, "total"),
    };
  }

  /**
   * 添加记忆
   * @param namespace 记忆命名空间
   * @param key 记忆的key
   * @param arg 记忆的value
   * @description 增加访问次数和最后访问时间
   */
  async addMemory(key: string, arg: MemoryNoMeta, links?: MemoryLinkValue[]): Promise<void>;
  async addMemory(namespace: string, key: string, arg: MemoryNoMeta, links?: MemoryLinkValue[]): Promise<void>;
  async addMemory(
    keyOrNamespace: string,
    keyOrArg: string | MemoryNoMeta,
    argOrLinks: MemoryNoMeta | MemoryLinkValue[] = [],
    maybeLinks: MemoryLinkValue[] = [],
  ): Promise<void> {
    const key = typeof keyOrArg === "string" ? keyOrArg : keyOrNamespace;
    const arg = (typeof keyOrArg === "string" ? argOrLinks : keyOrArg) as MemoryNoMeta;
    const links = (typeof keyOrArg === "string" ? maybeLinks : argOrLinks) as MemoryLinkValue[];
    await this.executeWriteOperation("addMemory", async () => {
      await this.kv.add(key, arg, links ?? []);
    });
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
  async updateMemory(key: string, arg: Partial<MemoryNoMeta>, links?: MemoryLinkValue[]): Promise<void>;
  async updateMemory(
    namespace: string,
    key: string,
    arg: Partial<MemoryNoMeta>,
    links?: MemoryLinkValue[],
  ): Promise<void>;
  async updateMemory(
    keyOrNamespace: string,
    keyOrArg: string | Partial<MemoryNoMeta>,
    argOrLinks: Partial<MemoryNoMeta> | MemoryLinkValue[] = [],
    maybeLinks?: MemoryLinkValue[],
  ): Promise<void> {
    const key = typeof keyOrArg === "string" ? keyOrArg : keyOrNamespace;
    const arg = (typeof keyOrArg === "string" ? argOrLinks : keyOrArg) as Partial<MemoryNoMeta>;
    const links = (typeof keyOrArg === "string" ? maybeLinks : argOrLinks) as MemoryLinkValue[] | undefined;
    await this.executeWriteOperation("updateMemory", async () => {
      await this.kv.update(key, arg, links);
    });
  }

  /**
   * 更新记忆的key
   * @param oldKey 旧的记忆key
   * @param newKey 新的记忆key
   */
  async updateKey(oldKey: string, newKey: string): Promise<void>;
  async updateKey(namespace: string, oldKey: string, newKey: string): Promise<void>;
  async updateKey(keyOrNamespace: string, oldKeyOrNewKey: string, maybeNewKey?: string): Promise<void> {
    const oldKey = maybeNewKey === undefined ? keyOrNamespace : oldKeyOrNewKey;
    const newKey = maybeNewKey === undefined ? oldKeyOrNewKey : maybeNewKey;
    await this.executeWriteOperation("updateKey", async () => {
      await this.kv.updateKey(oldKey, newKey);
    });
  }

  /**
   * Alias of `updateKey` to keep rename semantics explicit in caller code.
   */
  async renameMemoryKey(oldKey: string, newKey: string): Promise<void>;
  async renameMemoryKey(namespace: string, oldKey: string, newKey: string): Promise<void>;
  async renameMemoryKey(
    keyOrNamespace: string,
    oldKeyOrNewKey: string,
    maybeNewKey?: string,
  ): Promise<void> {
    const oldKey = maybeNewKey === undefined ? keyOrNamespace : oldKeyOrNewKey;
    const newKey = maybeNewKey === undefined ? oldKeyOrNewKey : maybeNewKey;
    await this.updateKey(oldKey, newKey);
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
   * 批量读取记忆（DFS）。
   *
   * Debug hint: if traversal result is unexpectedly small, check metadata fields
   * `duplicatesSkipped`, `depthReached`, and current `limits` first.
   */
  async bulkReadMemory(key: string, params: BulkReadMemoryParams = {}): Promise<BulkReadResult | undefined> {
    const limits = KVMemoryService.resolveBulkReadParams(params);
    const targetMemory = await this.kv.get(key);
    if (!targetMemory) {
      return undefined;
    }

    const memoryCache = new Map<string, Memory | undefined>();
    const linksCache = new Map<string, MemoryLinkValue[]>();
    memoryCache.set(key, targetMemory);

    const visited = new Set<string>([key]);
    const associatedMemories: BulkReadMemoryItem[] = [];
    const maxAssociated = Math.max(0, limits.total - 1);
    let duplicatesSkipped = 0;
    let depthReached = 0;

    const loadMemories = async (keys: string[]): Promise<Record<string, Memory | undefined>> => {
      const unique = [...new Set(keys.filter((item) => item.length > 0))];
      const missing = unique.filter((item) => !memoryCache.has(item));
      if (missing.length > 0) {
        const loaded = await this.kv.getMany(missing);
        for (const item of missing) {
          memoryCache.set(item, loaded[item]);
        }
      }

      const result: Record<string, Memory | undefined> = {};
      for (const item of unique) {
        result[item] = memoryCache.get(item);
      }
      return result;
    };

    const loadLinks = async (sourceKey: string): Promise<MemoryLinkValue[]> => {
      if (!linksCache.has(sourceKey)) {
        const loaded = await this.kv.getLinksMany([sourceKey]);
        linksCache.set(sourceKey, loaded[sourceKey] ?? []);
      }

      return linksCache.get(sourceKey) ?? [];
    };

    const toMemoryWithSummaries = async (
      sourceKey: string,
      memory: Memory,
    ): Promise<MemoryNoMetaWithLinkSummary & { key: string }> => {
      const links = await loadLinks(sourceKey);
      if (links.length === 0) {
        return {
          key: sourceKey,
          summary: memory.summary,
          text: memory.text,
          links: [],
        };
      }

      const linkedKeys = [...new Set(links.map((link) => link.key).filter((item): item is string => Boolean(item)))];
      const linkedMemoriesByKey = await loadMemories(linkedKeys);
      const sortedLinks = sortLinksByCombinedScore(links, linkedMemoriesByKey);

      return {
        key: sourceKey,
        summary: memory.summary,
        text: memory.text,
        links: sortedLinks.map((link) => ({
          ...link,
          summary: link.key && linkedMemoriesByKey[link.key]?.summary
            ? linkedMemoriesByKey[link.key]!.summary
            : "关联记忆不存在",
        })),
      };
    };

    const dfs = async (sourceKey: string, currentDepth: number): Promise<void> => {
      if (associatedMemories.length >= maxAssociated) {
        return;
      }

      if (currentDepth > limits.depth) {
        return;
      }

      const links = await loadLinks(sourceKey);
      if (links.length === 0) {
        return;
      }

      const linkedKeys = [...new Set(links.map((link) => link.key).filter((item): item is string => Boolean(item)))];
      const linkedMemoriesByKey = await loadMemories(linkedKeys);

      const candidateByKey = new Map<
        string,
        {
          key: string;
          memory: Memory;
          link: MemoryLinkValue;
          combinedScore: number;
        }
      >();

      for (const link of links) {
        if (!link.key) {
          continue;
        }

        const linkedMemory = linkedMemoriesByKey[link.key];
        if (!linkedMemory) {
          continue;
        }

        if (visited.has(link.key)) {
          duplicatesSkipped += 1;
          continue;
        }

        const memoryScore =
          typeof linkedMemory.meta.score === "number" && Number.isFinite(linkedMemory.meta.score)
            ? linkedMemory.meta.score
            : 50;
        const combinedScore = link.weight * memoryScore;
        const current = candidateByKey.get(link.key);

        if (
          !current ||
          combinedScore > current.combinedScore ||
          (combinedScore === current.combinedScore && link.weight > current.link.weight)
        ) {
          candidateByKey.set(link.key, {
            key: link.key,
            memory: linkedMemory,
            link,
            combinedScore,
          });
        }
      }

      const selected = [...candidateByKey.values()]
        .sort((left, right) => {
          if (right.combinedScore !== left.combinedScore) {
            return right.combinedScore - left.combinedScore;
          }

          if (right.link.weight !== left.link.weight) {
            return right.link.weight - left.link.weight;
          }

          return left.key.localeCompare(right.key);
        })
        .slice(0, limits.breadth);

      for (const candidate of selected) {
        if (associatedMemories.length >= maxAssociated) {
          return;
        }

        visited.add(candidate.key);
        depthReached = Math.max(depthReached, currentDepth);

        const resolved = await toMemoryWithSummaries(candidate.key, candidate.memory);
        associatedMemories.push({
          ...resolved,
          depth: currentDepth,
          combinedScore: Number(candidate.combinedScore.toFixed(6)),
        });

        if (currentDepth < limits.depth && associatedMemories.length < maxAssociated) {
          await dfs(candidate.key, currentDepth + 1);
        }
      }
    };

    await dfs(key, 1);

    const targetWithSummaries = await toMemoryWithSummaries(key, targetMemory);

    return {
      targetMemory: targetWithSummaries,
      associatedMemories,
      metadata: {
        depthReached,
        totalRetrieved: associatedMemories.length + 1,
        duplicatesSkipped,
      },
      limits,
    };
  }

  /**
   * 遍历记忆
   * @param key 记忆的key
   * @returns 记忆的value
   * @description 增加遍历次数和最后遍历时间
   */
  async traverseMemory(key: string): Promise<Memory | undefined>;
  async traverseMemory(namespace: string, key: string): Promise<Memory | undefined>;
  async traverseMemory(keyOrNamespace: string, maybeKey?: string): Promise<Memory | undefined> {
    const key = maybeKey ?? keyOrNamespace;
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
