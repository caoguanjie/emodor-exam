import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Reply = { success(value: unknown): void; fail(value: unknown): void }
const OriginalURL = URL
const sourcePath = 'blob:avatar-original'
const original = 'wxfile://tmp_avatar-original.jpg'
const compressed = 'wxfile://tmp_avatar-compressed.jpg'
function jpeg(width: number, height: number, size = 64) {
  const bytes = new Uint8Array(size)
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9])
  return new Blob([bytes], { type: 'image/jpeg' })
}
function browser(width = 8000, height = 6000, size = 12 * 1024 * 1024) {
  const source = jpeg(width, height, size)
  const revoked: string[] = [], close = vi.fn(), drawImage = vi.fn()
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => ({ drawImage })), toBlob: vi.fn((callback: (v: Blob | null) => void) => callback(jpeg(1600, 1200, 2000))) }
  vi.stubGlobal('uni', { chooseImage: (o: Reply) => o.success({ tempFiles: [{ path: sourcePath, size, type: 'image/jpeg' }] }) })
  vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => source })))
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width, height, close })))
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = vi.fn(() => 'blob:avatar-compressed'); static revokeObjectURL(path: string) { revoked.push(path) } })
  vi.stubGlobal('document', { createElement: () => canvas })
  return { source, canvas, revoked, close, drawImage }
}
function native(extra: Record<string, unknown> = {}) {
  const removed: string[] = []
  const compress = vi.fn((o: Reply) => o.success({ tempFilePath: compressed }))
  vi.stubGlobal('uni', {
    chooseImage: (o: Reply) => o.success({ tempFiles: [{ path: original, size: 12 * 1024 * 1024 }] }),
    getImageInfo: (o: Reply & { src: string }) => o.success({ width: o.src === original ? 8000 : 1600, height: o.src === original ? 6000 : 1200, type: 'jpeg' }),
    compressImage: compress,
    getFileInfo: (o: Reply) => o.success({ size: 2000 }),
    getFileSystemManager: () => ({ unlink: (o: { filePath: string }) => removed.push(o.filePath) }),
    ...extra,
  })
  return { removed, compress }
}
beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

describe('high resolution avatar compression', () => {
  it('compresses a 48MP H5 photograph larger than 10MiB before returning an upload file', async () => {
    const { canvas, close, revoked } = browser()
    const { pickAvatar } = await import('../src/platform/media-picker')
    expect(await pickAvatar()).toEqual({ tempFilePath: 'blob:avatar-compressed', size: 2000, mimeType: 'image/jpeg' })
    expect([canvas.width, canvas.height]).toEqual([1600, 1200])
    expect(close).toHaveBeenCalledOnce()
    expect(revoked).toEqual([sourcePath])
  })
  it('uses an HTML image and canvas when ImageBitmap is unavailable', async () => {
    const { canvas } = browser(6000, 8000, 1000)
    vi.stubGlobal('createImageBitmap', undefined)
    const image = { naturalWidth: 6000, naturalHeight: 8000, onload: null as null | (() => void), onerror: null as null | (() => void), set src(_value: string) { if (_value) queueMicrotask(() => this.onload?.()) } }
    vi.stubGlobal('document', { createElement: (tag: string) => tag === 'img' ? image : canvas })
    const { pickAvatar } = await import('../src/platform/media-picker')
    expect(await pickAvatar()).toMatchObject({ tempFilePath: 'blob:avatar-compressed' })
    expect([canvas.width, canvas.height]).toEqual([1200, 1600])
  })
  it('checks dimensions from the image header before decoding an excessive original', async () => {
    browser(12000, 9000, 1000)
    const { pickAvatar } = await import('../src/platform/media-picker')
    await expect(pickAvatar()).rejects.toThrow('普通拍照')
    expect(createImageBitmap).not.toHaveBeenCalled()
  })
  it('never falls back to a large H5 original when canvas compression fails', async () => {
    const { canvas, revoked, close } = browser()
    canvas.getContext.mockReturnValue(null as never)
    const { pickAvatar } = await import('../src/platform/media-picker')
    await expect(pickAvatar()).rejects.toThrow('压缩')
    expect(revoked).toEqual([sourcePath])
    expect(close).toHaveBeenCalledOnce()
  })
  it('rejects an oversized compressed H5 result instead of returning the original', async () => {
    const { canvas } = browser()
    canvas.toBlob.mockImplementation(callback => callback(jpeg(1600, 1200, 3 * 1024 * 1024)))
    const { pickAvatar } = await import('../src/platform/media-picker')
    await expect(pickAvatar()).rejects.toThrow('压缩')
  })
  it('compresses and rechecks a 48MP native image and cleans the owned original', async () => {
    const { removed, compress } = native()
    const { pickAvatar, releasePickedMedia } = await import('../src/platform/media-picker')
    const picked = await pickAvatar()
    expect(picked).toEqual({ tempFilePath: compressed, size: 2000, mimeType: 'image/jpeg' })
    expect(compress).toHaveBeenCalledWith(expect.objectContaining({ compressedWidth: 1600, compressedHeight: 1200 }))
    releasePickedMedia(picked!)
    expect(removed).toEqual([original, compressed])
  })
  it('fails closed when a native compressor ignores requested dimensions', async () => {
    const { removed } = native({ getImageInfo: (o: Reply) => o.success({ width: 8000, height: 6000, type: 'jpeg' }) })
    const { pickAvatar } = await import('../src/platform/media-picker')
    await expect(pickAvatar()).rejects.toThrow('微信')
    expect(removed).toContain(original)
    expect(removed).toContain(compressed)
  })
  it('does not return a large native original if compression is unavailable', async () => {
    native({ compressImage: undefined })
    const { pickAvatar } = await import('../src/platform/media-picker')
    await expect(pickAvatar()).rejects.toThrow('微信')
  })
  it('also compresses a 48MP ID photograph before upload', async () => {
    const { canvas } = browser(8000, 6000, 1000)
    const { pickIdentityMedia } = await import('../src/platform/media-picker')
    await expect(pickIdentityMedia('portrait', 'album')).resolves.toMatchObject({ tempFilePath: 'blob:avatar-compressed' })
    expect(canvas.toBlob).toHaveBeenCalled()
  })
})

  it('does not treat an unreadable small H5 image as a validated fallback', async () => {
    browser(1200, 900, 1000)
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('decode failed') }))
    const image = { naturalWidth: 0, naturalHeight: 0, onload: null as null | (() => void), onerror: null as null | (() => void), set src(value: string) { if (value) queueMicrotask(() => this.onerror?.()) } }
    vi.stubGlobal('document', { createElement: () => image })
    const { pickAvatar } = await import('../src/platform/media-picker')
    await expect(pickAvatar()).rejects.toThrow('压缩')
  })

  it('rejects over-25MiB originals before reading or decoding them', async () => {
    browser(8000, 6000, 26 * 1024 * 1024)
    const { pickIdentityMedia } = await import('../src/platform/media-picker')
    await expect(pickIdentityMedia('portrait', 'album')).rejects.toThrow('25MiB')
    expect(fetch).not.toHaveBeenCalled()
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it('does not upload an oversized native compressed output or the large original', async () => {
    const { removed } = native({ getFileInfo: (o: Reply) => o.success({ size: 3 * 1024 * 1024 }) })
    const { pickIdentityMedia } = await import('../src/platform/media-picker')
    await expect(pickIdentityMedia('portrait', 'album')).rejects.toThrow('压缩')
    expect(removed).toEqual([compressed, original])
  })
