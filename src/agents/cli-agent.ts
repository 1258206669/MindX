/**
 * CLI Agent — 通过本地 CLI 工具执行任务
 *
 * 每个 CLI Agent 绑定一个 CliToolDef，
 * 可以直接执行命令，也可以通过 action 模板匹配
 */

import { execSync, type ExecSyncOptions } from 'child_process';
import { BaseAgent } from './base-agent.js';
import type { AgentBackend, AgentCapability, AgentInput, AgentResult, CliToolDef } from '../types.js';

export class CliAgent extends BaseAgent {
  readonly name: string;
  readonly description: string;
  readonly backend: AgentBackend = 'cli';
  readonly capabilities: AgentCapability[];

  private tool: CliToolDef;
  private execOpts: ExecSyncOptions;

  constructor(tool: CliToolDef, opts?: { cwd?: string; timeout?: number }) {
    super();
    this.tool = tool;
    this.name = `cli:${tool.name}`;
    this.description = tool.description;
    this.capabilities = tool.actions.map(a => ({
      name: a.name,
      description: a.description,
      keywords: [tool.name, a.name],
    }));
    this.execOpts = {
      cwd: opts?.cwd ?? process.cwd(),
      timeout: opts?.timeout ?? 30_000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    };
  }

  async execute(input: AgentInput): Promise<AgentResult> {
    const cmd = this.resolveCommand(input);
    if (!cmd) return this.fail(`Cannot resolve command from: ${input.raw}`);
    return this.run(cmd);
  }

  /** 直接执行原始命令 */
  async exec(command: string): Promise<AgentResult> {
    return this.run(command);
  }

  private run(command: string): AgentResult {
    try {
      const output = execSync(command, this.execOpts) as string;
      return this.ok(output.trim(), { command });
    } catch (err: any) {
      return this.fail(`Command failed: ${command}\n${err.stderr?.toString() ?? err.message}`);
    }
  }

  private resolveCommand(input: AgentInput): string | null {
    if (input.command) return input.command;

    // 匹配 action 模板
    const lower = input.raw.toLowerCase();
    for (const action of this.tool.actions) {
      if (lower.includes(action.name.toLowerCase())) {
        let cmd = action.template;
        for (const p of action.params ?? []) {
          const val = this.extractParam(input.raw, p.name) ?? p.default ?? '';
          cmd = cmd.replace(`{{${p.name}}}`, val);
        }
        return cmd;
      }
    }

    // fallback
    const args = input.args?.join(' ') ?? '';
    return args ? `${this.tool.command} ${args}` : null;
  }

  private extractParam(input: string, name: string): string | null {
    const m = input.match(new RegExp(`${name}[=:\\s]+([\\w./-]+)`, 'i'));
    return m?.[1] ?? null;
  }
}
