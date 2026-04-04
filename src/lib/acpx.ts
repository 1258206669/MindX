/**
 * acpx CLI 封装 — 参考 OpenDeepCrew 的 acpx-cli.js
 *
 * 通过 spawn acpx 进程来驱动 Kiro/Claude Code/Codex 等 AI 工具
 * 前提：全局安装 acpx (npm install -g acpx@latest)
 */

import { spawn, type ChildProcess } from 'child_process';
import { Readable } from 'stream';

export type AcpxAgent = 'kiro' | 'claude' | 'codex' | 'gemini' | 'opencode';
export type PermissionMode = 'approve-all' | 'approve-reads' | 'deny-all';

export interface AcpxSession {
  id?: string;
  acpxRecordId: string;
  name: string;
  cwd: string;
  pid?: number;
  agentCommand?: string;
}

export interface AcpxPromptResult {
  stream: Readable;
  child: ChildProcess;
}

export class AcpxCli {
  private agent: AcpxAgent;

  constructor(agent: AcpxAgent = 'kiro') {
    this.agent = agent;
  }

  /** 创建或获取会话 */
  async sessionsEnsure(opts: {
    cwd: string;
    name: string;
    permissionMode?: PermissionMode;
    timeout?: number;
  }): Promise<AcpxSession> {
    const args = this.buildArgs(['sessions', 'ensure'], opts);
    return this.execJson(args);
  }

  /** 列出所有会话 */
  async sessionsList(): Promise<AcpxSession[]> {
    const args = this.buildArgs(['sessions', 'list'], {});
    return this.execJson(args);
  }

  /** 关闭会话 */
  async sessionsClose(opts: { cwd: string; name: string }): Promise<void> {
    const args = this.buildArgs(['sessions', 'close'], opts);
    await this.execJson(args);
  }

  /** 发送消息给 agent（流式返回） */
  prompt(opts: {
    cwd?: string;
    name?: string;
    message: string;
    permissionMode?: PermissionMode;
    ttl?: number;
  }): AcpxPromptResult {
    const args = this.buildArgs([], { ...opts, message: opts.message });

    const child = spawn('acpx', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
    });

    // 写入消息到 stdin
    child.stdin!.end(opts.message);

    // 解析 NDJSON 流
    const stream = new Readable({ objectMode: true, read() {} });
    let buffer = '';

    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        try { stream.push(JSON.parse(line)); } catch { /* skip */ }
      }
    });

    child.stderr!.on('data', () => {});

    child.on('close', (code) => {
      if (buffer.trim()) {
        try { stream.push(JSON.parse(buffer)); } catch { /* skip */ }
      }
      if (code !== 0 && code !== null) {
        stream.destroy(new Error(`acpx exited with code ${code}`));
      } else {
        stream.push(null);
      }
    });

    child.on('error', (err) => stream.destroy(err));

    return { stream, child };
  }

  /** 发送消息并等待完整结果（非流式） */
  async promptAndWait(opts: {
    cwd?: string;
    name?: string;
    message: string;
    permissionMode?: PermissionMode;
    ttl?: number;
  }): Promise<string> {
    const { stream } = this.prompt(opts);
    const texts: string[] = [];

    for await (const event of stream) {
      const update = (event as any)?.params?.update;
      if (update?.sessionUpdate === 'agent_message_chunk') {
        const content = update.content;
        if (content?.type === 'text' && content.text) {
          texts.push(content.text);
        }
      }
      // 也处理简单的文本输出
      if (typeof event === 'object' && event.text) {
        texts.push(event.text);
      }
    }

    return texts.join('');
  }

  /** 取消当前执行 */
  async cancel(opts: { cwd: string; name: string }): Promise<void> {
    const args = this.buildArgs(['cancel'], opts);
    await this.execJson(args);
  }

  // ─── 内部 ────────────────────────────────

  private buildArgs(subcommand: string[], opts: any): string[] {
    const args = ['--format', 'json'];

    if (opts.cwd) args.push('--cwd', opts.cwd);

    if (opts.permissionMode === 'approve-all') args.push('--approve-all');
    else if (opts.permissionMode === 'approve-reads') args.push('--approve-reads');
    else if (opts.permissionMode === 'deny-all') args.push('--deny-all');

    if (opts.ttl != null) args.push('--ttl', String(opts.ttl));
    if (opts.timeout != null) args.push('--timeout', String(opts.timeout));

    args.push(this.agent);

    const isSessionsCmd = subcommand[0] === 'sessions';
    if (!isSessionsCmd && opts.name) args.push('-s', opts.name);

    args.push(...subcommand);

    if (isSessionsCmd && opts.name) {
      const sub = subcommand[1];
      if (sub === 'new' || sub === 'ensure') args.push('--name', opts.name);
      else args.push(opts.name);
    }

    if (opts.message) args.push('-f', '-');

    return args;
  }

  private execJson(args: string[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const child = spawn('acpx', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
      let stdout = '';
      let stderr = '';

      child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk; });
      child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk; });

      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`acpx exited ${code}: ${stderr.trim()}`));
        }
        try {
          const trimmed = stdout.trim();
          resolve(trimmed ? JSON.parse(trimmed) : null);
        } catch {
          reject(new Error(`Failed to parse acpx output: ${stdout.slice(0, 200)}`));
        }
      });
    });
  }
}
