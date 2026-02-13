/**
 * Scheduler core runtime.
 * Manages multiple scheduled tasks and exposes lifecycle controls.
 */

import { SchedulerTask } from "./task";
import type {
  SchedulerSnapshot,
  SchedulerTaskConfig,
  SchedulerTaskSnapshot,
} from "./types";

/**
 * In-memory scheduler that controls all registered tasks.
 */
export class Scheduler {
  private readonly tasks: Map<string, SchedulerTask>;

  constructor() {
    this.tasks = new Map<string, SchedulerTask>();
  }

  /**
   * Registers a new task from config.
   */
  registerTask(config: SchedulerTaskConfig): SchedulerTask {
    if (this.tasks.has(config.id)) {
      throw new Error(`task already exists: ${config.id}`);
    }

    const task = new SchedulerTask(config);
    this.tasks.set(config.id, task);
    return task;
  }

  /**
   * Unregisters task and always stops timer first.
   */
  removeTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    task.stop();
    return this.tasks.delete(taskId);
  }

  /**
   * Starts one task by id.
   */
  startTask(taskId: string): void {
    this.getTaskOrThrow(taskId).start();
  }

  /**
   * Stops one task by id.
   */
  stopTask(taskId: string): void {
    this.getTaskOrThrow(taskId).stop();
  }

  /**
   * Pauses one task by id.
   */
  pauseTask(taskId: string): void {
    this.getTaskOrThrow(taskId).pause();
  }

  /**
   * Resumes one paused task by id.
   */
  resumeTask(taskId: string): void {
    this.getTaskOrThrow(taskId).resume();
  }

  /**
   * Updates one task interval in milliseconds.
   */
  setTaskInterval(taskId: string, intervalMs: number): void {
    this.getTaskOrThrow(taskId).setIntervalMs(intervalMs);
  }

  /**
   * Starts all registered tasks.
   */
  startAll(): void {
    for (const task of this.tasks.values()) {
      task.start();
    }
  }

  /**
   * Stops all registered tasks.
   */
  stopAll(): void {
    for (const task of this.tasks.values()) {
      task.stop();
    }
  }

  /**
   * Pauses all running tasks.
   */
  pauseAll(): void {
    for (const task of this.tasks.values()) {
      task.pause();
    }
  }

  /**
   * Resumes all paused tasks.
   */
  resumeAll(): void {
    for (const task of this.tasks.values()) {
      task.resume();
    }
  }

  /**
   * Returns task snapshot for monitoring by id.
   */
  getTaskSnapshot(taskId: string): SchedulerTaskSnapshot {
    return this.getTaskOrThrow(taskId).getSnapshot();
  }

  /**
   * Returns scheduler-wide monitoring snapshot.
   */
  getSnapshot(): SchedulerSnapshot {
    const tasks = Array.from(this.tasks.values()).map((task) => task.getSnapshot());

    let runningTaskCount = 0;
    let pausedTaskCount = 0;
    let stoppedTaskCount = 0;

    for (const task of tasks) {
      if (task.status === "running") {
        runningTaskCount += 1;
      } else if (task.status === "paused") {
        pausedTaskCount += 1;
      } else if (task.status === "stopped") {
        stoppedTaskCount += 1;
      }
    }

    return {
      totalTaskCount: tasks.length,
      runningTaskCount,
      pausedTaskCount,
      stoppedTaskCount,
      tasks,
    };
  }

  /**
   * Returns whether task exists.
   */
  hasTask(taskId: string): boolean {
    return this.tasks.has(taskId);
  }

  /**
   * Returns registered task ids.
   */
  getTaskIds(): string[] {
    return Array.from(this.tasks.keys());
  }

  /**
   * Resolves task and throws explicit error for unknown ids.
   */
  private getTaskOrThrow(taskId: string): SchedulerTask {
    const task = this.tasks.get(taskId);
    if (!task) {
      // Debug entry: check registration order if this error appears.
      throw new Error(`task not found: ${taskId}`);
    }

    return task;
  }
}
