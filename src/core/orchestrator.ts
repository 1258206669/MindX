/**
 * Orchestrator — 多 Agent 调度器（融合版）
 *
 * 借鉴：
 * - OpenDeepCrew: acpx 会话管理 + workspace 隔离
 * - Claude Code: 安全审批 + 项目记忆 + 工具 schema
 *
 * 补足 OpenDeepCrew 的 7 个不足：
 * 1. PermissionEngine — 命令审批，不再黑盒执行
 * 2. SmartMemory — 三层记忆，跨会话上下文
 * 3. ParallelRunner — 真正的多 Agent 并行
 * 4. Tracer — 结构化执行链路追踪
 */

import { v4 as uuid } from 'uuid';
import type { IAgent, AgentInput, AgentResult, BusMessage, PluginContext, Plugin, CliToolDef } from '../types.js';
import { MessageBusImpl } from './message-bus.js';
import { MemoryStore } from '../memory/memory-store.js';
import { SmartMemory } from '../memory/smart-memory.js';
import { CliAgent } from '../agents/cli-agent.js';
import { AgentLoop, type IBrain, type LoopConfig } from './agent-loop.js';
import { PermissionEngine } from '../security/permission.js';
import { Tracer } from './tracer.js';
import { ParallelRunner } from './parallel-runner.js';

export class Orchestrator {
  private agents: Map<string, IAgent> = new Map();
  private bus: MessageBusImpl;
  private memory: MemoryStore;
  private smartMemory: SmartMemory;
  private permissions: PermissionEngine;
  private tracer: Tracer;
  private parallel: ParallelRunner;
  private sessionId: string;
  private brain?: IBrain;
  private loopConfig: Partial<LoopConfig> = {};
  private readyPromise: Promise<void>;

  constructor(opts?: {
    dbPath?: string;
    sandboxPaths?: string[];
    onPermissionAsk?: (check: any) => Promise<boolean>;
  }) {
    this.bus = new MessageBusImpl();
    this.memory = new MemoryStore(opts?.dbPath);
    this.sessionId = uuid();
    this.readyPromise = this.memory.ensureReady();

    this.permissions = new PermissionEngine({
      sandboxPaths: opts?.sandboxPaths,
      onAsk: opts?.onPermissionAsk,
    });

    this.tracer = new Tracer({
      onSpanEnd: (span) => {
        this.bus.emit(this.msg('system:log', `[trace] ${span.kind}:${span.name} ${span.status} ${span.duration}ms`));
      },
    });

    this.parallel = new ParallelRunner();
    this.smartMemory = new SmartMemory(this.memory);
  }

  async ready(): Promise<void> {
    await this.readyPromise;
  }

  // ─── Agent 管理 ──────────────────────────

  registerAgent(agent: IAgent): void {
    this.agents.set(agent.name, agent);
    this.log(`Agent registered: ${agent.name} (${agent.backend})`);
  }

  registerTool(tool: CliToolDef): void {
    this.registerAgent(new CliAgent(tool));
  }

  async loadPlugin(plugin: Plugin): Promise<void> {
    const ctx: PluginContext = {
      registerAgent: (a) => this.registerAgent(a),
      registerTool: (t) => this.registerTool(t),
      bus: this.bus,
      memory: this.memory,
    };
    await plugin.register(ctx);
    this.log(`Plugin loaded: ${plugin.name} v${plugin.version}`);
  }

  // ─── Brain 管理 ───────────────────────────

  setBrain(brain: IBrain, config?: Partial<LoopConfig>): void {
    this.brain = brain;
    if (config) this.loopConfig = config;
    this.log(`Brain set: ${brain.name}`);
  }

  async handleWithLoop(rawInput: string): Promise<AgentResult> {
    if (!this.brain) {
      return { success: false, output: '', error: 'No brain configured.' };
    }

    const traceId = this.tracer.startTrace(rawInput);
    const shellAgent = this.agents.get('cli:shell');

    const loop = new AgentLoop(
      this.brain,
      (name) => this.agents.get(name) ?? this.agents.get(`cli:${name}`),
      {
        ...this.loopConfig,
        onStep: (step, result) => {
          this.bus.emit(this.msg('agent:result', { step: step.description, ...result }));
          this.smartMemory.autoExtract('loop', step.command, result.output || result.error || '', this.sessionId);
        },
        onThink: (response) => {
          this.bus.emit(this.msg('system:log', `Brain: ${response.summary}`));
        },
      },
      shellAgent,
    );

    const result = await loop.run(rawInput, this.sessionId);
    this.tracer.endTrace(traceId, result.success ? 'ok' : 'error');

    this.memory.add({
      sessionId: this.sessionId,
      role: 'agent',
      agentName: this.brain.name,
      content: result.output || result.error || '',
      timestamp: Date.now(),
      tags: ['loop'],
      persistent: false,
    });

    return { ...result, metadata: { ...result.metadata, trace: this.tracer.getSummary(traceId) } };
  }

  // ─── 主执行入口 ───────────────────────────

  async handle(rawInput: string): Promise<AgentResult> {
    const traceId = this.tracer.startTrace(rawInput);

    // 1. 记录用户输入
    this.memory.add({
      sessionId: this.sessionId,
      role: 'user',
      agentName: 'orchestrator',
      content: rawInput,
      timestamp: Date.now(),
      tags: [],
      persistent: false,
    });

    this.bus.emit(this.msg('user:input', rawInput));

    // 2. 选择 Agent
    const selectSpan = this.tracer.startSpan(traceId, 'selectAgent', 'agent');
    const agent = this.selectAgent(rawInput);
    if (!agent) {
      this.tracer.endSpan(traceId, selectSpan, 'error', 'No agent found');
      this.tracer.endTrace(traceId, 'error');
      return { success: false, output: '', error: `No agent can handle: "${rawInput}"` };
    }
    this.tracer.setAttributes(traceId, selectSpan, { agent: agent.name });
    this.tracer.endSpan(traceId, selectSpan, 'ok');

    // 3. 安全检查（CLI Agent 才需要）
    if (agent.backend === 'cli') {
      const permSpan = this.tracer.startSpan(traceId, 'permissionCheck', 'permission');
      const check = await this.permissions.check(rawInput);
      this.tracer.endSpan(traceId, permSpan, check.allowed ? 'ok' : 'error');

      if (!check.allowed) {
        this.tracer.endTrace(traceId, 'error');
        return { success: false, output: '', error: `Permission denied: ${check.reason}` };
      }
    }

    // 4. 构建输入（注入智能记忆）
    const context = this.memory.getSession(this.sessionId, 20);
    const smartContext = this.smartMemory.buildContext(this.sessionId, rawInput);
    const input: AgentInput = {
      raw: rawInput,
      context,
      sessionId: this.sessionId,
    };

    // 5. 执行
    const execSpan = this.tracer.startSpan(traceId, `execute:${agent.name}`, 'tool');
    this.bus.emit(this.msg('agent:start', { agent: agent.name, input: rawInput }));

    const result = await agent.execute(input);

    this.tracer.setAttributes(traceId, execSpan, { success: result.success });
    this.tracer.endSpan(traceId, execSpan, result.success ? 'ok' : 'error', result.error);

    // 6. 记录结果 + 自动提取记忆
    this.memory.add({
      sessionId: this.sessionId,
      role: 'agent',
      agentName: agent.name,
      content: result.success ? result.output : (result.error ?? 'unknown error'),
      timestamp: Date.now(),
      tags: [agent.backend],
      persistent: false,
    });

    this.smartMemory.autoExtract(agent.name, rawInput, result.output || result.error || '', this.sessionId);

    this.bus.emit(this.msg(result.success ? 'agent:result' : 'agent:error', result));
    this.tracer.endTrace(traceId, result.success ? 'ok' : 'error');

    return { ...result, metadata: { ...result.metadata, trace: this.tracer.getSummary(traceId) } };
  }

  async handleWith(agentName: string, rawInput: string): Promise<AgentResult> {
    const agent = this.agents.get(agentName);
    if (!agent) return { success: false, output: '', error: `Agent not found: ${agentName}` };
    const context = this.memory.getSession(this.sessionId, 20);
    return agent.execute({ raw: rawInput, context, sessionId: this.sessionId });
  }

  /** 并行执行多个任务 */
  async handleParallel(tasks: Array<{ agentName: string; input: string }>): Promise<AgentResult[]> {
    const agentInputs = tasks.map(t => {
      const agent = this.agents.get(t.agentName);
      if (!agent) throw new Error(`Agent not found: ${t.agentName}`);
      return {
        agent,
        input: { raw: t.input, sessionId: this.sessionId } as AgentInput,
      };
    });
    return this.parallel.runSimple(agentInputs);
  }

  // ─── 查询 ────────────────────────────────

  listAgents() {
    return [...this.agents.values()].map(a => ({
      name: a.name, backend: a.backend, description: a.description,
    }));
  }

  getMemory() { return this.memory; }
  getSmartMemory() { return this.smartMemory; }
  getPermissions() { return this.permissions; }
  getTracer() { return this.tracer; }
  getBus() { return this.bus; }
  getSessionId() { return this.sessionId; }
  newSession() { this.sessionId = uuid(); }

  // ─── 内部 ────────────────────────────────

  private selectAgent(input: string): IAgent | null {
    const atMatch = input.match(/^@([\w:]+)\s*/);
    if (atMatch) {
      const name = atMatch[1];
      return this.agents.get(name) ?? this.agents.get(`cli:${name}`) ?? null;
    }

    let best: IAgent | null = null;
    let bestScore = 0;
    for (const agent of this.agents.values()) {
      if (agent.canHandle(input)) {
        const score = agent.capabilities.reduce((s, cap) =>
          s + cap.keywords.filter(kw => input.toLowerCase().includes(kw.toLowerCase())).length, 0);
        if (score > bestScore) { bestScore = score; best = agent; }
      }
    }
    return best;
  }

  private msg(type: BusMessage['type'], payload: unknown): BusMessage {
    return { type, source: 'orchestrator', payload, timestamp: Date.now(), sessionId: this.sessionId };
  }

  private log(msg: string) {
    this.bus.emit(this.msg('system:log', msg));
  }

  destroy() {
    this.memory.close();
    this.tracer.cleanup(0);
  }
}
