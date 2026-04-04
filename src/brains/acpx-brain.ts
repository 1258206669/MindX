/**
 * acpx Brain — 通过 acpx 驱动 Kiro/Claude Code 做大脑
 *
 * 这是 OpenDeepCrew 的核心方式，我们直接复用
 */

import { AcpxCli, type AcpxAgent } from '../lib/acpx.js';
import type { IBrain, BrainResponse, StepResult } from '../core/agent-loop.js';

export interface AcpxBrainConfig {
  agent: AcpxAgent;
  cwd?: string;
  sessionName?: string;
  permissionMode?: 'approve-all' | 'approve-reads';
}

export class AcpxBrain implements IBrain {
  readonly name: string;
  private cli: AcpxCli;
  private config: AcpxBrainConfig;
  private sessionReady = false;

  constructor(config: AcpxBrainConfig) {
    this.name = `brain:acpx:${config.agent}`;
    this.config = config;
    this.cli = new AcpxCli(config.agent);
  }

  async analyze(task: string, history: StepResult[]): Promise<BrainResponse> {
    const cwd = this.config.cwd ?? process.cwd();
    const name = this.config.sessionName ?? 'macli-session';

    try {
      // 确保会话存在
      if (!this.sessionReady) {
        await this.cli.sessionsEnsure({
          cwd,
          name,
          permissionMode: this.config.permissionMode ?? 'approve-all',
          timeout: 60,
        });
        this.sessionReady = true;
      }

      // 构建 prompt
      const prompt = this.buildPrompt(task, history);

      // 发送给 agent 并等待结果
      const result = await this.cli.promptAndWait({
        cwd,
        name,
        message: prompt,
        permissionMode: this.config.permissionMode ?? 'approve-all',
      });

      return this.parseResponse(result);
    } catch (err: any) {
      return { done: true, summary: `acpx error: ${err.message}`, steps: [] };
    }
  }

  async close() {
    if (this.sessionReady) {
      try {
        await this.cli.sessionsClose({
          cwd: this.config.cwd ?? process.cwd(),
          name: this.config.sessionName ?? 'macli-session',
        });
      } catch { /* ignore */ }
    }
  }

  private buildPrompt(task: string, history: StepResult[]): string {
    let prompt = task;

    if (history.length > 0) {
      prompt += '\n\nPrevious steps:\n';
      for (const h of history) {
        const s = h.result.success ? '✓' : '✗';
        prompt += `  ${s} ${h.step.description}: ${h.step.command}\n`;
        if (h.result.output) prompt += `    → ${h.result.output.slice(0, 200)}\n`;
        if (h.result.error) prompt += `    Error: ${h.result.error.slice(0, 200)}\n`;
      }
    }

    return prompt;
  }

  private parseResponse(result: string): BrainResponse {
    // acpx 返回的是 agent 的自然语言回复
    // 直接作为完成结果返回（agent 内部已经执行了任务）
    return {
      done: true,
      summary: result || 'Agent completed the task.',
      steps: [],
    };
  }
}
