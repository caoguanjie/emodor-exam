import { describe, expect, it } from 'vitest'

const modulePath = '../src/types/' + 'content.ts'

describe('restricted learner rich content', () => {
  it('accepts paragraphs, literal text, line breaks and controlled image identities', async () => {
    const { validateReadonlyDoc = () => ({ ok: false }) } = await import(modulePath).catch(() => ({}))
    expect(validateReadonlyDoc({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: '<b>literal text</b>' }, { type: 'hardBreak' },
      { type: 'image', attrs: { asset_id: 'training-sign-a' } },
    ] }] })).toEqual({ ok: true })
  })

  it.each([
    { type: 'doc', content: [{ type: 'script', text: 'alert(1)' }] },
    { type: 'doc', content: [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }] },
    { type: 'doc', content: [{ type: 'image', attrs: { asset_id: '../../secret', src: 'https://untrusted.test' } }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] },
    { type: 'paragraph', content: [] },
    null,
  ])('rejects unsupported or unsafe input %#', async (doc) => {
    const { validateReadonlyDoc = () => ({ ok: true }) } = await import(modulePath).catch(() => ({}))
    expect(validateReadonlyDoc(doc)).toEqual({ ok: false })
  })

  it('produces plain text runs and image references without an HTML execution path', async () => {
    const { renderableNodes = () => [] } = await import(modulePath).catch(() => ({}))
    expect(renderableNodes({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: '<script>alert(1)</script>' }, { type: 'hardBreak' },
      { type: 'image', attrs: { asset_id: 'sign-a' } },
    ] }] })).toEqual([{ type: 'paragraph', children: [
      { type: 'text', text: '<script>alert(1)</script>' }, { type: 'hardBreak' }, { type: 'image', assetId: 'sign-a' },
    ] }])
    expect(renderableNodes({ type: 'doc', content: [{ type: 'script' }] })).toEqual([{ type: 'unsupported' }])
  })

  it('enforces decimal production media IDs and total node/text limits across all paragraphs', async () => {
    const { validateReadonlyDoc } = await import(modulePath)
    expect(validateReadonlyDoc({ type: 'doc', content: [{ type: 'image', attrs: { asset_id: '901' } }] }, { decimalAssetIds: true }).ok).toBe(true)
    expect(validateReadonlyDoc({ type: 'doc', content: [{ type: 'image', attrs: { asset_id: 'static-alias' } }] }, { decimalAssetIds: true }).ok).toBe(false)
    expect(validateReadonlyDoc({ type: 'doc', content: Array.from({ length: 1000 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: 'x' }, { type: 'hardBreak' }] })) }).ok).toBe(false)
    expect(validateReadonlyDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(50001) }] }, { type: 'paragraph', content: [{ type: 'text', text: 'y'.repeat(50000) }] }] }).ok).toBe(false)
  })
})
