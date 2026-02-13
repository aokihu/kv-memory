/**
 * Memory decay configuration management.
 * Keep all defaults in one place for deterministic behavior.
 */

import { watch, type FSWatcher } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { DecayConfig, DecayThresholdConfig, DecayWeightConfig } from "./types";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * Time decay related parameters.
 * Use a bounded range so score never drops too aggressively.
 */
export type DecayTimeConfig = {
  minFactor: number;
  maxFactor: number;
  fullDecayHours: number;
};

/**
 * Usage frequency boost parameters.
 * Saturation controls how quickly high access counts reach max boost.
 */
export type DecayUsageBoostConfig = {
  maxBoost: number;
  saturationAccessCount: number;
};

/**
 * Structural importance boost parameters.
 * Link count and average link weight are both normalized by these bounds.
 */
export type DecayStructureBoostConfig = {
  maxBoost: number;
  saturationLinkCount: number;
  minLinkWeight: number;
  maxLinkWeight: number;
};

/**
 * Scheduler parameters for periodic decay runs.
 */
export type DecaySchedulerConfig = {
  intervalMs: number;
  batchSize: number;
};

/**
 * Full algorithm configuration grouped by concern.
 */
export type DecayAlgorithmConfig = {
  minScore: number;
  maxScore: number;
  thresholds: DecayThresholdConfig;
  timeDecay: DecayTimeConfig;
  usageBoost: DecayUsageBoostConfig;
  structureBoost: DecayStructureBoostConfig;
  scheduler: DecaySchedulerConfig;
};

/**
 * Feature toggles for gradual rollout and safe rollback.
 */
export type DecayFeatureToggles = {
  algorithmEnabled: boolean;
  schedulerEnabled: boolean;
  statusClassificationEnabled: boolean;
  monitoringAlertEnabled: boolean;
  loggingEnabled: boolean;
};

export type DecayFeatureTogglesInput = DeepPartial<DecayFeatureToggles>;

export type DecayAlgorithmConfigInput = DeepPartial<DecayAlgorithmConfig>;

/**
 * Backward compatible input type for legacy callers.
 */
export type DecayConfigInput = Partial<Omit<DecayConfig, "thresholds" | "weights">> & {
  thresholds?: Partial<DecayThresholdConfig>;
  weights?: Partial<DecayWeightConfig>;
};

/**
 * Source of a runtime configuration reload.
 */
export type DecayConfigReloadSource = "api" | "file-watch";

/**
 * Event pushed to listeners on config state changes.
 */
export type DecayConfigChangeEvent = {
  type: "config_reloaded" | "config_reload_failed" | "watch_started" | "watch_stopped";
  source: DecayConfigReloadSource;
  version: number;
  occurredAt: string;
  algorithmConfig: DecayAlgorithmConfig;
  featureToggles: DecayFeatureToggles;
  legacyConfig: DecayConfig;
  previousAlgorithmConfig?: DecayAlgorithmConfig;
  previousFeatureToggles?: DecayFeatureToggles;
  previousLegacyConfig?: DecayConfig;
  filePath?: string;
  error?: Error;
};

/**
 * Callback contract for config change subscribers.
 */
export type DecayConfigChangeListener = (event: DecayConfigChangeEvent) => void;

/**
 * File watch controls for config auto reload.
 */
export type DecayConfigWatchHandle = {
  filePath: string;
  stop: () => void;
};

/**
 * Result payload for reload operations.
 */
export type DecayConfigReloadResult = {
  version: number;
  source: DecayConfigReloadSource;
  filePath?: string;
  algorithmConfig: DecayAlgorithmConfig;
  featureToggles: DecayFeatureToggles;
  legacyConfig: DecayConfig;
};

/**
 * Optional envelope shape persisted on disk.
 */
export type PersistedDecayConfig = {
  algorithmConfig?: DecayAlgorithmConfigInput;
  featureToggles?: DecayFeatureTogglesInput;
};

/**
 * Canonical defaults aligned with design.md.
 */
export const DEFAULT_DECAY_ALGORITHM_CONFIG: DecayAlgorithmConfig = {
  minScore: 0,
  maxScore: 100,
  thresholds: {
    activeMinScore: 70,
    coldMinScore: 30,
  },
  timeDecay: {
    minFactor: 0.95,
    maxFactor: 1,
    fullDecayHours: 24 * 30,
  },
  usageBoost: {
    maxBoost: 10,
    saturationAccessCount: 20,
  },
  structureBoost: {
    maxBoost: 5,
    saturationLinkCount: 10,
    minLinkWeight: 0,
    maxLinkWeight: 1,
  },
  scheduler: {
    intervalMs: 15 * 60 * 1000,
    batchSize: 100,
  },
};

/**
 * Default feature switches are fully enabled.
 */
export const DEFAULT_DECAY_FEATURE_TOGGLES: DecayFeatureToggles = {
  algorithmEnabled: true,
  schedulerEnabled: true,
  statusClassificationEnabled: true,
  monitoringAlertEnabled: true,
  loggingEnabled: true,
};

/**
 * Legacy default config kept for compatibility.
 */
export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  minScore: DEFAULT_DECAY_ALGORITHM_CONFIG.minScore,
  maxScore: DEFAULT_DECAY_ALGORITHM_CONFIG.maxScore,
  batchSize: DEFAULT_DECAY_ALGORITHM_CONFIG.scheduler.batchSize,
  intervalMs: DEFAULT_DECAY_ALGORITHM_CONFIG.scheduler.intervalMs,
  thresholds: {
    ...DEFAULT_DECAY_ALGORITHM_CONFIG.thresholds,
  },
  weights: {
    minTimeDecayFactor: DEFAULT_DECAY_ALGORITHM_CONFIG.timeDecay.minFactor,
    maxUsageBoost: DEFAULT_DECAY_ALGORITHM_CONFIG.usageBoost.maxBoost,
    maxStructureBoost: DEFAULT_DECAY_ALGORITHM_CONFIG.structureBoost.maxBoost,
  },
};

function toLegacyDecayConfig(config: DecayAlgorithmConfig): DecayConfig {
  return {
    minScore: config.minScore,
    maxScore: config.maxScore,
    batchSize: config.scheduler.batchSize,
    intervalMs: config.scheduler.intervalMs,
    thresholds: {
      ...config.thresholds,
    },
    weights: {
      minTimeDecayFactor: config.timeDecay.minFactor,
      maxUsageBoost: config.usageBoost.maxBoost,
      maxStructureBoost: config.structureBoost.maxBoost,
    },
  };
}

function toError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(fallbackMessage);
}

function cloneAlgorithmConfig(config: DecayAlgorithmConfig): DecayAlgorithmConfig {
  return {
    minScore: config.minScore,
    maxScore: config.maxScore,
    thresholds: {
      activeMinScore: config.thresholds.activeMinScore,
      coldMinScore: config.thresholds.coldMinScore,
    },
    timeDecay: {
      minFactor: config.timeDecay.minFactor,
      maxFactor: config.timeDecay.maxFactor,
      fullDecayHours: config.timeDecay.fullDecayHours,
    },
    usageBoost: {
      maxBoost: config.usageBoost.maxBoost,
      saturationAccessCount: config.usageBoost.saturationAccessCount,
    },
    structureBoost: {
      maxBoost: config.structureBoost.maxBoost,
      saturationLinkCount: config.structureBoost.saturationLinkCount,
      minLinkWeight: config.structureBoost.minLinkWeight,
      maxLinkWeight: config.structureBoost.maxLinkWeight,
    },
    scheduler: {
      intervalMs: config.scheduler.intervalMs,
      batchSize: config.scheduler.batchSize,
    },
  };
}

function cloneLegacyConfig(config: DecayConfig): DecayConfig {
  return {
    minScore: config.minScore,
    maxScore: config.maxScore,
    batchSize: config.batchSize,
    intervalMs: config.intervalMs,
    thresholds: {
      activeMinScore: config.thresholds.activeMinScore,
      coldMinScore: config.thresholds.coldMinScore,
    },
    weights: {
      minTimeDecayFactor: config.weights.minTimeDecayFactor,
      maxUsageBoost: config.weights.maxUsageBoost,
      maxStructureBoost: config.weights.maxStructureBoost,
    },
  };
}

function cloneFeatureToggles(toggles: DecayFeatureToggles): DecayFeatureToggles {
  return {
    algorithmEnabled: toggles.algorithmEnabled,
    schedulerEnabled: toggles.schedulerEnabled,
    statusClassificationEnabled: toggles.statusClassificationEnabled,
    monitoringAlertEnabled: toggles.monitoringAlertEnabled,
    loggingEnabled: toggles.loggingEnabled,
  };
}

let runtimeAlgorithmConfig = cloneAlgorithmConfig(DEFAULT_DECAY_ALGORITHM_CONFIG);
let runtimeLegacyConfig = cloneLegacyConfig(DEFAULT_DECAY_CONFIG);
let runtimeFeatureToggles = cloneFeatureToggles(DEFAULT_DECAY_FEATURE_TOGGLES);
let runtimeVersion = 1;

const configChangeListeners = new Set<DecayConfigChangeListener>();

let reloadQueue: Promise<void> = Promise.resolve();

let fileWatcher: FSWatcher | null = null;
let watchedConfigPath: string | null = null;
let watchReloadTimer: ReturnType<typeof setTimeout> | null = null;

function mergeAlgorithmConfig(input: DecayAlgorithmConfigInput = {}): DecayAlgorithmConfig {
  return {
    ...DEFAULT_DECAY_ALGORITHM_CONFIG,
    ...input,
    thresholds: {
      ...DEFAULT_DECAY_ALGORITHM_CONFIG.thresholds,
      ...input.thresholds,
    },
    timeDecay: {
      ...DEFAULT_DECAY_ALGORITHM_CONFIG.timeDecay,
      ...input.timeDecay,
    },
    usageBoost: {
      ...DEFAULT_DECAY_ALGORITHM_CONFIG.usageBoost,
      ...input.usageBoost,
    },
    structureBoost: {
      ...DEFAULT_DECAY_ALGORITHM_CONFIG.structureBoost,
      ...input.structureBoost,
    },
    scheduler: {
      ...DEFAULT_DECAY_ALGORITHM_CONFIG.scheduler,
      ...input.scheduler,
    },
  };
}

function mergeFeatureToggles(input: DecayFeatureTogglesInput = {}): DecayFeatureToggles {
  return {
    ...DEFAULT_DECAY_FEATURE_TOGGLES,
    ...input,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!isFiniteNumber(value)) {
    return fallback;
  }

  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
}

function normalizePositiveInteger(value: number, fallback: number): number {
  if (!isFiniteNumber(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

/**
 * Validate normalized feature toggles.
 */
export function validateDecayFeatureToggles(toggles: DecayFeatureToggles): string[] {
  const errors: string[] = [];

  if (!isBoolean(toggles.algorithmEnabled)) {
    errors.push("featureToggles.algorithmEnabled must be boolean");
  }

  if (!isBoolean(toggles.schedulerEnabled)) {
    errors.push("featureToggles.schedulerEnabled must be boolean");
  }

  if (!isBoolean(toggles.statusClassificationEnabled)) {
    errors.push("featureToggles.statusClassificationEnabled must be boolean");
  }

  if (!isBoolean(toggles.monitoringAlertEnabled)) {
    errors.push("featureToggles.monitoringAlertEnabled must be boolean");
  }

  if (!isBoolean(toggles.loggingEnabled)) {
    errors.push("featureToggles.loggingEnabled must be boolean");
  }

  return errors;
}

/**
 * Normalize feature toggles into deterministic booleans.
 */
export function normalizeDecayFeatureToggles(input: DecayFeatureTogglesInput = {}): DecayFeatureToggles {
  const merged = mergeFeatureToggles(input);
  const defaults = DEFAULT_DECAY_FEATURE_TOGGLES;

  return {
    algorithmEnabled: isBoolean(merged.algorithmEnabled) ? merged.algorithmEnabled : defaults.algorithmEnabled,
    schedulerEnabled: isBoolean(merged.schedulerEnabled) ? merged.schedulerEnabled : defaults.schedulerEnabled,
    statusClassificationEnabled: isBoolean(merged.statusClassificationEnabled)
      ? merged.statusClassificationEnabled
      : defaults.statusClassificationEnabled,
    monitoringAlertEnabled: isBoolean(merged.monitoringAlertEnabled)
      ? merged.monitoringAlertEnabled
      : defaults.monitoringAlertEnabled,
    loggingEnabled: isBoolean(merged.loggingEnabled) ? merged.loggingEnabled : defaults.loggingEnabled,
  };
}

/**
 * Resolve full feature toggles with defaults + normalization.
 */
export function resolveDecayFeatureToggles(input: DecayFeatureTogglesInput = {}): DecayFeatureToggles {
  return normalizeDecayFeatureToggles(input);
}

/**
 * Validate normalized algorithm config.
 * Return explicit errors so callers can fail fast in bootstrap checks.
 */
export function validateDecayAlgorithmConfig(config: DecayAlgorithmConfig): string[] {
  const errors: string[] = [];

  if (config.minScore > config.maxScore) {
    errors.push("minScore must be less than or equal to maxScore");
  }

  if (config.thresholds.coldMinScore > config.thresholds.activeMinScore) {
    errors.push("thresholds.coldMinScore must be less than or equal to thresholds.activeMinScore");
  }

  if (config.timeDecay.minFactor > config.timeDecay.maxFactor) {
    errors.push("timeDecay.minFactor must be less than or equal to timeDecay.maxFactor");
  }

  if (config.structureBoost.minLinkWeight > config.structureBoost.maxLinkWeight) {
    errors.push("structureBoost.minLinkWeight must be less than or equal to structureBoost.maxLinkWeight");
  }

  if (config.timeDecay.minFactor < 0 || config.timeDecay.maxFactor > 1) {
    errors.push("timeDecay factors must be within [0, 1]");
  }

  if (config.usageBoost.maxBoost < 0 || config.structureBoost.maxBoost < 0) {
    errors.push("boost max values must be greater than or equal to 0");
  }

  if (config.scheduler.intervalMs <= 0 || config.scheduler.batchSize <= 0) {
    errors.push("scheduler intervalMs and batchSize must be positive");
  }

  return errors;
}

/**
 * Normalize algorithm config into safe and deterministic values.
 * Debug note: if decay outputs look unstable, inspect this function first.
 */
export function normalizeDecayAlgorithmConfig(input: DecayAlgorithmConfigInput = {}): DecayAlgorithmConfig {
  const merged = mergeAlgorithmConfig(input);
  const defaults = DEFAULT_DECAY_ALGORITHM_CONFIG;

  const minScore = isFiniteNumber(merged.minScore) ? merged.minScore : defaults.minScore;
  const maxScore = isFiniteNumber(merged.maxScore) ? merged.maxScore : defaults.maxScore;

  const safeScoreRange =
    minScore <= maxScore
      ? { minScore, maxScore }
      : { minScore: defaults.minScore, maxScore: defaults.maxScore };

  const coldMinScore = clamp(
    merged.thresholds.coldMinScore,
    safeScoreRange.minScore,
    safeScoreRange.maxScore,
    defaults.thresholds.coldMinScore,
  );
  const activeMinScore = clamp(
    merged.thresholds.activeMinScore,
    safeScoreRange.minScore,
    safeScoreRange.maxScore,
    defaults.thresholds.activeMinScore,
  );

  const orderedThresholds =
    coldMinScore <= activeMinScore
      ? { coldMinScore, activeMinScore }
      : {
          coldMinScore: defaults.thresholds.coldMinScore,
          activeMinScore: defaults.thresholds.activeMinScore,
        };

  const timeDecayMinFactor = clamp(merged.timeDecay.minFactor, 0, 1, defaults.timeDecay.minFactor);
  const timeDecayMaxFactor = clamp(merged.timeDecay.maxFactor, 0, 1, defaults.timeDecay.maxFactor);

  const orderedTimeDecayFactors =
    timeDecayMinFactor <= timeDecayMaxFactor
      ? { minFactor: timeDecayMinFactor, maxFactor: timeDecayMaxFactor }
      : {
          minFactor: defaults.timeDecay.minFactor,
          maxFactor: defaults.timeDecay.maxFactor,
        };

  const structureMinLinkWeight = clamp(
    merged.structureBoost.minLinkWeight,
    0,
    1,
    defaults.structureBoost.minLinkWeight,
  );
  const structureMaxLinkWeight = clamp(
    merged.structureBoost.maxLinkWeight,
    0,
    1,
    defaults.structureBoost.maxLinkWeight,
  );

  const orderedStructureWeights =
    structureMinLinkWeight <= structureMaxLinkWeight
      ? { minLinkWeight: structureMinLinkWeight, maxLinkWeight: structureMaxLinkWeight }
      : {
          minLinkWeight: defaults.structureBoost.minLinkWeight,
          maxLinkWeight: defaults.structureBoost.maxLinkWeight,
        };

  return {
    minScore: safeScoreRange.minScore,
    maxScore: safeScoreRange.maxScore,
    thresholds: {
      coldMinScore: orderedThresholds.coldMinScore,
      activeMinScore: orderedThresholds.activeMinScore,
    },
    timeDecay: {
      minFactor: orderedTimeDecayFactors.minFactor,
      maxFactor: orderedTimeDecayFactors.maxFactor,
      fullDecayHours: normalizePositiveInteger(merged.timeDecay.fullDecayHours, defaults.timeDecay.fullDecayHours),
    },
    usageBoost: {
      maxBoost: Math.max(0, isFiniteNumber(merged.usageBoost.maxBoost) ? merged.usageBoost.maxBoost : defaults.usageBoost.maxBoost),
      saturationAccessCount: normalizePositiveInteger(
        merged.usageBoost.saturationAccessCount,
        defaults.usageBoost.saturationAccessCount,
      ),
    },
    structureBoost: {
      maxBoost: Math.max(
        0,
        isFiniteNumber(merged.structureBoost.maxBoost) ? merged.structureBoost.maxBoost : defaults.structureBoost.maxBoost,
      ),
      saturationLinkCount: normalizePositiveInteger(
        merged.structureBoost.saturationLinkCount,
        defaults.structureBoost.saturationLinkCount,
      ),
      minLinkWeight: orderedStructureWeights.minLinkWeight,
      maxLinkWeight: orderedStructureWeights.maxLinkWeight,
    },
    scheduler: {
      intervalMs: normalizePositiveInteger(merged.scheduler.intervalMs, defaults.scheduler.intervalMs),
      batchSize: normalizePositiveInteger(merged.scheduler.batchSize, defaults.scheduler.batchSize),
    },
  };
}

/**
 * Resolve full algorithm config with defaults + normalization.
 */
export function resolveDecayAlgorithmConfig(input: DecayAlgorithmConfigInput = {}): DecayAlgorithmConfig {
  return normalizeDecayAlgorithmConfig(input);
}

/**
 * Merge runtime overrides with defaults.
 * If score bounds are misconfigured, this function restores safe defaults.
 */
export function resolveDecayConfig(input: DecayConfigInput = {}): DecayConfig {
  const mergedAlgorithmConfig = resolveDecayAlgorithmConfig({
    minScore: input.minScore,
    maxScore: input.maxScore,
    thresholds: input.thresholds,
    timeDecay: {
      minFactor: input.weights?.minTimeDecayFactor,
    },
    usageBoost: {
      maxBoost: input.weights?.maxUsageBoost,
    },
    structureBoost: {
      maxBoost: input.weights?.maxStructureBoost,
    },
    scheduler: {
      batchSize: input.batchSize,
      intervalMs: input.intervalMs,
    },
  });

  return toLegacyDecayConfig(mergedAlgorithmConfig);
}

function notifyConfigChange(event: DecayConfigChangeEvent): void {
  configChangeListeners.forEach((listener) => {
    try {
      listener(event);
    } catch {
      // Debug path: listener failures must not block config updates.
      return;
    }
  });
}

function queueReload<T>(operation: () => Promise<T>): Promise<T> {
  const nextOperation = reloadQueue.then(operation, operation);
  reloadQueue = nextOperation.then(
    () => undefined,
    () => undefined,
  );

  return nextOperation;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parsePersistedConfig(raw: string, filePath: string): {
  algorithmInput: DecayAlgorithmConfigInput;
  featureTogglesInput: DecayFeatureTogglesInput;
} {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw toError(error, `Failed to parse JSON config file: ${filePath}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`Config file must contain a JSON object: ${filePath}`);
  }

  const hasEnvelopeField = "algorithmConfig" in parsed || "featureToggles" in parsed;
  if (!hasEnvelopeField) {
    return {
      algorithmInput: parsed as DecayAlgorithmConfigInput,
      featureTogglesInput: {},
    };
  }

  const algorithmInput = isPlainObject(parsed.algorithmConfig)
    ? (parsed.algorithmConfig as DecayAlgorithmConfigInput)
    : (parsed as DecayAlgorithmConfigInput);

  const featureTogglesInput = isPlainObject(parsed.featureToggles)
    ? (parsed.featureToggles as DecayFeatureTogglesInput)
    : {};

  return {
    algorithmInput,
    featureTogglesInput,
  };
}

function mapLegacyInputToAlgorithmInput(input: DecayConfigInput): DecayAlgorithmConfigInput {
  return {
    minScore: input.minScore,
    maxScore: input.maxScore,
    thresholds: input.thresholds,
    timeDecay: {
      minFactor: input.weights?.minTimeDecayFactor,
    },
    usageBoost: {
      maxBoost: input.weights?.maxUsageBoost,
    },
    structureBoost: {
      maxBoost: input.weights?.maxStructureBoost,
    },
    scheduler: {
      batchSize: input.batchSize,
      intervalMs: input.intervalMs,
    },
  };
}

function buildReloadResult(source: DecayConfigReloadSource, filePath?: string): DecayConfigReloadResult {
  return {
    version: runtimeVersion,
    source,
    filePath,
    algorithmConfig: cloneAlgorithmConfig(runtimeAlgorithmConfig),
    featureToggles: cloneFeatureToggles(runtimeFeatureToggles),
    legacyConfig: cloneLegacyConfig(runtimeLegacyConfig),
  };
}

function applyReload(
  nextAlgorithmConfig: DecayAlgorithmConfig,
  nextFeatureToggles: DecayFeatureToggles,
  source: DecayConfigReloadSource,
  filePath?: string,
): DecayConfigReloadResult {
  const validationErrors = validateDecayAlgorithmConfig(nextAlgorithmConfig);
  if (validationErrors.length > 0) {
    throw new Error(`Invalid decay algorithm config: ${validationErrors.join("; ")}`);
  }

  const toggleValidationErrors = validateDecayFeatureToggles(nextFeatureToggles);
  if (toggleValidationErrors.length > 0) {
    throw new Error(`Invalid decay feature toggles: ${toggleValidationErrors.join("; ")}`);
  }

  const previousAlgorithmConfig = cloneAlgorithmConfig(runtimeAlgorithmConfig);
  const previousFeatureToggles = cloneFeatureToggles(runtimeFeatureToggles);
  const previousLegacyConfig = cloneLegacyConfig(runtimeLegacyConfig);

  runtimeAlgorithmConfig = cloneAlgorithmConfig(nextAlgorithmConfig);
  runtimeFeatureToggles = cloneFeatureToggles(nextFeatureToggles);
  runtimeLegacyConfig = toLegacyDecayConfig(runtimeAlgorithmConfig);
  runtimeVersion += 1;

  const result = buildReloadResult(source, filePath);

  notifyConfigChange({
    type: "config_reloaded",
    source,
    version: result.version,
    occurredAt: new Date().toISOString(),
    filePath,
    algorithmConfig: cloneAlgorithmConfig(runtimeAlgorithmConfig),
    featureToggles: cloneFeatureToggles(runtimeFeatureToggles),
    legacyConfig: cloneLegacyConfig(runtimeLegacyConfig),
    previousAlgorithmConfig,
    previousFeatureToggles,
    previousLegacyConfig,
  });

  return result;
}

async function readPersistedConfigFromFile(filePath: string): Promise<{
  algorithmInput: DecayAlgorithmConfigInput;
  featureTogglesInput: DecayFeatureTogglesInput;
}> {
  const raw = await readFile(filePath, "utf8");
  return parsePersistedConfig(raw, filePath);
}

/**
 * Subscribe to runtime decay config events.
 * Debug tip: register a listener to inspect reload source and errors.
 */
export function subscribeDecayConfigChanges(listener: DecayConfigChangeListener): () => void {
  configChangeListeners.add(listener);
  return () => {
    configChangeListeners.delete(listener);
  };
}

/**
 * Return a safe snapshot of the runtime algorithm config.
 */
export function getRuntimeDecayAlgorithmConfig(): DecayAlgorithmConfig {
  return cloneAlgorithmConfig(runtimeAlgorithmConfig);
}

/**
 * Return a safe snapshot of the runtime legacy config.
 */
export function getRuntimeDecayConfig(): DecayConfig {
  return cloneLegacyConfig(runtimeLegacyConfig);
}

/**
 * Return a safe snapshot of runtime feature toggles.
 */
export function getRuntimeDecayFeatureToggles(): DecayFeatureToggles {
  return cloneFeatureToggles(runtimeFeatureToggles);
}

/**
 * Convenience API for algorithm switch state.
 */
export function isDecayAlgorithmEnabled(): boolean {
  return runtimeFeatureToggles.algorithmEnabled;
}

/**
 * Convenience API for scheduler switch state.
 */
export function isDecaySchedulerEnabled(): boolean {
  return runtimeFeatureToggles.schedulerEnabled;
}

/**
 * Convenience API for status classification switch state.
 */
export function isDecayStatusClassificationEnabled(): boolean {
  return runtimeFeatureToggles.statusClassificationEnabled;
}

/**
 * Convenience API for monitoring and alert switch state.
 */
export function isDecayMonitoringAlertEnabled(): boolean {
  return runtimeFeatureToggles.monitoringAlertEnabled;
}

/**
 * Convenience API for decay logging switch state.
 */
export function isDecayLoggingEnabled(): boolean {
  return runtimeFeatureToggles.loggingEnabled;
}

/**
 * Reload runtime config from algorithm input.
 * The queue guarantees atomic updates when multiple reload requests race.
 */
export async function reloadRuntimeDecayAlgorithmConfig(
  input: DecayAlgorithmConfigInput = {},
  source: DecayConfigReloadSource = "api",
): Promise<DecayConfigReloadResult> {
  return queueReload(async () => {
    try {
      const nextConfig = resolveDecayAlgorithmConfig(input);
      return applyReload(nextConfig, runtimeFeatureToggles, source);
    } catch (error) {
      const normalizedError = toError(error, "Failed to reload runtime decay algorithm config");

      notifyConfigChange({
        type: "config_reload_failed",
        source,
        version: runtimeVersion,
        occurredAt: new Date().toISOString(),
        algorithmConfig: cloneAlgorithmConfig(runtimeAlgorithmConfig),
        featureToggles: cloneFeatureToggles(runtimeFeatureToggles),
        legacyConfig: cloneLegacyConfig(runtimeLegacyConfig),
        error: normalizedError,
      });

      throw normalizedError;
    }
  });
}

/**
 * Reload runtime config from legacy input for compatibility.
 */
export async function reloadRuntimeDecayConfig(
  input: DecayConfigInput = {},
  source: DecayConfigReloadSource = "api",
): Promise<DecayConfigReloadResult> {
  return reloadRuntimeDecayAlgorithmConfig(mapLegacyInputToAlgorithmInput(input), source);
}

/**
 * Reload runtime config from a JSON file.
 */
export async function reloadRuntimeDecayConfigFromFile(
  filePath: string,
  source: DecayConfigReloadSource = "api",
): Promise<DecayConfigReloadResult> {
  return queueReload(async () => {
    try {
      const parsed = await readPersistedConfigFromFile(filePath);
      const nextConfig = resolveDecayAlgorithmConfig(parsed.algorithmInput);
      const hasFeatureTogglePayload = Object.keys(parsed.featureTogglesInput).length > 0;
      const nextFeatureToggles = hasFeatureTogglePayload
        ? resolveDecayFeatureToggles(parsed.featureTogglesInput)
        : cloneFeatureToggles(runtimeFeatureToggles);
      return applyReload(nextConfig, nextFeatureToggles, source, filePath);
    } catch (error) {
      const normalizedError = toError(error, `Failed to reload runtime decay config from file: ${filePath}`);

      notifyConfigChange({
        type: "config_reload_failed",
        source,
        version: runtimeVersion,
        occurredAt: new Date().toISOString(),
        filePath,
        algorithmConfig: cloneAlgorithmConfig(runtimeAlgorithmConfig),
        featureToggles: cloneFeatureToggles(runtimeFeatureToggles),
        legacyConfig: cloneLegacyConfig(runtimeLegacyConfig),
        error: normalizedError,
      });

      throw normalizedError;
    }
  });
}

/**
 * Reload runtime feature toggles from API input.
 */
export async function reloadRuntimeDecayFeatureToggles(
  input: DecayFeatureTogglesInput = {},
  source: DecayConfigReloadSource = "api",
): Promise<DecayConfigReloadResult> {
  return queueReload(async () => {
    try {
      const nextFeatureToggles = resolveDecayFeatureToggles(input);
      return applyReload(cloneAlgorithmConfig(runtimeAlgorithmConfig), nextFeatureToggles, source);
    } catch (error) {
      const normalizedError = toError(error, "Failed to reload runtime decay feature toggles");

      notifyConfigChange({
        type: "config_reload_failed",
        source,
        version: runtimeVersion,
        occurredAt: new Date().toISOString(),
        algorithmConfig: cloneAlgorithmConfig(runtimeAlgorithmConfig),
        featureToggles: cloneFeatureToggles(runtimeFeatureToggles),
        legacyConfig: cloneLegacyConfig(runtimeLegacyConfig),
        error: normalizedError,
      });

      throw normalizedError;
    }
  });
}

/**
 * Update one toggle by key as API-facing control surface.
 */
export async function setRuntimeDecayFeatureToggle(
  toggle: keyof DecayFeatureToggles,
  enabled: boolean,
  source: DecayConfigReloadSource = "api",
): Promise<DecayConfigReloadResult> {
  if (!(toggle in DEFAULT_DECAY_FEATURE_TOGGLES)) {
    throw new Error(`Unknown decay feature toggle: ${String(toggle)}`);
  }

  return reloadRuntimeDecayFeatureToggles({ [toggle]: enabled }, source);
}

/**
 * Reload only feature toggles from a JSON file.
 */
export async function reloadRuntimeDecayFeatureTogglesFromFile(
  filePath: string,
  source: DecayConfigReloadSource = "api",
): Promise<DecayConfigReloadResult> {
  return queueReload(async () => {
    try {
      const parsed = await readPersistedConfigFromFile(filePath);
      const nextFeatureToggles = resolveDecayFeatureToggles(parsed.featureTogglesInput);
      return applyReload(cloneAlgorithmConfig(runtimeAlgorithmConfig), nextFeatureToggles, source, filePath);
    } catch (error) {
      const normalizedError = toError(error, `Failed to reload runtime decay feature toggles from file: ${filePath}`);

      notifyConfigChange({
        type: "config_reload_failed",
        source,
        version: runtimeVersion,
        occurredAt: new Date().toISOString(),
        filePath,
        algorithmConfig: cloneAlgorithmConfig(runtimeAlgorithmConfig),
        featureToggles: cloneFeatureToggles(runtimeFeatureToggles),
        legacyConfig: cloneLegacyConfig(runtimeLegacyConfig),
        error: normalizedError,
      });

      throw normalizedError;
    }
  });
}

/**
 * Persist runtime config and feature toggles to a file.
 */
export async function persistRuntimeDecayConfig(filePath: string): Promise<void> {
  const payload: PersistedDecayConfig = {
    algorithmConfig: cloneAlgorithmConfig(runtimeAlgorithmConfig),
    featureToggles: cloneFeatureToggles(runtimeFeatureToggles),
  };

  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * Persist only feature toggles to a file.
 */
export async function persistRuntimeDecayFeatureToggles(filePath: string): Promise<void> {
  const payload: PersistedDecayConfig = {
    featureToggles: cloneFeatureToggles(runtimeFeatureToggles),
  };

  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function stopWatcherInternal(source: DecayConfigReloadSource = "api"): void {
  if (watchReloadTimer !== null) {
    clearTimeout(watchReloadTimer);
    watchReloadTimer = null;
  }

  if (fileWatcher !== null) {
    fileWatcher.close();
    fileWatcher = null;
  }

  if (watchedConfigPath !== null) {
    const previousPath = watchedConfigPath;
    watchedConfigPath = null;

    notifyConfigChange({
      type: "watch_stopped",
      source,
      version: runtimeVersion,
      occurredAt: new Date().toISOString(),
      filePath: previousPath,
      algorithmConfig: cloneAlgorithmConfig(runtimeAlgorithmConfig),
      featureToggles: cloneFeatureToggles(runtimeFeatureToggles),
      legacyConfig: cloneLegacyConfig(runtimeLegacyConfig),
    });
  }
}

/**
 * Start file-system based auto reload.
 * Debug tip: failures are reported through `config_reload_failed` events.
 */
export function startDecayConfigFileWatch(filePath: string): DecayConfigWatchHandle {
  stopWatcherInternal("api");

  watchedConfigPath = filePath;

  fileWatcher = watch(filePath, { persistent: false }, (eventType) => {
    // `rename` can mean file replacement in editors. Treat it as reload trigger.
    if (eventType !== "change" && eventType !== "rename") {
      return;
    }

    if (watchReloadTimer !== null) {
      clearTimeout(watchReloadTimer);
    }

    watchReloadTimer = setTimeout(() => {
      watchReloadTimer = null;
      void reloadRuntimeDecayConfigFromFile(filePath, "file-watch").catch(() => undefined);
    }, 50);
  });

  fileWatcher.on("error", (error) => {
    const normalizedError = toError(error, `Config file watch failed: ${filePath}`);

    notifyConfigChange({
      type: "config_reload_failed",
      source: "file-watch",
      version: runtimeVersion,
      occurredAt: new Date().toISOString(),
      filePath,
      algorithmConfig: cloneAlgorithmConfig(runtimeAlgorithmConfig),
      featureToggles: cloneFeatureToggles(runtimeFeatureToggles),
      legacyConfig: cloneLegacyConfig(runtimeLegacyConfig),
      error: normalizedError,
    });
  });

  notifyConfigChange({
    type: "watch_started",
    source: "file-watch",
    version: runtimeVersion,
    occurredAt: new Date().toISOString(),
    filePath,
    algorithmConfig: cloneAlgorithmConfig(runtimeAlgorithmConfig),
    featureToggles: cloneFeatureToggles(runtimeFeatureToggles),
    legacyConfig: cloneLegacyConfig(runtimeLegacyConfig),
  });

  return {
    filePath,
    stop: () => stopWatcherInternal("api"),
  };
}

/**
 * Stop active config file watch.
 */
export function stopDecayConfigFileWatch(): void {
  stopWatcherInternal("api");
}
