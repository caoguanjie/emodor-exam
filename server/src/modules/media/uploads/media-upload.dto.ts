import { basename } from 'node:path';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { Errors } from '../../../common/errors';
import type { AppConfig } from '../../../config/configuration';
import { assertMediaSize, assertPublicMediaPurpose, DEFAULT_MEDIA_LIMITS, MEDIA_UPLOAD_PURPOSES, mediaKindForPurpose } from '../media-policy';
import type { UploadInit } from './media-upload.contract';

export const UPLOAD_INIT_FIELDS = ['client_request_id','purpose','owner_id','filename','mime_type','size_bytes','fingerprint_sha256'] as const;
export class MediaUploadInitDto implements UploadInit {
  @IsUUID('4') client_request_id!: string;
  @IsString() @IsIn([...MEDIA_UPLOAD_PURPOSES]) purpose!: UploadInit['purpose'];
  @IsOptional() @IsString() @Matches(/^[1-9]\d{0,19}$/) owner_id?: string;
  @IsString() @MaxLength(255) filename!: string;
  @IsString() @MaxLength(128) mime_type!: string;
  @IsInt() @Min(1) size_bytes!: number;
  @IsString() @Matches(/^[a-fA-F0-9]{64}$/) fingerprint_sha256!: string;
}
export class EmptyUploadDto {}

export function normalizeUploadInit(input: UploadInit, config: AppConfig): UploadInit {
  if (!input || Object.keys(input).some(key => !UPLOAD_INIT_FIELDS.includes(key as any))
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.client_request_id || '')
    || typeof input.filename !== 'string' || !input.filename || input.filename.length > 255 || /[\0\r\n]/.test(input.filename)
    || !/^[a-fA-F0-9]{64}$/.test(input.fingerprint_sha256 || '')
    || !Number.isSafeInteger(input.size_bytes) || input.size_bytes < 1) throw Errors.param('上传声明无效');
  assertPublicMediaPurpose(input.purpose);
  if (input.owner_id !== undefined && (!/^[1-9]\d{0,19}$/.test(input.owner_id) || BigInt(input.owner_id) > 18446744073709551615n)) throw Errors.param('媒体拥有者无效');
  const kind = mediaKindForPurpose(input.purpose);
  const limits = { ...DEFAULT_MEDIA_LIMITS, ...config.media };
  assertMediaSize(kind,input.size_bytes,limits);
  if (!(kind === 'video' ? limits.allowedVideoTypes : limits.allowedImageTypes).includes(input.mime_type)) throw Errors.fileFormat();
  const filename=basename(input.filename.replace(/\\/g,'/'));
  if (!filename || filename === '.' || filename === '..') throw Errors.param('上传文件名无效');
  return { ...input, client_request_id:input.client_request_id.toLowerCase(), filename, fingerprint_sha256:input.fingerprint_sha256.toLowerCase() };
}
