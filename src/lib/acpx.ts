/**
 * acpx CLI 封装 — 支持 Windows (通过 WSL) 和 Linux/Mac 直接调用
 *
 * 链路：spawn acpx → kiro-cli acp → Kiro AI 执行任务
 */

import { spawn, type ChildProcess } from 'child_process';
import { Readable } from 'stream';
import { platform } from 'os';

export type AcpxAgent = 'kiro' | 'claude' | 'codex' | 'gemini' | 'opencode' | 'cursor';
export type PermissionMode = 'approve-all' | 'approve-reads' | 'deny-all';

export interface AcpxSession {
  id?: string;
  acpxRecordId: string;
  name: string;
  cwd: string;
  pid?: number;
}

export interface AcpxPromptResult {
  stream: Readable;
  child: ChildProcess;
}

/** 检测是否需要通过 WSL 调用 */
function isWindows(): boolean {
  return platform() === 'win32';
}

/** 构建 spawn 参数（Windows 走 WSL，其他直接调用） */
function spawnAcpx(args: string[], opts: { stdio: any; cwd?: string; shell?: boolean }) {
  if (isWindows()) {
    // Windows: 通过 wsl 调用 acpx
    // 把 Windows 路径转成 WSL 路径 (E:\xxx → /mnt/e/xxx)
    return spawn('wsl', ['acpx', ...args], { ...opts, shell: true });
  }
  return spawn('acpx', args, { ...opts, shell: true });
}

/** 把 Windows 路径转成 WSL 路径 */
function toWslPath(winPath: string): string {
  if (!isWindows()) return winPath;
  // E:\mindXA\MindX → /mnt/e/mindXA/MindX
  return winPath
    .replace(/^([A-Z]):\\/i, (_, drive) => `/mnt/${drive.toLowerCase()}/`)
    .replace(/\\/g, '/');
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
    const args = this.buildArgs(['sessions', 'ensure'], {
      ...opts,
      cwd: toWslPath(opts.cwd),
    });
    return this.execJson(args);
  }

  /** 列出所有会话 */
  async sessionsList(): Promise<AcpxSession[]> {
    const args = this.buildArgs(['sessions', 'list'], {});
    return this.execJson(args);
  }

  /** 关闭会话 */
  async sessionsClose(opts: { cwd: string; name: string }): Promise<void> {
    const args = this.buildArgs(['sessions', 'close'], {
      ...opts,
      cwd: toWslPath(opts.cwd),
    });
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
    const adjustedOpts = {
      ...opts,
      cwd: opts.cwd ? toWslPath(opts.cwd) : undefined,
    };
    const args = this.buildArgs([], { ...adjustedOpts, message: opts.message });

    const child = spawnAcpx(args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.cwd,
    });

    child.stdin!.end(opts.message);

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

  /** 发送消息并等待完整结果 */
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
      // acpx NDJSON 流式格式
      const update = (event as any)?.params?.update;
      if (update?.sessionUpdate === 'agent_message_chunk') {
        const content = update.content;
        if (content?.type === 'text' && content.text) {
          texts.push(content.text);
        }
      }
      if (typeof event === 'object' && (event as any).text) {
        texts.push((event as any).text);
      }
    }

    return texts.join('');
  }

  /** 一次性执行（不保留会话） */
  async exec(opts: {
    cwd?: string;
    message: string;
    permissionMode?: PermissionMode;
  }): Promise<string> {
    const adjustedOpts = {
      ...opts,
      cwd: opts.cwd ? toWslPath(opts.cwd) : undefined,
    };
    const args = this.buildArgs(['exec'], { ...adjustedOpts, message: opts.message });

    const child = spawnAcpx(args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdin!.end(opts.message);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk; });
      child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) reject(new Error(`acpx exec failed (${code}): ${stderr}`));
        else resolve(stdout.trim());
      });
    });
  }

  /** 取消当前执行 */
  async cancel(opts: { cwd: string; name: string }): Promise<void> {
    const args = this.buildArgs(['cancel'], {
      ...opts,
      cwd: toWslPath(opts.cwd),
    });
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
      const child = spawnAcpx(args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';

      child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk; });
      child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(`acpx exited ${code}: ${stderr.trim()}`));
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
