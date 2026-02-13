/**
 * Link sorting utility module.
 *
 * Provides reusable APIs for combined-score link sorting with cache and batch support.
 * Debug entry point: inspect `resolveScoreWithCache()` when order looks stale or unexpected.
 */

import type { Memory, MemoryLinkValue } from "../../type";

export type LinkedMemoriesByKey = Record<string, Memory | undefined>;

export type LinkSorterConfig = {
  defaultScore?: number;
  maxCacheEntriesPerSnapshot?: number;
};

export type LinkSortOptions = {
  defaultScore?: number;
  useCache?: boolean;
};

export type LinkBatchSortInput = {
  id: string;
  links: MemoryLinkValue[];
};

export type LinkBatchSortResult = {
  id: string;
  links: MemoryLinkValue[];
};

const DEFAULT_LINK_SORT_SCORE = 50;
const DEFAULT_MAX_CACHE_ENTRIES_PER_SNAPSHOT = 4096;

function resolveFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return null;
}

/**
 * Keep cache bounded to avoid long-running worker memory growth.
 *
 * Debug hint: if cache hit-rate is unexpectedly low, inspect whether this cap is too small.
 */
function pruneCache(cache: Map<string, number>, maxEntries: number): void {
  if (cache.size <= maxEntries) {
    return;
  }

  const overflowCount = cache.size - maxEntries;
  let removedCount = 0;

  for (const key of cache.keys()) {
    cache.delete(key);
    removedCount += 1;
    if (removedCount >= overflowCount) {
      break;
    }
  }
}

/**
 * Build a sorter instance with isolated cache space.
 */
export function createLinkSorter(config: LinkSorterConfig = {}) {
  const configuredDefaultScore = resolveFiniteNumber(config.defaultScore) ?? DEFAULT_LINK_SORT_SCORE;
  const configuredMaxCacheEntries =
    resolveFiniteNumber(config.maxCacheEntriesPerSnapshot) ?? DEFAULT_MAX_CACHE_ENTRIES_PER_SNAPSHOT;
  const maxCacheEntriesPerSnapshot = Math.max(1, Math.floor(configuredMaxCacheEntries));

  /**
   * Snapshot cache key is the `linkedMemoriesByKey` object identity.
   * If callers pass a new snapshot object, cache is naturally invalidated.
   */
  let scoreCacheBySnapshot = new WeakMap<LinkedMemoriesByKey, Map<string, number>>();

  function getSnapshotCache(snapshot: LinkedMemoriesByKey): Map<string, number> {
    const existing = scoreCacheBySnapshot.get(snapshot);
    if (existing) {
      return existing;
    }

    const created = new Map<string, number>();
    scoreCacheBySnapshot.set(snapshot, created);
    return created;
  }

  /**
   * Resolve score with optional cache.
   *
   * Trigger condition: every comparator invocation needs score for each link.
   */
  function resolveScoreWithCache(
    link: MemoryLinkValue,
    linkedMemoriesByKey: LinkedMemoriesByKey,
    defaultScore: number,
    useCache: boolean,
  ): number {
    if (!link.key) {
      return defaultScore;
    }

    if (!useCache) {
      const directScore = resolveFiniteNumber(linkedMemoriesByKey[link.key]?.meta.score);
      return directScore ?? defaultScore;
    }

    const cache = getSnapshotCache(linkedMemoriesByKey);
    const cachedScore = cache.get(link.key);
    if (cachedScore !== undefined) {
      return cachedScore;
    }

    const resolvedScore = resolveFiniteNumber(linkedMemoriesByKey[link.key]?.meta.score) ?? defaultScore;
    cache.set(link.key, resolvedScore);
    pruneCache(cache, maxCacheEntriesPerSnapshot);
    return resolvedScore;
  }

  /**
   * Sort links by `link.weight * linkedMemory.meta.score` in descending order.
   *
   * Tie-break order:
   * 1) Combined score (desc)
   * 2) Link weight (desc)
   * 3) Link key (asc)
   */
  function sortLinksByCombinedScore(
    links: MemoryLinkValue[],
    linkedMemoriesByKey: LinkedMemoriesByKey,
    options: LinkSortOptions = {},
  ): MemoryLinkValue[] {
    const defaultScore = resolveFiniteNumber(options.defaultScore) ?? configuredDefaultScore;
    const useCache = options.useCache ?? true;

    return [...links].sort((left, right) => {
      const leftCombinedScore =
        left.weight * resolveScoreWithCache(left, linkedMemoriesByKey, defaultScore, useCache);
      const rightCombinedScore =
        right.weight * resolveScoreWithCache(right, linkedMemoriesByKey, defaultScore, useCache);
      const combinedScoreDiff = rightCombinedScore - leftCombinedScore;
      if (combinedScoreDiff !== 0) {
        return combinedScoreDiff;
      }

      // Combined scores are equal, so preserve deterministic order by weight then key.
      const weightDiff = right.weight - left.weight;
      if (weightDiff !== 0) {
        return weightDiff;
      }

      const leftKey = left.key ?? "";
      const rightKey = right.key ?? "";
      return leftKey.localeCompare(rightKey);
    });
  }

  /**
   * Batch-sort multiple link collections.
   *
   * Debug hint: when one batch result seems wrong, locate it by `id` first.
   */
  function sortLinkBatchesByCombinedScore(
    batches: LinkBatchSortInput[],
    linkedMemoriesByKey: LinkedMemoriesByKey,
    options: LinkSortOptions = {},
  ): LinkBatchSortResult[] {
    const results: LinkBatchSortResult[] = [];

    for (const batch of batches) {
      results.push({
        id: batch.id,
        links: sortLinksByCombinedScore(batch.links, linkedMemoriesByKey, options),
      });
    }

    return results;
  }

  /**
   * Explicit cache clear hook for long-lived workers and tests.
   */
  function clearScoreCache(): void {
    scoreCacheBySnapshot = new WeakMap<LinkedMemoriesByKey, Map<string, number>>();
  }

  return {
    sortLinksByCombinedScore,
    sortLinkBatchesByCombinedScore,
    clearScoreCache,
  };
}

const defaultLinkSorter = createLinkSorter();

export const sortLinksByCombinedScore = defaultLinkSorter.sortLinksByCombinedScore;
export const sortLinkBatchesByCombinedScore = defaultLinkSorter.sortLinkBatchesByCombinedScore;
export const clearLinkSorterScoreCache = defaultLinkSorter.clearScoreCache;
