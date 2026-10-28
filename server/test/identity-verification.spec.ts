import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { IdentityCrypto } from '../src/modules/identity/identity-crypto';
import { IdentityService } from '../src/modules/identity/identity.service';
import { LearnerIdentity } from '../src/entities/learner-identity.entity';
import { IdentityVerificationSession } from '../src/entities/identity-verification-session.entity';
import { SysUser } from '../src/entities/sys-user.entity';
import { DisabledIdentityProvider, TencentIdentityProvider, TencentIdCardOcrAdapter, TencentFaceIdAdapter } from '../src/modules/identity/identity-provider';

// The repository double models durable rows; a second service reuses the same DB.
function fixture() {
  const tables = new Map<any, any[]>([[SysUser, [{ id: '7', role: 'employee', status: 1, realName: '待核验姓名', source: 'external', categoryId: '9' }, { id: '8', role: 'employee', status: 1, realName: '另一待核验姓名', categoryId: '9' }]], [LearnerIdentity, []], [IdentityVerificationSession, []]]);
  let failBind = false;
  const repos = new Map<any, any>();
  for (const [type, rows] of tables) {
    const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
    const repo = {
      create: (row) => ({ ...row }),
      findOne: async ({ where }) => rows.find((row) => matches(row, where)) || null,
      find: async ({ where = {}, order = {} } = {}) => rows.filter((row) => matches(row, where)).sort((a, b) => b.createdAt?.getTime() - a.createdAt?.getTime()),
      save: async (row) => {
        if (type === LearnerIdentity && failBind) throw new Error('bind failed');
        if (type === LearnerIdentity && rows.some((r) => r.userId !== row.userId && r.idFingerprint === row.idFingerprint)) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
        const index = rows.findIndex((r) => r.id === row.id && row.id !== undefined);
        if (index >= 0) rows[index] = { ...row }; else { row.id ||= String(rows.length + 1); rows.push({ ...row }); }
        return { ...row };
      },
    };
    repos.set(type, repo);
  }
  const manager = { getRepository: (type) => repos.get(type) };
  let queue: Promise<any> = Promise.resolve();
  const dataSource = { transaction: (work) => { const result = queue.then(() => work(manager)); queue = result.catch(() => {}); return result; } };
  const provider = { enabled: true, verifyCalls: 0, verify: async () => { provider.verifyCalls++; return { status: 'verified', realName: '合成测试主体', idNumber: 'SYNTHETIC-DOCUMENT-ONLY', providerRequestId: 'synthetic-request' }; } };
  const media = { assertUsable: async (user, asset, purpose) => { const suffix = { identity_face: '1', identity_id_portrait: '2', identity_id_emblem: '3' }[purpose]; if (!suffix || !(user === '7' ? ['1' + suffix, '2' + suffix] : ['3' + suffix]).includes(asset)) throw new Error('asset denied'); }, readPrivateBytes: async () => Buffer.from('synthetic'), bind: async () => {}, registerOwnerPolicy: () => {} };
  const config = { identity: { provider: 'disabled', sessionTtlSeconds: 600, dataEncryptionKey: randomBytes(32).toString('base64'), fingerprintSecret: randomBytes(32).toString('base64') } };
  const crypto = new IdentityCrypto(config as any);
  const audit = { log: (_entry: any): any => undefined };
  const make = () => new IdentityService(repos.get(LearnerIdentity), repos.get(IdentityVerificationSession), dataSource as any, media as any, provider as any, crypto, config as any, audit as any);
  return { service: make(), make, provider, tables, crypto, audit, setBindFailure: (value) => { failBind = value; } };
}
const images = { face_asset_id: '11', id_card_portrait_asset_id: '12', id_card_emblem_asset_id: '13' };
describe('durable learner identity', () => {
  afterEach(() => vi.useRealTimers());
  it('allows a learner without a category to complete real identity processing', async () => {
    const f = fixture(); f.tables.get(SysUser)![0].categoryId = null;
    await expect(f.service.create('7', images)).resolves.toMatchObject({ status: 'verified' });
    expect(f.provider.verifyCalls).toBe(1);
    expect(f.tables.get(SysUser)![0]).toMatchObject({ categoryId: null, source: 'external', role: 'employee' });
  });
  it.each([{ realName: '', categoryId: '9' }, { realName: '   ', categoryId: null }])('rejects a new verification with incomplete profile %j before provider or session writes', async (patch) => {
    const f = fixture(); Object.assign(f.tables.get(SysUser)![0], patch);
    await expect(f.service.create('7', images)).rejects.toMatchObject({ code: 40001, message: '请先填写真实姓名' });
    expect(f.provider.verifyCalls).toBe(0); expect(f.tables.get(IdentityVerificationSession)).toHaveLength(0);
  });
  it('allows a pending session to be replayed after legacy profile fields become incomplete', async () => {
    const f = fixture(); let finish!: (value: any) => void;
    f.provider.verify = async () => { f.provider.verifyCalls++; return new Promise((resolve) => { finish = resolve; }); };
    const first = f.service.create('7', images);
    while (!finish) await new Promise((resolve) => setTimeout(resolve, 0));
    Object.assign(f.tables.get(SysUser)![0], { realName: '', categoryId: null });
    expect(await f.make().create('7', images)).toMatchObject({ status: 'pending' });
    expect(f.provider.verifyCalls).toBe(1);
    finish({ status: 'verified', realName: '合成测试主体', idNumber: 'SYNTHETIC-DOCUMENT-ONLY', providerRequestId: 'synthetic-request' });
    expect(await first).toMatchObject({ status: 'verified' });
  });
  it('starts unverified and rejects foreign or mismatched material before provider calls', async () => {
    const f = fixture();
    expect(await f.service.view('7')).toMatchObject({ status: 'unverified', real_name: null });
    await expect(f.service.create('8', images)).rejects.toThrow('asset denied');
    await expect(f.service.create('7', { ...images, face_asset_id: '12' })).rejects.toMatchObject({ code: 40001 });
    expect(f.provider.verifyCalls).toBe(0);
  });
  it('binds one encrypted fact and replays the same three images without a second provider call', async () => {
    const f = fixture();
    const result = await f.service.create('7', images);
    expect(result.status).toBe('verified');
    await expect(f.make().create('7', images)).rejects.toMatchObject({ code: 40960, data: { status: 'verified' } });
    expect(f.provider.verifyCalls).toBe(1);
    const rows = f.tables.get(LearnerIdentity)!;
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/SYNTHETIC-DOCUMENT-ONLY|合成测试主体/);
    expect(await f.service.view('7')).toMatchObject({ status: 'verified', real_name: '合成测试主体' });
    expect(f.tables.get(SysUser)![0]).toMatchObject({ source: 'external', categoryId: '9', realName: '合成测试主体' });
    await expect(f.service.get('8', result.session_id)).rejects.toMatchObject({ code: 40302 });
  });
  it('persists provider success before binding failure and recovers after a service restart', async () => {
    vi.useFakeTimers();
    const f = fixture(); f.setBindFailure(true);
    await expect(f.service.create('7', images)).rejects.toThrow('bind failed');
    const session = f.tables.get(IdentityVerificationSession)![0];
    expect(session.status).toBe('provider_verified');
    expect(session.providerResultEncrypted).toBeTruthy();
    await vi.advanceTimersByTimeAsync(600_001);
    f.setBindFailure(false);
    expect(await f.make().get('7', session.id)).toMatchObject({ status: 'verified' });
    expect(f.provider.verifyCalls).toBe(1);
    expect(f.tables.get(LearnerIdentity)).toHaveLength(1);
  });
  it('does not retry a timeout of unknown provider outcome and maps expiry to a rejected session', async () => {
    vi.useFakeTimers();
    const f = fixture(); f.provider.verify = async () => { f.provider.verifyCalls++; throw new Error('timeout'); };
    await expect(f.service.create('7', images)).rejects.toThrow();
    const session = f.tables.get(IdentityVerificationSession)![0];
    expect(await f.make().get('7', session.id)).toMatchObject({ status: 'pending' });
    expect(f.provider.verifyCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(120_001);
    expect(await f.make().get('7', session.id)).toMatchObject({ status: 'pending' });
    expect(f.tables.get(IdentityVerificationSession)![0].status).toBe('provider_unknown');
    await vi.advanceTimersByTimeAsync(600_001);
    expect(await f.service.get('7', session.id)).toMatchObject({ status: 'rejected', reason_code: 'SESSION_EXPIRED' });
  });
  it('allows only one cross-instance provider call and refuses different materials while it is pending', async () => {
    const f = fixture(); let finish!: (value: any) => void;
    f.provider.verify = async () => { f.provider.verifyCalls++; return new Promise((resolve) => { finish = resolve; }); };
    const first = f.service.create('7', images);
    while (!finish) await new Promise((resolve) => setTimeout(resolve, 0));
    const same = await f.make().create('7', images);
    expect(same.status).toBe('pending');
    await expect(f.make().create('7', { face_asset_id: '21', id_card_portrait_asset_id: '22', id_card_emblem_asset_id: '23' })).rejects.toMatchObject({ code: 40906 });
    finish({ status: 'verified', realName: '合成测试主体', idNumber: 'SYNTHETIC-DOCUMENT-ONLY', providerRequestId: 'synthetic-request' });
    expect(await first).toMatchObject({ status: 'verified' });
    expect(f.provider.verifyCalls).toBe(1);
    expect(f.tables.get(IdentityVerificationSession)).toHaveLength(1);
    const row = f.tables.get(IdentityVerificationSession)![0];
    expect(row.boundEventId).toBeTruthy();
    const event = row.boundEventId;
    await f.service.get('7', row.id);
    expect(f.tables.get(IdentityVerificationSession)![0].boundEventId).toBe(event);
  });
  it('refuses a document fingerprint already bound to another account', async () => {
    const f = fixture(); await f.service.create('7', images);
    const collision = await f.make().create('8', { face_asset_id: '31', id_card_portrait_asset_id: '32', id_card_emblem_asset_id: '33' });
    expect(collision).toMatchObject({ status: 'rejected', reason_code: 'IDENTITY_ALREADY_BOUND', clear_materials: [] });
    expect(f.tables.get(LearnerIdentity)).toHaveLength(1);
  });
  it('encrypts with fresh nonces and rejects tampering while HMAC fingerprints are stable', () => {
    const f = fixture(); const a = f.crypto.encrypt({ name: 'synthetic' }); const b = f.crypto.encrypt({ name: 'synthetic' });
    expect(a).not.toBe(b); expect(f.crypto.decrypt(a)).toEqual({ name: 'synthetic' });
    expect(() => f.crypto.decrypt(a.slice(0, -2) + 'xx')).toThrow();
    expect(f.crypto.fingerprint('synthetic')).toBe(f.crypto.fingerprint('synthetic'));
  });
  it('keeps a committed identity successful when post-commit audit delivery rejects', async () => {
    const f = fixture(); f.audit.log = () => Promise.reject(new Error('synthetic audit unavailable'));
    expect(await f.service.create('7', images)).toMatchObject({ status: 'verified' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(await f.service.view('7')).toMatchObject({ status: 'verified' });
  });
  it('closes an unknown expired session before accepting new materials without replaying its supplier call', async () => {
    vi.useFakeTimers(); const f = fixture();
    f.provider.verify = async () => { f.provider.verifyCalls++; throw new Error('unknown outcome'); };
    await expect(f.service.create('7', images)).rejects.toThrow();
    const old = f.tables.get(IdentityVerificationSession)![0];
    await vi.advanceTimersByTimeAsync(600_001);
    f.provider.verify = async () => { f.provider.verifyCalls++; return { status: 'verified', realName: '合成测试主体', idNumber: 'SYNTHETIC-DOCUMENT-ONLY', providerRequestId: 'new-request' }; };
    expect(await f.service.create('7', { face_asset_id: '21', id_card_portrait_asset_id: '22', id_card_emblem_asset_id: '23' })).toMatchObject({ status: 'verified' });
    expect(f.tables.get(IdentityVerificationSession)!.find((row) => row.id === old.id).status).toBe('expired');
    expect(f.provider.verifyCalls).toBe(2);
  });
  it('disables fresh verifications without fabricating rejection', async () => {
    await expect(new DisabledIdentityProvider().verify({} as any)).rejects.toMatchObject({ code: 50004 });
  });
  it('returns authoritative already-verified when the provider is disabled', async () => {
    const f = fixture(); await f.service.create('7', images); f.provider.enabled = false;
    await expect(f.make().create('7', images)).rejects.toMatchObject({ code: 40960, data: { status: 'verified' } });
    expect(f.provider.verifyCalls).toBe(1);
  });
  it('recovers a durable successful result through same-material create after the provider is disabled', async () => {
    vi.useFakeTimers(); const f = fixture(); f.setBindFailure(true);
    await expect(f.service.create('7', images)).rejects.toThrow('bind failed');
    await vi.advanceTimersByTimeAsync(600_001); f.provider.enabled = false; f.setBindFailure(false);
    Object.assign(f.tables.get(SysUser)![0], { realName: '', categoryId: null });
    expect(await f.make().create('7', images)).toMatchObject({ status: 'verified' });
    expect(f.provider.verifyCalls).toBe(1);
  });
  it('reuses a rejected result when disabled but refuses a created result that still needs its provider call', async () => {
    const f = fixture(); f.provider.verify = async () => { f.provider.verifyCalls++; return { status: 'rejected', reasonCode: 'FACE_MISMATCH', providerRequestId: 'synthetic-rejection' } as any; };
    const rejected = await f.service.create('7', images); f.provider.enabled = false;
    expect(await f.make().create('7', images)).toEqual(rejected);
    const row = f.tables.get(IdentityVerificationSession)![0]; row.status = 'created'; row.reasonCode = null;
    await expect(f.make().create('7', images)).rejects.toMatchObject({ code: 50004 });
    expect(f.tables.get(IdentityVerificationSession)![0].status).toBe('created'); expect(f.provider.verifyCalls).toBe(1);
  });
});

describe('Tencent provider boundaries', () => {
  const group = (endpoint) => ({ enabled: true, secretId: 'synthetic-id', secretKey: randomBytes(32).toString('hex'), endpoint, timeoutSeconds: 1 });
  it('refuses non-official or insecure endpoints before reading image bytes', () => {
    expect(() => new TencentIdCardOcrAdapter(group('http://ocr.tencentcloudapi.com') as any)).toThrow();
    expect(() => new TencentFaceIdAdapter(group('https://user:pass@faceid.tencentcloudapi.com') as any)).toThrow();
    expect(() => new TencentFaceIdAdapter(group('https://localhost') as any)).toThrow();
  });
  it('does not serialize provider credentials and does not misclassify unavailable service as bad material', async () => {
    const settings = group('https://faceid.tencentcloudapi.com');
    const face = new TencentFaceIdAdapter(settings as any, async () => new Response(JSON.stringify({ Response: { RequestId: 'face-request', Error: { Code: 'FailedOperation.CompareSystemError', Message: 'sensitive provider content' } } })));
    expect(JSON.stringify(face)).not.toContain(settings.secretKey);
    await expect(face.verify('合成主体', 'SYNTHETIC', Buffer.from('face'))).rejects.toMatchObject({ code: 50004 });
  });
  it('rejects malformed document validity before attempting face verification', async () => {
    let faceCalls = 0;
    const provider = new TencentIdentityProvider({ recognize: async (_bytes, side) => side === 'FRONT' ? { realName: '合成主体', idNumber: 'SYNTHETIC', requestId: 'ocr-front' } : { validDate: '2020.13.01-2030.01.01', requestId: 'ocr-back' } } as any, { verify: async () => { faceCalls++; return 'face-request'; } } as any);
    expect(await provider.verify({ face: Buffer.from('x'), portrait: Buffer.from('y'), emblem: Buffer.from('z') })).toMatchObject({ status: 'rejected', reasonCode: 'ID_CARD_DOCUMENT_INVALID' });
    expect(faceCalls).toBe(0);
  });
  it('sends fixed OCR sides, rejects blocking warnings, and never retries an unknown response', async () => {
    let calls = 0;
    const ocr = new TencentIdCardOcrAdapter(group('https://ocr.tencentcloudapi.com') as any, async (_url, init) => {
      calls++; const body = JSON.parse(String(init.body)); expect(body.CardSide).toBe('FRONT');
      return new Response(JSON.stringify({ Response: { RequestId: 'ocr-request', Name: '合成主体', IdNum: 'SYNTHETIC', AdvancedInfo: JSON.stringify({ WarnInfos: [{ Code: -9100 }] }) } }));
    });
    await expect(ocr.recognize(Buffer.from('synthetic'), 'FRONT')).rejects.toMatchObject({ reasonCode: 'ID_CARD_DOCUMENT_INVALID' });
    expect(calls).toBe(1);
  });
  it('uses OCR-authoritative identity for FaceID and rejects similarity below 70', async () => {
    const face = new TencentFaceIdAdapter(group('https://faceid.tencentcloudapi.com') as any, async (_url, init) => {
      expect((init.headers as any)['X-TC-Action']).toBe('ImageRecognitionV2');
      expect(JSON.parse(String(init.body))).toMatchObject({ Name: '合成主体', IdCard: 'SYNTHETIC', ImageBase64: Buffer.from('face').toString('base64') });
      return new Response(JSON.stringify({ Response: { RequestId: 'face-request', Result: 'Success', Sim: 69.9 } }));
    });
    await expect(face.verify('合成主体', 'SYNTHETIC', Buffer.from('face'))).rejects.toMatchObject({ reasonCode: 'FACE_MISMATCH' });
  });
  it('matches the independently verified gooodwork TC3 V2 signing vector', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1551113065 * 1000);
    try {
      const face = new TencentFaceIdAdapter({ enabled: true, secretId: 'dummy-secret-id', secretKey: 'dummy-secret-key', token: 'dummy-session-token', endpoint: 'https://faceid.tencentcloudapi.com', timeoutSeconds: 10 }, async (_url, init) => {
        expect((init.headers as any).Authorization).toBe('TC3-HMAC-SHA256 Credential=dummy-secret-id/2019-02-25/faceid/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=040a3d2c29fd2dd89ddf276af5be3e798aceb72206a32a97962b5946188421b1');
        expect(String(init.body)).toBe('{"IdCard":"ID_CARD_PLACEHOLDER","Name":"测试占位","ImageBase64":"/9j/4GltYWdl"}');
        return new Response(JSON.stringify({ Response: { RequestId: 'provider-request-id', Result: 'Success', Sim: 88.88 } }));
      });
      await expect(face.verify('测试占位', 'ID_CARD_PLACEHOLDER', Buffer.from('/9j/4GltYWdl', 'base64'))).resolves.toBe('provider-request-id');
    } finally { vi.useRealTimers(); }
  });
  it.each([-9102, -9104, -9106, -9108, -9109, -9110, -9111])('rejects OCR authenticity warning %s', async (warning) => {
    const ocr = new TencentIdCardOcrAdapter(group('https://ocr.tencentcloudapi.com') as any, async () => new Response(JSON.stringify({ Response: { RequestId: 'ocr-request', Name: '合成主体', IdNum: '110101200001010010', Birth: '2000/01/01', Sex: '男', Nation: '合成', Address: '合成地址', AdvancedInfo: JSON.stringify({ WarnInfos: [{ Code: warning }] }) } })));
    await expect(ocr.recognize(Buffer.from('synthetic'), 'FRONT')).rejects.toMatchObject({ reasonCode: 'ID_CARD_DOCUMENT_INVALID' });
  });
});
