import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Public } from '../../common/guards/public.decorator';
import { RedisService } from '../../common/redis.service';

/**
 * 健康检查（04 册 §2：容器探活，豁免认证，仅限 Compose 内部网络——nginx 不对外代理该路径）。
 * 探活 MySQL 连接池 + Redis PING + 磁盘余量（07 册 6.1）。
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async check() {
    let mysql = 'down';
    try {
      await this.dataSource.query('SELECT 1');
      mysql = 'up';
    } catch { /* down */ }
    let redis = 'down';
    try {
      redis = this.redis.isAvailable() ? 'up' : 'down';
    } catch { /* down */ }
    let diskFreeMb = -1;
    try {
      const statfs = require('node:fs').statfsSync || require('node:fs').statfs;
      if (statfs) {
        const s = statfsSyncSafe('.');
        if (s) diskFreeMb = Math.floor((s.bavail * s.bsize) / 1024 / 1024);
      }
    } catch { /* ignore */ }
    return { status: mysql === 'up' ? 'ok' : 'degraded', mysql, redis, disk_free_mb: diskFreeMb };
  }
}

function statfsSyncSafe(path: string): { bavail: number; bsize: number } | null {
  try {
    const fs = require('node:fs');
    if (typeof fs.statfsSync === 'function') return fs.statfsSync(path);
    return null;
  } catch {
    return null;
  }
}
