import { TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * 全局配置读取。全部连接类与密钥类配置经环境变量注入（02 册 5.3 配置管理），
 * 敏感值（DB_PASSWORD / REDIS_PASSWORD / JWT_SECRET / APP_ENCRYPTION_KEY）不落业务库、不回显前端。
 * 开发环境（NODE_ENV=development）下密钥缺省时以进程内随机值兜底，生产环境强制要求显式配置。
 */
export class AppConfig {
  env: string;
  port: number;
  db: TypeOrmModuleOptions;
  redis: { host: string; port: number; password?: string; enabled: boolean; keyPrefix: string };
  jwt: { secret: string; expiresIn: string; refreshExpiresDays: number; priorSecret?: string };
  examShuffleSecret: string;
  appEncryptionKey?: string;
  upload: { dir: string; maxUploadSizeMb: number; maxImportSizeMb: number; maxImportRows: number };
  corsOrigins: string[];
  dataDir: string;
  logDir: string;
  ai: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    egressAllowHosts: string[];
    timeoutMs: number;
    chunkSize: number;
    chunkOverlap: number;
    blockConcurrency: number;
    multimodalEnabled: boolean;
    multimodalTriggerChars: number;
    multimodalPagesPerRequest: number;
    multimodalDpi: number;
    multimodalMaxImageBytes: number;
    multimodalMaxPages: number;
  };
  tz: string;
}

function req(name: string, isProd: boolean): string | undefined {
  const v = process.env[name];
  if (!v && isProd) {
    throw new Error(`生产环境必须显式配置环境变量 ${name}`);
  }
  return v;
}

function randKey(): string {
  // 开发兜底：进程内随机密钥（重启失效，仅用于 NODE_ENV=development）
  return require('crypto').randomBytes(48).toString('base64');
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function loadConfig(): AppConfig {
  const env = process.env.NODE_ENV || 'development';
  const isProd = env === 'production';
  const tz = process.env.TZ || 'Asia/Shanghai';
  if (!process.env.TZ) process.env.TZ = tz;

  const dbPassword = process.env.DB_PASSWORD ?? '';
  return {
    env,
    port: Number(process.env.PORT || 3000),
    db: {
      type: 'mysql',
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      username: process.env.DB_USERNAME || 'root',
      password: dbPassword,
      database: process.env.DB_DATABASE || 'ruleexam',
      charset: 'utf8mb4_0900_ai_ci',
      timezone: 'Z', // 存取统一以 UTC 序列化、业务层统一本地(Asia/Shanghai)语义——DATETIME 无时区，避免驱动隐式换算
      entities: [__dirname + '/../entities/*.entity.js'],
      synchronize: false, // 表结构以 database/init.sql 为唯一权威（03 册）
      logging: false,
      poolSize: 20,
      extra: { connectionLimit: 20 },
    } as TypeOrmModuleOptions,
    redis: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT || 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      enabled: process.env.REDIS_ENABLED !== 'false',
      // 默认空字符串保持历史键名；测试运行由 harness 注入一次性前缀隔离。
      keyPrefix: (process.env.REDIS_KEY_PREFIX || '').trim(),
    },
    jwt: {
      secret: req('JWT_SECRET', isProd) || randKey(),
      expiresIn: process.env.JWT_EXPIRES_IN || '2h',
      refreshExpiresDays: Number(process.env.JWT_REFRESH_EXPIRES_DAYS || 7),
      priorSecret: process.env.JWT_SECRET_PRIOR,
    },
    examShuffleSecret: req('EXAM_SHUFFLE_SECRET', isProd) || randKey(),
    appEncryptionKey: req('APP_ENCRYPTION_KEY', isProd),
    upload: {
      dir: process.env.UPLOAD_DIR || './data/uploads',
      maxUploadSizeMb: Number(process.env.MAX_UPLOAD_SIZE || 50),
      maxImportSizeMb: 5,
      maxImportRows: 1000,
    },
    dataDir: process.env.DATA_DIR || './data',
    logDir: process.env.LOG_DIR || './data/logs',
    // CORS 显式白名单（逗号分隔）。缺省禁用跨域：生产为 nginx 同源（web 静态与 /api 反代同域），
    // 开发走 Vite 代理亦同源；仅前端独立域名部署时需要配置
    corsOrigins: (process.env.CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    ai: {
      baseUrl: process.env.AI_BASE_URL,
      apiKey: process.env.AI_API_KEY,
      model: process.env.AI_MODEL,
      // SSRF 纵深防御的显式例外清单（host 或 host:port，逗号分隔）：
      // 仅供本地开发/测试放行环回地址上的 Mock AI（如 127.0.0.1）；生产环境保持为空。
      egressAllowHosts: (process.env.AI_EGRESS_ALLOW_HOSTS || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
      timeoutMs: 120_000, // NFR-05：单次调用 120 秒硬超时
      chunkSize: 4000, // 05 册 4.4.2 长文本分块
      chunkOverlap: 200,
      blockConcurrency: 3,
      // 文本层过短的 PDF 自动走视觉输入；默认开启，用户只需配置支持视觉的模型即可。
      multimodalEnabled: process.env.AI_MULTIMODAL_ENABLED !== 'false',
      multimodalTriggerChars: envInt('AI_MULTIMODAL_TRIGGER_CHARS', 1000, 0, 1_000_000),
      multimodalPagesPerRequest: envInt('AI_MULTIMODAL_PAGES_PER_REQUEST', 4, 1, 8),
      multimodalDpi: envInt('AI_MULTIMODAL_DPI', 144, 72, 200),
      multimodalMaxImageBytes: envInt('AI_MULTIMODAL_MAX_IMAGE_BYTES', 6 * 1024 * 1024, 256 * 1024, 20 * 1024 * 1024),
      multimodalMaxPages: envInt('AI_MULTIMODAL_MAX_PAGES', 200, 1, 1000),
    },
    tz,
  };
}
