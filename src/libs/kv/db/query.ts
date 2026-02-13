/**
 * Query mapping helpers for memory SQLite storage.
 *
 * This module centralizes row<->domain conversion so KV layer keeps business flow clear.
 * Debug entry point: inspect `memoryRowToMemory()` when read result looks malformed.
 */

import type { Memory, MemoryLinkValue, MemoryMeta } from "../../../type";
import { MemoryLink, MemoryMetaSchema, MemorySchema } from "../../../type";
import { DEFAULT_DECAY_ALGORITHM_CONFIG } from "../../decay/config";

/**
 * Raw row shape returned from `memories` table reads.
 */
export type MemoryRow = {
  key: string;
  summary: string;
  text: string;
  meta: string;
  created_at: number;
};

/**
 * Raw row shape for `memory_links` insert operations.
 */
export type MemoryLinkRow = {
  from_key: string;
  to_key: string;
  link_type: string;
  term: string;
  weight: number;
  created_at: number;
};

export type MemoryLinkRelationReadRow = {
  to_key: string;
  link_type: string;
  term: string;
  weight: number;
};

/**
 * Query-time lifecycle states supported by DB filtering.
 */
export type QueryMemoryState = "active" | "cold" | "deprecated";

/**
 * Backward-compatible optional state filter input.
 *
 * - `states`: include only these states
 * - `excludeStates`: remove these states from result set
 */
export type MemoryStateFilter = {
  states?: QueryMemoryState | QueryMemoryState[];
  excludeStates?: QueryMemoryState | QueryMemoryState[];
  scoreMin?: number;
  scoreMax?: number;
};

/**
 * Supported sort fields for memory list queries.
 */
export type MemorySortByField = "score" | "created_at";

/**
 * Supported sort direction.
 */
export type MemorySortOrder = "asc" | "desc";

/**
 * Backward-compatible sort input.
 *
 * - Single field: `"score"`
 * - Multi field: `["score", "created_at"]`
 */
export type MemorySortByInput = MemorySortByField | MemorySortByField[];

/**
 * Backward-compatible sort direction input.
 *
 * - Single order: `"desc"`
 * - Multi order: `["desc", "asc"]`
 */
export type MemorySortOrderInput = MemorySortOrder | MemorySortOrder[];

/**
 * SQL fragment produced by state filter builder.
 */
export type MemoryStateWhereClause = {
  sql: string;
  params: Array<number | string>;
};

/**
 * Statistics export format selector.
 */
export type MemoryStateStatisticsExportFormat = "json" | "csv" | "both";

/**
 * Optional time-range and output settings for state statistics.
 */
export type MemoryStateStatisticsOptions = {
  fromTimestamp?: number;
  toTimestamp?: number;
  histogramBinSize?: number;
  cacheTtlMs?: number;
  exportFormat?: MemoryStateStatisticsExportFormat;
};

/**
 * Score histogram bucket.
 */
export type MemoryScoreHistogramBucket = {
  rangeStart: number;
  rangeEnd: number;
  count: number;
};

/**
 * Transition pair between stored status and score-derived state.
 */
export type MemoryStateTransitionStatistic = {
  fromState: QueryMemoryState;
  toState: QueryMemoryState;
  count: number;
};

/**
 * Return payload for state statistics API.
 */
export type MemoryStateStatistics = {
  generatedAt: number;
  timeRange: {
    fromTimestamp?: number;
    toTimestamp?: number;
  };
  counts: {
    active: number;
    cold: number;
    deprecated: number;
    total: number;
  };
  percentages: {
    active: number;
    cold: number;
    deprecated: number;
  };
  averageScore: number | null;
  histogram: MemoryScoreHistogramBucket[];
  transitions: {
    total: number;
    pairs: MemoryStateTransitionStatistic[];
  };
  export: {
    json?: string;
    csv?: string;
  };
};

type QueryResultRow = Record<string, unknown>;

type StatisticsQuery = {
  get: (...params: Array<number | string>) => QueryResultRow | null | undefined;
  all: (...params: Array<number | string>) => QueryResultRow[];
};

/**
 * Minimal DB contract used by statistics query.
 */
export type MemoryStatisticsReadableDb = {
  query: (sql: string) => StatisticsQuery;
};

type ScoreThresholds = typeof DEFAULT_DECAY_ALGORITHM_CONFIG.thresholds;

const QUERY_MEMORY_STATES: QueryMemoryState[] = ["active", "cold", "deprecated"];
const QUERY_MEMORY_SORT_FIELDS: MemorySortByField[] = ["score", "created_at"];
const QUERY_MEMORY_SORT_ORDERS: MemorySortOrder[] = ["asc", "desc"];
const DEFAULT_STATS_CACHE_TTL_MS = 30_000;
const DEFAULT_HISTOGRAM_BIN_SIZE = 10;
const MAX_STATISTICS_CACHE_ENTRIES = 32;
const memoryStateStatisticsCache = new Map<
  string,
  {
    expiresAt: number;
    value: MemoryStateStatistics;
  }
>();

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function toState(value: unknown): QueryMemoryState | null {
  if (value === "active" || value === "cold" || value === "deprecated") {
    return value;
  }

  return null;
}

/**
 * Normalize histogram bin size.
 *
 * Debug hint: if bucket distribution looks too sparse, inspect resolved bin size first.
 */
function resolveHistogramBinSize(binSize?: number): number {
  const resolved = Math.floor(binSize ?? DEFAULT_HISTOGRAM_BIN_SIZE);
  if (resolved <= 0 || resolved > 100) {
    throw new Error(`Invalid histogram bin size: ${binSize}`);
  }

  return resolved;
}

/**
 * Build created_at range filter for statistics queries.
 */
function buildTimeRangeWhereClause(options?: MemoryStateStatisticsOptions): MemoryStateWhereClause {
  const fragments: string[] = [];
  const params: Array<number | string> = [];

  if (typeof options?.fromTimestamp === "number") {
    fragments.push("created_at >= ?");
    params.push(options.fromTimestamp);
  }

  if (typeof options?.toTimestamp === "number") {
    fragments.push("created_at <= ?");
    params.push(options.toTimestamp);
  }

  if (fragments.length === 0) {
    return { sql: "", params: [] };
  }

  return {
    sql: fragments.join(" AND "),
    params,
  };
}

function formatPercentage(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatAverageScore(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

/**
 * Export payload to CSV for monitoring pipelines.
 */
function buildStatisticsCsv(statistics: Omit<MemoryStateStatistics, "export">): string {
  const lines = [
    "section,key,value",
    `counts,active,${statistics.counts.active}`,
    `counts,cold,${statistics.counts.cold}`,
    `counts,deprecated,${statistics.counts.deprecated}`,
    `counts,total,${statistics.counts.total}`,
    `percentages,active,${statistics.percentages.active}`,
    `percentages,cold,${statistics.percentages.cold}`,
    `percentages,deprecated,${statistics.percentages.deprecated}`,
    `scores,average,${statistics.averageScore ?? ""}`,
    `transitions,total,${statistics.transitions.total}`,
  ];

  for (const bucket of statistics.histogram) {
    lines.push(`histogram,${bucket.rangeStart}-${bucket.rangeEnd},${bucket.count}`);
  }

  for (const pair of statistics.transitions.pairs) {
    lines.push(`transition,${pair.fromState}->${pair.toState},${pair.count}`);
  }

  return lines.join("\n");
}

function buildStatisticsExport(
  statistics: Omit<MemoryStateStatistics, "export">,
  format: MemoryStateStatisticsExportFormat,
): MemoryStateStatistics["export"] {
  if (format === "json") {
    return {
      json: JSON.stringify(statistics),
    };
  }

  if (format === "csv") {
    return {
      csv: buildStatisticsCsv(statistics),
    };
  }

  return {
    json: JSON.stringify(statistics),
    csv: buildStatisticsCsv(statistics),
  };
}

function buildStatisticsCacheKey(
  options: MemoryStateStatisticsOptions,
  thresholds: ScoreThresholds,
  binSize: number,
): string {
  return [
    options.fromTimestamp ?? "",
    options.toTimestamp ?? "",
    options.exportFormat ?? "both",
    options.cacheTtlMs ?? DEFAULT_STATS_CACHE_TTL_MS,
    binSize,
    thresholds.activeMinScore,
    thresholds.coldMinScore,
  ].join("|");
}

/**
 * Keeps cache bounded so long-running workers do not accumulate stale keys.
 */
function pruneStatisticsCache(now: number): void {
  for (const [key, item] of memoryStateStatisticsCache.entries()) {
    if (item.expiresAt <= now) {
      memoryStateStatisticsCache.delete(key);
    }
  }

  if (memoryStateStatisticsCache.size <= MAX_STATISTICS_CACHE_ENTRIES) {
    return;
  }

  const overflow = memoryStateStatisticsCache.size - MAX_STATISTICS_CACHE_ENTRIES;
  let removed = 0;
  for (const key of memoryStateStatisticsCache.keys()) {
    memoryStateStatisticsCache.delete(key);
    removed += 1;
    if (removed >= overflow) {
      break;
    }
  }
}

/**
 * Build lifecycle statistics for monitoring and export.
 *
 * Transition statistics use `meta.status` as previous state and current score-derived
 * classification as current state. This helps detect pending status updates.
 */
export function getMemoryStateStatistics(
  db: MemoryStatisticsReadableDb,
  options: MemoryStateStatisticsOptions = {},
  thresholds: ScoreThresholds = DEFAULT_DECAY_ALGORITHM_CONFIG.thresholds,
): MemoryStateStatistics {
  const now = Date.now();
  const cacheTtlMs = Math.max(0, Math.floor(options.cacheTtlMs ?? DEFAULT_STATS_CACHE_TTL_MS));
  const binSize = resolveHistogramBinSize(options.histogramBinSize);
  const exportFormat = options.exportFormat ?? "both";
  const timeRangeClause = buildTimeRangeWhereClause(options);
  const scoreExpr = "CAST(json_extract(meta, '$.score') AS REAL)";
  const statusExpr = "json_extract(meta, '$.status')";
  const stateByScoreExpr = `CASE WHEN ${scoreExpr} >= ${thresholds.activeMinScore} THEN 'active' WHEN ${scoreExpr} >= ${thresholds.coldMinScore} THEN 'cold' ELSE 'deprecated' END`;
  const cacheKey = buildStatisticsCacheKey(options, thresholds, binSize);

  pruneStatisticsCache(now);
  const cacheHit = memoryStateStatisticsCache.get(cacheKey);
  if (cacheHit && cacheHit.expiresAt > now) {
    return cacheHit.value;
  }

  const whereSql = timeRangeClause.sql ? `WHERE ${timeRangeClause.sql}` : "";
  const aggregateQuery = db.query(`
    SELECT
      SUM(CASE WHEN ${stateByScoreExpr} = 'active' THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN ${stateByScoreExpr} = 'cold' THEN 1 ELSE 0 END) AS cold_count,
      SUM(CASE WHEN ${stateByScoreExpr} = 'deprecated' THEN 1 ELSE 0 END) AS deprecated_count,
      COUNT(*) AS total_count,
      AVG(${scoreExpr}) AS average_score
    FROM memories
    ${whereSql}
  `);
  const aggregateRow = aggregateQuery.get(...timeRangeClause.params) ?? {};

  const activeCount = toNumber(aggregateRow.active_count);
  const coldCount = toNumber(aggregateRow.cold_count);
  const deprecatedCount = toNumber(aggregateRow.deprecated_count);
  const totalCount = toNumber(aggregateRow.total_count);
  const averageScoreRaw = aggregateRow.average_score;
  const averageScore =
    averageScoreRaw === null || averageScoreRaw === undefined
      ? null
      : formatAverageScore(toNumber(averageScoreRaw, 0));

  const denominator = totalCount > 0 ? totalCount : 1;
  const percentages = {
    active: formatPercentage((activeCount / denominator) * 100),
    cold: formatPercentage((coldCount / denominator) * 100),
    deprecated: formatPercentage((deprecatedCount / denominator) * 100),
  };

  const histogramQuery = db.query(`
    SELECT
      CAST(${scoreExpr} / ? AS INTEGER) AS bucket_index,
      COUNT(*) AS bucket_count
    FROM memories
    ${whereSql ? `${whereSql} AND` : "WHERE"} ${scoreExpr} IS NOT NULL
    GROUP BY bucket_index
    ORDER BY bucket_index ASC
  `);
  const histogramRows = histogramQuery.all(binSize, ...timeRangeClause.params);
  const histogram: MemoryScoreHistogramBucket[] = histogramRows.map((row) => {
    const bucketIndex = toNumber(row.bucket_index);
    const rangeStart = bucketIndex * binSize;
    const rangeEnd = Math.min(rangeStart + binSize - 1, 100);

    return {
      rangeStart,
      rangeEnd,
      count: toNumber(row.bucket_count),
    };
  });

  const transitionQuery = db.query(`
    SELECT
      ${statusExpr} AS from_state,
      ${stateByScoreExpr} AS to_state,
      COUNT(*) AS transition_count
    FROM memories
    ${whereSql ? `${whereSql} AND` : "WHERE"} ${statusExpr} IN ('active', 'cold', 'deprecated')
      AND ${statusExpr} != ${stateByScoreExpr}
    GROUP BY from_state, to_state
    ORDER BY from_state, to_state
  `);
  const transitionRows = transitionQuery.all(...timeRangeClause.params);
  const transitionPairs: MemoryStateTransitionStatistic[] = [];
  let transitionTotal = 0;
  for (const row of transitionRows) {
    const fromState = toState(row.from_state);
    const toStateValue = toState(row.to_state);
    if (!fromState || !toStateValue) {
      continue;
    }

    const count = toNumber(row.transition_count);
    transitionTotal += count;
    transitionPairs.push({
      fromState,
      toState: toStateValue,
      count,
    });
  }

  const statisticsCore: Omit<MemoryStateStatistics, "export"> = {
    generatedAt: now,
    timeRange: {
      fromTimestamp: options.fromTimestamp,
      toTimestamp: options.toTimestamp,
    },
    counts: {
      active: activeCount,
      cold: coldCount,
      deprecated: deprecatedCount,
      total: totalCount,
    },
    percentages,
    averageScore,
    histogram,
    transitions: {
      total: transitionTotal,
      pairs: transitionPairs,
    },
  };

  const result: MemoryStateStatistics = {
    ...statisticsCore,
    export: buildStatisticsExport(statisticsCore, exportFormat),
  };

  if (cacheTtlMs > 0) {
    memoryStateStatisticsCache.set(cacheKey, {
      expiresAt: now + cacheTtlMs,
      value: result,
    });
  }

  return result;
}

/**
 * Convert input into a deduplicated array.
 *
 * Debug hint: if filters look ignored, check normalized values first.
 */
function normalizeStateList(input?: QueryMemoryState | QueryMemoryState[]): QueryMemoryState[] {
  if (!input) {
    return [];
  }

  const list = Array.isArray(input) ? input : [input];
  const unique = [...new Set(list)];

  for (const state of unique) {
    if (!QUERY_MEMORY_STATES.includes(state)) {
      throw new Error(`Invalid memory state filter: ${state}`);
    }
  }

  return unique;
}

/**
 * Normalize sorting fields into validated list.
 *
 * Debug hint: when sort appears ignored, inspect this normalized list first.
 */
function normalizeSortByList(input?: MemorySortByInput): MemorySortByField[] {
  if (!input) {
    return [];
  }

  const list = Array.isArray(input) ? input : [input];
  const unique = [...new Set(list)];

  for (const field of unique) {
    if (!QUERY_MEMORY_SORT_FIELDS.includes(field)) {
      throw new Error(`Invalid sortBy field: ${field}`);
    }
  }

  return unique;
}

/**
 * Normalize sorting directions and map them to each sort field.
 */
function normalizeSortOrderList(input: MemorySortOrderInput | undefined, sortFieldCount: number): MemorySortOrder[] {
  const defaultList: MemorySortOrder[] = Array(sortFieldCount).fill("desc");
  if (sortFieldCount <= 0) {
    return [];
  }

  if (!input) {
    return defaultList;
  }

  const list = Array.isArray(input) ? input : [input];

  for (const order of list) {
    if (!QUERY_MEMORY_SORT_ORDERS.includes(order)) {
      throw new Error(`Invalid sortOrder: ${order}`);
    }
  }

  if (list.length === 1) {
    return Array(sortFieldCount).fill(list[0]);
  }

  if (list.length !== sortFieldCount) {
    throw new Error("Invalid sortOrder: order count must be 1 or match sortBy field count");
  }

  return list;
}

/**
 * Build ORDER BY clause for memory query sorting.
 *
 * Optimization note: direct `score` ordering allows SQLite to use score index.
 */
export function buildMemorySortOrderByClause(
  sortBy?: MemorySortByInput,
  sortOrder: MemorySortOrderInput = "desc",
): string {
  const fields = normalizeSortByList(sortBy);
  if (fields.length === 0) {
    return "";
  }

  const orders = normalizeSortOrderList(sortOrder, fields.length);
  const orderFragments: string[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const order = (orders[index] ?? "desc").toUpperCase();
    orderFragments.push(`${field} ${order}`);
  }

  return `ORDER BY ${orderFragments.join(", ")}`;
}

const DEFAULT_LINK_SORT_SCORE = 50;

/**
 * Sort links by `link.weight * linkedMemory.meta.score` in descending order.
 *
 * Tie-break order:
 * 1) Combined score (desc)
 * 2) Link weight (desc)
 * 3) Link key (asc, alphabetical)
 *
 * Debug hint: if sorted order looks unexpected, inspect each link's resolved
 * score from `linkedMemoriesByKey` and verify missing scores fallback to 50.
 */
export function sortLinksByCombinedScore(
  links: MemoryLinkValue[],
  linkedMemoriesByKey: Record<string, Memory | undefined>,
): MemoryLinkValue[] {
  const resolveScore = (link: MemoryLinkValue): number => {
    const linkedMemory = link.key ? linkedMemoriesByKey[link.key] : undefined;
    const score = linkedMemory?.meta.score;

    if (typeof score === "number" && Number.isFinite(score)) {
      return score;
    }

    return DEFAULT_LINK_SORT_SCORE;
  };

  return [...links].sort((left, right) => {
    const leftCombinedScore = left.weight * resolveScore(left);
    const rightCombinedScore = right.weight * resolveScore(right);
    const combinedScoreDiff = rightCombinedScore - leftCombinedScore;
    if (combinedScoreDiff !== 0) {
      return combinedScoreDiff;
    }

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
 * Validate one score boundary from filter input.
 *
 * Debug hint: if callers pass string scores, this throws immediately so the
 * invalid parameter source can be traced at controller/service boundary.
 */
function normalizeScoreBoundary(
  value: number | undefined,
  fieldName: "scoreMin" | "scoreMax",
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${fieldName}: expected finite number`);
  }

  if (value < 0 || value > 100) {
    throw new Error(`Invalid ${fieldName}: expected value between 0 and 100`);
  }

  return value;
}

/**
 * Build SQL where clause for score range filtering.
 *
 * Optimization note: direct `score` comparisons keep query index-friendly.
 */
function buildScoreRangeWhereClause(filter?: MemoryStateFilter): MemoryStateWhereClause {
  const scoreMin = normalizeScoreBoundary(filter?.scoreMin, "scoreMin");
  const scoreMax = normalizeScoreBoundary(filter?.scoreMax, "scoreMax");

  if (scoreMin !== undefined && scoreMax !== undefined && scoreMin > scoreMax) {
    throw new Error("Invalid score range: scoreMin cannot be greater than scoreMax");
  }

  const fragments: string[] = [];
  const params: Array<number | string> = [];

  if (scoreMin !== undefined) {
    fragments.push("score >= ?");
    params.push(scoreMin);
  }

  if (scoreMax !== undefined) {
    fragments.push("score <= ?");
    params.push(scoreMax);
  }

  return {
    sql: fragments.join(" AND "),
    params,
  };
}

/**
 * Build score-range SQL condition for one lifecycle state.
 *
 * Optimization note: this uses direct score comparisons so SQLite can use score index.
 */
function buildSingleStateCondition(
  state: QueryMemoryState,
  thresholds: ScoreThresholds,
): MemoryStateWhereClause {
  if (state === "active") {
    return {
      sql: "score >= ?",
      params: [thresholds.activeMinScore],
    };
  }

  if (state === "cold") {
    return {
      sql: "score >= ? AND score < ?",
      params: [thresholds.coldMinScore, thresholds.activeMinScore],
    };
  }

  return {
    sql: "score < ?",
    params: [thresholds.coldMinScore],
  };
}

/**
 * Build SQL where clause for lifecycle state filtering.
 *
 * - Supports single and multi-state inclusion
 * - Supports excluding one or more states
 * - Returns empty clause for no filter to preserve old behavior
 */
export function buildMemoryStateWhereClause(
  filter?: MemoryStateFilter,
  thresholds: ScoreThresholds = DEFAULT_DECAY_ALGORITHM_CONFIG.thresholds,
): MemoryStateWhereClause {
  const includeStates = normalizeStateList(filter?.states);
  const excludeStates = normalizeStateList(filter?.excludeStates);

  const includeStateSet = new Set(includeStates);
  for (const excluded of excludeStates) {
    if (includeStateSet.has(excluded)) {
      throw new Error(`State filter conflict: ${excluded} exists in both states and excludeStates`);
    }
  }

  const fragments: string[] = [];
  const params: Array<number | string> = [];
  const scoreRangeClause = buildScoreRangeWhereClause(filter);

  if (includeStates.length > 0) {
    const includeConditions: string[] = [];
    for (const state of includeStates) {
      const stateCondition = buildSingleStateCondition(state, thresholds);
      includeConditions.push(`(${stateCondition.sql})`);
      params.push(...stateCondition.params);
    }

    fragments.push(`(${includeConditions.join(" OR ")})`);
  }

  if (excludeStates.length > 0) {
    const excludeConditions: string[] = [];
    for (const state of excludeStates) {
      const stateCondition = buildSingleStateCondition(state, thresholds);
      excludeConditions.push(`(${stateCondition.sql})`);
      params.push(...stateCondition.params);
    }

    fragments.push(`NOT (${excludeConditions.join(" OR ")})`);
  }

  if (scoreRangeClause.sql) {
    fragments.push(scoreRangeClause.sql);
    params.push(...scoreRangeClause.params);
  }

  if (fragments.length === 0) {
    return { sql: "", params: [] };
  }

  return {
    sql: fragments.join(" AND "),
    params,
  };
}

/**
 * Backward-compatible SQL helper.
 *
 * Existing callers can keep passing only `baseSql` and `params`.
 * New callers can pass `filter` and sorting params to enable lifecycle filtering and ordering.
 */
export function appendMemoryStateFilter(
  baseSql: string,
  params: Array<number | string> = [],
  filter?: MemoryStateFilter,
  thresholds: ScoreThresholds = DEFAULT_DECAY_ALGORITHM_CONFIG.thresholds,
  sortBy?: MemorySortByInput,
  sortOrder: MemorySortOrderInput = "desc",
): MemoryStateWhereClause {
  const stateClause = buildMemoryStateWhereClause(filter, thresholds);
  const orderByClause = buildMemorySortOrderByClause(sortBy, sortOrder);

  let sql = baseSql;
  const mergedParams = [...params];

  if (!stateClause.sql) {
    if (orderByClause) {
      const hasOrderBy = /\border\s+by\b/i.test(sql);
      if (hasOrderBy) {
        throw new Error("Cannot append sort order: base SQL already contains ORDER BY");
      }

      sql = `${sql} ${orderByClause}`;
    }

    return { sql, params: mergedParams };
  }

  const hasWhere = /\bwhere\b/i.test(sql);
  sql = `${sql}${hasWhere ? " AND " : " WHERE "}${stateClause.sql}`;
  mergedParams.push(...stateClause.params);

  if (orderByClause) {
    const hasOrderBy = /\border\s+by\b/i.test(sql);
    if (hasOrderBy) {
      throw new Error("Cannot append sort order: base SQL already contains ORDER BY");
    }

    sql = `${sql} ${orderByClause}`;
  }

  return {
    sql,
    params: mergedParams,
  };
}

/**
 * Convert DB row into validated `Memory` object.
 *
 * Trigger condition: called after selecting one memory row.
 * Debug hint: malformed JSON or schema drift will throw during parse.
 */
export function memoryRowToMemory(row: MemoryRow): Memory {
  const meta = MemoryMetaSchema.parse(JSON.parse(row.meta));

  return MemorySchema.parse({
    meta,
    summary: row.summary,
    text: row.text,
  });
}

/**
 * Build values used for memories table write.
 *
 * Trigger condition: add/update write path.
 */
export function memoryToWritableColumns(memory: Memory): {
  summary: string;
  text: string;
  meta: string;
  created_at: number;
} {
  const validated = MemorySchema.parse(memory);

  return {
    summary: validated.summary,
    text: validated.text,
    meta: JSON.stringify(validated.meta),
    created_at: validated.meta.created_at,
  };
}

/**
 * Convert memory links to relation table rows.
 *
 * Trigger condition: persist link payload to `memory_links` table.
 * Debug hint: links without `key` are intentionally skipped.
 */
export function linksToRelationRows(
  fromKey: string,
  links: MemoryLinkValue[],
  createdAt: number,
): MemoryLinkRow[] {
  const rows: MemoryLinkRow[] = [];

  for (const rawLink of links) {
    const link = MemoryLink.parse(rawLink);
    if (!link.key) {
      continue;
    }

    rows.push({
      from_key: fromKey,
      to_key: link.key,
      link_type: link.type,
      term: link.term,
      weight: link.weight,
      created_at: createdAt,
    });
  }

  return rows;
}

/**
 * Convert relation table row to memory link payload.
 */
export function relationRowToMemoryLink(row: MemoryLinkRelationReadRow): MemoryLinkValue {
  return MemoryLink.parse({
    type: row.link_type,
    key: row.to_key,
    term: row.term,
    weight: row.weight,
  });
}

/**
 * Merge partial memory patch and return validated full memory.
 *
 * Trigger condition: update flow that receives `Partial<Memory>`.
 */
export function mergeMemoryPatch(current: Memory, patch: Partial<Memory>): Memory {
  return MemorySchema.parse({
    ...current,
    ...patch,
  });
}

/**
 * Build updated meta with new key id.
 */
export function withRenamedMetaId(meta: MemoryMeta, newKey: string): MemoryMeta {
  return MemoryMetaSchema.parse({
    ...meta,
    id: newKey,
  });
}
