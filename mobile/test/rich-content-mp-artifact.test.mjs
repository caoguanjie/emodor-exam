import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

// Run after `node scripts/build.mjs mp-weixin`: these assertions inspect the
// emitted platform boundary, where implicit Vue self references can disappear.
const output = fileURLToPath(new URL('../dist/build/mp-weixin/', import.meta.url))
const component = resolve(output, 'components/rich-content/RichNode')

test('the emitted recursive tag resolves to the RichNode mini-program component itself', async () => {
  const [config, template] = await Promise.all([
    readFile(`${component}.json`, 'utf8').then(JSON.parse),
    readFile(`${component}.wxml`, 'utf8'),
  ])
  const recursiveTags = [...template.matchAll(/<(rich-node)\b/g)]
  assert.equal(recursiveTags.length, 3, 'table cells, nested list bodies and ordinary descendants must all recurse')
  assert.equal(typeof config.usingComponents['rich-node'], 'string', 'every emitted rich-node tag needs a usingComponents entry')
  assert.equal(resolve(dirname(component), config.usingComponents['rich-node']), component)
})

test('the emitted component removes its native host so merged cells become grid items', async () => {
  const script = await readFile(`${component}.js`, 'utf8')
  let definition
  // Capture the actual compiled definition at wx.createComponent without
  // launching WeChat. setup/render still belong to the compiled component.
  const vendor = {
    defineComponent: value => value,
    _export_sfc: value => value,
  }
  runInNewContext(script, {
    require: name => {
      assert.equal(name, '../../common/vendor.js')
      return vendor
    },
    wx: { createComponent: value => { definition = value } },
  })
  assert.equal(definition?.options?.virtualHost, true, 'the RichNode host must not sit between table grid and cell view')
})

test('the emitted table keeps horizontal scrolling with styled recursive grid children', async () => {
  const template = await readFile(`${component}.wxml`, 'utf8')
  assert.match(template, /<scroll-view\b[^>]*class="rich-node__table-scroll[^\"]*"[^>]*scroll-x[\s>]/)
  assert.match(template, /<view\b[^>]*class="rich-node__table[^\"]*"[^>]*style="[^\"]+"><rich-node\b/)
  assert.match(template, /<view\b[^>]*wx:else[^>]*class="[^\"]+"[^>]*style="[^\"]+"><rich-node\b/)
})
