import { describe, expect, it } from 'vitest'
import rich from '../../tests/fixtures/question-authoring-v3/rich-content.json'
import student from '../../tests/fixtures/question-authoring-v3/student-content.json'
import unsafe from '../../tests/fixtures/question-authoring-v3/unsafe-content.json'
import { validateReadonlyDoc } from '../src/types/content'

const path = '../src/types/' + 'content-v3.ts'
const codec = () => import(path).catch(() => ({
  validateRichDocV3: (_value: unknown): any => { throw new Error('schema 3 not supported') },
  renderableRichNodes: (_value: unknown): any[] => [],
}))
const paragraph = (text = '内容'): any => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...content: any[]): any => ({ type: 'doc', content })
const cell = (colspan = 1, rowspan = 1, colwidth: number[] | null = null): any => ({ type: 'tableCell', attrs: { colspan, rowspan, colwidth, align: null }, content: [paragraph()] })
const row = (...content: any[]): any => ({ type: 'tableRow', content })
const table = (...content: any[]): any => ({ type: 'table', content })

describe('mobile schema 3 content contract', () => {
  it('accepts and rebuilds the same rich fixture as the server without relaxing schema 2', async () => {
    const { validateRichDocV3 } = await codec()
    expect(validateRichDocV3(rich.stem)).toEqual(student.stem)
    expect(validateRichDocV3(rich.options[0].content)).toEqual(student.options[0].content)
    expect(validateReadonlyDoc(rich.stem).ok).toBe(false)
    const original = doc(paragraph()), parsed = validateRichDocV3(original)
    parsed.content[0].content[0].text = 'changed'
    expect(original.content[0].content[0].text).toBe('内容')
  })
  it('projects merged grid positions, ordered list labels and safe font fallback', async () => {
    const { validateRichDocV3, renderableRichNodes } = await codec()
    const nodes = renderableRichNodes(validateRichDocV3(rich.stem))
    expect(nodes[1].children[0].style).toMatchObject({ fontFamily: '"SimSun", "Songti SC", serif', fontSize: '12pt', color: '#aabbcc', backgroundColor: 'rgb(255, 240, 0)' })
    expect(nodes[1].children[2].style).toMatchObject({ verticalAlign: 'super' })
    expect(nodes[1].children[3].style).toMatchObject({ verticalAlign: 'sub' })
    expect(nodes[3].children[0].marker).toBe('C.')
    expect(nodes[6].style.gridTemplateColumns).toBe('80px 100px 120px')
    expect(nodes[6].children.map((node: any) => [node.style.gridRow, node.style.gridColumn])).toEqual([
      ['1 / span 2', '1 / span 1'], ['1 / span 1', '2 / span 2'], ['2 / span 1', '2 / span 1'], ['2 / span 1', '3 / span 1'],
    ])
    expect(nodes[6].children[3].children[0].children[0]).toMatchObject({ type: 'image', assetId: '43' })
  })
  it('retains paragraph text and both levels of the shared nested-list fixture', async () => {
    const { validateRichDocV3, renderableRichNodes } = await codec()
    const nodes = renderableRichNodes(validateRichDocV3(rich.stem))
    expect(nodes[1]).toMatchObject({ type: 'paragraph', children: [{ type: 'text', text: '按要求选择。' }, { type: 'hardBreak' }, { type: 'text', text: '标记' }, { type: 'text', text: '下标' }, { type: 'image', assetId: '42' }] })
    expect(nodes[3]).toMatchObject({ type: 'orderedList', children: [{ type: 'listItem', marker: 'C.', children: [
      { type: 'paragraph', children: [{ type: 'text', text: '检查' }] },
      { type: 'bulletList', children: [{ type: 'listItem', marker: '•', children: [{ type: 'paragraph', children: [{ type: 'text', text: '设备' }] }] }] },
    ] }] })
  })
  it.each(['1', 'a', 'A', 'i', 'I'])('renders ordered list type %s with its start', async type => {
    const { validateRichDocV3, renderableRichNodes } = await codec()
    const labels: Record<string, string> = { '1': '3.', a: 'c.', A: 'C.', i: 'iii.', I: 'III.' }
    const nodes = renderableRichNodes(validateRichDocV3(doc({ type: 'orderedList', attrs: { start: 3, type }, content: [{ type: 'listItem', content: [paragraph()] }] })))
    expect(nodes[0].children[0].marker).toBe(labels[type])
  })
  it.each([
    unsafe,
    doc({ type: 'widgetField', attrs: { checked: true } }),
    doc({ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:x' } }] }] }),
    doc({ type: 'paragraph', content: [{ type: 'image', attrs: { asset_id: '42', src: 'https://bad.test' } }] }),
    doc({ type: 'paragraph', attrs: { style: 'color:red' }, content: [] }),
    doc({ type: 'heading', attrs: { level: 5 } }),
    doc({ type: 'codeBlock', content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }] }] }),
    doc(table(row(cell(1, 2)))),
    doc(table(row(cell(), cell()), row(cell()))),
    doc(table(row(cell(1, 1, [80])), row(cell(1, 1, [81])))),
  ])('rejects unsafe fields and broken grid just as the server %#', async value => {
    const { validateRichDocV3 } = await codec()
    expect(() => validateRichDocV3(value)).toThrow()
  })
  it.each(['Arial', 'url(x)', 'SimSun; color:red'])('rejects unapproved font %s', async fontFamily => {
    const { validateRichDocV3 } = await codec()
    expect(() => validateRichDocV3(doc({ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'textStyle', attrs: { fontFamily } }] }] }))).toThrow()
  })
  it('enforces the server node, depth and text budgets', async () => {
    const { validateRichDocV3 } = await codec()
    expect(validateRichDocV3(doc(...Array.from({ length: 1999 }, () => ({ type: 'paragraph' })))).content).toHaveLength(1999)
    expect(() => validateRichDocV3(doc(...Array.from({ length: 2000 }, () => ({ type: 'paragraph' }))))).toThrow()
    expect(() => validateRichDocV3(doc(paragraph('x'.repeat(100001))))).toThrow()
    let nested = paragraph()
    for (let i = 0; i < 16; i++) nested = { type: 'blockquote', content: [nested] }
    expect(() => validateRichDocV3(doc(nested))).toThrow()
  })
})
