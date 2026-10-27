import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { vi } from 'vitest';
import { ExamRecord } from '../../src/entities/exam-record.entity';
import { ExamPaper } from '../../src/entities/exam-paper.entity';
import { SysUser } from '../../src/entities/sys-user.entity';

/** Real MySQL query builders; only the database transport is replaced. */
export async function dashboardQueryFixture(permissions: string[] = []) {
  const source = new DataSource({ type: 'mysql', database: 'dashboard_unit_no_connection', entities: [ExamRecord, ExamPaper, SysUser] });
  await (source as any).buildMetadatas();
  const query = vi.fn(async (_sql: string, _parameters?: unknown[]): Promise<any[]> => []);
  source.manager.query = query as any;
  const transaction = vi.fn(async (_isolation: string, work: any) => work(source.manager));
  source.transaction = transaction as any;
  const access = { permissions: vi.fn(async () => permissions) };
  return { source, query, access, transaction };
}
