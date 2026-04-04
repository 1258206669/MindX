/**
 * Rule Brain — 纯规则引擎，不需要任何 AI
 *
 * 通过预定义的规则匹配用户意图，生成执行计划
 * 适合固定流程的自动化任务
 */

import type { IBrain, BrainResponse, StepResult } from '../core/agent-loop.js';

export interface Rule {
  /** 规则名称 */
  name: string;
  /** 匹配模式（正则或关键词） */
  match: RegExp | string[];
  /** 生成执行步骤 */
  plan: (task: string, params: Record<string, string>) => BrainResponse;
}

export class RuleBrain implements IBrain {
  readonly name = 'brain:rules';
  private rules: Rule[] = [];

  addRule(rule: Rule): void {
    this.rules.push(rule);
  }

  async analyze(task: string, history: StepResult[]): Promise<BrainResponse> {
    // 如果上一步都成功了，检查是否还有后续
    if (history.length > 0) {
      const lastResult = history[history.length - 1];
      if (lastResult.result.success) {
        return { done: true, summary: 'All steps completed.', steps: [] };
      }
      // 失败了就停止
      return { done: true, summary: `Failed at: ${lastResult.step.description}`, steps: [] };
    }

    // 匹配规则
    for (const rule of this.rules) {
      const params = this.matchRule(task, rule);
      if (params) {
        return rule.plan(task, params);
      }
    }

    // 没有匹配的规则
    return { done: true, summary: `No rule matched: "${task}"`, steps: [] };
  }

  private matchRule(task: string, rule: Rule): Record<string, string> | null {
    if (rule.match instanceof RegExp) {
      const m = task.match(rule.match);
      if (m) {
        const params: Record<string, string> = {};
        m.forEach((val, i) => { if (i > 0) params[`$${i}`] = val; });
        return params;
      }
    } else {
      // 关键词匹配
      const lower = task.toLowerCase();
      if (rule.match.some(kw => lower.includes(kw.toLowerCase()))) {
        return {};
      }
    }
    return null;
  }
}

/** 预置一些常用规则 */
export function createDefaultRuleBrain(): RuleBrain {
  const brain = new RuleBrain();

  brain.addRule({
    name: 'git-deploy',
    match: ['deploy', '部署', '发布'],
    plan: () => ({
      done: false,
      summary: 'Running deploy pipeline',
      steps: [
        { description: 'Check git status', command: 'git status' },
        { description: 'Run tests', command: 'npm test' },
        { description: 'Build project', command: 'npm run build' },
        { description: 'Push to remote', command: 'git push' },
      ],
    }),
  });

  brain.addRule({
    name: 'git-sync',
    match: ['sync', '同步', 'pull'],
    plan: () => ({
      done: false,
      summary: 'Syncing with remote',
      steps: [
        { description: 'Pull latest', command: 'git pull' },
        { description: 'Install deps', command: 'npm install' },
      ],
    }),
  });

  brain.addRule({
    name: 'project-init',
    match: /init(?:ialize)?\s+(.+)/i,
    plan: (_task, params) => ({
      done: false,
      summary: `Initializing project: ${params['$1']}`,
      steps: [
        { description: 'Create directory', command: `mkdir ${params['$1']}` },
        { description: 'Init npm', command: `npm init -y` },
        { description: 'Init git', command: `git init` },
      ],
    }),
  });

  brain.addRule({
    name: 'cleanup',
    match: ['clean', '清理', 'cleanup'],
    plan: () => ({
      done: false,
      summary: 'Cleaning project',
      steps: [
        { description: 'Remove node_modules', command: 'rm -rf node_modules' },
        { description: 'Remove dist', command: 'rm -rf dist' },
        { description: 'Reinstall', command: 'npm install' },
      ],
    }),
  });

  return brain;
}
