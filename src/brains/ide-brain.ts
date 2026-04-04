/**
 * IDE Brain — 通过 WebSocket 连接 Kiro/Cursor 扩展，用 IDE 内置 AI 做大脑
 *
 * 链路：
 *   IdeBrain → WebSocket → IDE Extension → IDE AI Chat → 结果回传
 *
 * 使用前提：
 *   1. 在 Kiro/Cursor 中安装 macli-ide-bridge 扩展
 *   2. 扩展自动启动 WebSocket 服务（默认 4120 端口）
 */

import { WebSocket } from 'ws';
import type { IBrain, BrainResponse, StepResult } from '../core/agent-loop.js';

export interface IdeBrainConfig {
  /** WebSocket 地址，默认 ws://127.0.0.1:4120 */
  url?: string;
  /** 连接超时 */
  connectTimeout?: number;
  /** 请求超时 */
  requestTimeout?: number;
}

interface BridgeRequest {
  id: string;
  type: string;
  payload: unknown;
}

interface BridgeResponse {
  id: string;
  type: string;
  payload: { success: boolean; data?: string; error?: string; done?: boolean };
}

export class IdeBrain implements IBrain {
  readonly name = 'brain:ide';
  private config: IdeBrainConfig;
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pending = new Map<string, {
    resolve: (data: string) => void;
    reject: (err: Error) => void;
  }>();

  constructor(config: IdeBrainConfig = {}) {
    this.config = config;
  }

  async analyze(task: string, history: StepResult[]): Promise<BrainResponse> {
    const prompt = this.buildPrompt(task, history);

    try {
      await this.ensureConnected();

      // 先获取 IDE 状态
      const status = await this.send({ type: 'status', payload: {} });
      const ideInfo = JSON.parse(status);

      // 发送 chat 消息给 IDE AI
      const result = await this.send({
        type: 'chat',
        payload: { message: prompt },
      });

      return this.parseResponse(result, ideInfo);
    } catch (err: any) {
      return { done: true, summary: `IDE Brain error: ${err.message}`, steps: [] };
    }
  }

  /** 直接发命令给 IDE */
  async executeCommand(command: string, args?: unknown[]): Promise<string> {
    await this.ensureConnected();
    return this.send({ type: 'command', payload: { command, args } });
  }

  /** 读取 IDE 中的文件 */
  async readFile(path: string): Promise<string> {
    await this.ensureConnected();
    return this.send({ type: 'file', payload: { action: 'read', path } });
  }

  /** 在 IDE 终端执行命令 */
  async runInTerminal(command: string): Promise<string> {
    await this.ensureConnected();
    return this.send({ type: 'terminal', payload: { command } });
  }

  /** 获取 IDE 状态 */
  async getStatus(): Promise<unknown> {
    await this.ensureConnected();
    const data = await this.send({ type: 'status', payload: {} });
    return JSON.parse(data);
  }

  /** 断开连接 */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // ─── 内部 ────────────────────────────────

  private async ensureConnected(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const url = this.config.url ?? 'ws://127.0.0.1:4120';
    const timeout = this.config.connectTimeout ?? 5000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Connection timeout: ${url}. Is the IDE bridge extension running?`));
      }, timeout);

      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        clearTimeout(timer);
        resolve();
      });

      this.ws.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`WebSocket error: ${err.message}. Make sure IDE bridge extension is installed and running.`));
      });

      this.ws.on('message', (data) => {
        try {
          const msg: BridgeResponse = JSON.parse(data.toString());
          const pending = this.pending.get(msg.id);
          if (pending) {
            this.pending.delete(msg.id);
            if (msg.payload.success) {
              pending.resolve(msg.payload.data ?? '');
            } else {
              pending.reject(new Error(msg.payload.error ?? 'Unknown error'));
            }
          }
        } catch { /* ignore parse errors */ }
      });

      this.ws.on('close', () => {
        // 拒绝所有 pending 请求
        for (const [id, p] of this.pending) {
          p.reject(new Error('Connection closed'));
          this.pending.delete(id);
        }
        this.ws = null;
      });
    });
  }

  private send(req: Omit<BridgeRequest, 'id'>): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'));
        return;
      }

      const id = `req-${++this.requestId}`;
      const timeout = this.config.requestTimeout ?? 120_000;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);

      this.pending.set(id, {
        resolve: (data) => { clearTimeout(timer); resolve(data); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      this.ws.send(JSON.stringify({ id, ...req }));
    });
  }

  private buildPrompt(task: string, history: StepResult[]): string {
    let prompt = `Task: ${task}\n\n`;

    if (history.length > 0) {
      prompt += 'Previous steps:\n';
      for (const h of history) {
        const s = h.result.success ? '✓' : '✗';
        prompt += `  ${s} ${h.step.description}\n`;
      }
      prompt += '\n';
    }

    prompt += 'Please analyze and provide next steps as JSON:\n';
    prompt += '{"done": false, "summary": "...", "steps": [{"description": "...", "command": "..."}]}';

    return prompt;
  }

  private parseResponse(result: string, ideInfo: any): BrainResponse {
    // 尝试从 IDE 回复中提取 JSON
    const jsonMatch = result.match(/\{[\s\S]*"done"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          done: Boolean(parsed.done),
          summary: parsed.summary ?? '',
          steps: (parsed.steps ?? []).map((s: any) => ({
            description: s.description ?? '',
            command: s.command ?? '',
          })),
        };
      } catch { /* fall through */ }
    }

    // IDE 可能直接返回了自然语言回复
    return {
      done: true,
      summary: result || 'IDE processed the request. Check IDE for details.',
      steps: [],
    };
  }
}
