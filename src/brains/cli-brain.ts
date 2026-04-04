/**
 * CLI Brain — 用本地 AI CLI 工具（Kiro/Cursor/Claude）做"大脑"
 *
 * 核心思路：
 *   把任务 + 历史格式化成 prompt → 发给 CLI 工具 → 解析返回的执行计划
 *
 * 支持的 CLI 工具：
 *   - kiro: Kiro IDE 的 CLI
 *   - claude: Claude Code CLI
 *   - 任何支持 stdin/stdout 交互的 AI CLI
 */

import { execSync } from 'child_process';
import type { IBrain, BrainResponse, StepResult } from '../core/agent-loop.js';

export interface CliBrainConfig {
  /** CLI 命令，如 "kiro", "claude", "cursor" */
  command: string;
  /** 命令参数模板，{{prompt}} 会被替换为实际 prompt */
  argsTemplate: string;
  /** 工作目录 */
  cwd?: string;
  /** 超时（毫秒） */
  timeout?: number;
}

/** 预设的 CLI Brain 配置 */
export const BRAIN_PRESETS: Record<string, CliBrainConfig> = {
  kiro: {
    command: 'kiro',
    argsTemplate: '--chat "{{prompt}}"',
    timeout: 120_000,
  },
  claude: {
    command: 'claude',
    argsTemplate: '-p "{{prompt}}"',
    timeout: 120_000,
  },
  // 通用：任何能接受 -p 参数的 CLI
  generic: {
    command: '',
    argsTemplate: '-p "{{prompt}}"',
    timeout: 60_000,
  },
};

export class CliBrain implements IBrain {
  readonly name: string;
  private config: CliBrainConfig;

  constructor(name: string, config: CliBrainConfig) {
    this.name = `brain:${name}`;
    this.config = config;
  }

  async analyze(task: string, history: StepResult[]): Promise<BrainResponse> {
    const prompt = this.buildPrompt(task, history);

    try {
      const output = this.callCli(prompt);
      return this.parseResponse(output);
    } catch (err: any) {
      // CLI 调用失败，返回错误但不崩溃
      return {
        done: true,
        summary: `Brain error: ${err.message}`,
        steps: [],
      };
    }
  }

  private buildPrompt(task: string, history: StepResult[]): string {
    let prompt = `You are a task planner. Analyze the task and return a JSON execution plan.

TASK: ${task}

`;

    if (history.length > 0) {
      prompt += `PREVIOUS STEPS:\n`;
      for (const h of history) {
        const status = h.result.success ? '✓' : '✗';
        prompt += `  ${status} ${h.step.description}: ${h.step.command}\n`;
        if (h.result.output) prompt += `    Output: ${h.result.output.slice(0, 200)}\n`;
        if (h.result.error) prompt += `    Error: ${h.result.error.slice(0, 200)}\n`;
      }
      prompt += '\n';
    }

    prompt += `Respond ONLY with JSON in this format:
{
  "done": false,
  "summary": "what you're doing",
  "steps": [
    { "description": "step desc", "command": "shell command to run" }
  ]
}

If the task is complete, set "done": true and provide a summary. Keep steps minimal.`;

    return prompt;
  }

  private callCli(prompt: string): string {
    const { command, argsTemplate, cwd, timeout } = this.config;
    const args = argsTemplate.replace('{{prompt}}', prompt.replace(/"/g, '\\"'));
    const fullCmd = `${command} ${args}`;

    const output = execSync(fullCmd, {
      cwd: cwd ?? process.cwd(),
      timeout: timeout ?? 60_000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return output.trim();
  }

  private parseResponse(output: string): BrainResponse {
    // 尝试从输出中提取 JSON
    const jsonMatch = output.match(/\{[\s\S]*"done"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          done: Boolean(parsed.done),
          summary: parsed.summary ?? '',
          steps: (parsed.steps ?? []).map((s: any) => ({
            description: s.description ?? '',
            command: s.command ?? '',
            agent: s.agent,
          })),
        };
      } catch {
        // JSON 解析失败，fallback
      }
    }

    // fallback：把整个输出当作一个步骤
    return {
      done: false,
      summary: '',
      steps: [{
        description: 'Execute brain suggestion',
        command: output.split('\n')[0], // 取第一行作为命令
      }],
    };
  }
}

/** 快速创建预设 Brain */
export function createBrain(preset: keyof typeof BRAIN_PRESETS, overrides?: Partial<CliBrainConfig>): CliBrain {
  const config = { ...BRAIN_PRESETS[preset], ...overrides };
  return new CliBrain(preset, config);
}
