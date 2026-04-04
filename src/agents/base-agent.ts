/**
 * Base Agent — 所有 Agent 的抽象基类
 */

import type { IAgent, AgentBackend, AgentCapability, AgentInput, AgentResult } from '../types.js';

export abstract class BaseAgent implements IAgent {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly backend: AgentBackend;
  abstract readonly capabilities: AgentCapability[];

  abstract execute(input: AgentInput): Promise<AgentResult>;

  /** 通过关键词匹配判断能否处理 */
  canHandle(input: string): boolean {
    const lower = input.toLowerCase();
    return this.capabilities.some(cap =>
      cap.keywords.some(kw => lower.includes(kw.toLowerCase()))
    );
  }

  protected ok(output: string, metadata?: Record<string, unknown>): AgentResult {
    return { success: true, output, metadata };
  }

  protected fail(error: string): AgentResult {
    return { success: false, output: '', error };
  }
}
