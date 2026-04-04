/**
 * Core type definitions for multi-agent CLI framework
 *
 * 架构参考：
 * - Claude Code: 工具系统 schema + 权限声明
 * - OpenClaw: 多 Agent + 插件化 + 消息总线
 */

// ─── Agent 系统 ───────────────────────────────

export type AgentBackend = 'cli' | 'llm' | 'composite';

export interface AgentResult {
  success: boolean;
  output: string;
  error?: string;
  /** 执行的原始命令、耗时等 */
  metadata?: Record<string, unknown>;
}

export interface AgentCapability {
  name: string;
  description: string;
  keywords: string[];
}

/** Agent 统一接口 — 不管背后是 LLM 还是 CLI */
export interface IAgent {
  readonly name: string;
  readonly description: string;
  readonly backend: AgentBackend;
  readonly capabilities: AgentCapability[];

  execute(input: AgentInput): Promise<AgentResult>;
  canHandle(input: string): boolean;
}

export interface AgentInput {
  raw: string;
  command?: string;
  args?: string[];
  context?: MemoryEntry[];
  sessionId: string;
}

// ─── 记忆系统 ─────────────────────────────────

export interface MemoryEntry {
  id: string;
  sessionId: string;
  role: 'user' | 'agent' | 'system';
  agentName: string;
  content: string;
  timestamp: number;
  tags: string[];
  persistent: boolean;
}

// ─── CLI 工具定义 ──────────────────────────────

export interface CliToolDef {
  name: string;
  command: string;
  description: string;
  actions: CliAction[];
}

export interface CliAction {
  name: string;
  description: string;
  /** 命令模板，{{param}} 占位 */
  template: string;
  params?: CliParam[];
}

export interface CliParam {
  name: string;
  description: string;
  required: boolean;
  default?: string;
}

// ─── 消息总线（参考 OpenClaw Gateway） ─────────

export type MessageType =
  | 'user:input'
  | 'agent:start'
  | 'agent:result'
  | 'agent:error'
  | 'system:log'
  | 'memory:save'
  | 'memory:recall';

export interface BusMessage {
  type: MessageType;
  source: string;
  payload: unknown;
  timestamp: number;
  sessionId: string;
}

// ─── 插件系统 ──────────────────────────────────

export interface Plugin {
  name: string;
  version: string;
  description: string;
  /** 注册 Agent、工具、或 hook */
  register(ctx: PluginContext): void | Promise<void>;
}

export interface PluginContext {
  registerAgent(agent: IAgent): void;
  registerTool(tool: CliToolDef): void;
  bus: MessageBus;
  memory: MemoryAPI;
}

export interface MessageBus {
  emit(msg: BusMessage): void;
  on(type: MessageType, handler: (msg: BusMessage) => void): void;
  off(type: MessageType, handler: (msg: BusMessage) => void): void;
}

export interface MemoryAPI {
  add(entry: Omit<MemoryEntry, 'id'>): MemoryEntry;
  getSession(sessionId: string, limit?: number): MemoryEntry[];
  search(query: string, limit?: number): MemoryEntry[];
  getByTag(tag: string, limit?: number): MemoryEntry[];
  markPersistent(id: string): void;
}
