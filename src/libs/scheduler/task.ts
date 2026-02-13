/**
 * Scheduler task entity.
 * Encapsulates timer lifecycle and monitoring metrics for one task.
 */

import type {
  SchedulerTaskConfig,
  SchedulerTaskMetrics,
  SchedulerTaskSnapshot,
  SchedulerTaskStatus,
} from "./types";

/**
 * Single scheduled task with start/stop/pause/resume controls.
 */
export class SchedulerTask {
  private readonly id: string;
  private readonly handler: SchedulerTaskConfig["handler"];

  private intervalMs: number;
  private status: SchedulerTaskStatus;
  private timer: ReturnType<typeof setInterval> | null;
  private isExecuting: boolean;

  private readonly metrics: SchedulerTaskMetrics;

  constructor(config: SchedulerTaskConfig) {
    this.id = config.id;
    this.handler = config.handler;
    this.intervalMs = SchedulerTask.validateIntervalMs(config.intervalMs);
    this.status = "idle";
    this.timer = null;
    this.isExecuting = false;

    this.metrics = {
      runCount: 0,
      successCount: 0,
      failureCount: 0,
      lastRunAt: null,
      nextRunAt: null,
      lastErrorMessage: null,
    };

    if (config.autoStart) {
      this.start();
    }
  }

  /**
   * Starts task timer if it is not already running.
   */
  start(): void {
    if (this.status === "running") {
      return;
    }

    this.clearTimer();
    this.status = "running";
    this.metrics.nextRunAt = Date.now() + this.intervalMs;
    this.timer = setInterval(() => {
      void this.execute();
    }, this.intervalMs);
  }

  /**
   * Stops task and clears future schedule.
   */
  stop(): void {
    this.clearTimer();
    this.status = "stopped";
    this.metrics.nextRunAt = null;
  }

  /**
   * Pauses a running task and keeps counters unchanged.
   */
  pause(): void {
    if (this.status !== "running") {
      return;
    }

    this.clearTimer();
    this.status = "paused";
    this.metrics.nextRunAt = null;
  }

  /**
   * Resumes task only from paused state.
   */
  resume(): void {
    if (this.status !== "paused") {
      return;
    }

    this.start();
  }

  /**
   * Updates interval and reapplies timer when task is running.
   */
  setIntervalMs(intervalMs: number): void {
    this.intervalMs = SchedulerTask.validateIntervalMs(intervalMs);

    // Debug entry: when interval changes at runtime, recreate timer to apply new cadence.
    if (this.status === "running") {
      this.clearTimer();
      this.metrics.nextRunAt = Date.now() + this.intervalMs;
      this.timer = setInterval(() => {
        void this.execute();
      }, this.intervalMs);
    }
  }

  /**
   * Returns task id.
   */
  getId(): string {
    return this.id;
  }

  /**
   * Returns read-only snapshot for monitoring.
   */
  getSnapshot(): SchedulerTaskSnapshot {
    return {
      id: this.id,
      status: this.status,
      intervalMs: this.intervalMs,
      metrics: {
        runCount: this.metrics.runCount,
        successCount: this.metrics.successCount,
        failureCount: this.metrics.failureCount,
        lastRunAt: this.metrics.lastRunAt,
        nextRunAt: this.metrics.nextRunAt,
        lastErrorMessage: this.metrics.lastErrorMessage,
      },
    };
  }

  /**
   * Executes handler with overlap guard and metrics update.
   */
  private async execute(): Promise<void> {
    if (this.isExecuting || this.status !== "running") {
      // Debug entry: skipped because previous tick still running or task no longer active.
      return;
    }

    this.isExecuting = true;
    this.metrics.runCount += 1;
    this.metrics.lastRunAt = Date.now();

    try {
      await this.handler();
      this.metrics.successCount += 1;
      this.metrics.lastErrorMessage = null;
    } catch (error) {
      this.metrics.failureCount += 1;
      this.metrics.lastErrorMessage =
        error instanceof Error ? error.message : String(error);
    } finally {
      this.isExecuting = false;

      if (this.status === "running") {
        this.metrics.nextRunAt = Date.now() + this.intervalMs;
      }
    }
  }

  /**
   * Clears timer safely when lifecycle changes.
   */
  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Normalizes interval input and rejects invalid values.
   */
  private static validateIntervalMs(intervalMs: number): number {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error("intervalMs must be a positive number");
    }

    return Math.floor(intervalMs);
  }
}
