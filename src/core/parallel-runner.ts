/**
 * Parallel Runner — 多 Agent 并行执行（补 OpenDeepCrew 的串行限制）
 *
 * 支持：
 * - 并行执行多个独立子任务
 * - 依赖关系声明（DAG 执行）
 * - 超时控制
 * - 部分失败不影响其他任务
 */

import type { IAgent, AgentInput, AgentResult } from '../types.js';

export interface ParallelTask {
  id: string;
  agent: IAgent;
  input: AgentInput;
  /** 依赖的任务 ID（这些任务完成后才执行） */
  dependsOn?: string[];
  /** 单任务超时 */
  timeout?: number;
}

export interface ParallelResult {
  taskId: string;
  result: AgentResult;
  duration: number;
}

export class ParallelRunner {
  /** 并行执行多个任务（支持依赖关系） */
  async run(tasks: ParallelTask[]): Promise<ParallelResult[]> {
    const results = new Map<string, ParallelResult>();
    const pending = new Map(tasks.map(t => [t.id, t]));

    while (pending.size > 0) {
      // 找出所有依赖已满足的任务
      const ready: ParallelTask[] = [];
      for (const task of pending.values()) {
        const depsOk = (task.dependsOn ?? []).every(dep => results.has(dep));
        if (depsOk) ready.push(task);
      }

      if (ready.length === 0) {
        // 死锁检测
        const remaining = [...pending.keys()].join(', ');
        throw new Error(`Deadlock: tasks [${remaining}] have unresolvable dependencies`);
      }

      // 并行执行所有就绪任务
      const promises = ready.map(async (task) => {
        pending.delete(task.id);
        const start = Date.now();

        try {
          const result = task.timeout
            ? await withTimeout(task.agent.execute(task.input), task.timeout)
            : await task.agent.execute(task.input);

          return { taskId: task.id, result, duration: Date.now() - start };
        } catch (err: any) {
          return {
            taskId: task.id,
            result: { success: false, output: '', error: err.message } as AgentResult,
            duration: Date.now() - start,
          };
        }
      });

      const batch = await Promise.all(promises);
      for (const r of batch) {
        results.set(r.taskId, r);
      }
    }

    return [...results.values()];
  }

  /** 简单并行（无依赖关系） */
  async runSimple(
    agents: Array<{ agent: IAgent; input: AgentInput }>,
    timeout?: number,
  ): Promise<AgentResult[]> {
    const tasks: ParallelTask[] = agents.map((a, i) => ({
      id: `task-${i}`,
      agent: a.agent,
      input: a.input,
      timeout,
    }));

    const results = await this.run(tasks);
    return results.map(r => r.result);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
