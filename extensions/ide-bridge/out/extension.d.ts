/**
 * MACLI IDE Bridge — Kiro/Cursor 扩展
 *
 * 在 IDE 内部启动 WebSocket 服务器，接收外部指令，
 * 调用 IDE 内部 AI Chat 执行任务，返回结果。
 *
 * 安装方式：在 Kiro 里按 Ctrl+Shift+P → "Install from VSIX"
 */
import * as vscode from 'vscode';
export declare function activate(context: vscode.ExtensionContext): void;
export declare function deactivate(): void;
