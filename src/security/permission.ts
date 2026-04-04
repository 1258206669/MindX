/**
 * Permission Engine — 安全审批层（借鉴 Claude Code 安全沙箱）
 *
 * OpenDeepCrew 缺失：agent 执行命令时无任何拦截
 * Claude Code 做法：命令白名单 + 路径沙箱 + 执行审批
 *
 * 我们的实现：
 * 1. 命令白名单/黑名单
 * 2. 路径沙箱（限制可访问的目录）
 * 3. 审批回调（危险操作需要人工确认）
 * 4. 操作审计日志
 */

export type PermissionLevel = 'allow' | 'ask' | 'deny';

export interface PermissionRule {
  /** 匹配模式（正则） */
  pattern: RegExp;
  /** 权限级别 */
  level: PermissionLevel;
  /** 规则说明 */
  reason: string;
}

export interface PermissionCheck {
  allowed: boolean;
  level: PermissionLevel;
  reason: string;
  command: string;
}

export interface AuditEntry {
  timestamp: number;
  command: string;
  result: PermissionCheck;
  approved?: boolean;
  approver?: string;
}

export class PermissionEngine {
  private rules: PermissionRule[] = [];
  private sandboxPaths: string[] = [];
  private auditLog: AuditEntry[] = [];
  private onAsk?: (check: PermissionCheck) => Promise<boolean>;

  constructor(opts?: {
    sandboxPaths?: string[];
    onAsk?: (check: PermissionCheck) => Promise<boolean>;
  }) {
    this.sandboxPaths = opts?.sandboxPaths ?? [process.cwd()];
    this.onAsk = opts?.onAsk;
    this.loadDefaultRules();
  }

  private loadDefaultRules() {
    // 危险命令 — 直接拒绝
    this.deny(/\brm\s+-rf\s+[\/~]/, 'Dangerous: rm -rf on root or home');
    this.deny(/\brm\s+-rf\s+\*/, 'Dangerous: rm -rf wildcard');
    this.deny(/\bformat\b/i, 'Dangerous: format command');
    this.deny(/\b(shutdown|reboot|halt)\b/i, 'Dangerous: system shutdown');
    this.deny(/\bcurl\b.*\|\s*(bash|sh)\b/, 'Dangerous: pipe curl to shell');
    this.deny(/\bchmod\s+777\b/, 'Dangerous: chmod 777');
    this.deny(/\bnpm\s+publish\b/, 'Requires approval: npm publish');

    // 需要确认的命令
    this.ask(/\brm\b/, 'Delete operation requires confirmation');
    this.ask(/\bgit\s+push\b/, 'Push to remote requires confirmation');
    this.ask(/\bgit\s+reset\s+--hard\b/, 'Hard reset requires confirmation');
    this.ask(/\bnpm\s+install\s+-g\b/, 'Global install requires confirmation');
    this.ask(/\bdocker\s+rm\b/, 'Container removal requires confirmation');

    // 安全命令 — 直接放行
    this.allow(/\bgit\s+(status|log|diff|branch)\b/, 'Safe git read operations');
    this.allow(/\bls\b/, 'Safe: list directory');
    this.allow(/\bcat\b/, 'Safe: read file');
    this.allow(/\becho\b/, 'Safe: echo');
    this.allow(/\bnpm\s+(list|outdated|run|test)\b/, 'Safe npm operations');
  }

  allow(pattern: RegExp, reason: string) {
    this.rules.unshift({ pattern, level: 'allow', reason });
  }

  ask(pattern: RegExp, reason: string) {
    this.rules.push({ pattern, level: 'ask', reason });
  }

  deny(pattern: RegExp, reason: string) {
    this.rules.unshift({ pattern, level: 'deny', reason });
  }

  /** 检查命令是否允许执行 */
  async check(command: string): Promise<PermissionCheck> {
    // 1. 路径沙箱检查
    const pathCheck = this.checkPaths(command);
    if (pathCheck) return pathCheck;

    // 2. 规则匹配
    for (const rule of this.rules) {
      if (rule.pattern.test(command)) {
        const result: PermissionCheck = {
          allowed: rule.level === 'allow',
          level: rule.level,
          reason: rule.reason,
          command,
        };

        if (rule.level === 'ask' && this.onAsk) {
          const approved = await this.onAsk(result);
          this.audit(result, approved);
          return { ...result, allowed: approved };
        }

        this.audit(result);
        return result;
      }
    }

    // 3. 默认：允许（但记录）
    const defaultResult: PermissionCheck = {
      allowed: true,
      level: 'allow',
      reason: 'No matching rule, default allow',
      command,
    };
    this.audit(defaultResult);
    return defaultResult;
  }

  private checkPaths(command: string): PermissionCheck | null {
    // 检测命令中是否包含沙箱外的绝对路径
    const absPathMatch = command.match(/(?:^|\s)(\/[\w/.-]+|[A-Z]:\\[\w\\.-]+)/g);
    if (!absPathMatch) return null;

    for (const pathStr of absPathMatch) {
      const p = pathStr.trim();
      const inSandbox = this.sandboxPaths.some(sp => p.startsWith(sp));
      if (!inSandbox) {
        return {
          allowed: false,
          level: 'deny',
          reason: `Path outside sandbox: ${p}`,
          command,
        };
      }
    }
    return null;
  }

  private audit(result: PermissionCheck, approved?: boolean) {
    this.auditLog.push({
      timestamp: Date.now(),
      command: result.command,
      result,
      approved,
    });
    // 只保留最近 1000 条
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-500);
    }
  }

  getAuditLog(limit = 50): AuditEntry[] {
    return this.auditLog.slice(-limit);
  }
}
