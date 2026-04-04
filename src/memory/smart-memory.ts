/**
 * Smart Memory — 智能记忆系统（借鉴 Claude Code 的 CLAUDE.md + 项目上下文）
 *
 * OpenDeepCrew 缺失：会话关了上下文就没了
 * Claude Code 做法：.claude/ 目录 + CLAUDE.md 项目记忆
 *
 * 我们的三层记忆：
 * 1. 短期记忆：当前会话对话历史（内存）
 * 2. 项目记忆：项目结构、约定、常用命令（文件持久化）
 * 3. 长期记忆：跨项目的用户偏好、经验教训（SQLite）
 *
 * 每次新会话自动注入相关上下文
 */

import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import type { MemoryStore } from './memory-store.js';

/** 项目记忆文件内容 */
export interface ProjectMemory {
  /** 项目描述 */
  description: string;
  /** 技术栈 */
  techStack: string[];
  /** 常用命令 */
  commands: Record<string, string>;
  /** 项目约定/规范 */
  conventions: string[];
  /** 重要文件说明 */
  keyFiles: Record<string, string>;
  /** 自定义上下文（用户手动添加） */
  customContext: string[];
}

const DEFAULT_PROJECT_MEMORY: ProjectMemory = {
  description: '',
  techStack: [],
  commands: {},
  conventions: [],
  keyFiles: {},
  customContext: [],
};

export class SmartMemory {
  private store: MemoryStore;
  private projectDir: string;
  private projectMemoryPath: string;
  private projectMemory: ProjectMemory;

  constructor(store: MemoryStore, projectDir: string = process.cwd()) {
    this.store = store;
    this.projectDir = projectDir;

    // 项目记忆存在 .macli/memory.json
    const macliDir = resolve(projectDir, '.macli');
    this.projectMemoryPath = resolve(macliDir, 'memory.json');

    if (existsSync(this.projectMemoryPath)) {
      try {
        this.projectMemory = JSON.parse(readFileSync(this.projectMemoryPath, 'utf-8'));
      } catch {
        this.projectMemory = { ...DEFAULT_PROJECT_MEMORY };
      }
    } else {
      this.projectMemory = { ...DEFAULT_PROJECT_MEMORY };
    }
  }

  /** 构建注入给 Agent/Brain 的上下文 */
  buildContext(sessionId: string, query: string): string {
    const parts: string[] = [];

    // 1. 项目记忆
    const pm = this.projectMemory;
    if (pm.description) {
      parts.push(`## Project: ${pm.description}`);
    }
    if (pm.techStack.length > 0) {
      parts.push(`Tech stack: ${pm.techStack.join(', ')}`);
    }
    if (Object.keys(pm.commands).length > 0) {
      parts.push('Common commands:');
      for (const [name, cmd] of Object.entries(pm.commands)) {
        parts.push(`  ${name}: ${cmd}`);
      }
    }
    if (pm.conventions.length > 0) {
      parts.push('Conventions:');
      pm.conventions.forEach(c => parts.push(`  - ${c}`));
    }
    if (pm.customContext.length > 0) {
      parts.push('Additional context:');
      pm.customContext.forEach(c => parts.push(`  - ${c}`));
    }

    // 2. 最近会话历史
    const recent = this.store.getSession(sessionId, 10);
    if (recent.length > 0) {
      parts.push('\nRecent conversation:');
      for (const entry of recent) {
        parts.push(`  [${entry.role}] ${entry.content.slice(0, 150)}`);
      }
    }

    // 3. 相关长期记忆（关键词搜索）
    const keywords = query.split(/\s+/).filter(w => w.length > 2).slice(0, 3);
    if (keywords.length > 0) {
      const longTerm = this.store.search(keywords.join(' '), 5);
      if (longTerm.length > 0) {
        parts.push('\nRelevant past experience:');
        for (const entry of longTerm) {
          parts.push(`  - ${entry.content.slice(0, 150)}`);
        }
      }
    }

    return parts.join('\n');
  }

  /** 更新项目记忆 */
  updateProject(updates: Partial<ProjectMemory>) {
    Object.assign(this.projectMemory, updates);
    this.saveProject();
  }

  /** 添加项目约定 */
  addConvention(convention: string) {
    if (!this.projectMemory.conventions.includes(convention)) {
      this.projectMemory.conventions.push(convention);
      this.saveProject();
    }
  }

  /** 添加常用命令 */
  addCommand(name: string, command: string) {
    this.projectMemory.commands[name] = command;
    this.saveProject();
  }

  /** 从 agent 执行结果中自动提取值得记住的信息 */
  autoExtract(agentName: string, input: string, output: string, sessionId: string) {
    // 如果执行了 npm/git 命令且成功，记录为常用命令
    const cmdMatch = input.match(/^(npm|git|docker)\s+.+/);
    if (cmdMatch && output && !output.includes('error')) {
      // 记录到长期记忆
      this.store.add({
        sessionId,
        role: 'system',
        agentName,
        content: `Successful command: ${input} → ${output.slice(0, 100)}`,
        timestamp: Date.now(),
        tags: ['auto-extract', 'command'],
        persistent: true,
      });
    }

    // 如果输出包含错误信息，也记录（下次可以避免）
    if (output.includes('error') || output.includes('Error')) {
      this.store.add({
        sessionId,
        role: 'system',
        agentName,
        content: `Error encountered: ${input} → ${output.slice(0, 200)}`,
        timestamp: Date.now(),
        tags: ['auto-extract', 'error'],
        persistent: true,
      });
    }
  }

  getProjectMemory(): ProjectMemory {
    return { ...this.projectMemory };
  }

  private saveProject() {
    const dir = resolve(this.projectMemoryPath, '..');
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.projectMemoryPath, JSON.stringify(this.projectMemory, null, 2));
  }
}
