import { IMAGE_INPUT_MAX_BYTES, preparePickedImage } from './image-preparation'

/** Temporary local media; do not persist identity photos in client storage. */
export interface PickedMedia {
  tempFilePath: string
  size: number
  mimeType?: string
}

export interface MediaPicker {
  pickIdentitySide(side: 'portrait' | 'emblem'): Promise<PickedMedia>
  captureLiveFace(): Promise<PickedMedia>
}

export type MediaSource = 'camera' | 'album'
const ownedNativeTemps = new Set<string>()
function ownNativeTemp(path: string): boolean {
  if (typeof path !== 'string' || /[\x00-\x20\x7f\\?#%]/.test(path)
    || path.split('/').some(segment => segment === '.' || segment === '..')
    || !/^(?:wxfile:\/\/tmp_[^/]+|https?:\/\/tmp\/[^/].*|\/(?:temp|tmp)\/[^/].*)$/.test(path)) return false
  ownedNativeTemps.add(path)
  return true
}
export function pickIdentityMedia(kind: 'portrait' | 'emblem' | 'face', source: MediaSource): Promise<PickedMedia | null> {
  return pickImage(kind === 'face' ? ['camera'] : [source])
}
export function pickAvatar(): Promise<PickedMedia | null> { return pickImage(['camera', 'album']) }
function pickImage(sourceType: MediaSource[]): Promise<PickedMedia | null> {
  return new Promise((resolve, reject) => uni.chooseImage({
    count: 1, sourceType, sizeType: ['compressed'],
    success: result => {
      const files = result.tempFiles as UniApp.ChooseImageSuccessCallbackResultFile[]
      const file = files[0]
      if (!file) { resolve(null); return }
      // #ifdef MP-WEIXIN
      if (typeof uni.getFileSystemManager === 'function' && !ownNativeTemp(file.path)) { reject(new Error('请选择本次拍摄或相册选择的临时照片')); return }
      // #endif
      if (!Number.isSafeInteger(file.size) || file.size <= 0) { releasePickedMedia({ tempFilePath: file.path, size: 0 }); reject(new Error('无法读取照片，请重新选择')); return }
      if (file.size > IMAGE_INPUT_MAX_BYTES) { releasePickedMedia({ tempFilePath: file.path, size: file.size }); reject(new Error('照片不能超过25MiB，请使用普通拍照模式')); return }
      const picked = { tempFilePath: file.path, size: file.size, mimeType: (file as unknown as { type?: string }).type }
      void preparePickedImage(picked, { own: ownNativeTemp, release: releasePickedMedia }).then(resolve, cause => { releasePickedMedia(picked); reject(cause) })
    },
    fail: error => /cancel/i.test(error.errMsg) ? resolve(null) : reject(new Error(typeof uni.getFileSystemManager === 'function'
      ? '无法打开相机或相册，请检查微信小程序和系统的相机、相册权限后重试'
      : '无法打开相机或相册，请检查权限后重试')),
  }))
}
export function releasePickedMedia(media: PickedMedia) {
  // #ifdef H5
  if (media.tempFilePath.startsWith('blob:') && typeof URL !== 'undefined') URL.revokeObjectURL(media.tempFilePath)
  // #endif
  // #ifdef MP-WEIXIN
  if (ownedNativeTemps.delete(media.tempFilePath) && typeof uni.getFileSystemManager === 'function') uni.getFileSystemManager().unlink({ filePath: media.tempFilePath, fail: () => {} })
  // #endif
}
