/**
 * Scheduler integration tests for memory decay workflow.
 * Focuses on lifecycle controls, timed execution, monitoring, and recovery behavior.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { initializeMemoryDecayScheduler } from "../src/libs/decay/scheduler-integration";
import { Scheduler } from "../src/libs/scheduler";

/**
 * Sleep helper used to allow timer-based tasks to advance.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Polls until predicate is true or timeout is reached.
 * Debug start point when a timing-sensitive assertion flakes.
 */
async function waitFor(
  predicate: () => boolean,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    timeoutMessage?: string;
  } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 1_500;
  const intervalMs = options.intervalMs ?? 10;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    if (predicate()) {
      return;
    }

    await sleep(intervalMs);
  }

  throw new Error(options.timeoutMessage ?? `waitFor timeout after ${timeoutMs}ms`);
}

const teardownCallbacks: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (teardownCallbacks.length > 0) {
    const callback = teardownCallbacks.pop();
    if (!callback) {
      continue;
    }

    await callback();
  }
});

describe("decay scheduler integration", () => {
  it("initializes scheduler and applies task configuration", () => {
    const scheduler = new Scheduler();
    teardownCallbacks.push(() => scheduler.stopAll());

    scheduler.registerTask({
      id: "config-task",
      intervalMs: 40,
      handler: () => {},
      autoStart: true,
    });

    const beforeUpdate = scheduler.getTaskSnapshot("config-task");
    expect(beforeUpdate.status).toBe("running");
    expect(beforeUpdate.intervalMs).toBe(40);
    expect(beforeUpdate.metrics.nextRunAt).not.toBeNull();

    scheduler.setTaskInterval("config-task", 25);
    const afterUpdate = scheduler.getTaskSnapshot("config-task");
    expect(afterUpdate.intervalMs).toBe(25);
    expect(afterUpdate.status).toBe("running");
  });

  it("controls task lifecycle start, pause, resume, and stop", async () => {
    const scheduler = new Scheduler();
    teardownCallbacks.push(() => scheduler.stopAll());

    let runCounter = 0;
    scheduler.registerTask({
      id: "lifecycle-task",
      intervalMs: 20,
      handler: () => {
        runCounter += 1;
      },
    });

    scheduler.startTask("lifecycle-task");
    await waitFor(() => runCounter >= 1, {
      timeoutMessage: "task did not start in time",
    });

    scheduler.pauseTask("lifecycle-task");
    const pausedCount = runCounter;
    await sleep(70);
    expect(runCounter).toBe(pausedCount);

    scheduler.resumeTask("lifecycle-task");
    await waitFor(() => runCounter > pausedCount, {
      timeoutMessage: "task did not resume in time",
    });

    scheduler.stopTask("lifecycle-task");
    const stoppedCount = runCounter;
    await sleep(70);
    expect(runCounter).toBe(stoppedCount);

    const snapshot = scheduler.getTaskSnapshot("lifecycle-task");
    expect(snapshot.status).toBe("stopped");
    expect(snapshot.metrics.nextRunAt).toBeNull();
  });

  it("executes scheduled tasks repeatedly and updates metrics", async () => {
    const scheduler = new Scheduler();
    teardownCallbacks.push(() => scheduler.stopAll());

    scheduler.registerTask({
      id: "timed-task",
      intervalMs: 15,
      handler: () => {},
      autoStart: true,
    });

    await waitFor(() => scheduler.getTaskSnapshot("timed-task").metrics.runCount >= 3, {
      timeoutMessage: "scheduled task did not run expected times",
    });

    const snapshot = scheduler.getTaskSnapshot("timed-task");
    expect(snapshot.metrics.runCount).toBeGreaterThanOrEqual(3);
    expect(snapshot.metrics.successCount).toBe(snapshot.metrics.runCount);
    expect(snapshot.metrics.failureCount).toBe(0);
    expect(snapshot.metrics.lastRunAt).not.toBeNull();
  });

  it("reports scheduler status and task snapshots for monitoring", async () => {
    const scheduler = new Scheduler();
    teardownCallbacks.push(() => scheduler.stopAll());

    scheduler.registerTask({ id: "running-task", intervalMs: 20, handler: () => {} });
    scheduler.registerTask({ id: "paused-task", intervalMs: 20, handler: () => {} });
    scheduler.registerTask({ id: "stopped-task", intervalMs: 20, handler: () => {} });

    scheduler.startTask("running-task");
    scheduler.startTask("paused-task");
    scheduler.startTask("stopped-task");

    await waitFor(() => scheduler.getTaskSnapshot("running-task").metrics.runCount >= 1);

    scheduler.pauseTask("paused-task");
    scheduler.stopTask("stopped-task");

    const snapshot = scheduler.getSnapshot();
    expect(snapshot.totalTaskCount).toBe(3);
    expect(snapshot.runningTaskCount).toBe(1);
    expect(snapshot.pausedTaskCount).toBe(1);
    expect(snapshot.stoppedTaskCount).toBe(1);

    const runningTask = snapshot.tasks.find((task) => task.id === "running-task");
    expect(runningTask).toBeDefined();
    expect(runningTask?.metrics.lastRunAt).not.toBeNull();
  });

  it("tracks handler errors and recovers on subsequent successful runs", async () => {
    const scheduler = new Scheduler();
    teardownCallbacks.push(() => scheduler.stopAll());

    let attempt = 0;
    scheduler.registerTask({
      id: "recovery-task",
      intervalMs: 20,
      autoStart: true,
      handler: () => {
        attempt += 1;
        if (attempt === 1) {
          throw new Error("expected-first-failure");
        }
      },
    });

    await waitFor(
      () => {
        const metrics = scheduler.getTaskSnapshot("recovery-task").metrics;
        return metrics.failureCount >= 1 && metrics.successCount >= 1;
      },
      { timeoutMessage: "error/recovery path not observed" },
    );

    const snapshot = scheduler.getTaskSnapshot("recovery-task");
    expect(snapshot.metrics.failureCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.metrics.successCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.metrics.lastErrorMessage).toBeNull();
  });

  it("prevents overlapping executions under high-frequency scheduling", async () => {
    const scheduler = new Scheduler();
    teardownCallbacks.push(() => scheduler.stopAll());

    let activeExecutions = 0;
    let maxConcurrentExecutions = 0;

    scheduler.registerTask({
      id: "concurrency-task",
      intervalMs: 10,
      autoStart: true,
      handler: async () => {
        activeExecutions += 1;
        if (activeExecutions > maxConcurrentExecutions) {
          maxConcurrentExecutions = activeExecutions;
        }

        await sleep(40);
        activeExecutions -= 1;
      },
    });

    await waitFor(
      () => scheduler.getTaskSnapshot("concurrency-task").metrics.runCount >= 2,
      { timeoutMs: 2_000, timeoutMessage: "concurrency task did not execute enough" },
    );

    expect(maxConcurrentExecutions).toBe(1);
  });

  it("handles invalid operations and configuration boundaries", () => {
    const scheduler = new Scheduler();
    teardownCallbacks.push(() => scheduler.stopAll());

    expect(() =>
      scheduler.registerTask({ id: "invalid-interval", intervalMs: 0, handler: () => {} }),
    ).toThrow("intervalMs must be a positive number");

    scheduler.registerTask({ id: "boundary-task", intervalMs: 30, handler: () => {} });

    expect(() =>
      scheduler.registerTask({ id: "boundary-task", intervalMs: 30, handler: () => {} }),
    ).toThrow("task already exists: boundary-task");

    expect(() => scheduler.startTask("unknown-task")).toThrow("task not found: unknown-task");
    expect(() => scheduler.setTaskInterval("boundary-task", -10)).toThrow(
      "intervalMs must be a positive number",
    );
  });

  it("supports decay scheduler bootstrap and idempotent stop", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "decay-scheduler-test-"));
    const dbPath = join(tempDir, "scheduler-integration.db");

    const runtime = initializeMemoryDecayScheduler({
      mode: "mcp",
      dbPath,
      taskId: "integration-task",
      config: {
        scheduler: {
          intervalMs: 60_000,
          batchSize: 5,
        },
      },
    });

    teardownCallbacks.push(async () => {
      runtime.stop();
      await rm(tempDir, { recursive: true, force: true });
    });

    expect(runtime.taskId).toBe("integration-task");
    expect(runtime.scheduler.hasTask("integration-task")).toBe(true);

    const snapshot = runtime.scheduler.getSnapshot();
    expect(snapshot.totalTaskCount).toBe(1);
    expect(snapshot.runningTaskCount).toBe(1);

    runtime.stop();
    runtime.stop();

    const stoppedSnapshot = runtime.scheduler.getSnapshot();
    expect(stoppedSnapshot.stoppedTaskCount).toBe(1);
  });
});
