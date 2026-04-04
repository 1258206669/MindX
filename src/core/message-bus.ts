/**
 * Message Bus — 事件总线（参考 OpenClaw Gateway 消息路由）
 *
 * 所有 Agent、插件、记忆模块通过 Bus 通信，解耦各层
 */

import EventEmitter from 'eventemitter3';
import type { MessageBus as IMessageBus, BusMessage, MessageType } from '../types.js';

export class MessageBusImpl implements IMessageBus {
  private ee = new EventEmitter();

  emit(msg: BusMessage): void {
    this.ee.emit(msg.type, msg);
    // 同时广播到 '*' 通道，方便日志/审计
    this.ee.emit('*', msg);
  }

  on(type: MessageType | '*', handler: (msg: BusMessage) => void): void {
    this.ee.on(type, handler);
  }

  off(type: MessageType | '*', handler: (msg: BusMessage) => void): void {
    this.ee.off(type, handler);
  }

  /** 便捷方法：发送并等待对应的 result */
  async request(msg: BusMessage, timeout = 30_000): Promise<BusMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ee.off('agent:result', handler);
        reject(new Error(`Bus request timeout: ${msg.type}`));
      }, timeout);

      const handler = (result: BusMessage) => {
        if (result.sessionId === msg.sessionId) {
          clearTimeout(timer);
          this.ee.off('agent:result', handler);
          resolve(result);
        }
      };

      this.ee.on('agent:result', handler);
      this.emit(msg);
    });
  }
}
