/**
 * Task Queue — 多任务队列管理
 *
 * 支持：
 * - 飞书发多条消息，排队执行
 * - 并行执行不同 workspace 的任务
 * - 任务状态追踪（pending/running/done/failed）
 * - 超时自动取消
 */

import { v4 as uuid } from 'uuid';

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  input: string;
  status: TaskStatus;
  result?: string;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** 来源渠道 */
  channel?: string;
  /** 发送者 */
  sender?: string;
  /** 工作目录 */
  cwd?: string;
}

export interface TaskQueueConfig {
  /** 最大并行任务数 */
  concurrency: number;
  /** 单任务超时（毫秒） */
  taskTimeout: number;
  /** 任务执行函数 */
  executor: (task: Task) => Promise<string>;
  /** 任务完成回调（用于通知飞书等渠道） */
  onComplete?: (task: Task) => void;
}

export class TaskQueue {
  private tasks: Map<string, Task> = new Map();
  private queue: string[] = [];  // pending task IDs
  private running = 0;
  private config: TaskQueueConfig;

  constructor(config: TaskQueueConfig) {
    this.config = config;
  }

  /** 添加任务到队列 */
  add(input: string, opts?: { channel?: string; sender?: string; cwd?: string }): Task {
    const task: Task = {
      id: uuid(),
      input,
      status: 'pending',
      createdAt: Date.now(),
      channel: opts?.channel,
      sender: opts?.sender,
      cwd: opts?.cwd,
    };

    this.tasks.set(task.id, task);
    this.queue.push(task.id);
    this.processNext();
    return task;
  }

  /** 获取任务状态 */
  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  /** 列出所有任务 */
  list(status?: TaskStatus): Task[] {
    const all = [...this.tasks.values()];
    return status ? all.filter(t => t.status === status) : all;
  }

  /** 取消任务 */
  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (task.status === 'pending') {
      task.status = 'cancelled';
      task.finishedAt = Date.now();
      this.queue = this.queue.filter(tid => tid !== id);
      return true;
    }
    return false; // running 的任务暂不支持取消
  }

  /** 队列统计 */
  stats() {
    const all = [...this.tasks.values()];
    return {
      pending: all.filter(t => t.status === 'pending').length,
      running: all.filter(t => t.status === 'running').length,
      done: all.filter(t => t.status === 'done').length,
      failed: all.filter(t => t.status === 'failed').length,
      total: all.length,
    };
  }

  /** 清理已完成的旧任务 */
  cleanup(maxAge = 3600_000) {
    const cutoff = Date.now() - maxAge;
    for (const [id, task] of this.tasks) {
      if ((task.status === 'done' || task.status === 'failed') && (task.finishedAt ?? 0) < cutoff) {
        this.tasks.delete(id);
      }
    }
  }

  // ─── 内部 ────────────────────────────────

  private async processNext() {
    while (this.running < this.config.concurrency && this.queue.length > 0) {
      const taskId = this.queue.shift()!;
      const task = this.tasks.get(taskId);
      if (!task || task.status !== 'pending') continue;

      this.running++;
      task.status = 'running';
      task.startedAt = Date.now();

      this.executeTask(task).finally(() => {
        this.running--;
        this.processNext();
      });
    }
  }

  private async executeTask(task: Task) {
    try {
      const result = await Promise.race([
        this.config.executor(task),
        this.timeout(task.id),
      ]);

      task.status = 'done';
      task.result = result;
    } catch (err: any) {
      task.status = 'failed';
      task.error = err.message;
    } finally {
      task.finishedAt = Date.now();
      this.config.onComplete?.(task);
    }
  }

  private timeout(taskId: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        const task = this.tasks.get(taskId);
        if (task?.status === 'running') {
          reject(new Error(`Task timeout after ${this.config.taskTimeout}ms`));
        }
      }, this.config.taskTimeout);
    });
  }
}
