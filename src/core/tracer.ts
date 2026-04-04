/**
 * Tracer — 执行链路追踪（补 OpenDeepCrew 缺失的可观测性）
 *
 * 记录每个任务的完整执行链路：
 *   任务 → Brain 分析 → Agent 选择 → 工具调用 → 结果
 *
 * 支持：
 * - 结构化 span（类似 OpenTelemetry）
 * - 耗时统计
 * - 错误分类
 * - 导出为 JSON（可接入外部监控）
 */

export interface Span {
  id: string;
  traceId: string;
  parentId?: string;
  name: string;
  kind: 'task' | 'brain' | 'agent' | 'tool' | 'permission';
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'running' | 'ok' | 'error';
  attributes: Record<string, unknown>;
  error?: string;
}

export interface Trace {
  id: string;
  task: string;
  startTime: number;
  endTime?: number;
  status: 'running' | 'ok' | 'error';
  spans: Span[];
}

let counter = 0;
function genId(): string {
  return `${Date.now().toString(36)}-${(counter++).toString(36)}`;
}

export class Tracer {
  private traces: Map<string, Trace> = new Map();
  private onSpanEnd?: (span: Span, trace: Trace) => void;

  constructor(opts?: { onSpanEnd?: (span: Span, trace: Trace) => void }) {
    this.onSpanEnd = opts?.onSpanEnd;
  }

  /** 开始一个新的 trace（对应一个用户任务） */
  startTrace(task: string): string {
    const id = genId();
    this.traces.set(id, {
      id,
      task,
      startTime: Date.now(),
      status: 'running',
      spans: [],
    });
    return id;
  }

  /** 开始一个 span */
  startSpan(traceId: string, name: string, kind: Span['kind'], parentId?: string): string {
    const trace = this.traces.get(traceId);
    if (!trace) return '';

    const span: Span = {
      id: genId(),
      traceId,
      parentId,
      name,
      kind,
      startTime: Date.now(),
      status: 'running',
      attributes: {},
    };
    trace.spans.push(span);
    return span.id;
  }

  /** 结束一个 span */
  endSpan(traceId: string, spanId: string, status: 'ok' | 'error' = 'ok', error?: string) {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    const span = trace.spans.find(s => s.id === spanId);
    if (!span) return;

    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;
    if (error) span.error = error;

    this.onSpanEnd?.(span, trace);
  }

  /** 给 span 添加属性 */
  setAttributes(traceId: string, spanId: string, attrs: Record<string, unknown>) {
    const trace = this.traces.get(traceId);
    const span = trace?.spans.find(s => s.id === spanId);
    if (span) Object.assign(span.attributes, attrs);
  }

  /** 结束 trace */
  endTrace(traceId: string, status: 'ok' | 'error' = 'ok') {
    const trace = this.traces.get(traceId);
    if (!trace) return;
    trace.endTime = Date.now();
    trace.status = status;
  }

  /** 获取 trace 摘要 */
  getSummary(traceId: string): string {
    const trace = this.traces.get(traceId);
    if (!trace) return 'Trace not found';

    const total = trace.endTime ? trace.endTime - trace.startTime : Date.now() - trace.startTime;
    const errors = trace.spans.filter(s => s.status === 'error');
    const lines = [
      `Task: ${trace.task}`,
      `Status: ${trace.status} | Duration: ${total}ms | Spans: ${trace.spans.length} | Errors: ${errors.length}`,
    ];

    for (const span of trace.spans) {
      const dur = span.duration ? `${span.duration}ms` : 'running';
      const icon = span.status === 'ok' ? '✓' : span.status === 'error' ? '✗' : '⏳';
      lines.push(`  ${icon} [${span.kind}] ${span.name} (${dur})`);
      if (span.error) lines.push(`    Error: ${span.error}`);
    }

    return lines.join('\n');
  }

  /** 导出所有 traces（可接入外部监控） */
  export(): Trace[] {
    return [...this.traces.values()];
  }

  /** 清理旧 traces */
  cleanup(maxAge = 3600_000) {
    const cutoff = Date.now() - maxAge;
    for (const [id, trace] of this.traces) {
      if (trace.startTime < cutoff) this.traces.delete(id);
    }
  }
}
