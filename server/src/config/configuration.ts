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
  sms: {
    provider: 'disabled' | 'yunxin';
    appKey?: string;
    appSecret?: string;
    templateId?: string;
    baseUrl: string;
    timeoutSeconds: number;
    resendSeconds: number;
    verifyTtlSeconds: number;
    maxVerifyAttempts: number;
    phoneDailyLimit: number;
    ipDailyLimit: number;
    redisKeyPrefix: string;
  };
  debugLoginEnabled: boolean;
  examShuffleSecret: string;
  appEncryptionKey?: string;
  upload: { dir: string; maxUploadSizeMb: number; maxImportSizeMb: number; maxImportRows: number };
  media: {
    videoMaxBytes: number;
    imageMaxBytes: number;
    imageMaxPixels: number;
    probeTimeoutMs: number;
    ffprobePath: string;
    ffmpegPath: string;
    allowedImageTypes: string[];
    allowedVideoTypes: string[];
  };
  identity: {
    provider: 'disabled' | 'tencent';
    dataEncryptionKey: string;
    fingerprintSecret: string;
    sessionTtlSeconds: number;
    idCardOcr: TencentIdentityEndpointConfig;
    faceId: TencentIdentityEndpointConfig;
  };
  mediaTicket: { secret: string; ttlSeconds: number };
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

export interface TencentIdentityEndpointConfig {
  enabled: boolean;
  secretId: string;
  secretKey: string;
  token?: string;
  endpoint: string;
  timeoutSeconds: number;
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

function secret32(name: string, required: boolean): string {
  const value = process.env[name];
  if (!value && required) throw new Error(`必须显式配置环境变量 ${name}`);
  if (!value) return require('crypto').randomBytes(32).toString('base64');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
    || Buffer.from(value, 'base64').length !== 32) {
    throw new Error(`环境变量 ${name} 必须是 32 字节 Base64 密钥`);
  }
  return value;
}

function strictEnvBool(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw !== 'true' && raw !== 'false') throw new Error(`环境变量 ${name} 只支持 true 或 false`);
  return raw === 'true';
}

function tencentEndpoint(name: string, fallback: string, expectedHost: string): string {
  const value = process.env[name]?.trim() || fallback;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`环境变量 ${name} 必须是有效 HTTPS URL`); }
  if (url.protocol !== 'https:' || url.hostname !== expectedHost || url.port || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`环境变量 ${name} 必须使用腾讯官方 HTTPS 端点`);
  }
  return url.href;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function mediaEnvInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^(0|[1-9]\d*)$/.test(raw)) {
    throw new Error(`环境变量 ${name} 必须是整数`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`环境变量 ${name} 超出支持范围`);
  }
  return value;
}

function positiveEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`环境变量 ${name} 必须是正整数`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`环境变量 ${name} 超出支持范围`);
  return value;
}

export function loadConfig(): AppConfig {
  const env = process.env.NODE_ENV || 'development';
  const isProd = env === 'production';
  const tz = process.env.TZ || 'Asia/Shanghai';
  if (!process.env.TZ) process.env.TZ = tz;

  const dbPassword = process.env.DB_PASSWORD ?? '';
  const dbPoolSize = positiveEnvInt('DB_POOL_SIZE', 20);
  const smsProvider = (process.env.SMS_PROVIDER || 'disabled').trim().toLowerCase();
  if (smsProvider !== 'disabled' && smsProvider !== 'yunxin') {
    throw new Error('环境变量 SMS_PROVIDER 只支持 disabled 或 yunxin');
  }
  const debugLoginEnabled = process.env.SERVER_DEBUG_LOGIN_ENABLED === 'true';
  if (isProd && debugLoginEnabled) {
    throw new Error('生产环境禁止启用 SERVER_DEBUG_LOGIN_ENABLED');
  }
  const smsAppKey = process.env.YUNXIN_SMS_APP_KEY?.trim() || undefined;
  const smsAppSecret = process.env.YUNXIN_SMS_APP_SECRET?.trim() || undefined;
  const smsTemplateId = process.env.YUNXIN_SMS_LOGIN_CODE_TEMPLATE_ID?.trim() || undefined;
  if (smsProvider === 'yunxin' && (!smsAppKey || !smsAppSecret || !smsTemplateId)) {
    throw new Error('SMS_PROVIDER=yunxin 时必须配置网易云信 AppKey、AppSecret 和登录模板 ID');
  }
  const identityProvider = (process.env.IDENTITY_PROVIDER || 'disabled').trim().toLowerCase();
  if (identityProvider !== 'disabled' && identityProvider !== 'tencent') {
    throw new Error('环境变量 IDENTITY_PROVIDER 只支持 disabled 或 tencent');
  }
  const idCardOcrEnabled = strictEnvBool('TENCENT_ID_CARD_OCR_ENABLED');
  const faceIdEnabled = strictEnvBool('TENCENT_FACEID_ENABLED');
  const idCardOcrSecretId = process.env.TENCENT_ID_CARD_OCR_SECRET_ID?.trim() || '';
  const idCardOcrSecretKey = process.env.TENCENT_ID_CARD_OCR_SECRET_KEY?.trim() || '';
  const faceIdSecretId = process.env.TENCENT_FACEID_SECRET_ID?.trim() || '';
  const faceIdSecretKey = process.env.TENCENT_FACEID_SECRET_KEY?.trim() || '';
  if (idCardOcrEnabled && (!idCardOcrSecretId || !idCardOcrSecretKey)) {
    throw new Error('启用腾讯身份证 OCR 时必须配置 SECRET_ID 和 SECRET_KEY');
  }
  if (faceIdEnabled && (!faceIdSecretId || !faceIdSecretKey)) {
    throw new Error('启用腾讯 FaceID 时必须配置 SECRET_ID 和 SECRET_KEY');
  }
  if (identityProvider === 'tencent' && (!idCardOcrEnabled || !faceIdEnabled)) {
    throw new Error('IDENTITY_PROVIDER=tencent 时必须同时启用身份证 OCR 和 FaceID');
  }
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
      poolSize: dbPoolSize,
      extra: { connectionLimit: dbPoolSize },
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
    sms: {
      provider: smsProvider,
      appKey: smsAppKey,
      appSecret: smsAppSecret,
      templateId: smsTemplateId,
      baseUrl: process.env.YUNXIN_SMS_BASE_URL || 'https://sms.yunxinapi.com',
      timeoutSeconds: positiveEnvInt('YUNXIN_SMS_TIMEOUT_SECONDS', 5),
      resendSeconds: positiveEnvInt('YUNXIN_SMS_LOGIN_RESEND_SECONDS', 60),
      verifyTtlSeconds: positiveEnvInt('YUNXIN_SMS_LOGIN_VERIFY_TTL_SECONDS', 300),
      maxVerifyAttempts: positiveEnvInt('YUNXIN_SMS_LOGIN_MAX_VERIFY_ATTEMPTS', 5),
      phoneDailyLimit: positiveEnvInt('YUNXIN_SMS_LOGIN_PHONE_DAILY_LIMIT', 10),
      ipDailyLimit: positiveEnvInt('YUNXIN_SMS_LOGIN_IP_DAILY_LIMIT', 100),
      redisKeyPrefix: process.env.YUNXIN_SMS_REDIS_KEY_PREFIX || 'ruleexam:sms_auth',
    },
    debugLoginEnabled,
    examShuffleSecret: req('EXAM_SHUFFLE_SECRET', isProd) || randKey(),
    appEncryptionKey: req('APP_ENCRYPTION_KEY', isProd),
    upload: {
      dir: process.env.UPLOAD_DIR || './data/uploads',
      maxUploadSizeMb: Number(process.env.MAX_UPLOAD_SIZE || 50),
      maxImportSizeMb: 5,
      maxImportRows: 1000,
    },
    media: {
      // Media overrides reject malformed/unsupported values. The upload transport
      // uses max(image, video); deploy/check-media-limits.mjs enforces the nginx +1 MiB margin.
      videoMaxBytes: mediaEnvInt('MEDIA_VIDEO_MAX_BYTES', 512 * 1024 * 1024, 1, 512 * 1024 * 1024),
      imageMaxBytes: mediaEnvInt('MEDIA_IMAGE_MAX_BYTES', 10 * 1024 * 1024, 1, 100 * 1024 * 1024),
      imageMaxPixels: mediaEnvInt('MEDIA_IMAGE_MAX_PIXELS', 25_000_000, 1, 100_000_000),
      probeTimeoutMs: mediaEnvInt('MEDIA_PROBE_TIMEOUT_MS', 30_000, 1_000, 120_000),
      ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
      ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
      allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
      allowedVideoTypes: ['video/mp4'],
    },
    identity: {
      provider: identityProvider,
      dataEncryptionKey: secret32('IDENTITY_DATA_ENCRYPTION_KEY', isProd || identityProvider === 'tencent'),
      fingerprintSecret: secret32('IDENTITY_FINGERPRINT_SECRET', isProd || identityProvider === 'tencent'),
      sessionTtlSeconds: positiveEnvInt('IDENTITY_SESSION_TTL_SECONDS', 600),
      idCardOcr: {
        enabled: idCardOcrEnabled,
        secretId: idCardOcrSecretId,
        secretKey: idCardOcrSecretKey,
        token: process.env.TENCENT_ID_CARD_OCR_TOKEN?.trim() || undefined,
        endpoint: tencentEndpoint('TENCENT_ID_CARD_OCR_ENDPOINT', 'https://ocr.tencentcloudapi.com', 'ocr.tencentcloudapi.com'),
        timeoutSeconds: positiveEnvInt('TENCENT_ID_CARD_OCR_HTTP_TIMEOUT_SECONDS', 10),
      },
      faceId: {
        enabled: faceIdEnabled,
        secretId: faceIdSecretId,
        secretKey: faceIdSecretKey,
        token: process.env.TENCENT_FACEID_TOKEN?.trim() || undefined,
        endpoint: tencentEndpoint('TENCENT_FACEID_ENDPOINT', 'https://faceid.tencentcloudapi.com', 'faceid.tencentcloudapi.com'),
        timeoutSeconds: positiveEnvInt('TENCENT_FACEID_HTTP_TIMEOUT_SECONDS', 10),
      },
    },
    mediaTicket: {
      secret: secret32('MEDIA_TICKET_SECRET', isProd),
      ttlSeconds: positiveEnvInt('MEDIA_TICKET_TTL_SECONDS', 300),
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
