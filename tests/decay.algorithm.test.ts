/**
 * Decay algorithm unit tests.
 *
 * Focus:
 * - Core score formula and factor calculations.
 * - Status classification and score boundaries.
 * - Error handling and config fallback behavior.
 * - Repeatable execution by resetting module-level runtime state.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
  calculateMemoryScore,
  calculateStructureBoost,
  calculateTimeDecayFactor,
  calculateUsageBoost,
  classifyDecayStatus,
  computeDecayScore,
  resetDecayAlgorithmMetrics,
  updateDecayAlgorithmLogConfig,
} from "../src/libs/decay/algorithm";
import {
  DEFAULT_DECAY_ALGORITHM_CONFIG,
  DEFAULT_DECAY_CONFIG,
  resolveDecayAlgorithmConfig,
  resolveDecayConfig,
  validateDecayAlgorithmConfig,
} from "../src/libs/decay/config";

type TestMemory = {
  key: string;
  summary: string;
  text: string;
  created_at: string;
  updated_at: string;
  meta: {
    score: number;
    access_count: number;
    last_accessed_at: number;
    in_degree: number;
    out_degree: number;
  };
};

function buildMemory(overrides: Partial<TestMemory> = {}): TestMemory {
  const now = Date.now();
  return {
    key: "mem:test",
    summary: "summary",
    text: "text",
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    meta: {
      score: 50,
      access_count: 0,
      last_accessed_at: now,
      in_degree: 0,
      out_degree: 0,
    },
    ...overrides,
    meta: {
      score: 50,
      access_count: 0,
      last_accessed_at: now,
      in_degree: 0,
      out_degree: 0,
      ...overrides.meta,
    },
  };
}

beforeEach(() => {
  resetDecayAlgorithmMetrics();
  updateDecayAlgorithmLogConfig({
    enabled: false,
    outputs: { console: false, file: false, remote: false },
  });
});

describe("calculateMemoryScore", () => {
  it("uses canonical formula", () => {
    const result = calculateMemoryScore(50, 0.98, 2, 1);
    expect(result).toBeCloseTo(52, 6);
  });

  it("clamps result into [0, 100]", () => {
    expect(calculateMemoryScore(100, 1, 10, 5)).toBe(100);
    expect(calculateMemoryScore(0, 0.95, 0, 0)).toBe(0);
  });

  it("throws for invalid factor or boosts", () => {
    expect(() => calculateMemoryScore(50, 0.94, 1, 1)).toThrow("timeDecayFactor must be within [0.95, 1.0]");
    expect(() => calculateMemoryScore(50, 0.98, 11, 1)).toThrow("usageBoost must be within [0, 10]");
    expect(() => calculateMemoryScore(50, 0.98, 1, 6)).toThrow("structureBoost must be within [0, 5]");
  });
});

describe("calculateTimeDecayFactor", () => {
  it("returns 1 when elapsed time is zero or negative", () => {
    const now = 1_700_000_000_000;
    expect(calculateTimeDecayFactor(now, now)).toBeCloseTo(1, 8);
    expect(calculateTimeDecayFactor(now + 1_000, now)).toBeCloseTo(1, 8);
  });

  it("approaches configured min factor as elapsed time grows", () => {
    const now = 1_700_000_000_000;
    const config = { intervalMs: 1_000, weights: { minTimeDecayFactor: 0.95 } };
    const factor = calculateTimeDecayFactor(now - 10_000_000, now, config);
    expect(factor).toBeGreaterThanOrEqual(0.95);
    expect(factor).toBeLessThanOrEqual(1);
    expect(factor).toBeCloseTo(0.95, 3);
  });

  it("throws for invalid inputs", () => {
    expect(() => calculateTimeDecayFactor(Number.NaN)).toThrow("lastAccessTime must be a finite number");
    expect(() => calculateTimeDecayFactor(Date.now(), Number.NaN)).toThrow("currentTime must be a finite number");
  });
});

describe("calculateUsageBoost", () => {
  it("returns zero when access count is zero", () => {
    const now = 1_700_000_000_000;
    const boost = calculateUsageBoost(0, now, now);
    expect(boost).toBe(0);
  });

  it("gives higher boost for recent frequent access", () => {
    const now = 1_700_000_000_000;
    const recent = calculateUsageBoost(20, now - 10_000, now, { intervalMs: 60_000 });
    const old = calculateUsageBoost(20, now - 10 * 60_000, now, { intervalMs: 60_000 });
    expect(recent).toBeGreaterThan(old);
  });

  it("stays within [0, 10]", () => {
    const now = 1_700_000_000_000;
    const boost = calculateUsageBoost(100_000, now, now);
    expect(boost).toBeGreaterThanOrEqual(0);
    expect(boost).toBeLessThanOrEqual(10);
  });

  it("throws for invalid input", () => {
    const now = 1_700_000_000_000;
    expect(() => calculateUsageBoost(-1, now, now)).toThrow("accessCount must be >= 0");
    expect(() => calculateUsageBoost(1, Number.NaN, now)).toThrow("lastAccessTime must be a finite number");
  });
});

describe("calculateStructureBoost", () => {
  it("returns zero when no links", () => {
    expect(calculateStructureBoost(0, 1)).toBe(0);
  });

  it("increases with link count and link weight", () => {
    const low = calculateStructureBoost(2, 0.2);
    const high = calculateStructureBoost(20, 1);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(5);
  });

  it("respects lower maxStructureBoost config", () => {
    const capped = calculateStructureBoost(100, 1, { weights: { maxStructureBoost: 2 } });
    expect(capped).toBeLessThanOrEqual(2);
  });

  it("throws for invalid input", () => {
    expect(() => calculateStructureBoost(-1, 0.5)).toThrow("linkCount must be >= 0");
    expect(() => calculateStructureBoost(1, 1.1)).toThrow("averageLinkWeight must be within [0, 1]");
  });
});

describe("classifyDecayStatus", () => {
  it("classifies by threshold ranges", () => {
    expect(classifyDecayStatus(70)).toBe("active");
    expect(classifyDecayStatus(69)).toBe("cold");
    expect(classifyDecayStatus(30)).toBe("cold");
    expect(classifyDecayStatus(29)).toBe("deprecated");
  });

  it("supports custom threshold config", () => {
    const config = { thresholds: { activeMinScore: 80, coldMinScore: 40 } };
    expect(classifyDecayStatus(79, config)).toBe("cold");
    expect(classifyDecayStatus(39, config)).toBe("deprecated");
  });
});

describe("computeDecayScore", () => {
  it("returns deterministic score breakdown for fixed time input", () => {
    const now = 1_700_000_000_000;
    const memory = buildMemory({
      meta: {
        score: 50,
        access_count: 10,
        last_accessed_at: now - 60_000,
        in_degree: 3,
        out_degree: 2,
      },
    });

    const result = computeDecayScore(memory as unknown as Parameters<typeof computeDecayScore>[0], undefined, now);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.breakdown.baseScore).toBe(50);
    expect(result.breakdown.timeDecayFactor).toBeGreaterThanOrEqual(0.95);
    expect(result.breakdown.timeDecayFactor).toBeLessThanOrEqual(1);
    expect(result.breakdown.usageBoost).toBeGreaterThanOrEqual(0);
    expect(result.breakdown.usageBoost).toBeLessThanOrEqual(10);
    expect(result.breakdown.structureBoost).toBeGreaterThanOrEqual(0);
    expect(result.breakdown.structureBoost).toBeLessThanOrEqual(5);
    expect(["active", "cold", "deprecated"]).toContain(result.status);
  });

  it("falls back to default base score when memory.meta.score is missing", () => {
    const now = 1_700_000_000_000;
    const memory = buildMemory({
      meta: {
        score: undefined as unknown as number,
        access_count: 0,
        last_accessed_at: now,
        in_degree: 0,
        out_degree: 0,
      },
    });

    const result = computeDecayScore(memory as unknown as Parameters<typeof computeDecayScore>[0], undefined, now);
    expect(result.breakdown.baseScore).toBe(DEFAULT_DECAY_CONFIG.maxScore / 2);
  });

  it("throws when memory payload is invalid", () => {
    expect(() => computeDecayScore(undefined as unknown as Parameters<typeof computeDecayScore>[0])).toThrow();
  });
});

describe("config validation", () => {
  it("restores safe score range when minScore > maxScore", () => {
    const resolved = resolveDecayAlgorithmConfig({ minScore: 100, maxScore: 10 });
    expect(resolved.minScore).toBe(DEFAULT_DECAY_ALGORITHM_CONFIG.minScore);
    expect(resolved.maxScore).toBe(DEFAULT_DECAY_ALGORITHM_CONFIG.maxScore);
  });

  it("resolves legacy config with safe defaults for invalid scheduler values", () => {
    const resolved = resolveDecayConfig({ batchSize: -10, intervalMs: 0 });
    expect(resolved.batchSize).toBe(DEFAULT_DECAY_CONFIG.batchSize);
    expect(resolved.intervalMs).toBe(DEFAULT_DECAY_CONFIG.intervalMs);
  });

  it("reports validation errors for invalid algorithm config", () => {
    const errors = validateDecayAlgorithmConfig({
      ...DEFAULT_DECAY_ALGORITHM_CONFIG,
      thresholds: { activeMinScore: 20, coldMinScore: 30 },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toContain("thresholds.coldMinScore must be less than or equal to thresholds.activeMinScore");
  });
});
