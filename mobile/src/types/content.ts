export type ReadonlyInlineNode =
  | { type: 'text'; text: string }
  | { type: 'hardBreak' }
  | { type: 'image'; attrs: { asset_id: string } }
export interface ReadonlyTiptapDoc {
  type: 'doc'
  content: ({ type: 'paragraph'; content?: ReadonlyInlineNode[] } | Extract<ReadonlyInlineNode, { type: 'image' }>)[]
}
export type RenderableInline = { type: 'text'; text: string } | { type: 'hardBreak' } | { type: 'image'; assetId: string }
export type RenderableNode = { type: 'paragraph'; children: RenderableInline[] } | { type: 'image'; assetId: string } | { type: 'unsupported' }

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function onlyKeys(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).every(key => keys.includes(key)) }
function validInline(value: unknown): boolean {
  if (!record(value)) return false
  if (value.type === 'text') return onlyKeys(value, ['type', 'text']) && typeof value.text === 'string'
  if (value.type === 'hardBreak') return onlyKeys(value, ['type'])
  return value.type === 'image' && onlyKeys(value, ['type', 'attrs']) && record(value.attrs)
    && onlyKeys(value.attrs, ['asset_id']) && typeof value.attrs.asset_id === 'string'
    && /^[A-Za-z0-9_-]{1,128}$/.test(value.attrs.asset_id)
}
export function validateReadonlyDoc(doc: unknown, options: { decimalAssetIds?: boolean } = {}): { ok: boolean } {
  const ok = record(doc) && onlyKeys(doc, ['type', 'content']) && doc.type === 'doc' && Array.isArray(doc.content)
    && doc.content.length <= 2000 && doc.content.every(node => {
      if (!record(node)) return false
      if (node.type === 'image') return validInline(node)
      return node.type === 'paragraph' && onlyKeys(node, ['type', 'content'])
        && (node.content === undefined || (Array.isArray(node.content) && node.content.length <= 2000 && node.content.every(validInline)))
    })
  let count = 0, textLength = 0, validAssets = true
  function visit(value: unknown, depth = 1) {
    if (!record(value)) return
    count++
    if (depth > 4) validAssets = false
    if (value.type === 'text') textLength += typeof value.text === 'string' ? value.text.length : 0
    if (value.type === 'image' && options.decimalAssetIds && (!record(value.attrs) || typeof value.attrs.asset_id !== 'string' || !/^[1-9]\d*$/.test(value.attrs.asset_id))) validAssets = false
    if (Array.isArray(value.content)) value.content.forEach(child => visit(child, depth + 1))
  }
  if (ok) visit(doc)
  return { ok: !!ok && count <= 2000 && textLength <= 100000 && validAssets }
}
export function renderableNodes(doc: unknown): RenderableNode[] {
  if (!validateReadonlyDoc(doc).ok) return [{ type: 'unsupported' }]
  const inline = (node: ReadonlyInlineNode): RenderableInline => node.type === 'image'
    ? { type: 'image', assetId: node.attrs.asset_id } : node
  return (doc as ReadonlyTiptapDoc).content.map(node => node.type === 'paragraph'
    ? { type: 'paragraph', children: (node.content || []).map(inline) }
    : { type: 'image', assetId: node.attrs.asset_id })
}
export type ReadonlyContentDoc = ReadonlyTiptapDoc | import('./content-v3').ReadonlyRichDocV3
export function textDoc(text: string): ReadonlyTiptapDoc { return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }
