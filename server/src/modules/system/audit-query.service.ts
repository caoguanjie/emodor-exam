import { Injectable } from '@nestjs/common';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { redactAuditValue, type AuditEntry } from '../../common/audit.service';
import { Errors } from '../../common/errors';
import { AppConfig } from '../../config/configuration';

const AUDIT_FILE = /^audit-(\d{4}-\d{2}-\d{2})\.log$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function auditStorageUnavailable(): never {
  throw Errors.serviceUnavailable('审计日志读取失败');
}

function auditId(value: unknown): string | number | null {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? value : null;
}

function normalizedAuditEntry(value: unknown): AuditEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.ts !== 'string' || typeof row.action !== 'string') return null;
  if (row.result !== 'success' && row.result !== 'failure') return null;
  const detail = row.detail && typeof row.detail === 'object' && !Array.isArray(row.detail)
    ? row.detail as Record<string, unknown>
    : {};
  // Rebuild the public shape instead of echoing arbitrary legacy top-level
  // properties. The recursive sanitizer then protects nested diagnostic data.
  return redactAuditValue({
    ts: row.ts,
    actor_id: auditId(row.actor_id),
    actor_name: typeof row.actor_name === 'string' ? row.actor_name : '',
    action: row.action,
    object_type: typeof row.object_type === 'string' ? row.object_type : '',
    object_id: auditId(row.object_id),
    detail,
    result: row.result,
    source_ip: typeof row.source_ip === 'string' ? row.source_ip : null,
  }) as AuditEntry;
}

export interface AuditQuery {
  date_from?: string;
  date_to?: string;
  actor?: string;
  action?: string;
  scope?: 'management' | 'security' | 'exam' | 'learner' | 'system' | 'all';
  result?: 'success' | 'failure';
  page?: number;
  page_size?: number;
}

const AUDIT_SCOPES = new Set(['management', 'security', 'exam', 'learner', 'system', 'all']);
const MANAGEMENT_ACTION_PREFIXES = [
  'access.', 'system.', 'student.', 'user.', 'training_category.', 'course.',
  'question', 'ai.', 'paper.', 'training_paper.', 'statistics.', 'regulation.',
];

function scopeOf(row: AuditEntry): Exclude<AuditQuery['scope'], 'all' | undefined> {
  if (row.action.startsWith('auth.') || row.action.startsWith('identity.')) return 'security';
  if (row.action.startsWith('exam.')) return 'exam';
  if (row.action === 'student.training_category.confirm') return 'learner';
  if (MANAGEMENT_ACTION_PREFIXES.some((prefix) => row.action.startsWith(prefix))) return 'management';
  if (row.actor_id === null || row.actor_name === 'system') return 'system';
  return 'management';
}

@Injectable()
export class AuditQueryService {
  constructor(private readonly config: AppConfig) {}

  async list(query: AuditQuery) {
    const page = Number(query.page || 1);
    const pageSize = Number(query.page_size || 20);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw Errors.param('分页参数非法');
    }
    const from = query.date_from?.trim();
    const to = query.date_to?.trim();
    if ((from && !DAY.test(from)) || (to && !DAY.test(to)) || (from && to && from > to)) {
      throw Errors.param('审计日期范围非法');
    }
    const scope = query.scope || 'all';
    if (!AUDIT_SCOPES.has(scope)) throw Errors.param('审计记录范围非法');
    if (query.result !== undefined && query.result !== 'success' && query.result !== 'failure') {
      throw Errors.param('审计结果非法');
    }

    const root = resolve(this.config.logDir, 'audit');
    let rootStat;
    try {
      rootStat = await lstat(root);
    } catch (error) {
      // A new installation legitimately has no audit directory until the first
      // write. Every other storage failure must remain observable to callers;
      // returning an empty page would falsely assert that no audit events exist.
      if (isMissing(error)) return { items: [], total: 0, page, page_size: pageSize };
      auditStorageUnavailable();
    }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) auditStorageUnavailable();
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      // Once the root was observed, even ENOENT means storage changed during
      // the read and must not be presented as an authoritative empty result.
      auditStorageUnavailable();
    }

    const rows: AuditEntry[] = [];
    for (const entry of entries) {
      const match = AUDIT_FILE.exec(entry.name);
      if (!entry.isFile() || !match) continue;
      const day = match[1];
      if (from && day < from || to && day > to) continue;
      const path = resolve(root, entry.name);
      const rel = relative(root, path);
      if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`)) continue;
      let handle;
      let content: string;
      try {
        // O_NOFOLLOW keeps a local symlink swap from turning the audit reader
        // into an arbitrary file reader after readdir reported a regular file.
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        if (!(await handle.stat()).isFile()) auditStorageUnavailable();
        content = await handle.readFile('utf8');
        await handle.close();
        handle = undefined;
      } catch {
        // Best-effort close is cleanup only. The externally visible result is a
        // safe 503, never a partial page that conceals an unreadable audit file.
        await handle?.close().catch(() => undefined);
        auditStorageUnavailable();
      }
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const normalized = normalizedAuditEntry(parsed);
          if (normalized) rows.push(normalized);
        } catch {
          // Malformed legacy lines are ignored; returning raw text would leak it.
        }
      }
    }

    const actor = query.actor?.trim().toLowerCase();
    const action = query.action?.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      const actorMatches = !actor
        || String(row.actor_id ?? '').toLowerCase() === actor
        || String(row.actor_name || '').toLowerCase().includes(actor);
      const actionMatches = !action || String(row.action).toLowerCase().includes(action);
      const scopeMatches = scope === 'all' || scopeOf(row) === scope;
      const resultMatches = !query.result || row.result === query.result;
      return actorMatches && actionMatches && scopeMatches && resultMatches;
    }).sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    return {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      page,
      page_size: pageSize,
    };
  }
}
