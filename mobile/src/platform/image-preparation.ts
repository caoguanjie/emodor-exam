import type { PickedMedia } from './media-picker'

export const IMAGE_INPUT_MAX_BYTES = 25 * 1024 * 1024
export const IMAGE_INPUT_MAX_PIXELS = 64_000_000
const OUTPUT_MAX_BYTES = 2.1 * 1024 * 1024
const OUTPUT_MAX_EDGE = 1600
interface Dimensions { width: number; height: number }
interface TemporaryFiles { own(path: string): boolean; release(file: PickedMedia): void }
const compressionError = () => new Error('照片压缩失败，请重新选择照片或使用普通拍照模式')
const nativeCompressionError = () => new Error('照片未能压缩到合适尺寸，请更新微信后重试，或使用普通拍照模式')
function checkDimensions(value: Dimensions) {
  if (!Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || value.width <= 0 || value.height <= 0) throw new Error('照片尺寸无效，请重新选择')
  if (value.width > Math.floor(IMAGE_INPUT_MAX_PIXELS / value.height)) throw new Error('照片超过6400万像素，请使用普通拍照模式后重试')
}
function outputFits(info: Dimensions, size: number) {
  return Math.max(info.width, info.height) <= OUTPUT_MAX_EDGE && Number.isSafeInteger(size) && size > 0 && size <= OUTPUT_MAX_BYTES
}

// Read bounded file metadata before allocating a full decoded photograph.
async function imageHeader(blob: Blob): Promise<Dimensions> {
  const view = new DataView(await blob.slice(0, 1024 * 1024).arrayBuffer())
  if (blob.type === 'image/png' && view.byteLength >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && view.getUint32(12) === 0x49484452) {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (blob.type === 'image/jpeg' && view.byteLength >= 4 && view.getUint16(0) === 0xffd8) {
    let position = 2
    while (position + 4 <= view.byteLength) {
      if (view.getUint8(position++) !== 0xff) break
      while (position < view.byteLength && view.getUint8(position) === 0xff) position++
      if (position >= view.byteLength) break
      const marker = view.getUint8(position++)
      if (marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue
      if (position + 2 > view.byteLength) break
      const length = view.getUint16(position)
      if (length < 2 || position + length > view.byteLength) break
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 8) {
        return { width: view.getUint16(position + 5), height: view.getUint16(position + 3) }
      }
      position += length
    }
  }
  throw new Error('无法读取JPEG或PNG照片尺寸，请重新选择')
}

// #ifdef H5
async function browserImage(file: PickedMedia, temps: TemporaryFiles): Promise<PickedMedia> {
  const source = await (await fetch(file.tempFilePath)).blob()
  if (!['image/jpeg', 'image/png'].includes(source.type)) throw new Error('仅支持JPEG或PNG照片')
  if (!source.size || source.size > IMAGE_INPUT_MAX_BYTES) throw new Error('照片不能超过25MiB，请使用普通拍照模式')
  const metadata = await imageHeader(source)
  checkDimensions(metadata)
  let bitmap: ImageBitmap | undefined, image: HTMLImageElement | undefined, decoded = false
  try {
    if (typeof createImageBitmap === 'function') {
      try { bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' }) } catch { /* Older browsers can still decode through an image element. */ }
    }
    if (!bitmap) {
      image = document.createElement('img')
      await new Promise<void>((resolve, reject) => {
        image!.onload = () => resolve()
        image!.onerror = () => reject(compressionError())
        image!.src = file.tempFilePath
      })
    }
    const dimensions = bitmap || { width: image!.naturalWidth, height: image!.naturalHeight }
    checkDimensions(dimensions)
    decoded = true
    const scale = Math.min(1, OUTPUT_MAX_EDGE / Math.max(dimensions.width, dimensions.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(dimensions.width * scale)); canvas.height = Math.max(1, Math.round(dimensions.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw compressionError()
    context.drawImage(bitmap || image!, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.9, 0.8, 0.65, 0.5]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (!blob || !['image/jpeg', 'image/png'].includes(blob.type) || blob.size > OUTPUT_MAX_BYTES) continue
      const output = await imageHeader(blob)
      checkDimensions(output)
      if (!outputFits(output, blob.size)) continue
      const result = { tempFilePath: URL.createObjectURL(blob), size: blob.size, mimeType: blob.type }
      temps.release(file)
      return result
    }
    throw compressionError()
  } catch (cause) {
    // Small validated originals are safe; never send an uncompressed large photo.
    if (decoded && outputFits(metadata, source.size)) return { ...file, size: source.size, mimeType: source.type }
    throw cause instanceof Error ? cause : compressionError()
  } finally {
    bitmap?.close()
    if (image) { image.onload = null; image.onerror = null; image.src = '' }
  }
}
// #endif

export async function preparePickedImage(file: PickedMedia, temps: TemporaryFiles): Promise<PickedMedia> {
  if (file.mimeType && !['image/jpeg', 'image/png'].includes(file.mimeType)) throw new Error('仅支持JPEG或PNG照片')
  // #ifdef H5
  if (typeof document !== 'undefined' && typeof uni.getFileSystemManager !== 'function') return browserImage(file, temps)
  // #endif
  // #ifdef MP-WEIXIN
  if (typeof uni.getImageInfo === 'function') {
    const inspect = async (path: string) => {
      let info: UniApp.GetImageInfoSuccessData
      try { info = await new Promise((resolve, reject) => uni.getImageInfo({ src: path, success: resolve, fail: reject })) } catch { throw new Error('无法读取照片，请重新选择') }
      const mimeType = info.type === 'jpeg' || info.type === 'jpg' ? 'image/jpeg' : info.type === 'png' ? 'image/png' : ''
      if (!mimeType) throw new Error('仅支持JPEG或PNG照片')
      checkDimensions(info)
      return { info, mimeType }
    }
    const original = await inspect(file.tempFilePath)
    const validated = { ...file, mimeType: original.mimeType }
    if (typeof uni.compressImage !== 'function') {
      if (outputFits(original.info, file.size)) return validated
      throw nativeCompressionError()
    }
    let unusedPath = '', overwritten = false
    try {
      const scale = Math.min(1, OUTPUT_MAX_EDGE / Math.max(original.info.width, original.info.height))
      const result = await new Promise<UniApp.CompressImageSuccessResult>((resolve, reject) => uni.compressImage({ src: file.tempFilePath, quality: 80, compressedWidth: Math.max(1, Math.round(original.info.width * scale)), compressedHeight: Math.max(1, Math.round(original.info.height * scale)), success: resolve, fail: reject }))
      if (result.tempFilePath !== file.tempFilePath) {
        if (!temps.own(result.tempFilePath)) throw nativeCompressionError()
        unusedPath = result.tempFilePath
      } else overwritten = true
      const output = await inspect(result.tempFilePath)
      const stat = await new Promise<{ size: number }>((resolve, reject) => uni.getFileInfo({ filePath: result.tempFilePath, success: resolve, fail: reject }))
      if (!outputFits(output.info, stat.size)) throw nativeCompressionError()
      if (!overwritten) temps.release(file)
      unusedPath = ''
      return { tempFilePath: result.tempFilePath, size: stat.size, mimeType: output.mimeType }
    } catch (cause) {
      if (!overwritten && outputFits(original.info, file.size)) return validated
      throw cause instanceof Error ? cause : nativeCompressionError()
    } finally { if (unusedPath) temps.release({ tempFilePath: unusedPath, size: 0 }) }
  }
  // #endif
  throw new Error('当前微信版本不支持照片校验，请更新微信后重试')
}
