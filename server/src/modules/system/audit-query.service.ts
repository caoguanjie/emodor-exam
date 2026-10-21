import { Injectable } from '@nestjs/common';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { redactAuditValue, type AuditEntry } from '../../common/audit.service';
import { Errors } from '../../common/errors';
import { AppConfig } from '../../config/configuration';

const AUDIT_FILE = /^audit-(\d{4}-\d{2}-\d{2})\.log$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

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
  page?: number;
  page_size?: number;
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

    const root = resolve(this.config.logDir, 'audit');
    let entries;
    try {
      const rootStat = await lstat(root);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        return { items: [], total: 0, page, page_size: pageSize };
      }
      entries = await readdir(root, { withFileTypes: true });
    }
    catch { return { items: [], total: 0, page, page_size: pageSize }; }

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
        if (!(await handle.stat()).isFile()) continue;
        content = await handle.readFile('utf8');
      } catch {
        continue;
      } finally {
        await handle?.close().catch(() => undefined);
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
      return actorMatches && actionMatches;
    }).sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    return {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      page,
      page_size: pageSize,
    };
  }
}
