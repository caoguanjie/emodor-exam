import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import cookieParser from 'cookie-parser';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { AppModule } from './app.module';
import { loadConfig } from './config/configuration';
import { ensureSeedData } from './seed';

const config = loadConfig();

async function bootstrap() {
  const server = express();
  // 恰一跳可信反代：nginx 覆盖式重写 X-Forwarded-For（$remote_addr）后转发，Express 取最右侧可信 hop 还原真实来源 IP（审计 source_ip / 登录限流）；
  // 直连 API 的开发场景请求不带 XFF 头，不受影响
  server.set('trust proxy', 1);
  // 请求体上限与上传上限一致（≤ 50MB，07 册 4.3.1；nginx client_max_body_size 同步配置）
  server.use(express.json({ limit: '2mb' }));
  server.use(express.urlencoded({ extended: true, limit: '2mb' }));
  server.use(cookieParser());

  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    logger: ['log', 'warn', 'error'],
  });
  app.setGlobalPrefix('api/v1');
  // CORS 显式白名单（CORS_ORIGINS）：origin:true 会反射任意来源并附带凭据许可，等于全站放行；
  // 同源部署（nginx 同域反代）与 Vite 代理开发均不触发跨域，缺省禁用不影响现有链路
  app.enableCors({ origin: config.corsOrigins.length ? config.corsOrigins : false, credentials: true });
  app.enableShutdownHooks();

  // 数据 / 日志 / 上传目录就绪
  mkdirSync(config.upload.dir, { recursive: true });
  mkdirSync(join(config.upload.dir, 'tmp'), { recursive: true });
  mkdirSync(join(config.upload.dir, 'tmp', 'media'), { recursive: true });
  mkdirSync(join(config.upload.dir, 'regulations'), { recursive: true });
  mkdirSync(join(config.upload.dir, 'media'), { recursive: true });
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.logDir, { recursive: true });

  await app.listen(config.port, '0.0.0.0');
  console.log(`[EmodorRuleExam] api listening on :${config.port} (env=${config.env}, TZ=${config.tz})`);

  // 首次部署种子（幂等）：根部门 + 超级管理员（口令经 ADMIN_INITIAL_PASSWORD 注入）
  const { DataSource } = await import('typeorm');
  const dataSource = app.get(DataSource);
  await ensureSeedData(dataSource);
}

void bootstrap();
