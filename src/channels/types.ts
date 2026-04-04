/**
 * Channel 渠道层类型定义
 *
 * 渠道 = 消息的来源和去处（飞书、钉钉、Telegram、Web、CLI…）
 * 所有渠道统一适配成 ChannelMessage 格式
 */

/** 标准化的渠道消息 */
export interface ChannelMessage {
  /** 消息来源渠道 */
  channel: string;
  /** 发送者 ID（飞书 user_id / Telegram chat_id 等） */
  senderId: string;
  /** 发送者名称 */
  senderName?: string;
  /** 消息内容 */
  text: string;
  /** 原始消息（渠道特定格式） */
  raw?: unknown;
}

/** 渠道回复 */
export interface ChannelReply {
  text: string;
  /** 是否为错误消息 */
  isError?: boolean;
}

/** 渠道适配器接口 */
export interface IChannel {
  readonly name: string;

  /** 处理来自该渠道的 HTTP 请求，返回标准化消息 */
  parseRequest(body: unknown, headers: Record<string, string>): ChannelMessage | null;

  /** 把回复格式化为该渠道的响应格式 */
  formatReply(reply: ChannelReply, originalMsg: ChannelMessage): unknown;

  /** 主动推送消息到渠道（可选） */
  push?(senderId: string, reply: ChannelReply): Promise<void>;

  /** 验证请求签名（安全校验） */
  verify?(body: unknown, headers: Record<string, string>): boolean;
}
