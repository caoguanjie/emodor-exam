import {
  Comment,
  Fragment,
  Text,
  defineComponent,
  h,
  mergeProps,
  resolveComponent,
  type VNode,
} from 'vue';
import './style.css';

// A permission-controlled slot may exist but contain only v-if comments.
// Do not leave an empty search/action/pagination strip in that case.
function hasContent(nodes: VNode[]): boolean {
  return nodes.some((node) => {
    if (node.type === Comment) return false;
    if (node.type === Text) return String(node.children ?? '').trim().length > 0;
    if (node.type === Fragment && Array.isArray(node.children)) {
      return hasContent(node.children as VNode[]);
    }
    return true;
  });
}

/** FitsTable's page structure, adapted to RuleExam's existing Element Plus tables. */
export const FitsTable = defineComponent({
  name: 'FitsTable',
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => {
      const search = slots.search?.() ?? [];
      const actions = slots.actions?.() ?? [];
      const body = slots.default?.() ?? [];
      const pagination = slots.pagination?.() ?? [];
      return h('div', mergeProps(attrs, { class: 'fits-table' }), [
        hasContent(search)
          ? h('section', { class: 'fits-table__search', 'aria-label': '查询条件' }, search)
          : null,
        hasContent(actions)
          ? h('div', { class: 'fits-table__actions', role: 'group', 'aria-label': '列表操作' }, actions)
          : null,
        hasContent(body) ? h('div', { class: 'fits-table__body' }, body) : null,
        hasContent(pagination)
          ? h('nav', { class: 'fits-table__pagination', 'aria-label': '分页' }, pagination)
          : null,
      ]);
    };
  },
});

/** Compact row operations; permission-hidden slots leave no empty group. */
export const FitsTableActions = defineComponent({
  name: 'FitsTableActions',
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => {
      const actions = slots.default?.() ?? [];
      return hasContent(actions)
        ? h('div', mergeProps(attrs, {
          class: 'fits-table-actions',
          role: 'group',
          'aria-label': '行操作',
        }), actions)
        : null;
    };
  },
});

/** Element Plus keeps the semantic colors, loading state and native button behavior. */
export const FitsTableAction = defineComponent({
  name: 'FitsTableAction',
  inheritAttrs: false,
  props: {
    type: { type: String, default: 'primary' },
  },
  setup(props, { attrs, slots }) {
    return () => h(resolveComponent('el-button'), mergeProps(attrs, {
      class: 'fits-table-action',
      type: props.type,
      link: true,
      text: false,
      bg: false,
      tag: 'button',
    }), slots);
  },
});

/** Labeled, wrapping search form. Values and query/reset behavior stay in the page. */
export const FitsListSearch = defineComponent({
  name: 'FitsListSearch',
  inheritAttrs: false,
  props: {
    labelWidth: { type: [String, Number], default: '88px' },
  },
  setup(props, { attrs, slots }) {
    return () => {
      const fields = slots.default?.() ?? [];
      const actions = slots.actions?.() ?? [];
      return h(
        resolveComponent('el-form'),
        mergeProps({
          class: 'fits-list-search',
          inline: true,
          labelWidth: props.labelWidth,
          onSubmit: (event: Event) => event.preventDefault(),
        }, attrs),
        {
          default: () => [
            ...fields,
            hasContent(actions)
              ? h(resolveComponent('el-form-item'), { class: 'fits-list-search__actions' }, { default: () => actions })
              : null,
          ],
        },
      );
    };
  },
});
