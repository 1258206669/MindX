/**
 * LLM Agent — 可选的 LLM 后端 Agent
 *
 * 通过 HTTP 调用 OpenAI / Anthropic / 本地 Ollama 等
 * 用户不接 LLM 时可以完全不用这个模块
 */

import { BaseAgent } from './base-agent.js';
import type { AgentBackend, AgentCapability, AgentInput, AgentResult } from '../types.js';

export interface LlmConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'custom';
  baseUrl: string;
  apiKey?: string;
  model: string;
  systemPrompt?: string;
}

export class LlmAgent extends BaseAgent {
  readonly name: string;
  readonly description: string;
  readonly backend: AgentBackend = 'llm';
  readonly capabilities: AgentCapability[];

  private config: LlmConfig;

  constructor(name: string, config: LlmConfig, capabilities: AgentCapability[] = []) {
    super();
    this.name = `llm:${name}`;
    this.description = `LLM agent powered by ${config.provider}/${config.model}`;
    this.config = config;
    this.capabilities = capabilities.length > 0 ? capabilities : [{
      name: 'general',
      description: 'General purpose LLM reasoning',
      keywords: ['think', 'analyze', 'explain', 'generate', 'help'],
    }];
  }

  async execute(input: AgentInput): Promise<AgentResult> {
    const messages = this.buildMessages(input);

    try {
      const response = await this.callLlm(messages);
      return this.ok(response);
    } catch (err: any) {
      return this.fail(`LLM call failed: ${err.message}`);
    }
  }

  private buildMessages(input: AgentInput): Array<{ role: string; content: string }> {
    const msgs: Array<{ role: string; content: string }> = [];

    if (this.config.systemPrompt) {
      msgs.push({ role: 'system', content: this.config.systemPrompt });
    }

    // 注入记忆上下文
    if (input.context?.length) {
      const ctx = input.context.map(m => `[${m.role}] ${m.content}`).join('\n');
      msgs.push({ role: 'system', content: `Previous context:\n${ctx}` });
    }

    msgs.push({ role: 'user', content: input.raw });
    return msgs;
  }

  private async callLlm(messages: Array<{ role: string; content: string }>): Promise<string> {
    const { provider, baseUrl, apiKey, model } = this.config;

    // 统一走 OpenAI 兼容接口（Anthropic/Ollama 都支持）
    const url = provider === 'anthropic'
      ? `${baseUrl}/v1/messages`
      : `${baseUrl}/v1/chat/completions`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers[provider === 'anthropic' ? 'x-api-key' : 'Authorization'] =
        provider === 'anthropic' ? apiKey : `Bearer ${apiKey}`;
    }

    let body: string;
    if (provider === 'anthropic') {
      const system = messages.find(m => m.role === 'system')?.content;
      const nonSystem = messages.filter(m => m.role !== 'system');
      body = JSON.stringify({ model, max_tokens: 4096, system, messages: nonSystem });
    } else {
      body = JSON.stringify({ model, messages });
    }

    const res = await fetch(url, { method: 'POST', headers, body });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

    const data = await res.json() as any;

    if (provider === 'anthropic') {
      return data.content?.[0]?.text ?? '';
    }
    return data.choices?.[0]?.message?.content ?? '';
  }
}
