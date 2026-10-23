import { afterEach, describe, expect, it, vi } from 'vitest'
afterEach(() => vi.unstubAllGlobals())
describe('identity media picker', () => {
  it('uses camera only for face, while ID sides honor album selection', async () => {
    const choices: unknown[] = []
    vi.stubGlobal('uni', { chooseImage: (o: { sourceType: string[]; success: (v: unknown) => void }) => { choices.push(o.sourceType); o.success({ tempFilePaths: ['blob:test'], tempFiles: [{ path: 'blob:test', size: 2000, type: 'image/jpeg' }] }) } })
    const { pickIdentityMedia } = await import('../src/platform/media-picker')
    await pickIdentityMedia('face', 'album'); await pickIdentityMedia('portrait', 'album')
    expect(choices).toEqual([['camera'], ['album']])
  })
  it('treats cancel as no material and releases a local object URL', async () => {
    vi.stubGlobal('uni', { chooseImage: (o: { fail: (v: unknown) => void }) => o.fail({ errMsg: 'chooseImage:fail cancel' }) })
    const { pickIdentityMedia, releasePickedMedia } = await import('../src/platform/media-picker')
    expect(await pickIdentityMedia('face', 'camera')).toBeNull()
    const revoke = vi.fn(); vi.stubGlobal('URL', { revokeObjectURL: revoke })
    releasePickedMedia({ tempFilePath: 'blob:owned', size: 10 }); expect(revoke).toHaveBeenCalledWith('blob:owned')
  })
  it('releases the native compressed file if size inspection fails and keeps the valid original', async () => {
    const removed: string[] = []
    vi.stubGlobal('createImageBitmap', undefined)
    vi.stubGlobal('uni', {
      chooseImage: (o: { success: (v: unknown) => void }) => o.success({ tempFiles: [{ path: '/temp/original.jpg', size: 2000, type: 'image/jpeg' }] }),
      getImageInfo: (o: { success: (v: unknown) => void }) => o.success({ width: 2400, height: 1800, type: 'jpeg' }),
      compressImage: (o: { success: (v: unknown) => void }) => o.success({ tempFilePath: '/temp/compressed.jpg' }),
      getFileInfo: (o: { fail: (v: unknown) => void }) => o.fail(new Error('stat failed')),
      getFileSystemManager: () => ({ unlink: (o: { filePath: string }) => removed.push(o.filePath) }),
    })
    const { pickIdentityMedia } = await import('../src/platform/media-picker')
    expect(await pickIdentityMedia('portrait', 'camera')).toMatchObject({ tempFilePath: '/temp/original.jpg' })
    expect(removed).toEqual(['/temp/compressed.jpg'])
  })
})
