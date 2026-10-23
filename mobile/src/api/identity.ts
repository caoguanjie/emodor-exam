import { request } from './client'
import { uploadMedia, type MediaTicketView } from './media'
import type { PickedMedia } from '@/platform/media-picker'
export type IdentityStatus = 'unverified' | 'pending' | 'verified' | 'rejected'
export type IdentityImageType = 'id_card_portrait' | 'id_card_emblem' | 'face'
export type IdentityReasonCode = 'ID_CARD_PORTRAIT_PARSE_FAILED' | 'ID_CARD_EMBLEM_PARSE_FAILED' | 'ID_CARD_DOCUMENT_INVALID' | 'ID_CARD_EXPIRED' | 'FACE_MISMATCH' | 'FACE_QUALITY_FAILED' | 'IDENTITY_ALREADY_BOUND' | 'SESSION_EXPIRED'
export interface IdentityVerificationView { status: IdentityStatus; real_name: string | null; id_number_masked: string | null; verified_at: string | null; current_session_id: string | null; reason_code: IdentityReasonCode | null }
export interface IdentityImageUpload { asset_id: string; image_type: IdentityImageType; scan_status: 'safe'; processed_preview: MediaTicketView | null }
export interface IdentitySessionCreate { face_asset_id: string; id_card_portrait_asset_id: string; id_card_emblem_asset_id: string }
export interface IdentitySessionView { session_id: string; status: 'pending' | 'verified' | 'rejected'; reason_code: IdentityReasonCode | null; clear_materials: IdentityImageType[]; expires_at: string }
export function getIdentity(): Promise<IdentityVerificationView> { return request({ url: '/me/identity-verification' }) }
export function uploadIdentityImage(imageType: IdentityImageType, file: PickedMedia): Promise<IdentityImageUpload> { return uploadMedia('/me/identity-verification/images', file, { image_type: imageType }) }
export function createIdentitySession(data: IdentitySessionCreate): Promise<IdentitySessionView> { return request({ url: '/me/identity-verification/sessions', method: 'POST', data }) }
export function getIdentitySession(id: string): Promise<IdentitySessionView> { return request({ url: `/me/identity-verification/sessions/${encodeURIComponent(id)}` }) }
export function releaseIdentityImage(id: string): Promise<null> { return request({ url: `/me/identity-verification/images/${encodeURIComponent(id)}`, method: 'DELETE' }) }
