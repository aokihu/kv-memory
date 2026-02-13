/**
 * Memory decay algorithm shared types.
 * Defines stable contracts for config and compute modules.
 */

import type { Memory, MemoryMeta } from "../../type";

/**
 * Lifecycle states used by decay score classification.
 */
export type DecayStatus = "active" | "cold" | "deprecated";

/**
 * Thresholds for mapping score to lifecycle status.
 */
export type DecayThresholdConfig = {
  activeMinScore: number;
  coldMinScore: number;
};

/**
 * Tunable weights for score evolution.
 */
export type DecayWeightConfig = {
  minTimeDecayFactor: number;
  maxUsageBoost: number;
  maxStructureBoost: number;
};

/**
 * Decay algorithm runtime configuration.
 */
export type DecayConfig = {
  minScore: number;
  maxScore: number;
  batchSize: number;
  intervalMs: number;
  thresholds: DecayThresholdConfig;
  weights: DecayWeightConfig;
};

/**
 * Minimum memory fields required for decay computation.
 */
export type DecayMemory = Pick<Memory, "summary" | "text"> & {
  key: string;
  meta: Pick<MemoryMeta, "score" | "access_count" | "in_degree" | "out_degree" | "last_accessed_at">;
};

/**
 * Derived values for a single score computation.
 */
export type DecayComputationBreakdown = {
  baseScore: number;
  timeDecayFactor: number;
  usageBoost: number;
  structureBoost: number;
};

/**
 * Result of one decay computation.
 */
export type DecayComputationResult = {
  score: number;
  status: DecayStatus;
  breakdown: DecayComputationBreakdown;
};
