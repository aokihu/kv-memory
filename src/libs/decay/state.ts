/**
 * Memory decay state management.
 *
 * This module centralizes score-to-state classification and state transition
 * checks so all callers use identical lifecycle rules.
 */

import { DEFAULT_DECAY_ALGORITHM_CONFIG } from "./config";
import type { DecayConfig, DecayStatus, DecayThresholdConfig } from "./types";

/**
 * Runtime input for state classification.
 * `thresholds` can be partially overridden; missing values fall back to defaults.
 */
export type MemoryStateConfig = {
  thresholds?: Partial<DecayThresholdConfig>;
};

/**
 * State transition inspection result.
 */
export type MemoryStateTransition = {
  previousState: DecayStatus;
  currentState: DecayStatus;
  changed: boolean;
};

function resolveThresholds(config?: MemoryStateConfig | Pick<DecayConfig, "thresholds">): DecayThresholdConfig {
  return {
    ...DEFAULT_DECAY_ALGORITHM_CONFIG.thresholds,
    ...config?.thresholds,
  };
}

/**
 * Classify memory lifecycle state from score.
 *
 * Debug note: if state output is unexpected, inspect resolved thresholds first,
 * then verify incoming score boundaries.
 */
export function classifyMemoryState(
  score: number,
  config?: MemoryStateConfig | Pick<DecayConfig, "thresholds">,
): DecayStatus {
  const thresholds = resolveThresholds(config);

  // Highest priority branch: score at/above active threshold stays active.
  if (score >= thresholds.activeMinScore) {
    return "active";
  }

  // Middle band branch: score between cold and active thresholds is cold.
  if (score >= thresholds.coldMinScore) {
    return "cold";
  }

  // Lowest band fallback: any score below cold threshold is deprecated.
  return "deprecated";
}

/**
 * Query current memory state by score.
 *
 * This is a semantic alias for callers that need a read-style API name.
 */
export function getMemoryState(
  score: number,
  config?: MemoryStateConfig | Pick<DecayConfig, "thresholds">,
): DecayStatus {
  return classifyMemoryState(score, config);
}

/**
 * Detect whether lifecycle state changed between two score snapshots.
 *
 * Debug note: use returned previousState/currentState to trace threshold
 * boundary crossings in decay batch processing logs.
 */
export function detectMemoryStateTransition(
  previousScore: number,
  currentScore: number,
  config?: MemoryStateConfig | Pick<DecayConfig, "thresholds">,
): MemoryStateTransition {
  const previousState = classifyMemoryState(previousScore, config);
  const currentState = classifyMemoryState(currentScore, config);

  return {
    previousState,
    currentState,
    changed: previousState !== currentState,
  };
}
