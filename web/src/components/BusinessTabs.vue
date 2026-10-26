<template>
  <nav class="business-tabs tabs-bar" aria-label="页面标签">
    <div ref="viewport" class="business-tabs__viewport" @wheel="onWheel">
      <div class="business-tabs__list">
        <div class="business-tabs__item business-tabs__home" :class="{ 'is-active': activePath === homePath }">
          <button
            type="button"
            class="business-tabs__link"
            aria-label="首页"
            :aria-current="activePath === homePath ? 'page' : undefined"
            @click="emit('activate', homePath)"
          >
            <el-icon><House /></el-icon><span>首页</span>
          </button>
        </div>
        <div
          v-for="item in dynamicItems"
          :key="item.path"
          class="business-tabs__item"
          :class="{ 'is-active': item.path === activePath }"
        >
          <button
            type="button"
            class="business-tabs__link"
            :title="item.title"
            :aria-current="item.path === activePath ? 'page' : undefined"
            @click="emit('activate', item.path)"
          >{{ item.title }}</button>
          <button
            v-if="item.closable !== false"
            type="button"
            class="business-tabs__close"
            :aria-label="`关闭${item.title}`"
            @click.stop="emit('close', item.path)"
          ><el-icon><Close /></el-icon></button>
        </div>
      </div>
    </div>
    <el-dropdown
      class="business-tabs__actions"
      trigger="click"
      placement="bottom-end"
      popper-class="business-tabs__menu"
      @command="onAction"
      @visible-change="menuOpen = $event"
    >
      <button
        type="button"
        class="business-tabs__actions-trigger"
        :class="{ 'is-open': menuOpen }"
        aria-label="标签页操作"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
      >
        <span class="business-tabs__more-icon" aria-hidden="true">
          <i class="business-tabs__more-box business-tabs__more-box--top" />
          <i class="business-tabs__more-box" />
        </span>
      </button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item :icon="RefreshActionIcon" command="refresh">刷新</el-dropdown-item>
          <el-dropdown-item :icon="CloseActionIcon" command="current" :disabled="!canCloseCurrent">关闭当前</el-dropdown-item>
          <el-dropdown-item :icon="CloseOthersActionIcon" command="others" :disabled="!canCloseOthers">关闭其它</el-dropdown-item>
          <el-dropdown-item :icon="CloseLeftActionIcon" command="left" :disabled="!canCloseLeft">关闭左侧</el-dropdown-item>
          <el-dropdown-item :icon="CloseRightActionIcon" command="right" :disabled="!canCloseRight">关闭右侧</el-dropdown-item>
          <el-dropdown-item :icon="CloseAllActionIcon" command="all" :disabled="!canCloseAll">关闭所有</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </nav>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, nextTick, ref, watch, type VNode } from 'vue';
import { Close, House } from '@element-plus/icons-vue';

interface TabItem { path: string; title: string; closable?: boolean }
type TabAction = 'refresh' | 'current' | 'others' | 'left' | 'right' | 'all';

const props = defineProps<{ items: readonly TabItem[]; activePath: string; homePath: string }>();
const emit = defineEmits<{
  activate: [path: string];
  close: [path: string];
  action: [action: TabAction];
}>();

const viewport = ref<HTMLElement | null>(null);
const menuOpen = ref(false);

function actionIcon(viewBox: string, children: () => VNode | VNode[]) {
  return defineComponent({
    name: 'BusinessTabActionIcon',
    setup: () => () => h('svg', {
      viewBox,
      width: '1em',
      height: '1em',
      fill: 'none',
      'aria-hidden': 'true',
    }, children()),
  });
}

const RefreshActionIcon = actionIcon('0 0 24 24', () => [
  h('path', { d: 'M20 11a8 8 0 1 0 2 5.3', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round' }),
  h('path', { d: 'M20 4v7h-7', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
]);
const CloseActionIcon = actionIcon('0 0 24 24', () => h('path', { d: 'm7 7 10 10M17 7 7 17', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round' }));
const CloseOthersActionIcon = actionIcon('0 0 24 24', () => [
  h('path', { d: 'M5 5h14M7 9h10v6H7zM5 19h14', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
]);
const CloseLeftActionIcon = actionIcon('0 0 24 24', () => h('path', { d: 'M4 4v16M20 12H8m0 0 5-5m-5 5 5 5', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
const CloseRightActionIcon = actionIcon('0 0 24 24', () => h('path', { d: 'M20 4v16M4 12h12m0 0-5-5m5 5-5 5', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
const CloseAllActionIcon = actionIcon('0 0 24 24', () => [
  h('path', { d: 'M12 3v9', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round' }),
  h('path', { d: 'M7.1 6.4a8 8 0 1 0 9.8 0', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round' }),
]);

const dynamicItems = computed(() => props.items.filter((item) => item.path !== props.homePath));
const activeIndex = computed(() => dynamicItems.value.findIndex((item) => item.path === props.activePath));
const isClosable = (item: TabItem) => item.closable !== false;
const canCloseCurrent = computed(() => activeIndex.value >= 0 && isClosable(dynamicItems.value[activeIndex.value]!));
const canCloseOthers = computed(() => dynamicItems.value.some((item) => item.path !== props.activePath && isClosable(item)));
const canCloseLeft = computed(() => activeIndex.value > 0 && dynamicItems.value.slice(0, activeIndex.value).some(isClosable));
const canCloseRight = computed(() => (
  props.activePath === props.homePath
    ? dynamicItems.value.some(isClosable)
    : activeIndex.value >= 0 && dynamicItems.value.slice(activeIndex.value + 1).some(isClosable)
));
const canCloseAll = computed(() => dynamicItems.value.some(isClosable));

function onAction(action: TabAction) {
  emit('action', action);
}

function onWheel(event: WheelEvent) {
  const element = viewport.value;
  if (!element || element.scrollWidth <= element.clientWidth) return;
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!delta) return;
  event.preventDefault();
  element.scrollLeft += delta;
}

watch([() => props.activePath, () => props.items.map((item) => item.path).join('\n')], async () => {
  await nextTick();
  const element = viewport.value;
  if (!element?.querySelector) return;
  element.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}, { immediate: true });
</script>

<style scoped>
.business-tabs {
  position: relative;
  z-index: 10;
  display: flex;
  flex: none;
  align-items: stretch;
  height: 40px;
  min-width: 0;
  background: var(--re-surface);
  box-shadow: 0 1px 4px rgba(0, 26, 54, .1);
}

.business-tabs__viewport {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.business-tabs__viewport::-webkit-scrollbar { display: none; }
.business-tabs__list { display: flex; align-items: flex-end; width: max-content; min-width: 100%; height: 100%; padding-top: 8px; padding-left: 20px; box-sizing: border-box; }
.business-tabs__item { position: relative; display: flex; flex: none; align-items: center; height: 32px; margin-right: -18px; padding: 0 25px; color: var(--re-text-2); transition: padding .3s cubic-bezier(.645,.045,.355,1), background-color .18s, color .18s; }
.business-tabs__item:first-child { margin-left: 15px; }
.business-tabs__item:last-child { margin-right: 30px; }
.business-tabs__item:hover, .business-tabs__item.is-active {
  z-index: 2;
  -webkit-mask: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAANoAAAAkBAMAAAAdqzmBAAAAMFBMVEVHcEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlTPQ5AAAAD3RSTlMAr3DvEM8wgCBA379gj5//tJBPAAAAnUlEQVRIx2NgAAM27fj/tAO/xBsYkIHyf9qCT8iWMf6nNQhAsk2f5rYheY7Dnua2/U+A28ZEe8v+F9Ax2v7/F4DbxkUH2wzgtvHTwbYPo7aN2jZq26hto7aN2jZq25Cy7Qvctnw62PYNbls9HWz7S8/G6//PsI6H4396gAUQy1je08W2jxDbpv6nD4gB2uWp+J9eYPsEhv/0BPS1DQBvoBLVZ3BppgAAAABJRU5ErkJggg==") 0 0 / 100% 100% no-repeat;
  mask: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAANoAAAAkBAMAAAAdqzmBAAAAMFBMVEVHcEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlTPQ5AAAAD3RSTlMAr3DvEM8wgCBA379gj5//tJBPAAAAnUlEQVRIx2NgAAM27fj/tAO/xBsYkIHyf9qCT8iWMf6nNQhAsk2f5rYheY7Dnua2/U+A28ZEe8v+F9Ax2v7/F4DbxkUH2wzgtvHTwbYPo7aN2jZq26hto7aN2jZq25Cy7Qvctnw62PYNbls9HWz7S8/G6//PsI6H4396gAUQy1je08W2jxDbpv6nD4gB2uWp+J9eYPsEhv/0BPS1DQBvoBLVZ3BppgAAAABJRU5ErkJggg==") 0 0 / 100% 100% no-repeat;
}
.business-tabs__item:hover { z-index: 3; color: var(--re-text); background: var(--re-border); }
.business-tabs__item.is-active { z-index: 4; color: var(--re-primary); background: var(--el-color-primary-light-9); }
.business-tabs__link, .business-tabs__close, .business-tabs__actions-trigger { display: inline-flex; align-items: center; justify-content: center; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.business-tabs__link { gap: 6px; height: 100%; padding: 0; white-space: nowrap; font-size: 12px; font-weight: 500; }
.business-tabs__item.is-active .business-tabs__link { font-weight: 600; }
.business-tabs__close { width: 0; height: 12px; margin-left: 0; padding: 0; overflow: hidden; border-radius: 50%; font-size: 12px; transform-origin: 100% 50%; transition: width .3s cubic-bezier(.645,.045,.355,1), margin-left .3s cubic-bezier(.645,.045,.355,1); }
.business-tabs__item:hover .business-tabs__close, .business-tabs__item.is-active .business-tabs__close { width: 12px; margin-left: 6px; }
.business-tabs__close:hover { color: #fff; background: var(--re-primary); }
.business-tabs__actions { display: flex; flex: 0 0 50px; align-items: center; justify-content: flex-start; width: 50px; }
.business-tabs__actions-trigger { width: 30px; height: 30px; margin-left: 10px; padding: 0; color: #9a9a9a; }
.business-tabs__more-icon { display: inline-block; transition: transform .3s ease-out; }
.business-tabs__more-box { position: relative; display: block; width: 14px; height: 8px; }
.business-tabs__more-box::before, .business-tabs__more-box::after { position: absolute; top: 2px; width: 6px; height: 6px; background: currentColor; content: ''; transition: background-color .2s; }
.business-tabs__more-box::before { left: 0; }
.business-tabs__more-box::after { left: 8px; }
.business-tabs__more-box--top::before { transition: transform .3s ease-out .3s, background-color .2s; }
.business-tabs__actions-trigger.is-open { color: var(--re-primary); }
.business-tabs__actions-trigger.is-open .business-tabs__more-icon { transform: rotate(90deg); }
.business-tabs__actions-trigger.is-open .business-tabs__more-box--top::before { transform: rotate(45deg); }
.business-tabs__actions-trigger:focus-visible, .business-tabs__link:focus-visible, .business-tabs__close:focus-visible { outline: 2px solid var(--re-primary); outline-offset: -2px; }
:global(.business-tabs__menu .el-dropdown-menu__item) { min-width: 108px; height: 27px; padding: 0 15px; color: #606266; font-size: 12px; line-height: 27px; }
:global(.business-tabs__menu .el-dropdown-menu__item .el-icon) { width: 14px; margin-right: 8px; font-size: 14px; }
</style>
