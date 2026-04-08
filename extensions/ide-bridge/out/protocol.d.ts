/**
 * Bridge Protocol — 定义 WebSocket 通信的消息格式
 *
 * 客户端（你的 server）→ 扩展：Request
 * 扩展 → 客户端：Response / Event（流式）
 */
export interface BridgeRequest {
    id: string;
    type: 'chat' | 'command' | 'file' | 'terminal' | 'status';
    payload: ChatPayload | CommandPayload | FilePayload | TerminalPayload | {};
}
export interface ChatPayload {
    message: string;
    /** 可选：指定在哪个文件上下文中对话 */
    activeFile?: string;
}
export interface CommandPayload {
    /** VS Code command ID */
    command: string;
    args?: unknown[];
}
export interface FilePayload {
    action: 'read' | 'write' | 'open' | 'list';
    path?: string;
    content?: string;
}
export interface TerminalPayload {
    command: string;
    cwd?: string;
}
export interface BridgeResponse {
    id: string;
    type: 'result' | 'stream' | 'error' | 'event';
    payload: {
        success: boolean;
        data?: string;
        error?: string;
        done?: boolean;
    };
}
/** IDE 状态信息 */
export interface IdeStatus {
    ide: 'kiro' | 'cursor' | 'vscode' | 'unknown';
    version: string;
    workspace?: string;
    activeFile?: string;
    bridgePort: number;
}
