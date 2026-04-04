/**
 * 飞书（Lark）渠道适配器
 *
 * 飞书机器人 webhook 流程：
 * 1. 在飞书开放平台创建机器人应用
 * 2. 配置事件订阅 URL 指向我们的 /channel/feishu
 * 3. 用户 @机器人 发消息 → 飞书推送事件到我们的 server
 * 4. 我们处理后通过 API 回复
 *
 * 文档：https://open.feishu.cn/document/server-docs/im-v1/message/create
 */

import type { IChannel, ChannelMessage, ChannelReply } from './types.js';

export interface FeishuConfig {
  /** 应用 App ID */
  appId: string;
  /** 应用 App Secret */
  appSecret: string;
  /** Verification Token（用于验证请求来源） */
  verificationToken?: string;
  /** Encrypt Key（可选加密） */
  encryptKey?: string;
}

export class FeishuChannel implements IChannel {
  readonly name = 'feishu';
  private config: FeishuConfig;
  private accessToken: string = '';
  private tokenExpiry: number = 0;

  constructor(config: FeishuConfig) {
    this.config = config;
  }

  parseRequest(body: any, _headers: Record<string, string>): ChannelMessage | null {
    // 飞书 URL 验证（首次配置时飞书会发 challenge）
    if (body?.challenge) {
      return null; // 由 server 层直接返回 challenge
    }

    // 飞书事件 v2.0 格式
    const event = body?.event;
    if (!event) return null;

    // im.message.receive_v1 事件
    const message = event.message;
    if (!message) return null;

    // 只处理文本消息
    let text = '';
    try {
      const content = JSON.parse(message.content || '{}');
      text = content.text || '';
    } catch {
      text = message.content || '';
    }

    // 去掉 @机器人 的部分
    text = text.replace(/@_user_\d+/g, '').trim();

    if (!text) return null;

    return {
      channel: 'feishu',
      senderId: event.sender?.sender_id?.open_id || 'unknown',
      senderName: event.sender?.sender_id?.user_id,
      text,
      raw: body,
    };
  }

  formatReply(reply: ChannelReply, _originalMsg: ChannelMessage): unknown {
    return {
      msg_type: 'text',
      content: JSON.stringify({ text: reply.text }),
    };
  }

  verify(body: any, _headers: Record<string, string>): boolean {
    if (!this.config.verificationToken) return true;
    // 飞书 v2.0 事件验证
    return body?.token === this.config.verificationToken;
  }

  /** 主动回复消息 */
  async push(messageId: string, reply: ChannelReply): Promise<void> {
    const token = await this.getAccessToken();

    const res = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reply`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        msg_type: 'text',
        content: JSON.stringify({ text: reply.text }),
      }),
    });

    if (!res.ok) {
      throw new Error(`Feishu reply failed: ${res.status} ${await res.text()}`);
    }
  }

  /** 获取飞书 tenant_access_token */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
      }),
    });

    const data = await res.json() as any;
    this.accessToken = data.tenant_access_token;
    this.tokenExpiry = Date.now() + (data.expire - 300) * 1000; // 提前 5 分钟刷新
    return this.accessToken;
  }
}
