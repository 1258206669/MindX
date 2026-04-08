#!/usr/bin/env node

/**
 * multi-agent-cli — 入口
 *
 * 运行模式：
 *   macli                              → 交互式 REPL
 *   macli -e "git status"              → 单次执行 CLI 工具
 *   macli -e "@browser doubao"         → 打开浏览器
 *   macli serve                        → HTTP 服务器（飞书/webhook → Kiro）
 *   macli kiro "帮我修复 bug"           → 通过 IDE Bridge 让 Kiro 执行
 *   macli acpx kiro "修复 bug"         → 通过 acpx 驱动（需要 WSL）
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
import { IdeBrain } from './brains/ide-brain.js';
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
  for (const tool of userTools) orchestrator.registerTool(tool);

  await loadPlugins(orchestrator, opts.pluginsDir);
  return orchestrator;
}

async function main() {
  program
    .name('macli')
    .description('Multi-agent CLI framework — drive Kiro from anywhere')
    .version('0.1.0');

  // 默认：REPL 或单次执行
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

  // kiro: 通过 IDE Bridge 让 Kiro 执行任务
  program
    .command('kiro <message>')
    .description('Send a task to Kiro AI via IDE Bridge (Kiro must be open)')
    .option('--port <port>', 'IDE Bridge WebSocket port', '4120')
    .option('--file <path>', 'Open this file as context')
    .action(async (message: string, opts) => {
      const brain = new IdeBrain({ url: `ws://127.0.0.1:${opts.port}` });

      console.log('🔌 Connecting to Kiro IDE...');
      try {
        const status = await brain.status();
        console.log(`✅ Connected to ${status.appName} (${status.workspace || 'no workspace'})`);
        console.log(`📤 Sending: ${message}\n`);

        const reply = await brain.chat(message, opts.file);
        console.log(reply);

        brain.disconnect();
      } catch (err: any) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
    });

  // serve: HTTP 服务器（飞书 → Kiro）
  program
    .command('serve')
    .description('Start HTTP server — Feishu/Webhook messages → Kiro AI')
    .option('-p, --port <port>', 'Server port', '3120')
    .option('--host <host>', 'Server host', '127.0.0.1')
    .option('--ide-port <port>', 'IDE Bridge WebSocket port', '4120')
    .option('--feishu-app-id <id>', 'Feishu App ID')
    .option('--feishu-app-secret <secret>', 'Feishu App Secret')
    .option('--feishu-token <token>', 'Feishu Verification Token')
    .option('--no-builtin', 'Skip loading built-in tools')
    .option('--tools-dir <path>', 'Custom tools directory')
    .option('--plugins-dir <path>', 'Custom plugins directory')
    .action(async (opts) => {
      const orchestrator = await initOrchestrator(opts);

      // 设置 IDE Brain 作为大脑
      const brain = new IdeBrain({ url: `ws://127.0.0.1:${opts.idePort}` });
      orchestrator.setBrain(brain);

      // 尝试连接 Kiro
      try {
        const status = await brain.status();
        console.log(`🔌 Connected to ${status.appName}`);
      } catch {
        console.log('⚠️  Kiro IDE not connected. Chat commands will use CLI agents only.');
        console.log('   Start Kiro and install macli-ide-bridge extension to enable AI.');
      }

      // 注册渠道
      const channels = new Map<string, IChannel>();
      channels.set('webhook', new WebhookChannel());

      if (opts.feishuAppId && opts.feishuAppSecret) {
        channels.set('feishu', new FeishuChannel({
          appId: opts.feishuAppId,
          appSecret: opts.feishuAppSecret,
          verificationToken: opts.feishuToken,
        }));
        console.log('📱 Feishu channel enabled');
      }

      createServer(orchestrator, channels, {
        port: parseInt(opts.port),
        host: opts.host,
      });
    });

  // acpx: 通过 acpx 驱动（需要 WSL + kiro-cli）
  program
    .command('acpx <agent> <message>')
    .description('Drive AI IDE via acpx (requires WSL + kiro-cli)')
    .option('--cwd <path>', 'Working directory')
    .option('-s, --session <name>', 'Session name', 'macli-session')
    .action(async (agent: string, message: string, opts) => {
      const cli = new AcpxCli(agent as AcpxAgent);
      console.log(`🤖 Sending to ${agent}...`);
      try {
        await cli.sessionsEnsure({ cwd: opts.cwd ?? process.cwd(), name: opts.session, permissionMode: 'approve-all', timeout: 60 });
        const { stream } = cli.prompt({ cwd: opts.cwd, name: opts.session, message, permissionMode: 'approve-all' });
        for await (const event of stream) {
          const update = (event as any)?.params?.update;
          if (update?.sessionUpdate === 'agent_message_chunk') {
            const content = update.content;
            if (content?.type === 'text' && content.text) process.stdout.write(content.text);
          }
        }
        console.log('\n✅ Done');
      } catch (err: any) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
    });

  program.parse();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
