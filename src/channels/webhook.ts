/**
 * Webhook 通用渠道 — 最简单的 HTTP 接入方式
 *
 * 任何能发 HTTP POST 的工具都能用：
 *   curl -X POST http://localhost:3120/channel/webhook \
 *     -H "Content-Type: application/json" \
 *     -d '{"text": "git status", "sender": "test"}'
 *
 * 也可以用来对接钉钉、企业微信等（自己写解析逻辑）
 */

import type { IChannel, ChannelMessage, ChannelReply } from './types.js';

export class WebhookChannel implements IChannel {
  readonly name = 'webhook';

  parseRequest(body: any, _headers: Record<string, string>): ChannelMessage | null {
    const text = body?.text || body?.message || body?.content;
    if (!text || typeof text !== 'string') return null;

    return {
      channel: 'webhook',
      senderId: body?.sender || body?.user || 'anonymous',
      senderName: body?.name,
      text: text.trim(),
      raw: body,
    };
  }

  formatReply(reply: ChannelReply): unknown {
    return {
      success: !reply.isError,
      text: reply.text,
    };
  }

  verify(): boolean {
    return true; // webhook 不做签名验证，靠网络层安全
  }
}
