import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { parse as parseSfc } from '@vue/compiler-sfc';
import { build } from 'vite';

const webRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));

function collectStaticClasses(node, classes = new Set()) {
  if (!node || typeof node !== 'object') return classes;
  if (node.type === 1) {
    for (const prop of node.props || []) {
      if (prop.type === 6 && prop.name === 'class' && prop.value) {
        for (const name of prop.value.content.split(/\s+/).filter(Boolean)) classes.add(name);
      }
    }
  }
  for (const child of node.children || []) collectStaticClasses(child, classes);
  return classes;
}

function isInsidePrintMedia(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && parent.name.toLowerCase() === 'media') {
      return /(^|[\s,(])print([\s),]|$)/i.test(parent.params);
    }
  }
  return false;
}

function declarationsFor(root, selector) {
  const declarations = new Map();
  root.walkRules((rule) => {
    if (!isInsidePrintMedia(rule)) return;
    const selectors = rule.selectors || rule.selector.split(',').map((value) => value.trim());
    if (!selectors.includes(selector)) return;
    rule.walkDecls((declaration) => declarations.set(declaration.prop, declaration));
  });
  return declarations;
}

function assertImportantDeclaration(root, selector, property, value) {
  const declaration = declarationsFor(root, selector).get(property);
  assert.ok(declaration, `${selector} must set ${property} in print media`);
  assert.equal(declaration.value, value, `${selector} must set ${property}: ${value}`);
  assert.equal(declaration.important, true, `${selector} print ${property} must override screen layout`);
}

async function productionCss() {
  const result = await build({
    root: webRoot,
    configFile: resolve(webRoot, 'vite.config.ts'),
    logLevel: 'silent',
    build: { write: false, minify: false, cssMinify: false },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry.output || []);
  return outputs
    .filter((entry) => entry.type === 'asset' && entry.fileName.endsWith('.css'))
    .map((entry) => typeof entry.source === 'string' ? entry.source : new TextDecoder().decode(entry.source))
    .join('\n');
}

test('grading print stylesheet releases the real application shell for paginated output', async () => {
  const layoutSource = await readFile(resolve(webRoot, 'src/layouts/MainLayout.vue'), 'utf8');
  const gradingSource = await readFile(resolve(webRoot, 'src/views/admin/GradingDetail.vue'), 'utf8');
  const layout = parseSfc(layoutSource, { filename: 'MainLayout.vue' }).descriptor;
  const grading = parseSfc(gradingSource, { filename: 'GradingDetail.vue' }).descriptor;
  assert.ok(layout.template?.ast, 'MainLayout template must compile');
  assert.ok(grading.template?.ast, 'GradingDetail template must compile');

  const layoutClasses = collectStaticClasses(layout.template.ast);
  for (const name of ['shell', 'aside', 'content-shell', 'header', 'tabs-bar', 'main', 'page-enter']) {
    assert.ok(layoutClasses.has(name), `real shell template must expose .${name}`);
  }
  const gradingClasses = collectStaticClasses(grading.template.ast);
  for (const name of ['detail-toolbar', 'summary', 'question-card']) {
    assert.ok(gradingClasses.has(name), `real grading template must expose .${name}`);
  }

  const css = await productionCss();
  assert.match(css, /\.detail-toolbar\[/, 'production CSS must contain GradingDetail scoped styles');
  const root = postcss.parse(css);

  for (const selector of ['.aside', '.header', '.tabs-bar']) {
    assertImportantDeclaration(root, selector, 'display', 'none');
  }
  for (const selector of ['html', 'body', '#app', '.shell', '.content-shell', '.main', '.page-enter']) {
    assertImportantDeclaration(root, selector, 'height', 'auto');
    assertImportantDeclaration(root, selector, 'overflow', 'visible');
  }
  for (const selector of ['.shell', '.content-shell', '.main', '.page-enter']) {
    assertImportantDeclaration(root, selector, 'display', 'block');
  }
});
