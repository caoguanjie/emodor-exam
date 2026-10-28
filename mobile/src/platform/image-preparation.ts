import type { PickedMedia } from './media-picker'

export const IMAGE_INPUT_MAX_BYTES = 25 * 1024 * 1024
export const IMAGE_INPUT_MAX_PIXELS = 64_000_000
const OUTPUT_MAX_BYTES = 2.1 * 1024 * 1024
const OUTPUT_MAX_EDGE = 1600
interface Dimensions { width: number; height: number }
interface TemporaryFiles { own(path: string): boolean; release(file: PickedMedia): void }
const LEGACY_DECODE_MAX_PIXELS = 16_000_000
function fittedDimensions(value: Dimensions): Dimensions {
  const scale = Math.min(1, OUTPUT_MAX_EDGE / Math.max(value.width, value.height))
  return { width: Math.max(1, Math.round(value.width * scale)), height: Math.max(1, Math.round(value.height * scale)) }
}
function exifSwapsAxes(view: DataView, start: number, end: number): boolean {
  if (start + 14 > end || view.getUint32(start) !== 0x45786966 || view.getUint16(start + 4) !== 0) return false
  const base = start + 6, little = view.getUint16(base) === 0x4949
  if (![0x4949, 0x4d4d].includes(view.getUint16(base)) || view.getUint16(base + 2, little) !== 42) return false
  const directory = base + view.getUint32(base + 4, little)
  if (directory < base + 8 || directory + 2 > end) return false
  const count = view.getUint16(directory, little)
  for (let entry = directory + 2, i = 0; i < count && entry + 12 <= end; i++, entry += 12) {
    if (view.getUint16(entry, little) === 0x0112 && view.getUint16(entry + 2, little) === 3 && view.getUint32(entry + 4, little) === 1) {
      return [5, 6, 7, 8].includes(view.getUint16(entry + 8, little))
    }
  }
  return false
}
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
async function imageHeader(blob: Blob): Promise<Dimensions & { mimeType: string }> {
  const view = new DataView(await blob.slice(0, 24).arrayBuffer())
  if (view.byteLength >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && view.getUint32(12) === 0x49484452) {
    return { width: view.getUint32(16), height: view.getUint32(20), mimeType: 'image/png' }
  }
  if (view.byteLength >= 4 && view.getUint16(0) === 0xffd8) {
    let position = 2
    let swapsAxes = false
    // Skip APP/ICC/XMP payloads by their offsets instead of limiting SOF to
    // the first MiB. Each read stays small even for metadata-heavy photographs.
    for (let segments = 0; segments < 4096 && position + 4 <= blob.size; segments++) {
      const prefix = new DataView(await blob.slice(position, position + 12).arrayBuffer())
      if (prefix.getUint8(0) !== 0xff) break
      if (prefix.getUint8(1) === 0xff) { position++; continue }
      const marker = prefix.getUint8(1)
      if (marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) { position += 2; continue }
      const length = prefix.getUint16(2)
      if (length < 2 || position + 2 + length > blob.size) break
      if (marker === 0xe1) {
        const exif = new DataView(await blob.slice(position + 4, position + 2 + length).arrayBuffer())
        swapsAxes = exifSwapsAxes(exif, 0, exif.byteLength) || swapsAxes
      }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 8) {
        const width = prefix.getUint16(7), height = prefix.getUint16(5)
        return { ...(swapsAxes ? { width: height, height: width } : { width, height }), mimeType: 'image/jpeg' }
      }
      position += 2 + length
    }
  }
  throw new Error('无法读取JPEG或PNG照片尺寸，请重新选择')
}

// #ifdef H5
async function browserImage(file: PickedMedia, temps: TemporaryFiles): Promise<PickedMedia> {
  const originalSource = await (await fetch(file.tempFilePath)).blob()
  if (!originalSource.size || originalSource.size > IMAGE_INPUT_MAX_BYTES) throw new Error('照片不能超过25MiB，请使用普通拍照模式')
  const metadata = await imageHeader(originalSource)
  // Android galleries may omit or mislabel MIME; identify the bytes, then
  // give the decoder the correct type without copying the whole photograph.
  const source = originalSource.slice(0, originalSource.size, metadata.mimeType)
  checkDimensions(metadata)
  const target = fittedDimensions(metadata)
  let bitmap: ImageBitmap | undefined, image: HTMLImageElement | undefined, decoded = false
  let canvas: HTMLCanvasElement | undefined
  try {
    if (typeof createImageBitmap === 'function') {
      try { bitmap = await createImageBitmap(source, { imageOrientation: 'from-image', resizeWidth: target.width, resizeHeight: target.height, resizeQuality: 'high' }) } catch { /* Bounded originals can use the legacy decoder below. */ }
      // Some older engines accept the options but ignore decoder resizing.
      if (bitmap && Math.max(bitmap.width, bitmap.height) > OUTPUT_MAX_EDGE && metadata.width * metadata.height > LEGACY_DECODE_MAX_PIXELS) {
        bitmap.close(); bitmap = undefined
      }
    }
    if (!bitmap) {
      if (metadata.width * metadata.height > LEGACY_DECODE_MAX_PIXELS) throw new Error('当前浏览器不支持大照片缩小解码，请更新浏览器或选择较小照片')
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
    canvas = document.createElement('canvas')
    const outputSize = fittedDimensions(dimensions)
    canvas.width = outputSize.width; canvas.height = outputSize.height
    const context = canvas.getContext('2d')
    if (!context) throw compressionError()
    context.drawImage(bitmap || image!, 0, 0, canvas.width, canvas.height)
    bitmap?.close(); bitmap = undefined
    for (const edge of [OUTPUT_MAX_EDGE, 1200, 800, 400]) {
      const ratio = Math.min(1, edge / Math.max(canvas.width, canvas.height))
      if (ratio < 1) {
        const smaller = document.createElement('canvas')
        smaller.width = Math.max(1, Math.round(canvas.width * ratio)); smaller.height = Math.max(1, Math.round(canvas.height * ratio))
        const smallerContext = smaller.getContext('2d')
        if (!smallerContext) throw compressionError()
        smallerContext.drawImage(canvas, 0, 0, smaller.width, smaller.height)
        canvas.width = 0; canvas.height = 0
        canvas = smaller
      }
      for (const quality of [0.9, 0.8, 0.65, 0.5]) {
        const blob = await new Promise<Blob | null>(resolve => canvas!.toBlob(resolve, 'image/jpeg', quality))
        if (!blob || !['image/jpeg', 'image/png'].includes(blob.type) || blob.size > OUTPUT_MAX_BYTES) continue
        const output = await imageHeader(blob)
        checkDimensions(output)
        if (!outputFits(output, blob.size)) continue
        const result = { tempFilePath: URL.createObjectURL(blob), size: blob.size, mimeType: blob.type }
        temps.release(file)
        return result
      }
    }
    throw compressionError()
  } catch (cause) {
    // Small validated originals are safe; never send an uncompressed large photo.
    if (decoded && outputFits(metadata, source.size)) return { ...file, size: source.size, mimeType: source.type }
    throw cause instanceof Error ? cause : compressionError()
  } finally {
    bitmap?.close()
    if (canvas) { canvas.width = 0; canvas.height = 0 }
    if (image) { image.onload = null; image.onerror = null; image.src = '' }
  }
}
// #endif

export async function preparePickedImage(file: PickedMedia, temps: TemporaryFiles): Promise<PickedMedia> {
  // #ifdef H5
  if (typeof document !== 'undefined' && typeof uni.getFileSystemManager !== 'function') return browserImage(file, temps)
  // #endif
  if (file.mimeType && !['image/jpeg', 'image/png'].includes(file.mimeType)) throw new Error('仅支持JPEG或PNG照片')
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
