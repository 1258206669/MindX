/**
 * Ollama Brain — 用本地 Ollama 模型做大脑
 *
 * 完全免费、本地运行、不需要 API key
 *
 * 安装 Ollama: https://ollama.com/download
 * 下载模型:    ollama pull qwen2.5:7b
 */

import type { IBrain, BrainResponse, StepResult } from '../core/agent-loop.js';

export interface OllamaBrainConfig {
  /** Ollama API 地址，默认 http://localhost:11434 */
  baseUrl?: string;
  /** 模型名称，推荐 qwen2.5:7b 或 llama3.1:8b */
  model: string;
  /** 超时毫秒 */
  timeout?: number;
}

export class OllamaBrain implements IBrain {
  readonly name: string;
  private config: OllamaBrainConfig;

  constructor(config: OllamaBrainConfig) {
    this.name = `brain:ollama:${config.model}`;
    this.config = config;
  }

  async analyze(task: string, history: StepResult[]): Promise<BrainResponse> {
    const prompt = this.buildPrompt(task, history);

    try {
      const text = await this.call(prompt);
      return this.parseResponse(text);
    } catch (err: any) {
      return { done: true, summary: `Ollama error: ${err.message}`, steps: [] };
    }
  }

  private buildPrompt(task: string, history: StepResult[]): string {
    let prompt = `You are a task planner that breaks down tasks into shell commands.

TASK: ${task}

`;
    if (history.length > 0) {
      prompt += 'PREVIOUS STEPS:\n';
      for (const h of history) {
        const s = h.result.success ? '✓' : '✗';
        prompt += `  ${s} ${h.step.description}: ${h.step.command}\n`;
        if (h.result.output) prompt += `    Output: ${h.result.output.slice(0, 300)}\n`;
        if (h.result.error) prompt += `    Error: ${h.result.error.slice(0, 300)}\n`;
      }
      prompt += '\n';
    }

    prompt += `Respond ONLY with valid JSON (no markdown, no explanation):
{
  "done": false,
  "summary": "brief description of what you're doing",
  "steps": [
    { "description": "what this step does", "command": "actual shell command" }
  ]
}

If the task is already complete based on previous steps, set "done": true.
Keep steps minimal (1-3 steps max). Use commands that work on Windows.`;

    return prompt;
  }

  private async call(prompt: string): Promise<string> {
    const baseUrl = this.config.baseUrl ?? 'http://localhost:11434';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout ?? 60_000);

    try {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          prompt,
          stream: false,
          options: { temperature: 0.1 },
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json() as any;
      return data.response ?? '';
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseResponse(text: string): BrainResponse {
    // 提取 JSON
    const jsonMatch = text.match(/\{[\s\S]*"done"[\s\S]*\}/);
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
      } catch { /* fall through */ }
    }

    // fallback
    return { done: true, summary: text.slice(0, 200), steps: [] };
  }
}
