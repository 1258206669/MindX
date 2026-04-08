/**
 * MACLI IDE Bridge — Kiro 扩展
 *
 * WebSocket 服务器，接收外部指令，驱动 Kiro AI
 */

import * as vscode from 'vscode';
import { WebSocketServer, WebSocket } from 'ws';

interface Request { id: string; type: string; payload: any; }
interface Response { id: string; success: boolean; data?: string; error?: string; }

let wss: WebSocketServer | null = null;
let statusBar: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('MACLI Bridge');
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'macli.bridge.status';
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('macli.bridge.start', () => start()),
    vscode.commands.registerCommand('macli.bridge.stop', () => stop()),
    vscode.commands.registerCommand('macli.bridge.status', () => showStatus()),
  );

  if (vscode.workspace.getConfiguration('macli.bridge').get<boolean>('autoStart', true)) start();
}

export function deactivate() { stop(); }

function start() {
  if (wss) return;
  const port = vscode.workspace.getConfiguration('macli.bridge').get<number>('port', 4120);
  try { wss = new WebSocketServer({ port, host: '127.0.0.1' }); }
  catch (err: any) { vscode.window.showErrorMessage(`MACLI Bridge: ${err.message}`); return; }

  wss.on('connection', (ws) => {
    log('Client connected');
    updateStatus();
    ws.on('message', async (raw) => {
      try {
        const req: Request = JSON.parse(raw.toString());
        log(`← ${req.type}`);
        const res = await handle(req);
        send(ws, res);
      } catch (err: any) {
        send(ws, { id: 'err', success: false, error: err.message });
      }
    });
    ws.on('close', () => updateStatus());
  });

  wss.on('error', (err) => { vscode.window.showErrorMessage(`Bridge: ${err.message}`); wss = null; updateStatus(); });
  updateStatus();
  log(`Started on port ${port}`);
  vscode.window.showInformationMessage(`MACLI Bridge on port ${port}`);
}

function stop() { if (wss) { wss.close(); wss = null; updateStatus(); } }

function showStatus() {
  const s = wss ? `Running, ${wss.clients.size} client(s)` : 'Not running';
  vscode.window.showInformationMessage(`MACLI Bridge: ${s}`);
}

function updateStatus() {
  statusBar.text = wss ? `$(plug) MACLI [${wss.clients.size}]` : '$(debug-disconnect) MACLI';
  statusBar.show();
}

// ─── 请求路由 ────────────────────────────────

async function handle(req: Request): Promise<Response> {
  switch (req.type) {
    case 'chat': return handleChat(req);
    case 'command': return handleCommand(req);
    case 'file-read': return handleFileRead(req);
    case 'file-write': return handleFileWrite(req);
    case 'terminal': return handleTerminal(req);
    case 'status': return handleStatus(req);
    case 'list-commands': return handleListCommands(req);
    default: return { id: req.id, success: false, error: `Unknown: ${req.type}` };
  }
}

/**
 * Chat — 发消息给 Kiro AI
 *
 * 用 workbench.action.chat.open 打开 chat 面板并输入消息，
 * 然后轮询剪贴板等待回复
 */
async function handleChat(req: Request): Promise<Response> {
  const { message, file } = req.payload;

  if (file) {
    try {
      const doc = await vscode.workspace.openTextDocument(file);
      await vscode.window.showTextDocument(doc);
    } catch { /* ignore */ }
  }

  try {
    // 清空剪贴板做标记
    const marker = `__macli_${Date.now()}__`;
    await vscode.env.clipboard.writeText(marker);

    // 打开 chat 面板，query 参数会自动填入输入框
    await vscode.commands.executeCommand('workbench.action.chat.open', { query: message });
    await sleep(300);

    // 尝试多种方式提交消息
    const submitCommands = [
      'workbench.action.chat.acceptInput',
      'workbench.action.chat.submit',
      'kiro.chat.submit',
      'kiro.chat.send',
    ];

    let submitted = false;
    for (const cmd of submitCommands) {
      try {
        await vscode.commands.executeCommand(cmd);
        submitted = true;
        log(`Submitted via: ${cmd}`);
        break;
      } catch { /* try next */ }
    }

    if (!submitted) {
      // fallback: 模拟 Enter 键
      try {
        await vscode.commands.executeCommand('type', { text: '\n' });
        log('Submitted via Enter key');
      } catch { /* ignore */ }
    }

    // 轮询等待回复（最多 120 秒）
    const maxWait = 120_000;
    const poll = 3000;
    const start = Date.now();
    let lastClip = marker;

    while (Date.now() - start < maxWait) {
      await sleep(poll);

      try {
        await vscode.commands.executeCommand('workbench.action.chat.copyLastResponse');
      } catch {
        // 命令不存在，尝试其他方式
        try {
          await vscode.commands.executeCommand('kiro.chat.copyLastResponse');
        } catch { continue; }
      }

      const clip = await vscode.env.clipboard.readText();

      if (clip && clip !== marker && clip !== lastClip && clip !== message) {
        // 内容变了，等一轮确认稳定
        lastClip = clip;
        await sleep(poll);

        try { await vscode.commands.executeCommand('workbench.action.chat.copyLastResponse'); } catch {}
        const clip2 = await vscode.env.clipboard.readText();

        if (clip2 === clip) {
          return { id: req.id, success: true, data: clip };
        }
        lastClip = clip2;
      }
    }

    // 超时但消息已发送
    if (lastClip !== marker) {
      return { id: req.id, success: true, data: lastClip };
    }

    return { id: req.id, success: true, data: 'Message sent to Kiro AI. Check chat panel for response.' };
  } catch (err: any) {
    return { id: req.id, success: false, error: err.message };
  }
}

async function handleCommand(req: Request): Promise<Response> {
  try {
    const result = await vscode.commands.executeCommand(req.payload.command, ...(req.payload.args ?? []));
    return { id: req.id, success: true, data: JSON.stringify(result ?? null) };
  } catch (err: any) {
    return { id: req.id, success: false, error: err.message };
  }
}

async function handleFileRead(req: Request): Promise<Response> {
  try {
    const data = await vscode.workspace.fs.readFile(vscode.Uri.file(req.payload.path));
    return { id: req.id, success: true, data: Buffer.from(data).toString('utf-8') };
  } catch (err: any) {
    return { id: req.id, success: false, error: err.message };
  }
}

async function handleFileWrite(req: Request): Promise<Response> {
  try {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(req.payload.path), Buffer.from(req.payload.content, 'utf-8'));
    return { id: req.id, success: true, data: 'Written' };
  } catch (err: any) {
    return { id: req.id, success: false, error: err.message };
  }
}

async function handleTerminal(req: Request): Promise<Response> {
  try {
    const t = vscode.window.createTerminal({ name: 'MACLI' });
    t.show();
    t.sendText(req.payload.command);
    return { id: req.id, success: true, data: `Sent: ${req.payload.command}` };
  } catch (err: any) {
    return { id: req.id, success: false, error: err.message };
  }
}

async function handleStatus(req: Request): Promise<Response> {
  const n = vscode.env.appName.toLowerCase();
  return {
    id: req.id, success: true,
    data: JSON.stringify({
      ide: n.includes('kiro') ? 'kiro' : n.includes('cursor') ? 'cursor' : 'vscode',
      version: vscode.version,
      appName: vscode.env.appName,
      workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
      activeFile: vscode.window.activeTextEditor?.document.uri.fsPath ?? null,
    }),
  };
}

/** 列出所有可用命令（调试用） */
async function handleListCommands(req: Request): Promise<Response> {
  const all = await vscode.commands.getCommands(true);
  const filter = req.payload?.filter as string | undefined;
  const cmds = filter ? all.filter(c => c.toLowerCase().includes(filter.toLowerCase())) : all;
  return { id: req.id, success: true, data: JSON.stringify(cmds) };
}

function send(ws: WebSocket, res: Response) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(res));
}

function log(msg: string) {
  outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
