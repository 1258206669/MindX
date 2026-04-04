/**
 * MACLI IDE Bridge Extension
 *
 * 在 Kiro/Cursor 内部启动 WebSocket 服务器，
 * 接收外部指令，调用 IDE 内部 API 执行
 *
 * 支持的操作：
 * - chat: 发送消息给 IDE 内置 AI（Kiro AI / Cursor AI）
 * - command: 执行任意 VS Code 命令
 * - file: 文件读写操作
 * - terminal: 在 IDE 终端执行命令
 * - status: 获取 IDE 状态
 */

import * as vscode from 'vscode';
import { WebSocketServer, WebSocket } from 'ws';
import type { BridgeRequest, BridgeResponse, IdeStatus } from './protocol';

let wss: WebSocketServer | null = null;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  // 状态栏
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'macli.bridge.status';
  context.subscriptions.push(statusBarItem);

  // 注册命令
  context.subscriptions.push(
    vscode.commands.registerCommand('macli.bridge.start', () => startServer(context)),
    vscode.commands.registerCommand('macli.bridge.stop', stopServer),
    vscode.commands.registerCommand('macli.bridge.status', showStatus),
  );

  // 自动启动
  const config = vscode.workspace.getConfiguration('macli.bridge');
  if (config.get<boolean>('autoStart', true)) {
    startServer(context);
  }
}

function startServer(context: vscode.ExtensionContext) {
  if (wss) {
    vscode.window.showInformationMessage('MACLI Bridge is already running');
    return;
  }

  const config = vscode.workspace.getConfiguration('macli.bridge');
  const port = config.get<number>('port', 4120);

  wss = new WebSocketServer({ port, host: '127.0.0.1' });

  wss.on('connection', (ws) => {
    vscode.window.showInformationMessage('MACLI Bridge: client connected');
    updateStatusBar(true);

    ws.on('message', async (data) => {
      try {
        const req: BridgeRequest = JSON.parse(data.toString());
        await handleRequest(ws, req);
      } catch (err: any) {
        sendResponse(ws, { id: 'unknown', type: 'error', payload: { success: false, error: err.message } });
      }
    });

    ws.on('close', () => {
      updateStatusBar(wss?.clients.size ? true : false);
    });
  });

  wss.on('error', (err) => {
    vscode.window.showErrorMessage(`MACLI Bridge error: ${err.message}`);
    wss = null;
    updateStatusBar(false);
  });

  updateStatusBar(true);
  vscode.window.showInformationMessage(`MACLI Bridge started on port ${port}`);
}

function stopServer() {
  if (wss) {
    wss.close();
    wss = null;
    updateStatusBar(false);
    vscode.window.showInformationMessage('MACLI Bridge stopped');
  }
}

function showStatus() {
  const status = wss
    ? `Running on port ${vscode.workspace.getConfiguration('macli.bridge').get('port')}, ${wss.clients.size} client(s)`
    : 'Not running';
  vscode.window.showInformationMessage(`MACLI Bridge: ${status}`);
}

function updateStatusBar(running: boolean) {
  if (running) {
    statusBarItem.text = '$(plug) MACLI Bridge';
    statusBarItem.tooltip = `Connected clients: ${wss?.clients.size ?? 0}`;
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.text = '$(debug-disconnect) MACLI Bridge';
    statusBarItem.tooltip = 'Not running';
  }
  statusBarItem.show();
}

// ─── 请求处理 ────────────────────────────────

async function handleRequest(ws: WebSocket, req: BridgeRequest) {
  switch (req.type) {
    case 'chat':
      await handleChat(ws, req);
      break;
    case 'command':
      await handleCommand(ws, req);
      break;
    case 'file':
      await handleFile(ws, req);
      break;
    case 'terminal':
      await handleTerminal(ws, req);
      break;
    case 'status':
      await handleStatus(ws, req);
      break;
    default:
      sendResponse(ws, { id: req.id, type: 'error', payload: { success: false, error: `Unknown type: ${req.type}` } });
  }
}

/** 发送消息给 IDE 内置 AI */
async function handleChat(ws: WebSocket, req: BridgeRequest) {
  const { message, activeFile } = req.payload as { message: string; activeFile?: string };

  // 如果指定了文件，先打开它
  if (activeFile) {
    try {
      const uri = vscode.Uri.file(activeFile);
      await vscode.window.showTextDocument(uri);
    } catch { /* ignore */ }
  }

  try {
    // 方式 1: 尝试 Kiro 的 chat API
    // Kiro 基于 VS Code，可能暴露了 chat 相关命令
    const chatCommands = await vscode.commands.getCommands(true);

    // 查找可用的 AI chat 命令
    const kiroChat = chatCommands.find(c =>
      c.includes('kiro') && c.includes('chat') ||
      c.includes('aichat') ||
      c.includes('copilot.chat') ||
      c.includes('cursor.chat')
    );

    if (kiroChat) {
      // 直接调用 IDE 的 chat 命令
      const result = await vscode.commands.executeCommand(kiroChat, message);
      sendResponse(ws, {
        id: req.id,
        type: 'result',
        payload: { success: true, data: String(result ?? 'Command executed'), done: true },
      });
      return;
    }

    // 方式 2: 通过 VS Code Chat API（1.90+）
    // 这是标准的 VS Code Chat 扩展 API
    try {
      // 尝试使用 vscode.chat.sendRequest（如果可用）
      const chatResult = await vscode.commands.executeCommand(
        'workbench.action.chat.open',
        { query: message }
      );

      // 打开了 chat 面板并输入了消息
      // 通过监听输出来获取结果
      sendResponse(ws, {
        id: req.id,
        type: 'result',
        payload: {
          success: true,
          data: 'Message sent to IDE AI chat. Check IDE for response.',
          done: true,
        },
      });
      return;
    } catch { /* fallthrough */ }

    // 方式 3: 写入终端让 agent 处理
    await executeInTerminal(message);
    sendResponse(ws, {
      id: req.id,
      type: 'result',
      payload: { success: true, data: 'Sent to terminal', done: true },
    });

  } catch (err: any) {
    sendResponse(ws, {
      id: req.id,
      type: 'error',
      payload: { success: false, error: err.message },
    });
  }
}

/** 执行 VS Code 命令 */
async function handleCommand(ws: WebSocket, req: BridgeRequest) {
  const { command, args } = req.payload as { command: string; args?: unknown[] };
  try {
    const result = await vscode.commands.executeCommand(command, ...(args ?? []));
    sendResponse(ws, {
      id: req.id,
      type: 'result',
      payload: { success: true, data: JSON.stringify(result ?? null), done: true },
    });
  } catch (err: any) {
    sendResponse(ws, { id: req.id, type: 'error', payload: { success: false, error: err.message } });
  }
}

/** 文件操作 */
async function handleFile(ws: WebSocket, req: BridgeRequest) {
  const { action, path: filePath, content } = req.payload as { action: string; path?: string; content?: string };

  try {
    switch (action) {
      case 'read': {
        if (!filePath) throw new Error('path required');
        const uri = vscode.Uri.file(filePath);
        const data = await vscode.workspace.fs.readFile(uri);
        sendResponse(ws, {
          id: req.id, type: 'result',
          payload: { success: true, data: Buffer.from(data).toString('utf-8'), done: true },
        });
        break;
      }
      case 'write': {
        if (!filePath || content === undefined) throw new Error('path and content required');
        const uri = vscode.Uri.file(filePath);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
        sendResponse(ws, {
          id: req.id, type: 'result',
          payload: { success: true, data: 'Written', done: true },
        });
        break;
      }
      case 'open': {
        if (!filePath) throw new Error('path required');
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc);
        sendResponse(ws, {
          id: req.id, type: 'result',
          payload: { success: true, data: 'Opened', done: true },
        });
        break;
      }
      case 'list': {
        const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 100);
        const paths = files.map(f => f.fsPath);
        sendResponse(ws, {
          id: req.id, type: 'result',
          payload: { success: true, data: JSON.stringify(paths), done: true },
        });
        break;
      }
      default:
        throw new Error(`Unknown file action: ${action}`);
    }
  } catch (err: any) {
    sendResponse(ws, { id: req.id, type: 'error', payload: { success: false, error: err.message } });
  }
}

/** 终端执行 */
async function handleTerminal(ws: WebSocket, req: BridgeRequest) {
  const { command, cwd } = req.payload as { command: string; cwd?: string };
  try {
    await executeInTerminal(command, cwd);
    sendResponse(ws, {
      id: req.id, type: 'result',
      payload: { success: true, data: `Terminal command sent: ${command}`, done: true },
    });
  } catch (err: any) {
    sendResponse(ws, { id: req.id, type: 'error', payload: { success: false, error: err.message } });
  }
}

/** IDE 状态 */
async function handleStatus(ws: WebSocket, req: BridgeRequest) {
  const ide = detectIde();
  const status: IdeStatus = {
    ide,
    version: vscode.version,
    workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    activeFile: vscode.window.activeTextEditor?.document.uri.fsPath,
    bridgePort: vscode.workspace.getConfiguration('macli.bridge').get('port', 4120),
  };
  sendResponse(ws, {
    id: req.id, type: 'result',
    payload: { success: true, data: JSON.stringify(status), done: true },
  });
}

// ─── 工具函数 ────────────────────────────────

function detectIde(): IdeStatus['ide'] {
  const appName = vscode.env.appName.toLowerCase();
  if (appName.includes('kiro')) return 'kiro';
  if (appName.includes('cursor')) return 'cursor';
  if (appName.includes('code')) return 'vscode';
  return 'unknown';
}

async function executeInTerminal(command: string, cwd?: string) {
  const terminal = vscode.window.createTerminal({
    name: 'MACLI',
    cwd,
  });
  terminal.show();
  terminal.sendText(command);
}

function sendResponse(ws: WebSocket, response: BridgeResponse) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(response));
  }
}

export function deactivate() {
  stopServer();
}
