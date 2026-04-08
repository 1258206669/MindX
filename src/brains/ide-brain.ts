/**
 * IDE Brain — 通过 WebSocket 连接 Kiro 扩展，用 Kiro 内置 AI 做大脑
 *
 * 不需要 WSL、不需要 API key、不需要 kiro-cli
 * 只需要 Kiro IDE 打开着 + 装了 macli-ide-bridge 扩展
 */

import WebSocket from 'ws';
import type { IBrain, BrainResponse, StepResult } from '../core/agent-loop.js';

export interface IdeBrainConfig {
  url?: string;
  connectTimeout?: number;
  requestTimeout?: number;
  /** 自动重连 */
  autoReconnect?: boolean;
}

interface PendingRequest {
  resolve: (data: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class IdeBrain implements IBrain {
  readonly name = 'brain:ide';
  private config: IdeBrainConfig;
  private ws: WebSocket | null = null;
  private reqId = 0;
  private pending = new Map<string, PendingRequest>();
  private connected = false;

  constructor(config: IdeBrainConfig = {}) {
    this.config = {
      url: config.url ?? 'ws://127.0.0.1:4120',
      connectTimeout: config.connectTimeout ?? 5000,
      requestTimeout: config.requestTimeout ?? 120_000,
      autoReconnect: config.autoReconnect ?? true,
    };
  }

  // ─── Brain 接口 ──────────────────────────

  async analyze(task: string, history: StepResult[]): Promise<BrainResponse> {
    try {
      await this.ensureConnected();

      // 发给 Kiro AI chat
      const reply = await this.chat(task);

      // Kiro 直接执行了任务，返回结果
      return {
        done: true,
        summary: reply,
        steps: [],
      };
    } catch (err: any) {
      return { done: true, summary: `IDE error: ${err.message}`, steps: [] };
    }
  }

  // ─── 公开方法 ─────────────────────────────

  /** 发消息给 Kiro AI */
  async chat(message: string, file?: string): Promise<string> {
    await this.ensureConnected();
    return this.send('chat', { message, file });
  }

  /** 执行 VS Code 命令 */
  async command(cmd: string, args?: unknown[]): Promise<string> {
    await this.ensureConnected();
    return this.send('command', { command: cmd, args });
  }

  /** 读文件 */
  async readFile(path: string): Promise<string> {
    await this.ensureConnected();
    return this.send('file-read', { path });
  }

  /** 写文件 */
  async writeFile(path: string, content: string): Promise<string> {
    await this.ensureConnected();
    return this.send('file-write', { path, content });
  }

  /** 在 IDE 终端执行命令 */
  async terminal(command: string): Promise<string> {
    await this.ensureConnected();
    return this.send('terminal', { command });
  }

  /** 获取 IDE 状态 */
  async status(): Promise<any> {
    await this.ensureConnected();
    const data = await this.send('status', {});
    return JSON.parse(data);
  }

  /** 是否已连接 */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /** 断开 */
  disconnect() {
    this.connected = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Disconnected'));
    }
    this.pending.clear();
  }

  // ─── 内部 ────────────────────────────────

  private ensureConnected(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const url = this.config.url!;
      const timer = setTimeout(() => {
        reject(new Error(
          `Cannot connect to IDE bridge at ${url}.\n` +
          `Make sure:\n` +
          `  1. Kiro IDE is open\n` +
          `  2. macli-ide-bridge extension is installed\n` +
          `  3. Bridge is running (check status bar)`
        ));
      }, this.config.connectTimeout);

      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        clearTimeout(timer);
        this.connected = true;
        resolve();
      });

      this.ws.on('error', (err) => {
        clearTimeout(timer);
        this.connected = false;
        reject(new Error(`WebSocket error: ${err.message}`));
      });

      this.ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            clearTimeout(p.timer);
            if (msg.success) p.resolve(msg.data ?? '');
            else p.reject(new Error(msg.error ?? 'Unknown error'));
          }
        } catch { /* ignore */ }
      });

      this.ws.on('close', () => {
        this.connected = false;
        // 拒绝所有 pending
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error('Connection closed'));
          this.pending.delete(id);
        }
      });
    });
  }

  private send(type: string, payload: any): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'));
        return;
      }

      const id = `req-${++this.reqId}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout (${this.config.requestTimeout}ms)`));
      }, this.config.requestTimeout);

      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, type, payload }));
    });
  }
}
