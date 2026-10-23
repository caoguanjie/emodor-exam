import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { isSafeTestDatabase } from './test-target.mjs';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { JwtService } = require('@nestjs/jwt');
const jwt = new JwtService({});

export function randomLearnerPhone() {
  return `138${String(randomBytes(4).readUInt32BE() % 100_000_000).padStart(8, '0')}`;
}

// Business-flow fixture only: SMS issuance is covered by mobile-auth. Restrict
// direct durable-session insertion and signing to the harness-owned test DB.
async function fixtureSession(ctx, userId, client, authMethod) {
  assert.ok(isSafeTestDatabase(ctx.env.DB_DATABASE), 'learner session requires an isolated test database');
  assert.ok(ctx.env.JWT_SECRET, 'learner session requires the run-owned JWT secret');
  const rows = await ctx.queryTestDb('SELECT id, username, role, auth_version FROM sys_user WHERE id = ?', [String(userId)]);
  assert.equal(rows.length, 1, 'learner fixture user missing');
  const user = rows[0];
  assert.equal(user.role, 'employee', 'mobile session fixture requires an employee');
  const sid = randomBytes(24).toString('hex');
  const now = new Date();
  await ctx.queryTestDb(
    'INSERT INTO auth_session (sid,user_id,client,auth_method,last_seen_at,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
    [sid, String(userId), client, authMethod, now, new Date(now.getTime() + 3_600_000), now, now],
  );
  return {
    userId: String(userId),
    accessToken: jwt.sign({
      sub: String(userId), username: user.username, role: user.role,
      auth_version: Number(user.auth_version || 0), client, auth_method: authMethod,
      sid, type: 'access', jti: randomBytes(16).toString('hex'),
    }, { secret: ctx.env.JWT_SECRET, expiresIn: '1h' }),
  };
}

export function learnerSession(ctx, userId) {
  return fixtureSession(ctx, userId, 'mobile', 'sms');
}

// Negative compatibility fixture: old PC sessions for permission-free employees
// must be rejected by the guard even when their durable sid and JWT are valid.
export function legacyLearnerPcSession(ctx, userId) {
  return fixtureSession(ctx, userId, 'pc', 'password');
}
