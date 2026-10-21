import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

function runtimeSecret(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Creates run-owned data paths and environment values. The returned env can be
 * reused when an API process is restarted; no state is written into the
 * checkout and no secret is logged.
 */
export async function createTrainingHarness({ root = undefined, redisPrefix = undefined, port = undefined } = {}) {
  const ownedRoot = root || await mkdtemp(join(tmpdir(), 'ruleexam-training-'));
  const dataDir = join(ownedRoot, 'data');
  const uploadDir = join(dataDir, 'uploads');
  const logDir = join(dataDir, 'logs');
  await mkdir(uploadDir, { recursive: true });
  await mkdir(logDir, { recursive: true });
  const prefix = redisPrefix || `training:${randomBytes(10).toString('hex')}:`;
  const adminPassword = `A9${runtimeSecret(18)}`;
  const env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: port ? String(port) : process.env.PORT || '3000',
    JWT_SECRET: runtimeSecret(48),
    JWT_SECRET_PRIOR: runtimeSecret(48),
    EXAM_SHUFFLE_SECRET: runtimeSecret(32),
    APP_ENCRYPTION_KEY: runtimeSecret(32),
    ADMIN_INITIAL_PASSWORD: adminPassword,
    REDIS_KEY_PREFIX: prefix,
    UPLOAD_DIR: uploadDir,
    DATA_DIR: dataDir,
    LOG_DIR: logDir,
    AI_EGRESS_ALLOW_HOSTS: process.env.AI_EGRESS_ALLOW_HOSTS || '127.0.0.1',
  };
  let cleaned = false;
  return {
    root: ownedRoot,
    dataDir,
    uploadDir,
    logDir,
    redisPrefix: prefix,
    adminPassword,
    env,
    async cleanup() {
      if (cleaned || root) return;
      cleaned = true;
      await rm(ownedRoot, { recursive: true, force: true });
    },
  };
}
