import type { MediaUploadPurpose } from '../media-policy';
import type { StorageLocator, StoredObject, UploadedPart } from '../storage/media-storage.port';

export type UploadState = 'uploading' | 'finalizing' | 'completed' | 'failed' | 'aborted' | 'expired';
export type UploadMode = 'simple' | 'multipart';

export type UploadInit = {
  client_request_id: string;
  purpose: MediaUploadPurpose;
  owner_id?: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  fingerprint_sha256: string;
};

export type UploadResult = { asset_id: string; status: 'ready'; duration_ms: number | null };
export type UploadSessionView = {
  session_id: string;
  state: UploadState;
  mode: UploadMode;
  expires_at: string;
  part_size: number;
  parallel_limit: number;
  parts: UploadedPart[];
  result: UploadResult | null;
  reason_code: string | null;
};

export type UploadGrant =
  | { mode: 'simple'; method: 'PUT'; url: string; headers: Record<string, string>; expires_at: string }
  | {
    mode: 'multipart'; bucket: string; region: string; key: string; upload_id: string;
    credentials: { tmp_secret_id: string; tmp_secret_key: string; token: string };
    start_time: number; expired_time: number;
  };

/** Register a claim-specific key before writing; persist verified object afterward. */
export type MediaUploadCandidate = {
  kind?: 'formal' | 'multipart';
  uploadId?: string;
  claimId: string;
  locator: StorageLocator;
  createdAt: string;
  object?: StoredObject;
  sha256?: string;
};
