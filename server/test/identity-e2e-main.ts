import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import cookieParser from 'cookie-parser';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { FakeIdentityProvider } from './support/fake-identity-provider';

// Load compiled production modules so Nest's emitted constructor metadata and
// Symbol tokens are identical to the ordinary server process.
const { AppModule } = require('../dist/app.module');
const { loadConfig } = require('../dist/config/configuration');
const { IDENTITY_PROVIDER } = require('../dist/modules/identity/identity-provider');
const { ensureSeedData } = require('../dist/seed');
const { DataSource } = require('typeorm');
async function bootstrap() {
  if (process.env.NODE_ENV !== 'test') throw new Error('Identity test bootstrap requires test environment');
  const config = loadConfig();
  if (!/^ruleexam_test_[A-Za-z0-9_]+$/.test(config.db.database)) throw new Error('Identity test bootstrap requires an isolated test database');
  const server = express(); server.set('trust proxy', 1);
  server.use(express.json({ limit: '2mb' })); server.use(express.urlencoded({ extended: true, limit: '2mb' })); server.use(cookieParser());
  const provider = new FakeIdentityProvider();
  // These observation/control routes exist only in this test source entry,
  // bind only to loopback and require a per-run secret derived from the harness.
  const controlSecret = createHmac('sha256', config.jwt.secret).update('identity-test-control').digest();
  server.use('/__identity-test/provider', (req, res, next) => {
    const remote = req.socket.remoteAddress;
    const value = String(req.headers['x-identity-test-control'] || '');
    const provided = /^[a-f0-9]{64}$/.test(value) ? Buffer.from(value, 'hex') : Buffer.alloc(0);
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote || '') || provided.length !== controlSecret.length || !timingSafeEqual(provided, controlSecret)) { res.status(403).end(); return; }
    next();
  });
  server.get('/__identity-test/provider', (_req, res) => res.json(provider.snapshot()));
  server.post('/__identity-test/provider', (req, res) => {
    if (req.body?.action === 'pause') provider.pause();
    else if (req.body?.action === 'resume') provider.resume();
    else { res.status(400).end(); return; }
    res.json(provider.snapshot());
  });
  const testing = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(IDENTITY_PROVIDER).useValue(provider).compile();
  const app = testing.createNestApplication(new ExpressAdapter(server), { logger: ['warn', 'error'] });
  app.setGlobalPrefix('api/v1'); app.enableShutdownHooks();
  for (const dir of [config.upload.dir, join(config.upload.dir, 'tmp', 'media'), join(config.upload.dir, 'media'), config.dataDir, config.logDir]) mkdirSync(dir, { recursive: true });
  await app.init(); await ensureSeedData(app.get(DataSource));
  await app.listen(config.port, '127.0.0.1');
  console.log(`[identity-test] api listening on :${config.port}`);
}
void bootstrap().catch(() => { console.error('Identity test bootstrap failed'); process.exitCode = 1; });
