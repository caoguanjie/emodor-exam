import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppConfig } from '../../config/configuration';
import { Errors } from '../../common/errors';
import { RedisService } from '../../common/redis.service';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { assertPublicHttpUrl } from './url-guard';

export interface AiConfigValue {
  base_url: string;
  api_key: string;
  model: string;
}

/**
 * AI 配置服务（05 册 4.4.1 / 07 册 4.2.2）：
 * 环境变量为初始兜底；super_admin 界面配置为权威副本 —— AES-256-GCM 加密后
 * 存应用数据目录配置文件（不落 MySQL 业务表，A-05 不引入第 13 张表）；
 * Redis 仅作读缓存 ai:config:cache（TTL 10 分钟，可再生）；
 * api_key 界面仅掩码回显（sk-****xxxx），明文不进日志。
 */
@Injectable()
export class AiConfigService {
  private static readonly CACHE_KEY = 'ai:config:cache';
  private static readonly CACHE_TTL = 600;

  constructor(private readonly config: AppConfig, private readonly redis: RedisService) {}

  private configFile(): string {
    const dir = this.config.dataDir;
    mkdirSync(dir, { recursive: true });
    return join(dir, 'ai-config.json.enc');
  }

  private encrypt(plain: string): string {
    const key = this.requireEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
  }

  private decrypt(payload: string): string {
    const key = this.requireEncryptionKey();
    const [ivB64, tagB64, dataB64] = payload.split(':');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  }

  private requireEncryptionKey(): Buffer {
    const raw = this.config.appEncryptionKey;
    if (!raw) throw Errors.internal('AI 配置加密密钥未配置（APP_ENCRYPTION_KEY）');
    // 32 字节密钥：环境变量可为 base64 或任意 ≥32 字符口令派生
    try {
      const decoded = Buffer.from(raw, 'base64');
      if (decoded.length === 32) return decoded;
    } catch { /* 非 base64，按口令处理 */ }
    return require('crypto').createHash('sha256').update(raw).digest();
  }

  async save(cfg: { base_url: string; api_key?: string; model: string }) {
    if (!cfg.base_url?.trim() || !cfg.model?.trim()) throw Errors.param('base_url / model 均必填');
    assertPublicHttpUrl(cfg.base_url.trim(), this.config.ai.egressAllowHosts);
    let apiKey = (cfg.api_key || '').trim();
    if (!apiKey) {
      // 界面「留空保持不变」：复用已保存（或环境变量兜底）的 api_key
      const existing = await this.load();
      if (!existing?.api_key) throw Errors.param('api_key 必填（首次配置不能留空）');
      apiKey = existing.api_key;
    }
    const value: AiConfigValue = { base_url: cfg.base_url.trim(), api_key: apiKey, model: cfg.model.trim() };
    const encrypted = this.encrypt(JSON.stringify(value));
    writeFileSync(this.configFile(), encrypted, { encoding: 'utf8', mode: 0o600 });
    await this.redis.del(AiConfigService.CACHE_KEY);
  }

  /** 权威读取：加密文件 → 解密；未做界面配置时回退环境变量兜底（07 册 4.2.2 优先级） */
  async load(): Promise<AiConfigValue | null> {
    // 读缓存（可再生，丢失由权威文件重建）
    const cached = await this.redis.get(AiConfigService.CACHE_KEY);
    if (cached) {
      try {
        const v = JSON.parse(cached) as AiConfigValue;
        if (v.base_url && v.api_key && v.model) return v;
      } catch { /* 缓存损坏则走权威路径 */ }
    }
    let value: AiConfigValue | null = null;
    const file = this.configFile();
    if (existsSync(file) && this.config.appEncryptionKey) {
      try {
        value = JSON.parse(this.decrypt(readFileSync(file, 'utf8')));
      } catch {
        value = null;
      }
    }
    if (!value) {
      const { baseUrl, apiKey, model } = this.config.ai;
      if (baseUrl && apiKey && model) value = { base_url: baseUrl, api_key: apiKey, model };
    }
    if (value) {
      await this.redis.set(AiConfigService.CACHE_KEY, JSON.stringify(value), AiConfigService.CACHE_TTL);
    }
    return value;
  }

  /** 掩码回显（FR-AIQ-01 验收②）：形如 sk-****xxxx，完整键值永不返回；短键头尾重叠会泄漏全键，一律纯掩码 */
  mask(cfg: AiConfigValue | null) {
    if (!cfg) return { base_url: '', model: '', api_key_masked: '', configured: false };
    const key = cfg.api_key;
    const masked = key.length >= 12 ? `${key.slice(0, 3)}****${key.slice(-4)}` : '****';
    return {
      base_url: cfg.base_url,
      model: cfg.model,
      api_key_masked: masked,
      configured: true,
    };
  }

  async isConfigured(): Promise<boolean> {
    const cfg = await this.load();
    return !!(cfg && cfg.base_url && cfg.api_key && cfg.model);
  }
}
