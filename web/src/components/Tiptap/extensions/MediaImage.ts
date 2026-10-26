import { mergeAttributes, Node } from '@tiptap/core';
import { isEditorMutationAllowed } from '../utils/widgetNodeViewRegistry';
import { assertControlledMediaUrl, invalidatePcMedia } from '../../../services/media-content';
import { isMediaContextCurrent, mediaContext, onMediaContextChange } from '../../../services/media-context';

export type MediaResolver = (assetId: string) => Promise<string | Blob>;

interface MediaImageOptions {
  mediaResolver?: MediaResolver;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mediaImage: {
      insertMediaImage: (attrs: { asset_id: string; alt?: string | null }) => ReturnType;
    };
  }
}

const MAX_UNSIGNED_BIGINT = 18_446_744_073_709_551_615n;

export function isControlledMediaAssetId(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return false;
  try {
    return BigInt(value) <= MAX_UNSIGNED_BIGINT;
  } catch {
    return false;
  }
}

function normalizeAlt(value: unknown): string | null {
  return typeof value === 'string' && Array.from(value).length <= 500 ? value : null;
}

export const MediaImage = Node.create<MediaImageOptions>({
  name: 'mediaImage',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { mediaResolver: undefined };
  },

  addAttributes() {
    return {
      asset_id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-media-id'),
        renderHTML: (attributes) => (
          isControlledMediaAssetId(attributes.asset_id)
            ? { 'data-media-id': attributes.asset_id }
            : {}
        ),
      },
      alt: {
        default: null,
        parseHTML: (element) => normalizeAlt(element.getAttribute('alt')),
        renderHTML: (attributes) => {
          const alt = normalizeAlt(attributes.alt);
          return alt === null || alt === '' ? {} : { alt };
        },
      },
    };
  },

  parseHTML() {
    return [{
      tag: 'img[data-media-id]',
      getAttrs: (element) => (
        element instanceof HTMLElement
        && isControlledMediaAssetId(element.getAttribute('data-media-id'))
          ? null
          : false
      ),
    }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.className = 'question-media-placeholder';
      dom.contentEditable = 'false';
      dom.dataset.controlledMediaPlaceholder = 'true';
      const statusText = document.createTextNode('');
      const resolver = this.options.mediaResolver;
      let assetId: unknown = node.attrs.asset_id;
      let alt: unknown = node.attrs.alt;
      let state: 'placeholder' | 'loading' | 'loaded' | 'error' = 'placeholder';
      let image: HTMLImageElement | null = null;
      let objectUrl: string | null = null;
      let generation = 0;
      let destroyed = false;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = '重试图片';
      retry.onmousedown = event => event.preventDefault();
      retry.onclick = event => { event.preventDefault(); if (isControlledMediaAssetId(assetId)) invalidatePcMedia(assetId); load(); };

      const render = () => {
        const id = isControlledMediaAssetId(assetId) ? assetId : '无效资源';
        const label = normalizeAlt(alt);
        dom.dataset.mediaId = id;
        dom.dataset.mediaState = state;
        dom.dataset.controlledMediaPlaceholder = String(state !== 'loaded');
        dom.setAttribute('role', 'img');
        dom.setAttribute('aria-label', label || `受控图片资源 ${id}`);
        const description = label ? `图片：${label}（资源 ${id}）` : `受控图片资源 ${id}`;
        const message = state === 'loading'
          ? `图片加载中：${label || id}`
          : state === 'error' ? `图片加载失败：${label || id}` : description;
        statusText.textContent = message;
        if (image) {
          image.alt = label || '';
          image.hidden = state !== 'loaded';
          if (image.parentNode !== dom) dom.replaceChildren(image);
          if (state === 'loaded') statusText.remove();
          else if (statusText.parentNode !== dom) dom.append(statusText);
        } else {
          dom.replaceChildren(statusText);
        }
        if (state === 'error' && resolver) dom.append(retry);
        dom.dispatchEvent(new CustomEvent('controlled-media-state', { bubbles: true }));
      };

      const releaseImage = () => {
        if (image) {
          image.onload = null;
          image.onerror = null;
          image.removeAttribute('src');
          image.remove();
          image = null;
        }
        if (objectUrl !== null) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
      };

      const load = () => {
        const request = ++generation;
        releaseImage();
        state = 'placeholder';
        if (!resolver || !isControlledMediaAssetId(assetId)) {
          render();
          return;
        }
        const requestedAssetId = assetId;
        const context = mediaContext();
        const isCurrent = () => !destroyed && request === generation && isMediaContextCurrent(context);
        state = 'loading';
        render();
        void Promise.resolve()
          .then(() => isCurrent() ? resolver(requestedAssetId) : undefined)
          .then((source) => {
            // A stale Blob never gets an ObjectURL, including after this NodeView is destroyed.
            if (!isCurrent() || source === undefined) return;
            const sourceUrl = typeof source === 'string' ? assertControlledMediaUrl(source) : (objectUrl = URL.createObjectURL(source));
            const resolvedImage = document.createElement('img');
            image = resolvedImage;
            resolvedImage.style.maxWidth = '100%';
            const loaded = () => {
              if (!isCurrent() || image !== resolvedImage) return;
              state = 'loaded';
              render();
            };
            const failed = () => {
              if (!isCurrent() || image !== resolvedImage) return;
              releaseImage();
              state = 'error';
              render();
            };
            resolvedImage.onload = () => {
              if (!isCurrent() || image !== resolvedImage) return;
              if (typeof resolvedImage.decode !== 'function') loaded();
              else void Promise.resolve().then(() => resolvedImage.decode()).then(loaded, failed);
            };
            resolvedImage.onerror = failed;
            render();
            resolvedImage.src = sourceUrl;
          })
          .catch(() => {
            if (!isCurrent()) return;
            releaseImage();
            state = 'error';
            render();
          });
      };
      const unsubscribeContext = onMediaContextChange(() => {
        generation += 1;
        releaseImage();
        state = 'error';
        render();
      });
      load();

      return {
        dom,
        update: (nextNode) => {
          if (nextNode.type.name !== this.name) return false;
          const assetChanged = assetId !== nextNode.attrs.asset_id;
          assetId = nextNode.attrs.asset_id;
          alt = nextNode.attrs.alt;
          if (assetChanged) load();
          else render();
          return true;
        },
        ignoreMutation: () => true,
        stopEvent: () => true,
        destroy: () => {
          destroyed = true;
          generation += 1;
          unsubscribeContext();
          releaseImage();
        },
      };
    };
  },

  addCommands() {
    return {
      insertMediaImage: (attrs) => ({ commands, editor }) => {
        if (!isEditorMutationAllowed(editor) || !isControlledMediaAssetId(attrs.asset_id)) return false;
        if (attrs.alt !== undefined && attrs.alt !== null && normalizeAlt(attrs.alt) === null) return false;
        return commands.insertContent({
          type: this.name,
          attrs: { asset_id: attrs.asset_id, alt: attrs.alt ?? null },
        });
      },
    };
  },
});
