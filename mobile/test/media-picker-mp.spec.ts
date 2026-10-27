import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Reply = { success(value: unknown): void; fail(value: unknown): void }
const original = 'wxfile://tmp_original.jpg'
const compressed = 'wxfile://tmp_compressed.jpg'
function install(extra: Record<string, unknown> = {}) {
  const removed: string[] = []
  vi.stubGlobal('createImageBitmap', undefined)
  vi.stubGlobal('uni', {
    chooseImage: (o: Reply) => o.success({ tempFiles: [{ path: original, size: 4000 }] }),
    getImageInfo: (o: Reply) => o.success({ width: 1200, height: 900, type: 'jpeg' }),
    compressImage: (o: Reply) => o.success({ tempFilePath: compressed }),
    getFileInfo: (o: Reply) => o.success({ size: 2000 }),
    getFileSystemManager: () => ({ unlink: (o: { filePath: string }) => removed.push(o.filePath) }),
    ...extra,
  })
  return removed
}
beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

describe('native image preparation', () => {
  it('uses inspected PNG metadata instead of labelling every compressed image as JPEG', async () => {
    const removed = install({ getImageInfo: (o: Reply) => o.success({ width: 1200, height: 900, type: 'png' }) })
    const { pickAvatar, releasePickedMedia } = await import('../src/platform/media-picker')
    const value = await pickAvatar()
    expect(value).toMatchObject({ tempFilePath: compressed, size: 2000, mimeType: 'image/png' })
    expect(removed).toEqual([original])
    releasePickedMedia(value!); releasePickedMedia(value!)
    expect(removed).toEqual([original, compressed])
  })
  it('rejects a disguised GIF using the actual native metadata and releases its own file', async () => {
    const removed = install({ getImageInfo: (o: Reply) => o.success({ width: 1200, height: 900, type: 'gif' }) })
    const { pickAvatar } = await import('../src/platform/media-picker')
    await expect(pickAvatar()).rejects.toThrow('仅支持')
    expect(removed).toEqual([original])
  })
  it('rejects invalid image dimensions before compression', async () => {
    const compress = vi.fn((o: Reply) => o.success({ tempFilePath: compressed }))
    install({ getImageInfo: (o: Reply) => o.success({ width: 0, height: 900, type: 'jpeg' }), compressImage: compress })
    const { pickAvatar } = await import('../src/platform/media-picker')
    await expect(pickAvatar()).rejects.toThrow('尺寸')
    expect(compress).not.toHaveBeenCalled()
  })
  it('cannot unlink remote, persistent or unowned paths', async () => {
    const removed = install()
    const { pickAvatar, releasePickedMedia } = await import('../src/platform/media-picker')
    await pickAvatar()
    for (const path of ['https://foreign.example/photo.jpg', 'wxfile://usr/saved.jpg', 'wxfile://tmp_unowned.jpg', '/private/account.json']) {
      releasePickedMedia({ tempFilePath: path, size: 1 })
    }
    expect(removed).toEqual([original])
  })
  it('cleans only the owned compressed output when inspection fails and keeps a validated original', async () => {
    const removed = install({ getFileInfo: (o: Reply) => o.fail({ errMsg: 'stat failed' }) })
    const { pickAvatar } = await import('../src/platform/media-picker')
    expect(await pickAvatar()).toEqual({ tempFilePath: original, size: 4000, mimeType: 'image/jpeg' })
    expect(removed).toEqual([compressed])
  })
  it('discards a compressed output whose actual type is unsupported', async () => {
    const removed = install({ getImageInfo: (o: Reply & { src: string }) => o.success({ width: 1200, height: 900, type: o.src === original ? 'jpeg' : 'gif' }) })
    const { pickAvatar } = await import('../src/platform/media-picker')
    expect(await pickAvatar()).toEqual({ tempFilePath: original, size: 4000, mimeType: 'image/jpeg' })
    expect(removed).toEqual([compressed])
  })
  it('does not reuse stale original metadata when compression overwrites that same path', async () => {
    let inspections = 0
    const removed = install({
      getImageInfo: (o: Reply) => o.success({ width: 1200, height: 900, type: inspections++ === 0 ? 'jpeg' : 'gif' }),
      compressImage: (o: Reply) => o.success({ tempFilePath: original }),
    })
    const { pickAvatar } = await import('../src/platform/media-picker')
    await expect(pickAvatar()).rejects.toThrow('仅支持')
    expect(removed).toEqual([original])
  })
  it('fails closed if native image metadata cannot be inspected', async () => {
    const removed = install({ getImageInfo: undefined })
    const { pickAvatar } = await import('../src/platform/media-picker')
    await expect(pickAvatar()).rejects.toThrow('照片校验')
    expect(removed).toEqual([original])
  })
  it.each(['https://foreign.example/photo.jpg', 'wxfile://usr/saved.jpg', '/private/account.json'])('rejects a non-temporary picker result without deleting it: %s', async path => {
    const removed = install({ chooseImage: (o: Reply) => o.success({ tempFiles: [{ path, size: 4000 }] }) })
    const { pickAvatar } = await import('../src/platform/media-picker')
    await expect(pickAvatar()).rejects.toThrow('临时照片')
    expect(removed).toEqual([])
  })
  it('returns cancellation quietly and gives a permission hint without opening settings', async () => {
    const openSetting = vi.fn()
    install({ chooseImage: (o: Reply) => o.fail({ errMsg: 'chooseImage:fail cancel' }), openSetting })
    const { pickAvatar } = await import('../src/platform/media-picker')
    expect(await pickAvatar()).toBeNull()
    install({ chooseImage: (o: Reply) => o.fail({ errMsg: 'chooseImage:fail auth deny' }), openSetting })
    await expect(pickAvatar()).rejects.toThrow('权限')
    expect(openSetting).not.toHaveBeenCalled()
  })
})
