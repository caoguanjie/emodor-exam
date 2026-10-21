import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/configuration';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface AuditEntry {
  ts: string;
  actor_id: string | number | null;
  actor_name: string;
  action: string;
  object_type: string;
  object_id: string | number | null;
  detail: Record<string, unknown>;
  result: 'success' | 'failure';
  source_ip: string | null;
}

const SENSITIVE_KEY = /(?:pass(?:word)?|pwd|secret|token|authorization|cookie|api[_-]?key|credential)/i;

function redactText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:pass(?:word)?|pwd|secret|token|api[_-]?key)\s*["']?\s*[=:]\s*["']?)[^"'\\\s,;&}]+/gi, '$1[REDACTED]');
}

/**
 * Central audit sanitizer shared by the writer, fallback and query path. It
 * deliberately preserves action/result diagnostics while removing credentials
 * recursively, including values nested in arrays or legacy JSONL records.
 */
export function redactAuditValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactAuditValue(item, seen));
  const output: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactAuditValue(item, seen);
  }
  return output;
}

/**
 * 审计日志（07 册 4.5，NFR-10）：管理端敏感操作与考试关键事件留痕。
 * 载体：结构化 JSON 文件（audit 通道，按天切割），不为审计新增 MySQL 表，
 * 保留 ≥ 180 天由外部 logrotate 承担。日志不含任何明文口令 / api_key（仅掩码）。
 */
@Injectable()
export class AuditService {
  constructor(private readonly config: AppConfig) {}

  private file(): string {
    const dir = resolve(this.config.logDir, 'audit');
    mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    return join(dir, `audit-${day}.log`);
  }

  log(entry: Omit<AuditEntry, 'ts'>) {
    const sanitized = redactAuditValue({ ts: new Date().toISOString(), ...entry });
    try {
      const line = JSON.stringify(sanitized);
      appendFileSync(this.file(), line + '\n', { encoding: 'utf8' });
    } catch {
      // 审计失败不阻断业务（文件系统异常时降级为标准错误输出）
      console.error('[audit-fallback]', JSON.stringify(sanitized));
    }
  }
}
