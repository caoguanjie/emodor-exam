import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createRenderer, h, nextTick, ref } from '@vue/runtime-core';

const webRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const componentPath = resolve(webRoot, 'src/components/MediaUpload.vue');
const apiPath = resolve(webRoot, 'src/api/media.ts');
const httpPath = resolve(webRoot, 'src/api/http.ts');
const mediaStubId = '\0media-api-component-test';
const httpStubId = '\0media-http-component-test';
const clientComponentId = '\0media-upload-component-client-test';

const testContext = {
  limits: {
    video_max_bytes: 512 * 1024 * 1024,
    image_max_bytes: 10 * 1024 * 1024,
    probe_timeout_ms: 30_000,
    allowed_image_types: ['image/png'],
    allowed_video_types: ['video/mp4'],
  },
  upload: null,
  metadata: null,
  calls: [],
  httpConfig: null,
};
let clientComponentCode = '';

const mediaStubCode = `
  const context = globalThis.__mediaUploadComponentTest;
  export async function getMediaLimits() { return context.limits; }
  export async function uploadMedia(file, purpose, options) {
    context.calls.push({ file, purpose, options });
    return context.upload(file, purpose, options);
  }
  export async function getMediaMetadata(assetId) { return context.metadata(assetId); }
  export async function getMediaImageContent() { throw new Error('image preview not used by this test'); }
`;

const httpStubCode = `
  const context = globalThis.__mediaUploadComponentTest;
  export default {
    async post(url, form, config) {
      context.httpConfig = { url, form, config };
      return { asset_id: 'asset-timeout', status: 'ready', duration_ms: null };
    },
    async get() { return context.limits; },
  };
`;

let vite;
let MediaUpload;

function testPlugin() {
  return {
    name: 'media-upload-component-test-stubs',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === '../api/media' && importer?.includes('/src/components/MediaUpload.vue')) return mediaStubId;
      if (source === '/src/api/media.ts' && importer === clientComponentId) return mediaStubId;
      if (source === './http' && importer?.includes('/src/api/media.ts')) return httpStubId;
      if (source === clientComponentId) return clientComponentId;
      return undefined;
    },
    load(id) {
      if (id === mediaStubId) return mediaStubCode;
      if (id === httpStubId) return httpStubCode;
      if (id === clientComponentId) return clientComponentCode;
      return undefined;
    },
  };
}

function createHost() {
  return createRenderer({
    patchProp(node, key, _previous, value) {
      node.props[key] = value;
    },
    insert(node, parent, anchor = null) {
      node.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index >= 0) parent.children.splice(index, 0, node);
      else parent.children.push(node);
    },
    remove(node) {
      const index = node.parent?.children.indexOf(node) ?? -1;
      if (index >= 0) node.parent.children.splice(index, 1);
      node.parent = null;
    },
    createElement(type) {
      return { type, props: {}, children: [], parent: null, text: '' };
    },
    createText(text) {
      return { type: '#text', props: {}, children: [], parent: null, text };
    },
    createComment(text) {
      return { type: '#comment', props: {}, children: [], parent: null, text };
    },
    setText(node, text) { node.text = text; },
    setElementText(node, text) { node.text = text; node.children = []; },
    parentNode(node) { return node.parent; },
    nextSibling(node) {
      const index = node.parent?.children.indexOf(node) ?? -1;
      return index >= 0 ? node.parent.children[index + 1] || null : null;
    },
    querySelector() { return null; },
    setScopeId() {},
    cloneNode(node) { return { ...node, props: { ...node.props }, children: [...node.children] }; },
    insertStaticContent(content, parent, anchor) {
      const node = { type: '#static', props: {}, children: [], parent: null, text: content };
      this.insert(node, parent, anchor);
      return [node, node];
    },
  });
}

function findNode(root, type) {
  if (!root) return null;
  if (root.type === type) return root;
  for (const child of root.children || []) {
    const found = findNode(child, type);
    if (found) return found;
  }
  return null;
}

function triggerFile(root, file) {
  const input = findNode(root, 'input');
  assert.ok(input, 'component should render a file input');
  const handler = input.props.onChange;
  assert.equal(typeof handler, 'function', 'file input should have a change handler');
  handler({ target: { files: [file] } });
}

function waitFor(predicate, timeoutMs = 1800, label = 'component state') {
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    const check = () => {
      if (predicate()) return resolvePromise();
      if (Date.now() - started >= timeoutMs) return reject(new Error(`timed out waiting for ${label}`));
      setTimeout(check, 10);
    };
    check();
  });
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolveValue) => { resolvePromise = resolveValue; });
  return { promise, resolve: resolvePromise };
}

async function mountComponent({ ownerId = 'owner-100', purpose = 'avatar', assetId = null, updates = [], uploaded = [], statuses = [] } = {}) {
  const host = createHost();
  const root = { type: 'root', props: {}, children: [], parent: null, text: '' };
  const owner = ref(ownerId);
  const currentPurpose = ref(purpose);
  const boundAsset = ref(assetId);
  const Parent = {
    setup() {
      return () => h(MediaUpload, {
        modelValue: boundAsset.value,
        ownerId: owner.value,
        purpose: currentPurpose.value,
        'onUpdate:modelValue': (value) => updates.push(value),
        onUploaded: (value) => uploaded.push(value),
        onStatus: (value) => statuses.push(value),
      });
    },
  };
  host.render(h(Parent), root);
  await nextTick();
  return { host, root, owner, currentPurpose, boundAsset, unmount: () => host.render(null, root) };
}

before(async () => {
  globalThis.__mediaUploadComponentTest = testContext;
  vite = await createServer({
    root: webRoot,
    configFile: resolve(webRoot, 'vite.config.ts'),
    server: { middlewareMode: true },
    appType: 'custom',
    plugins: [testPlugin()],
  });
  // Feed the browser-compiled SFC through Vite's SSR loader only as a Node
  // module transport. This keeps the actual client render function and avoids
  // SSR-only context calls while still exercising the real component source.
  const transformed = await vite.transformRequest('/src/components/MediaUpload.vue');
  assert.ok(transformed?.code, 'Vite should compile the real MediaUpload SFC');
  clientComponentCode = transformed.code
    .replace(/^import \{ createHotContext[\s\S]*?import\.meta\.hot = [^;]+;\s*/, '')
    .replace(/typeof __VUE_HMR_RUNTIME__[\s\S]*?(?=import _export_sfc)/, '')
    .replace(/from "\/node_modules\/\.vite\/deps\/vue\.js[^\"]*"/g, 'from "vue"');
  const loaded = await vite.ssrLoadModule(clientComponentId);
  MediaUpload = loaded.default;
});

after(async () => {
  delete globalThis.__mediaUploadComponentTest;
  await vite?.close();
});

beforeEach(() => {
  testContext.upload = null;
  testContext.metadata = null;
  testContext.calls = [];
  testContext.httpConfig = null;
});

test('emits model binding when processing media becomes ready', async () => {
  const file = new File(['video'], 'lesson.mp4', { type: 'video/mp4' });
  let metadataCalls = 0;
  testContext.upload = async () => ({ asset_id: 'asset-processing', status: 'processing', duration_ms: null });
  testContext.metadata = async (assetId) => {
    metadataCalls += 1;
    return {
      asset_id: assetId,
      purpose: 'video',
      media_kind: 'video',
      original_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      sha256: 'hash',
      status: metadataCalls === 1 ? 'processing' : 'ready',
      duration_ms: 12_000,
      probe_error: null,
      created_at: new Date().toISOString(),
    };
  };
  const updates = [];
  const mounted = await mountComponent({ purpose: 'video', updates });
  triggerFile(mounted.root, file);
  await waitFor(() => metadataCalls >= 2);
  assert.deepEqual(updates, ['asset-processing']);
  mounted.unmount();
});

test('invalidates an in-flight upload when owner or purpose changes', async () => {
  const file = new File(['image'], 'portrait.png', { type: 'image/png' });
  const pending = deferred();
  testContext.upload = async () => pending.promise;
  testContext.metadata = async () => ({ status: 'ready' });
  const updates = [];
  const mounted = await mountComponent({ ownerId: 'owner-100', purpose: 'avatar', updates });
  triggerFile(mounted.root, file);
  await waitFor(() => testContext.calls.length === 1);
  mounted.owner.value = 'owner-200';
  mounted.currentPurpose.value = 'video';
  await nextTick();
  assert.equal(testContext.calls[0].options.signal.aborted, true);
  pending.resolve({ asset_id: 'asset-old', status: 'ready', duration_ms: null });
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.deepEqual(updates, []);
  mounted.unmount();
});

test('loads the latest non-empty binding once when owner and model change in one tick', async () => {
  const pending = new Map();
  const statuses = [];
  testContext.metadata = async (assetId) => {
    const request = deferred();
    pending.set(assetId, request);
    return request.promise;
  };
  const mounted = await mountComponent({ ownerId: 'owner-100', assetId: 'asset-100', statuses });
  await waitFor(() => pending.has('asset-100'), 1800, 'asset-100 request');

  mounted.owner.value = 'owner-200';
  mounted.boundAsset.value = 'asset-200';
  await nextTick();
  await waitFor(() => pending.has('asset-200'), 1800, 'asset-200 request');

  const ready = (assetId) => ({
    asset_id: assetId,
    purpose: 'avatar',
    media_kind: 'image',
    original_name: `${assetId}.png`,
    mime_type: 'image/png',
    size_bytes: 4,
    sha256: 'hash',
    status: 'ready',
    duration_ms: null,
    probe_error: null,
    created_at: new Date().toISOString(),
  });
  pending.get('asset-100').resolve(ready('asset-100'));
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  pending.get('asset-200').resolve(ready('asset-200'));
  await waitFor(() => statuses.some((value) => value.asset_id === 'asset-200'), 1800, 'asset-200 ready status');
  assert.deepEqual(statuses.map((value) => value.asset_id), ['asset-200']);
  mounted.unmount();
});

test('uses an upload-specific unlimited timeout while preserving cancellation', async () => {
  const mediaApi = await vite.ssrLoadModule(`${apiPath}?timeout-test`);
  const file = new File(['video'], 'lesson.mp4', { type: 'video/mp4' });
  const controller = new AbortController();
  await mediaApi.uploadMedia(file, 'video', { signal: controller.signal });
  assert.equal(testContext.httpConfig.config.timeout, 0);
  assert.equal(testContext.httpConfig.config.signal, controller.signal);
  const httpSource = await readFile(httpPath, 'utf8');
  assert.match(httpSource, /timeout:\s*60000/);
});
