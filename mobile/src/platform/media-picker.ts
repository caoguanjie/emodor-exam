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
export function pickIdentityMedia(kind: 'portrait' | 'emblem' | 'face', source: MediaSource): Promise<PickedMedia | null> {
  return pickImage(kind === 'face' ? ['camera'] : [source], kind === 'face' ? 60000000 : 20000000)
}
export function pickAvatar(): Promise<PickedMedia | null> { return pickImage(['camera', 'album']) }
function pickImage(sourceType: MediaSource[], maxPixels = 20000000): Promise<PickedMedia | null> {
  return new Promise((resolve, reject) => uni.chooseImage({
    count: 1, sourceType, sizeType: ['compressed'],
    success: result => {
      const files = result.tempFiles as UniApp.ChooseImageSuccessCallbackResultFile[]
      const file = files[0]
      if (!file) { resolve(null); return }
      if (file.size > 10 * 1024 * 1024) { releasePickedMedia({ tempFilePath: file.path, size: file.size }); reject(new Error('照片不能超过10MB，请重新拍摄')); return }
      const picked = { tempFilePath: file.path, size: file.size, mimeType: (file as unknown as { type?: string }).type }
      void prepareImage(picked, maxPixels).then(resolve, cause => { releasePickedMedia(picked); reject(cause) })
    },
    fail: error => /cancel/i.test(error.errMsg) ? resolve(null) : reject(new Error('无法打开相机或相册，请检查权限后重试')),
  }))
}
async function prepareImage(file: PickedMedia, maxPixels: number): Promise<PickedMedia> {
  if (file.mimeType && !['image/jpeg', 'image/png'].includes(file.mimeType)) throw new Error('仅支持JPEG或PNG照片')
  // #ifdef H5
  if (typeof createImageBitmap === 'function' && typeof document !== 'undefined') {
    let bitmap: ImageBitmap | undefined
    try {
      const source = await (await fetch(file.tempFilePath)).blob()
      if (!['image/jpeg', 'image/png'].includes(source.type)) throw new Error('仅支持JPEG或PNG照片')
      bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })
      if (bitmap.width * bitmap.height > maxPixels) throw new Error('照片尺寸过大，请重新拍摄')
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('照片压缩不可用')
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      let blob: Blob | null = null
      for (const quality of [0.9, 0.8, 0.65, 0.5]) {
        blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
        if (blob && blob.size <= 2.1 * 1024 * 1024) break
      }
      if (!blob || blob.size > 2.1 * 1024 * 1024) throw new Error('照片压缩失败')
      const result = { tempFilePath: URL.createObjectURL(blob), size: blob.size, mimeType: 'image/jpeg' }
      releasePickedMedia(file)
      return result
    } catch (cause) {
      if (cause instanceof Error && /仅支持|尺寸过大/.test(cause.message)) throw cause
      // The server still probes, rotates, re-encodes and checks the original.
      if (file.mimeType && !['image/jpeg', 'image/png'].includes(file.mimeType)) throw new Error('仅支持JPEG或PNG照片')
      if (file.size > 10 * 1024 * 1024) throw new Error('照片不能超过10MB，请重新拍摄')
    } finally { bitmap?.close() }
  }
  // #endif
  // #ifdef MP-WEIXIN
  if (typeof uni.getImageInfo === 'function' && typeof uni.compressImage === 'function') {
    let unusedCompressedPath = ''
    try {
      const info = await new Promise<UniApp.GetImageInfoSuccessData>((resolve, reject) => uni.getImageInfo({ src: file.tempFilePath, success: resolve, fail: reject }))
      if (info.width * info.height > maxPixels) throw new Error('照片尺寸过大，请重新拍摄')
      const scale = Math.min(1, 1600 / Math.max(info.width, info.height))
      const compressed = await new Promise<UniApp.CompressImageSuccessResult>((resolve, reject) => uni.compressImage({ src: file.tempFilePath, quality: 80, compressedWidth: Math.round(info.width * scale), compressedHeight: Math.round(info.height * scale), success: resolve, fail: reject }))
      if (compressed.tempFilePath !== file.tempFilePath) unusedCompressedPath = compressed.tempFilePath
      const stat = await new Promise<{ size: number }>((resolve, reject) => uni.getFileInfo({ filePath: compressed.tempFilePath, success: resolve, fail: reject }))
      if (stat.size <= 2.1 * 1024 * 1024) { if (file.tempFilePath !== compressed.tempFilePath) releasePickedMedia(file); unusedCompressedPath = ''; return { tempFilePath: compressed.tempFilePath, size: stat.size, mimeType: 'image/jpeg' } }
    } catch (cause) { if (cause instanceof Error && cause.message.includes('尺寸过大')) throw cause }
    finally { if (unusedCompressedPath) releasePickedMedia({ tempFilePath: unusedCompressedPath, size: 0 }) }
  }
  // #endif
  return file
}
export function releasePickedMedia(media: PickedMedia) {
  // #ifdef H5
  if (media.tempFilePath.startsWith('blob:') && typeof URL !== 'undefined') URL.revokeObjectURL(media.tempFilePath)
  // #endif
  // #ifdef MP-WEIXIN
  if (!media.tempFilePath.startsWith('blob:') && typeof uni.getFileSystemManager === 'function') uni.getFileSystemManager().unlink({ filePath: media.tempFilePath, fail: () => {} })
  // #endif
}
