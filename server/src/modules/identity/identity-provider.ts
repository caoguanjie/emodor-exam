import { createHash, createHmac } from 'node:crypto';
import { Errors } from '../../common/errors';

export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');
export type IdentityImageType = 'id_card_portrait' | 'id_card_emblem' | 'face';
export interface TencentSettings { enabled: boolean; secretId: string; secretKey: string; token?: string; endpoint: string; timeoutSeconds: number }
export interface IdentitySettings { provider: 'disabled' | 'tencent'; dataEncryptionKey: string; fingerprintSecret: string; sessionTtlSeconds: number; idCardOcr: TencentSettings; faceId: TencentSettings }
export interface IdentityProviderInput { face: Buffer; portrait: Buffer; emblem: Buffer }
export type IdentityProviderResult = { status: 'verified'; realName: string; idNumber: string; providerRequestId: string } | { status: 'rejected'; reasonCode: string; providerRequestId: string };
export interface IdentityProvider {
  readonly enabled: boolean;
  verify(input: IdentityProviderInput): Promise<IdentityProviderResult>;
  cropDocument?(bytes: Buffer, side: 'FRONT' | 'BACK'): Promise<Buffer>;
}
export class IdentityMaterialError extends Error {
  constructor(readonly reasonCode: string) { super('认证材料未通过核验'); }
}
export class DisabledIdentityProvider implements IdentityProvider {
  readonly enabled = false;
  async verify(_input: IdentityProviderInput): Promise<IdentityProviderResult> { throw Errors.serviceUnavailable('实名认证暂不可用'); }
}
type HttpTransport = (url: string, init: RequestInit) => Promise<Response>;
const OCR_MATERIAL_CODES = new Set(['FailedOperation.DetectFailed', 'FailedOperation.EmptyImageError', 'FailedOperation.IdCardTooSmall', 'FailedOperation.ImageBlur', 'FailedOperation.ImageDecodeFailed', 'FailedOperation.ImageNoIdCard', 'FailedOperation.MultiCardError']);
const FACE_MISMATCH_CODES = new Set(['FailedOperation.CompareFail', 'FailedOperation.CompareLowSimilarity', 'FailedOperation.IdFormatError', 'FailedOperation.IdNameMisMatch', 'FailedOperation.IdNoExistSystem', 'FailedOperation.IdPhotoNoExist', 'FailedOperation.NameFormatError']);
const FACE_QUALITY_CODES = new Set(['FailedOperation.LifePhotoDetectFake', 'FailedOperation.IdPhotoPoorQuality', 'FailedOperation.LifePhotoDetectFaces', 'FailedOperation.LifePhotoDetectNoFaces', 'FailedOperation.LifePhotoPoorQuality', 'FailedOperation.LifePhotoSizeError', 'FailedOperation.CoveredFace', 'FailedOperation.ImageDecodeFailed', 'FailedOperation.IncompleteFace', 'FailedOperation.PoorImageQuality']);
function materialFailure(service: 'ocr' | 'faceid', code: string): string | null {
  if (service === 'ocr') return OCR_MATERIAL_CODES.has(code) ? 'ID_CARD_DOCUMENT_INVALID' : null;
  return FACE_MISMATCH_CODES.has(code) ? 'FACE_MISMATCH' : FACE_QUALITY_CODES.has(code) ? 'FACE_QUALITY_FAILED' : null;
}
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function hmac(key: string | Buffer, value: string): Buffer { return createHmac('sha256', key).update(value).digest(); }
function endpoint(settings: TencentSettings, host: string): URL {
  let url: URL;
  try { url = new URL(settings.endpoint); } catch { throw new Error('腾讯认证端点配置无效'); }
  if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('腾讯认证端点配置无效');
  if (!settings.enabled || !settings.secretId || !settings.secretKey || !Number.isFinite(settings.timeoutSeconds) || settings.timeoutSeconds <= 0) throw new Error('腾讯认证配置不完整');
  return url;
}
class TencentHttp {
  private readonly url: URL;
  constructor(private readonly settings: TencentSettings, private readonly service: 'ocr' | 'faceid', private readonly version: string, private readonly transport: HttpTransport = fetch) {
    this.url = endpoint(settings, `${service}.tencentcloudapi.com`);
  }
  toJSON() { return { service: this.service, version: this.version }; }
  async call(action: string, input: Record<string, unknown>): Promise<Record<string, any>> {
    const body = JSON.stringify(input); const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const signedHeaders = 'content-type;host;x-tc-action';
    const headersToSign = `content-type:application/json; charset=utf-8\nhost:${this.url.host}\nx-tc-action:${action.toLowerCase()}\n`;
    const canonical = `POST\n/\n\n${headersToSign}\n${signedHeaders}\n${hash(body)}`;
    const scope = `${date}/${this.service}/tc3_request`;
    const signKey = hmac(hmac(hmac(`TC3${this.settings.secretKey}`, date), this.service), 'tc3_request');
    const signature = hmac(signKey, `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${hash(canonical)}`).toString('hex');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.settings.timeoutSeconds * 1000);
    try {
      const response = await this.transport(this.url.href, { method: 'POST', redirect: 'error', signal: controller.signal, headers: {
        'Content-Type': 'application/json; charset=utf-8', Host: this.url.host,
        'X-TC-Action': action, 'X-TC-Version': this.version, 'X-TC-Timestamp': String(timestamp),
        Authorization: `TC3-HMAC-SHA256 Credential=${this.settings.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        ...(this.settings.token ? { 'X-TC-Token': this.settings.token } : {}),
      }, body });
      // Read bounded data; upstream messages can contain personal information.
      const chunks: Uint8Array[] = []; let size = 0;
      if (!response.body) throw Errors.serviceUnavailable('认证供应商响应异常');
      for await (const chunk of response.body as any) { size += chunk.length; if (size > 16_000_000) { controller.abort(); throw Errors.serviceUnavailable('认证供应商响应异常'); } chunks.push(chunk); }
      let payload: any;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')).Response; } catch { throw Errors.serviceUnavailable('认证供应商响应异常'); }
      if (!response.ok || !payload || typeof payload.RequestId !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(payload.RequestId)) throw Errors.serviceUnavailable('认证供应商暂不可用');
      if (payload.Error) {
        const code = String(payload.Error.Code || '');
        const reason = materialFailure(this.service, code);
        if (reason) throw new IdentityMaterialError(reason);
        throw Errors.serviceUnavailable('认证供应商暂不可用');
      }
      return payload;
    } catch (error) {
      if (error instanceof IdentityMaterialError || (error as any)?.code === 50004) throw error;
      throw Errors.serviceUnavailable('认证供应商暂不可用');
    } finally { clearTimeout(timer); }
  }
}
export interface OcrResult { realName: string; idNumber: string; validDate: string; crop: Buffer | null; requestId: string }
export class TencentIdCardOcrAdapter {
  private readonly http: TencentHttp;
  constructor(settings: TencentSettings, transport?: HttpTransport) { this.http = new TencentHttp(settings, 'ocr', '2018-11-19', transport); }
  async recognize(bytes: Buffer, side: 'FRONT' | 'BACK'): Promise<OcrResult> {
    const data = await this.http.call('IDCardOCR', { ImageBase64: bytes.toString('base64'), CardSide: side,
      Config: JSON.stringify({ CropIdCard: true, CopyWarn: true, BorderCheckWarn: true, ReshootWarn: true, DetectPsWarn: true, TempIdWarn: true, InvalidDateWarn: true, ReflectWarn: true, Quality: true }),
      EnableRecognitionRectify: true, EnableReflectDetail: false, CardWarnType: 'Advanced' });
    let info: any;
    try { info = typeof data.AdvancedInfo === 'string' ? JSON.parse(data.AdvancedInfo) : data.AdvancedInfo || {}; } catch { throw Errors.serviceUnavailable('认证供应商响应异常'); }
    const warnings = [...(Array.isArray(info.WarnInfos) ? info.WarnInfos : []), ...(Array.isArray(data.WarnInfos) ? data.WarnInfos : [])];
    // Unknown warning codes are fail-closed. Border/occlusion/reflection alone are advisory.
    const advisory = new Set([-9101, -9103, -9105, -9107]);
    if (warnings.some((w: any) => !advisory.has(typeof w === 'number' ? w : Number(w?.Code)))) throw new IdentityMaterialError('ID_CARD_DOCUMENT_INVALID');
    if (!Array.isArray(info.WarnInfos) || typeof info.Quality !== 'number' || info.Quality < 0 || info.Quality > 100) throw Errors.serviceUnavailable('认证供应商响应异常');
    const realName = typeof data.Name === 'string' ? data.Name.trim() : '';
    const idNumber = typeof data.IdNum === 'string' ? data.IdNum.trim().toUpperCase() : '';
    if (side === 'FRONT' ? !realName || realName.length > 64 || !/^\d{17}[\dX]$/.test(idNumber) || !data.Birth || !data.Sex || !data.Nation || !data.Address : !data.Authority || !data.ValidDate) {
      throw new IdentityMaterialError(side === 'FRONT' ? 'ID_CARD_PORTRAIT_PARSE_FAILED' : 'ID_CARD_EMBLEM_PARSE_FAILED');
    }
    let crop: Buffer | null = null;
    if (typeof info.IdCard === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(info.IdCard) && info.IdCard.length <= 14_000_000) crop = Buffer.from(info.IdCard, 'base64');
    return { realName, idNumber, validDate: String(data.ValidDate || ''), crop, requestId: data.RequestId.slice(0, 128) };
  }
}
export class TencentFaceIdAdapter {
  private readonly http: TencentHttp;
  constructor(settings: TencentSettings, transport?: HttpTransport) { this.http = new TencentHttp(settings, 'faceid', '2018-03-01', transport); }
  async verify(realName: string, idNumber: string, face: Buffer): Promise<string> {
    if (face.toString('base64').length > 2_800_000) throw new IdentityMaterialError('FACE_QUALITY_FAILED');
    const data = await this.http.call('ImageRecognitionV2', { IdCard: idNumber, Name: realName, ImageBase64: face.toString('base64') });
    if (data.Result !== 'Success') {
      const reason = materialFailure('faceid', String(data.Result));
      if (reason) throw new IdentityMaterialError(reason);
      throw Errors.serviceUnavailable('认证供应商暂不可用');
    }
    if (typeof data.Sim !== 'number' || !Number.isFinite(data.Sim) || data.Sim < 0 || data.Sim > 100) throw Errors.serviceUnavailable('认证供应商响应异常');
    if (data.Sim < 70) throw new IdentityMaterialError('FACE_MISMATCH');
    return data.RequestId.slice(0, 128);
  }
}
export class TencentIdentityProvider implements IdentityProvider {
  readonly enabled = true;
  constructor(private readonly ocr: TencentIdCardOcrAdapter, private readonly face: TencentFaceIdAdapter) {}
  async cropDocument(bytes: Buffer, side: 'FRONT' | 'BACK'): Promise<Buffer> {
    const result = await this.ocr.recognize(bytes, side);
    if (!result.crop?.length) throw new IdentityMaterialError(side === 'FRONT' ? 'ID_CARD_PORTRAIT_PARSE_FAILED' : 'ID_CARD_EMBLEM_PARSE_FAILED');
    return result.crop;
  }
  async verify(input: IdentityProviderInput): Promise<IdentityProviderResult> {
    try {
      const portrait = await this.ocr.recognize(input.portrait, 'FRONT');
      const emblem = await this.ocr.recognize(input.emblem, 'BACK');
      const parts = emblem.validDate.match(/^(\d{4})[.\-/]?(\d{2})[.\-/]?(\d{2})\s*[-~至]\s*(?:(\d{4})[.\-/]?(\d{2})[.\-/]?(\d{2})|长期)$/);
      if (!parts) throw new IdentityMaterialError('ID_CARD_DOCUMENT_INVALID');
      const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const start = `${parts[1]}-${parts[2]}-${parts[3]}`; const end = parts[4] ? `${parts[4]}-${parts[5]}-${parts[6]}` : null;
      const validDate = (value: string) => { const date = new Date(value + 'T00:00:00.000Z'); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; };
      if (!validDate(start) || end && (!validDate(end) || end < start)) throw new IdentityMaterialError('ID_CARD_DOCUMENT_INVALID');
      if (start > today) throw new IdentityMaterialError('ID_CARD_DOCUMENT_INVALID');
      if (end && end < today) throw new IdentityMaterialError('ID_CARD_EXPIRED');
      const requestId = await this.face.verify(portrait.realName, portrait.idNumber, input.face);
      return { status: 'verified', realName: portrait.realName, idNumber: portrait.idNumber, providerRequestId: requestId };
    } catch (error) {
      if (error instanceof IdentityMaterialError) return { status: 'rejected', reasonCode: error.reasonCode, providerRequestId: '' };
      throw error;
    }
  }
}
