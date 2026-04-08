/**
 * HTTP Server — 渠道网关 + 任务队列
 *
 * 完整链路：
 *   飞书消息 → POST /channel/feishu → TaskQueue → Orchestrator/AcpxBrain → 结果回传
 */

import express from 'express';
import type { Orchestrator } from '../core/orchestrator.js';
import type { IChannel, ChannelReply } from '../channels/types.js';
import { TaskQueue, type Task } from '../core/task-queue.js';
import { IdeBrain } from '../brains/ide-brain.js';

export interface ServerConfig {
  port: number;
  host?: string;
  idePort?: number;
}

export function createServer(orchestrator: Orchestrator, channels: Map<string, IChannel>, config: ServerConfig) {
  const app = express();
  app.use(express.json());

  // ─── IDE Brain（连接 Kiro）────────────────

  const ideBrain = new IdeBrain({ url: `ws://127.0.0.1:${config.idePort ?? 4120}` });
  let ideConnected = false;

  (async () => {
    try {
      await ideBrain.status();
      ideConnected = true;
      console.log('🔌 Connected to Kiro IDE');
    } catch {
      console.log('⚠️  Kiro not connected. Messages will use CLI agents.');
    }
  })();

  // ─── 任务队列 ────────────────────────────

  const taskQueue = new TaskQueue({
    concurrency: 3,
    taskTimeout: 300_000,
    executor: async (task: Task) => {
      // 优先发给 Kiro
      if (ideConnected) {
        try {
          await ideBrain.command('kiroAgent.sendMainUserInput', [task.input]);
          return `✅ 已发送给 Kiro: "${task.input}"`;
        } catch {
          ideConnected = false;
        }
      }
      // fallback: CLI Agent
      const result = await orchestrator.handle(task.input);
      return result.success ? (result.output || 'Done.') : (result.error || 'Failed.');
    },
    onComplete: (task: Task) => {
      // 任务完成后，如果有渠道信息，尝试推送结果
      if (task.channel && task.sender) {
        const channel = channels.get(task.channel);
        if (channel?.push) {
          const reply: ChannelReply = {
            text: task.status === 'done' ? (task.result || 'Done.') : `❌ ${task.error || 'Failed.'}`,
            isError: task.status === 'failed',
          };
          channel.push(task.sender, reply).catch(() => {});
        }
      }
    },
  });

  // ─── 渠道消息入口 ────────────────────────

  app.post('/channel/:name', async (req, res) => {
    const channelName = req.params.name;
    const channel = channels.get(channelName);

    if (!channel) {
      res.status(404).json({ error: `Channel not found: ${channelName}` });
      return;
    }

    // 飞书 challenge 验证
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
      res.json({ ok: true, message: 'Ignored' });
      return;
    }

    // 加入任务队列（异步执行，立即返回）
    const messageId = (msg.raw as any)?.event?.message?.message_id;
    const task = taskQueue.add(msg.text, {
      channel: channelName,
      sender: messageId || msg.senderId,
    });

    // 立即回复"已收到"
    const ack: ChannelReply = {
      text: `📝 收到，排队中... (任务 ${task.id.slice(0, 8)})`,
    };
    res.json(channel.formatReply(ack, msg));
  });

  // ─── API 端点 ────────────────────────────

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      agents: orchestrator.listAgents().length,
      tasks: taskQueue.stats(),
    });
  });

  app.get('/agents', (_req, res) => {
    res.json(orchestrator.listAgents());
  });

  // 任务管理
  app.get('/tasks', (req, res) => {
    const status = req.query.status as string | undefined;
    res.json(taskQueue.list(status as any));
  });

  app.get('/tasks/:id', (req, res) => {
    const task = taskQueue.get(req.params.id);
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json(task);
  });

  app.delete('/tasks/:id', (req, res) => {
    const ok = taskQueue.cancel(req.params.id);
    res.json({ cancelled: ok });
  });

  // 记忆查询
  app.get('/memory/search', (req, res) => {
    const q = req.query.q as string;
    if (!q) { res.status(400).json({ error: 'Missing: q' }); return; }
    res.json(orchestrator.getMemory().search(q));
  });

  // 安全审计
  app.get('/audit', (_req, res) => {
    res.json(orchestrator.getPermissions().getAuditLog());
  });

  // 直接执行
  app.post('/exec', async (req, res) => {
    const { text, agent, async: isAsync } = req.body;
    if (!text) { res.status(400).json({ error: 'Missing: text' }); return; }

    if (isAsync) {
      // 异步模式：加入队列
      const task = taskQueue.add(text);
      res.json({ taskId: task.id, status: 'pending' });
      return;
    }

    // 同步模式：等待结果
    const result = agent
      ? await orchestrator.handleWith(agent, text)
      : await orchestrator.handle(text);
    res.json(result);
  });

  // ─── 启动 ────────────────────────────────

  const host = config.host ?? '127.0.0.1';
  const server = app.listen(config.port, host, () => {
    console.log(`\n🚀 multi-agent-cli server`);
    console.log(`   http://${host}:${config.port}`);
    console.log(`\n   Channels: ${[...channels.keys()].join(', ') || 'none'}`);
    console.log(`   Agents: ${orchestrator.listAgents().map(a => a.name).join(', ')}`);
    console.log(`\n   API:`);
    console.log(`   POST /channel/:name  — 接收渠道消息（飞书/webhook）`);
    console.log(`   POST /exec           — 直接执行（同步/异步）`);
    console.log(`   GET  /tasks          — 查看任务队列`);
    console.log(`   GET  /agents         — 查看 Agent 列表`);
    console.log(`   GET  /memory/search  — 搜索记忆`);
    console.log(`   GET  /audit          — 安全审计日志`);
    console.log(`   GET  /health         — 健康检查`);
  });

  // 定期清理
  setInterval(() => taskQueue.cleanup(), 600_000);

  return server;
}
