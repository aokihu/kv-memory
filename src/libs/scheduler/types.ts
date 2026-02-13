/**
 * Scheduler module type contracts.
 * Keeps task lifecycle and runtime snapshots consistent across files.
 */

/**
 * Runtime lifecycle state for one scheduled task.
 */
export type SchedulerTaskStatus = "idle" | "running" | "paused" | "stopped";

/**
 * Execution handler for scheduled task work.
 */
export type SchedulerTaskHandler = () => Promise<void> | void;

/**
 * Static task configuration used when creating a task.
 */
export type SchedulerTaskConfig = {
  id: string;
  intervalMs: number;
  handler: SchedulerTaskHandler;
  autoStart?: boolean;
};

/**
 * Mutable runtime counters and timestamps for monitoring.
 */
export type SchedulerTaskMetrics = {
  runCount: number;
  successCount: number;
  failureCount: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastErrorMessage: string | null;
};

/**
 * Read-only snapshot consumed by monitoring callers.
 */
export type SchedulerTaskSnapshot = {
  id: string;
  status: SchedulerTaskStatus;
  intervalMs: number;
  metrics: SchedulerTaskMetrics;
};

/**
 * Summary snapshot for the scheduler runtime.
 */
export type SchedulerSnapshot = {
  totalTaskCount: number;
  runningTaskCount: number;
  pausedTaskCount: number;
  stoppedTaskCount: number;
  tasks: SchedulerTaskSnapshot[];
};
