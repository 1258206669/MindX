/**
 * Agent Loop — 任务循环引擎
 *
 * 支持两种大脑模式：
 * 1. CLI Brain: 用 Kiro/Cursor 等本地 AI CLI 工具做推理
 * 2. LLM Brain: 直接调用 LLM API 做推理
 *
 * 循环流程：
 *   用户任务 → Brain 分析 → 生成步骤 → 执行工具 → 观察结果 → Brain 判断是否完成 → 循环
 */

import type { IAgent, AgentInput, AgentResult } from '../types.js';

/** 单个执行步骤 */
export interface Step {
  /** 步骤描述 */
  description: string;
  /** 要执行的命令或指令 */
  command: string;
  /** 目标 Agent 名称（可选，不填则自动路由） */
  agent?: string;
}

/** Brain 的分析结果 */
export interface BrainResponse {
  /** 是否任务已完成 */
  done: boolean;
  /** 总结/回复 */
  summary: string;
  /** 下一步要执行的步骤 */
  steps: Step[];
}

/** Brain 接口 — 可以是 CLI 工具，也可以是 LLM */
export interface IBrain {
  readonly name: string;

  /**
   * 分析任务，返回执行计划
   * @param task 用户任务描述
   * @param history 之前步骤的执行历史
   */
  analyze(task: string, history: StepResult[]): Promise<BrainResponse>;
}

/** 步骤执行结果 */
export interface StepResult {
  step: Step;
  result: AgentResult;
}

/** Loop 配置 */
export interface LoopConfig {
  /** 最大循环次数，防止无限循环 */
  maxIterations: number;
  /** 每步执行前是否需要用户确认 */
  requireApproval: boolean;
  /** 审批回调 */
  onApproval?: (step: Step) => Promise<boolean>;
  /** 步骤执行回调（用于 UI 展示） */
  onStep?: (step: Step, result: AgentResult) => void;
  /** 思考回调 */
  onThink?: (response: BrainResponse) => void;
}

export class AgentLoop {
  private brain: IBrain;
  private agentResolver: (name: string) => IAgent | undefined;
  private defaultAgent?: IAgent;
  private config: LoopConfig;

  constructor(
    brain: IBrain,
    agentResolver: (name: string) => IAgent | undefined,
    config: Partial<LoopConfig> = {},
    defaultAgent?: IAgent,
  ) {
    this.brain = brain;
    this.agentResolver = agentResolver;
    this.defaultAgent = defaultAgent;
    this.config = {
      maxIterations: config.maxIterations ?? 10,
      requireApproval: config.requireApproval ?? false,
      onApproval: config.onApproval,
      onStep: config.onStep,
      onThink: config.onThink,
    };
  }

  /** 运行完整的任务循环 */
  async run(task: string, sessionId: string): Promise<AgentResult> {
    const history: StepResult[] = [];
    let iteration = 0;

    while (iteration < this.config.maxIterations) {
      iteration++;

      // 1. Brain 分析
      const response = await this.brain.analyze(task, history);
      this.config.onThink?.(response);

      // 2. 如果 Brain 说完成了，返回总结
      if (response.done || response.steps.length === 0) {
        return {
          success: true,
          output: response.summary,
          metadata: { iterations: iteration, steps: history.length },
        };
      }

      // 3. 逐步执行
      for (const step of response.steps) {
        // 审批检查
        if (this.config.requireApproval && this.config.onApproval) {
          const approved = await this.config.onApproval(step);
          if (!approved) {
            return {
              success: false,
              output: '',
              error: `User rejected step: ${step.description}`,
              metadata: { iterations: iteration, steps: history.length },
            };
          }
        }

        // 找到执行 Agent
        const agent = step.agent
          ? this.agentResolver(step.agent)
          : this.defaultAgent;

        if (!agent) {
          history.push({
            step,
            result: { success: false, output: '', error: `No agent found for: ${step.agent ?? 'default'}` },
          });
          continue;
        }

        // 执行
        const input: AgentInput = {
          raw: step.command,
          command: step.command,
          sessionId,
        };

        const result = await agent.execute(input);
        history.push({ step, result });
        this.config.onStep?.(step, result);

        // 如果某步失败，让 Brain 决定怎么处理（下一轮循环）
        if (!result.success) break;
      }
    }

    return {
      success: false,
      output: '',
      error: `Max iterations (${this.config.maxIterations}) reached`,
      metadata: { iterations: iteration, steps: history.length },
    };
  }
}
