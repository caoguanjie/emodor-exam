import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/configuration';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AuditEntry {
  ts: string;
  actor_id: number | null;
  actor_name: string;
  action: string;
  object_type: string;
  object_id: string | number | null;
  detail: Record<string, unknown>;
  result: 'success' | 'failure';
  source_ip: string | null;
}

/**
 * 审计日志（07 册 4.5，NFR-10）：管理端敏感操作与考试关键事件留痕。
 * 载体：结构化 JSON 文件（audit 通道，按天切割），不落 MySQL（A-05：不引入第 13 张表），
 * 保留 ≥ 180 天由外部 logrotate 承担。日志不含任何明文口令 / api_key（仅掩码）。
 */
@Injectable()
export class AuditService {
  constructor(private readonly config: AppConfig) {}

  private file(): string {
    const dir = join(this.config.logDir, 'audit');
    mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    return join(dir, `audit-${day}.log`);
  }

  log(entry: Omit<AuditEntry, 'ts'>) {
    try {
      const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
      appendFileSync(this.file(), line + '\n', { encoding: 'utf8' });
    } catch {
      // 审计失败不阻断业务（文件系统异常时降级为标准错误输出）
      console.error('[audit-fallback]', JSON.stringify(entry));
    }
  }
}
