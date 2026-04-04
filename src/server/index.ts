/**
 * HTTP Server — 渠道网关
 *
 * 统一接收来自各渠道的消息，路由到 Orchestrator 处理，回传结果
 *
 * 路由：
 *   POST /channel/:name  — 接收渠道消息
 *   GET  /health         — 健康检查
 *   GET  /agents         — 列出所有 Agent
 *   GET  /memory/search  — 搜索记忆
 */

import express from 'express';
import type { Orchestrator } from '../core/orchestrator.js';
import type { IChannel, ChannelReply } from '../channels/types.js';

export interface ServerConfig {
  port: number;
  host?: string;
}

export function createServer(orchestrator: Orchestrator, channels: Map<string, IChannel>, config: ServerConfig) {
  const app = express();
  app.use(express.json());

  // ─── 渠道消息入口 ────────────────────────

  app.post('/channel/:name', async (req, res) => {
    const channelName = req.params.name;
    const channel = channels.get(channelName);

    if (!channel) {
      res.status(404).json({ error: `Channel not found: ${channelName}` });
      return;
    }

    // 飞书 challenge 验证（特殊处理）
    if (req.body?.challenge) {
      res.json({ challenge: req.body.challenge });
      return;
    }

    // 签名验证
    if (channel.verify && !channel.verify(req.body, req.headers as Record<string, string>)) {
      res.status(403).json({ error: 'Verification failed' });
      return;
    }

    // 解析消息
    const msg = channel.parseRequest(req.body, req.headers as Record<string, string>);
    if (!msg) {
      res.json({ ok: true, message: 'Ignored (no parseable message)' });
      return;
    }

    // 执行 — 优先用 Brain（acpx），fallback 到普通 Agent 路由
    try {
      let result;
      try {
        result = await orchestrator.handleWithLoop(msg.text);
      } catch {
        // Brain 不可用，fallback 到普通路由
        result = await orchestrator.handle(msg.text);
      }
      const reply: ChannelReply = {
        text: result.success ? (result.output || 'Done.') : (result.error || 'Failed.'),
        isError: !result.success,
      };

      // 如果渠道支持主动推送，异步推送（飞书需要）
      if (channel.push) {
        const messageId = (msg.raw as any)?.event?.message?.message_id;
        if (messageId) {
          channel.push(messageId, reply).catch(err => {
            console.error(`Push to ${channelName} failed:`, err.message);
          });
        }
      }

      res.json(channel.formatReply(reply, msg));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── API 端点 ────────────────────────────

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', agents: orchestrator.listAgents().length });
  });

  app.get('/agents', (_req, res) => {
    res.json(orchestrator.listAgents());
  });

  app.get('/memory/search', (req, res) => {
    const q = req.query.q as string;
    if (!q) {
      res.status(400).json({ error: 'Missing query param: q' });
      return;
    }
    const results = orchestrator.getMemory().search(q);
    res.json(results);
  });

  // ─── 直接执行（方便调试） ─────────────────

  app.post('/exec', async (req, res) => {
    const { text, agent } = req.body;
    if (!text) {
      res.status(400).json({ error: 'Missing: text' });
      return;
    }

    const result = agent
      ? await orchestrator.handleWith(agent, text)
      : await orchestrator.handle(text);

    res.json(result);
  });

  /** 直接跟 Brain 对话（acpx → Kiro/Claude） */
  app.post('/chat', async (req, res) => {
    const { text } = req.body;
    if (!text) {
      res.status(400).json({ error: 'Missing: text' });
      return;
    }

    try {
      const result = await orchestrator.handleWithLoop(text);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── 启动 ────────────────────────────────

  const host = config.host ?? '127.0.0.1';
  const server = app.listen(config.port, host, () => {
    console.log(`🚀 Server running at http://${host}:${config.port}`);
    console.log(`   Channels: ${[...channels.keys()].join(', ') || 'none'}`);
    console.log(`   Agents: ${orchestrator.listAgents().map(a => a.name).join(', ')}`);
    console.log(`\n   POST /channel/:name  — receive channel messages`);
    console.log(`   POST /exec           — direct execution`);
    console.log(`   GET  /agents         — list agents`);
    console.log(`   GET  /health         — health check`);
  });

  return server;
}
