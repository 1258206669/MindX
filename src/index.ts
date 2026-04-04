#!/usr/bin/env node

/**
 * multi-agent-cli — 入口
 *
 * 运行模式：
 *   macli                          → 交互式 REPL
 *   macli -e "git status"          → 单次执行
 *   macli -e "@browser doubao"     → 打开豆包
 *   macli serve                    → HTTP 服务器（飞书/webhook）
 *   macli acpx kiro "修复 bug"     → 通过 acpx 驱动 Kiro
 */

import { program } from 'commander';
import React from 'react';
import { render } from 'ink';
import { Orchestrator } from './core/orchestrator.js';
import { builtinTools } from './tools/builtin.js';
import { loadToolDefs, loadPlugins } from './plugins/loader.js';
import { App } from './cli/app.js';
import { createServer } from './server/index.js';
import { WebhookChannel } from './channels/webhook.js';
import { FeishuChannel } from './channels/feishu.js';
import type { IChannel } from './channels/types.js';
import { AcpxBrain } from './brains/acpx-brain.js';
import { AcpxCli, type AcpxAgent } from './lib/acpx.js';

async function initOrchestrator(opts: any): Promise<Orchestrator> {
  const orchestrator = new Orchestrator();
  await orchestrator.ready();

  if (opts.builtin !== false) {
    for (const tool of builtinTools) {
      orchestrator.registerTool(tool);
    }
  }

  const userTools = loadToolDefs(opts.toolsDir);
  for (const tool of userTools) {
    orchestrator.registerTool(tool);
  }

  await loadPlugins(orchestrator, opts.pluginsDir);
  return orchestrator;
}

async function main() {
  program
    .name('macli')
    .description('Multi-agent CLI framework')
    .version('0.1.0');

  // 默认命令：交互式 REPL 或单次执行
  program
    .option('-e, --exec <command>', 'Execute a single command and exit')
    .option('--no-builtin', 'Skip loading built-in tools')
    .option('--tools-dir <path>', 'Custom tools directory')
    .option('--plugins-dir <path>', 'Custom plugins directory')
    .action(async (opts) => {
      const orchestrator = await initOrchestrator(opts);

      if (opts.exec) {
        const result = await orchestrator.handle(opts.exec);
        console.log(result.success ? result.output : result.error);
        orchestrator.destroy();
        process.exit(result.success ? 0 : 1);
      }

      render(React.createElement(App, { orchestrator }));
    });

  // serve: HTTP 服务器
  program
    .command('serve')
    .description('Start HTTP server for Feishu/Webhook integrations')
    .option('-p, --port <port>', 'Server port', '3120')
    .option('--host <host>', 'Server host', '127.0.0.1')
    .option('--feishu-app-id <id>', 'Feishu App ID')
    .option('--feishu-app-secret <secret>', 'Feishu App Secret')
    .option('--feishu-token <token>', 'Feishu Verification Token')
    .option('--no-builtin', 'Skip loading built-in tools')
    .option('--tools-dir <path>', 'Custom tools directory')
    .option('--plugins-dir <path>', 'Custom plugins directory')
    .action(async (opts) => {
      const orchestrator = await initOrchestrator(opts);
      const channels = new Map<string, IChannel>();

      channels.set('webhook', new WebhookChannel());

      if (opts.feishuAppId && opts.feishuAppSecret) {
        channels.set('feishu', new FeishuChannel({
          appId: opts.feishuAppId,
          appSecret: opts.feishuAppSecret,
          verificationToken: opts.feishuToken,
        }));
      }

      createServer(orchestrator, channels, {
        port: parseInt(opts.port),
        host: opts.host,
      });
    });

  // acpx: 通过 acpx 驱动 AI IDE
  program
    .command('acpx <agent> <message>')
    .description('Send a message to Kiro/Claude/Codex via acpx')
    .option('--cwd <path>', 'Working directory')
    .option('-s, --session <name>', 'Session name', 'macli-session')
    .option('--permission <mode>', 'Permission mode', 'approve-all')
    .action(async (agent: string, message: string, opts) => {
      const cli = new AcpxCli(agent as AcpxAgent);
      const cwd = opts.cwd ?? process.cwd();

      console.log(`🤖 Sending to ${agent}...`);

      try {
        // 确保会话
        await cli.sessionsEnsure({
          cwd,
          name: opts.session,
          permissionMode: opts.permission,
          timeout: 60,
        });

        // 发送并流式输出
        const { stream } = cli.prompt({
          cwd,
          name: opts.session,
          message,
          permissionMode: opts.permission,
        });

        for await (const event of stream) {
          const update = (event as any)?.params?.update;
          if (update?.sessionUpdate === 'agent_message_chunk') {
            const content = update.content;
            if (content?.type === 'text' && content.text) {
              process.stdout.write(content.text);
            }
          }
        }
        console.log('\n✅ Done');
      } catch (err: any) {
        console.error(`❌ Error: ${err.message}`);
        process.exit(1);
      }
    });

  // sessions: 管理 acpx 会话
  program
    .command('sessions')
    .description('List all acpx sessions')
    .option('--agent <agent>', 'Agent type', 'kiro')
    .action(async (opts) => {
      const cli = new AcpxCli(opts.agent as AcpxAgent);
      try {
        const sessions = await cli.sessionsList();
        if (!sessions?.length) {
          console.log('No active sessions.');
          return;
        }
        for (const s of sessions) {
          console.log(`  ${s.name} (${s.acpxRecordId}) — ${s.cwd}`);
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
      }
    });

  program.parse();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
