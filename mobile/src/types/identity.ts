export type IdentityViewState = 'unverified' | 'collecting' | 'submitting' | 'pending' | 'verified' | 'rejected' | 'error'
export type IdentityMaterialKind = 'portrait' | 'emblem' | 'face'
export type IdentityAssetState = 'ready' | 'uploading' | 'error' | 'unsafe' | null

export interface IdentityMaterials {
  portrait: IdentityAssetState
  emblem: IdentityAssetState
  face: IdentityAssetState
  consent: boolean
}

export function canSubmitIdentity(materials: IdentityMaterials): boolean {
  return materials.portrait === 'ready' && materials.emblem === 'ready' && materials.face === 'ready' && materials.consent === true
}

export interface IdentityVerifiedInfo {
  name: string
  maskedId: string
  gender?: string
  birthday?: string
  nationality?: string
  authority?: string
  validity?: string
}
