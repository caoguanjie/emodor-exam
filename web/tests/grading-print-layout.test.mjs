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

function hasStaticClass(node, name) {
  if (node?.type !== 1) return false;
  const attribute = node.props?.find((prop) => prop.type === 6 && prop.name === 'class');
  return attribute?.value?.content.split(/\s+/).includes(name) || false;
}

function findTemplateNode(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const match = findTemplateNode(child, predicate);
    if (match) return match;
  }
  return null;
}

function staticAttribute(node, name) {
  const attribute = node?.props?.find((prop) => prop.type === 6 && prop.name === name);
  return attribute?.value?.content;
}

function boundAttributeExpression(node, name) {
  const binding = node?.props?.find((prop) => (
    prop.type === 7
    && prop.name === 'bind'
    && prop.arg?.type === 4
    && prop.arg.content === name
  ));
  return binding?.exp?.loc?.source || binding?.exp?.content || '';
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

let productionCssPromise;
async function productionCss() {
  if (!productionCssPromise) {
    productionCssPromise = build({
      root: webRoot,
      configFile: resolve(webRoot, 'vite.config.ts'),
      logLevel: 'silent',
      build: { write: false, minify: false, cssMinify: false },
    }).then((result) => {
      const outputs = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry.output || []);
      return outputs
        .filter((entry) => entry.type === 'asset' && entry.fileName.endsWith('.css'))
        .map((entry) => typeof entry.source === 'string' ? entry.source : new TextDecoder().decode(entry.source))
        .join('\n');
    });
  }
  return productionCssPromise;
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

test('paper preview print isolates the active dialog and releases every paginating ancestor', async () => {
  const paperSource = await readFile(resolve(webRoot, 'src/views/admin/PaperDetail.vue'), 'utf8');
  const paper = parseSfc(paperSource, { filename: 'PaperDetail.vue' }).descriptor;
  assert.ok(paper.template?.ast, 'PaperDetail template must compile');

  const host = findTemplateNode(paper.template.ast, (node) => hasStaticClass(node, 'paper-detail'));
  assert.ok(host, 'real paper detail template must expose the print host');
  assert.match(
    boundAttributeExpression(host, 'class'),
    /paper-preview-open[\s\S]*previewVisible/,
    'the host must identify only an open preview as printable',
  );

  const dialog = findTemplateNode(paper.template.ast, (node) => hasStaticClass(node, 'paper-preview-dialog'));
  assert.ok(dialog, 'real paper detail template must expose the preview dialog');
  assert.equal(
    staticAttribute(dialog, 'modal-class'),
    'paper-preview-overlay',
    'the preview overlay needs a stable print boundary distinct from other dialogs',
  );
  assert.ok(
    findTemplateNode(dialog, (node) => hasStaticClass(node, 'preview-difficulty-print')),
    'the selected sample difficulty must remain visible when its filter is hidden',
  );

  const root = postcss.parse(await productionCss());
  assertImportantDeclaration(root, '.paper-detail.paper-preview-open > :not(.paper-preview-overlay)', 'display', 'none');
  assertImportantDeclaration(root, '.paper-detail.paper-preview-open > .el-overlay', 'display', 'none');
  assertImportantDeclaration(root, '.paper-detail.paper-preview-open > .paper-preview-overlay', 'display', 'block');

  for (const selector of [
    '.paper-detail.paper-preview-open > .paper-preview-overlay',
    '.paper-preview-overlay .el-overlay-dialog',
    '.paper-preview-overlay .paper-preview-dialog',
    '.paper-preview-overlay .el-dialog__body',
  ]) {
    assertImportantDeclaration(root, selector, 'height', 'auto');
    assertImportantDeclaration(root, selector, 'max-height', 'none');
    assertImportantDeclaration(root, selector, 'overflow', 'visible');
  }
  for (const selector of [
    '.paper-detail.paper-preview-open > .paper-preview-overlay',
    '.paper-preview-overlay .el-overlay-dialog',
  ]) {
    assertImportantDeclaration(root, selector, 'position', 'static');
  }
  assertImportantDeclaration(root, '.paper-preview-overlay .paper-preview-dialog', 'width', '100%');
  assertImportantDeclaration(root, '.paper-preview-overlay .paper-preview-dialog', 'margin', '0');
  assertImportantDeclaration(root, '.paper-preview-overlay .el-button', 'display', 'none');
  assertImportantDeclaration(root, '.paper-preview-overlay .el-dialog__footer', 'display', 'none');
  assertImportantDeclaration(root, '.paper-preview-overlay .el-dialog__headerbtn', 'display', 'none');
  assertImportantDeclaration(root, '.paper-preview-overlay .preview-difficulty .el-radio-group', 'display', 'none');
  assertImportantDeclaration(root, '.paper-preview-overlay .preview-difficulty-print', 'display', 'inline');
  assertImportantDeclaration(root, '.paper-preview-overlay .preview-question', 'break-inside', 'avoid');
});
