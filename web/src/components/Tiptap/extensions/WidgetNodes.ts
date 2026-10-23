
import { Content, Editor, Node } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import FieldComponent from '../widget/FieldComponent.vue'
import { findChildren, findParentNode } from 'prosemirror-utils';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { customAlphabet } from 'nanoid'
import { nextTick } from 'vue';
import { AlignType, ControlType, ControlTypeName, TemplateControl, OptionType } from '../type';
import { getNodeView, isEditorMutationAllowed } from '../utils/widgetNodeViewRegistry';



declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        widgetNodes: {
            /**
             * 插入小部件
             * @example editor.commands.insertField()
             */
            insertField: (attrs: Partial<TemplateControl>) => ReturnType,
            /**
             * 更新小部件
             * @example editor.commands.updateField('field_123456', { placeholder: '请输入内容' })
             */
            updateField: (id: string, attrs: Partial<TemplateControl>) => ReturnType,
            /**
             * 校验必填字段
             * @example editor.commands.validateField()
             */
            validateField: () => ReturnType,
            /**
             * 插入文本内容
             * @example editor.commands.insertFieldText() // 插入文本内容
             */
            insertFieldText: (id: string, text: string | OptionType | OptionType[]) => ReturnType,
            /**
             * 更新单选多选的属性值
             * @example editor.commands.updateFieldChecked()
             * @param id 组件id
             * @param group 单选多选组id
             * @param updateParams 更新参数，包含label和value、selected、排序布局layout
             */
            updateFieldAttrs: (id: string, group: string | null, updateParams: {
                label?: string; value?: any; checked?: boolean, layout?: number
            }) => ReturnType,
            /**
             * 更新选项，大部分情况是为了单选和多选应用的
             * @example editor.commands.updateDynamicOptions()
             */
            updateDynamicOptions: (group: string | null, dynamicOptions: OptionType[], options: string) => ReturnType,

        }
    }
}
const WIDGET_ID_LENGTH = 21;
const TYPE_NAME_MAX_CODE_POINTS = 64;

// 21 位随机标识符合正式题目协议的最小长度，复制/题目归属重映射留给 Q4-F。
export const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', WIDGET_ID_LENGTH)

function getIntegerAttribute(
    element: HTMLElement,
    name: string,
    fallback: number,
    min = Number.MIN_SAFE_INTEGER,
    max = Number.MAX_SAFE_INTEGER,
): number {
    const raw = element.getAttribute(name);
    if (raw === null || !/^-?\d+$/.test(raw)) return fallback;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}

function getFlagAttribute(element: HTMLElement, name: string, fallback: 0 | 1): 0 | 1 {
    return getIntegerAttribute(element, name, fallback, 0, 1) as 0 | 1;
}

function getBooleanAttribute(element: HTMLElement, name: string, fallback: boolean): boolean {
    const raw = element.getAttribute(name);
    if (raw === null) return fallback;
    if (raw === '' || raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    return fallback;
}

function getDynamicOptionsAttribute(element: HTMLElement): OptionType[] | null {
    const raw = element.getAttribute('data-dynamic-options');
    if (!raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed as OptionType[] : null;
    } catch {
        return null;
    }
}

function isValidTypeName(value: unknown): value is string {
    return typeof value === 'string' && Array.from(value).length <= TYPE_NAME_MAX_CODE_POINTS;
}

export const WidgetNodes = Node.create({
    name: 'widgetField',
    group: 'inline',
    inline: true,
    content: 'inline*',
    atom: false,
    // atom: true, // 作为原子节点，不可拆分
    selectable: true, // 确保节点可被选中
    // 定义属性
    addAttributes() {
        return {
            id: {
                default: '',
                parseHTML: element => {
                    const value = element.getAttribute('data-id');
                    return value && value.length >= WIDGET_ID_LENGTH ? value : nanoid();
                },
                renderHTML: attributes => ({ 'data-id': attributes.id })
            },
            // 小部件名称
            name: {
                default: '文本输入',
                parseHTML: element => element.getAttribute('data-widget-name'),
                renderHTML: attributes => ({ 'data-widget-name': attributes.name })
            },
            // 小部件类型
            type: {
                default: ControlType.text,
                parseHTML: element => getIntegerAttribute(element, 'data-widget-type', ControlType.text, ControlType.text, ControlType.radio),
                renderHTML: attributes => ({ 'data-widget-type': attributes.type })
            },
            // 小部件类型
            typeName: {
                default: '文本输入',
                parseHTML: element => {
                    const value = element.getAttribute('data-widget-type-name');
                    return isValidTypeName(value) ? value : '文本输入';
                },
                renderHTML: attributes => ({ 'data-widget-type-name': attributes.typeName })
            },

            // 占位符
            placeholder: {
                default: '文本输入',
                parseHTML: element => element.getAttribute('data-placeholder'),
                renderHTML: attributes => ({ 'data-placeholder': attributes.placeholder })
            },
            // 显示的字数
            width: {
                default: 8,
                parseHTML: element => getIntegerAttribute(element, 'data-font-num', 8, 0),
                renderHTML: attributes => ({ 'data-font-num': attributes.width })
            },
            // 文字大小
            fontSize: {
                default: 11,
                parseHTML: element => getIntegerAttribute(element, 'data-font-size', 11, 9, 36),
                renderHTML: attributes => ({ 'data-font-size': attributes.fontSize })
            },

            // 组件绑定的值
            value: {
                default: '',
                parseHTML: element => element.getAttribute('data-widget-value'),
                renderHTML: attributes => ({ 'data-widget-value': attributes.value })
            },
            // 组件绑定的值
            label: {
                default: '',
                parseHTML: element => element.getAttribute('data-label'),
                renderHTML: attributes => ({ 'data-label': attributes.label })
            },
            // 是否必填
            isRequired: {
                default: 0,
                parseHTML: element => getFlagAttribute(element, 'data-required', 0),
                renderHTML: attributes => ({ 'data-required': attributes.isRequired })
            },
            // 是否只读
            isReadonly: {
                default: 0,
                parseHTML: element => getFlagAttribute(element, 'data-readonly', 0),
                renderHTML: attributes => ({ 'data-readonly': attributes.isReadonly })
            },
            // 下划线
            isUnderline: {
                default: 0,
                parseHTML: element => getFlagAttribute(element, 'data-underline', 0),
                renderHTML: attributes => ({ 'data-underline': attributes.isUnderline })
            },
            // 新增：校验失败标记
            validate: {
                default: 1,
                parseHTML: element => getFlagAttribute(element, 'data-validate', 1),
                renderHTML: attributes => ({ 'data-validate': attributes.validate })
            },
            // 对齐方式
            align: {
                default: AlignType.left,
                parseHTML: element => getIntegerAttribute(element, 'data-align', AlignType.left, AlignType.left, AlignType.right),
                renderHTML: attributes => ({ 'data-align': attributes.align })
            },
            // 时间格式
            dateFormat: {
                default: 'YYYY-MM-DD',
                parseHTML: element => element.getAttribute('data-date-format'),
                renderHTML: attributes => ({ 'data-date-format': attributes.dateFormat })
            },
            options: {
                default: null,
                parseHTML: element => element.getAttribute('data-options'),
                renderHTML: attributes => ({ 'data-options': attributes.options })
            },
            // 是否多选
            isMultiple: {
                default: 0,
                parseHTML: element => getFlagAttribute(element, 'data-multiple', 0),
                renderHTML: attributes => ({ 'data-multiple': attributes.isMultiple })
            },
            // 数据来源
            dataSourceCode: {
                default: null,
                parseHTML: element => element.getAttribute('data-data-source') === '' ? '' : null,
                renderHTML: attributes => ({ 'data-data-source': attributes.dataSourceCode })
            },
            // 组别id
            group: {
                default: null,
                parseHTML: element => element.getAttribute('data-group'),
                renderHTML: attributes => ({ 'data-group': attributes.group })
            },
            // 选中
            checked: {
                default: false,
                parseHTML: element => getBooleanAttribute(element, 'data-checked', false),
                renderHTML: attributes => ({ 'data-checked': attributes.checked })
            },
            // 动态选项
            dynamicOptions: {
                default: null,
                parseHTML: element => getDynamicOptionsAttribute(element),
                renderHTML: attributes => attributes.dynamicOptions === null
                    ? {}
                    : { 'data-dynamic-options': JSON.stringify(attributes.dynamicOptions) }
            },
            // 排列顺序
            layout: {
                default: 1,
                parseHTML: element => getIntegerAttribute(element, 'data-layout', 1, 1, 2),
                renderHTML: attributes => ({ 'data-layout': attributes.layout })
            },

        }
    },
    // 模板返回时，解析HTML,如果输出JSON的时候，会返回「customNodes」name名称，如果输出html，会返回「vue-component」
    parseHTML() {
        return [
            {
                // tag: 'Widget-component',
                tag: 'span[data-type="field"]',
            },
        ]
    },
    // 渲染HTML（输出），这里vue-component是自定义的标签，没有多大的意义，不会显示在html中。我们在浏览器中看不到这个标签，但是这个标签会作为我们自定义组件的容器
    renderHTML({ HTMLAttributes }) {
        return ['span', { ...HTMLAttributes, 'data-type': 'field' }, 0];
    },

    // 节点视图（编辑状态），UI交互状态
    addNodeView() {
        return VueNodeViewRenderer(FieldComponent)
    },
    addCommands() {
        return {

            insertFieldText: (id, text) => ({ commands, tr, state, dispatch, view, editor }) => {
                if (!isEditorMutationAllowed(editor)) return false;
                if (!dispatch) return false; // 确保有事务调度能力
                const { selection } = state || {}
                // 获取文档中所有widgetField节点,且ID与传入的id相同
                const widgets = findChildren(
                    state.doc,
                    node => node.type.name === this.name && node.attrs.id === id
                );
                const widget = widgets[0];
                if (!widget) {
                    return false;
                }
                // 创建新事务避免冲突
                const newTr = state.tr;

                const { node, pos } = widget;
                const from = pos + 1;
                const to = pos + node.nodeSize - 1;

                const displayText = typeof text === 'string'
                    ? text
                    : Array.isArray(text)
                        ? text.map(item => item.label).join(',')
                        : text.label;
                const storedValue = typeof text === 'string'
                    ? text
                    : Array.isArray(text)
                        ? text.map(item => item.value).join(',')
                        : text.value;

                // 内容与 value 属性由同一输入同步生成；空值也必须清掉旧 value。
                newTr.delete(from, to);
                if (displayText) {
                    newTr.insertText(displayText, from);
                }
                newTr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    value: storedValue,
                });
                dispatch(newTr);

                return true
            },
            insertField: attrs => ({ commands, tr, state, view, editor }) => {
                if (!isEditorMutationAllowed(editor)) return false;
                if (attrs.typeName !== undefined && !isValidTypeName(attrs.typeName)) return false;
                const { selection } = state || {}
                const widgetNode = findParentNode(
                    node => node.type.name === this.name
                )(selection);
                // console.log(widgetNode);
                const defaultAttr = {
                    placeholder: '文本输入',
                    type: ControlType.text,
                    width: 8,
                    checked: false,
                    options: "1:选项1\n2:选项2\n3:选项3",
                    // ID 会在属性解析时自动生成
                }

                if (attrs.type === ControlType.radio || attrs.type === ControlType.checkbox) {

                    const dynamicOptions = attrs.dynamicOptions || [{ value: '1', label: '选项1', selected: false }, { value: '2', label: '选项2', selected: false }, { value: '3', label: '选项3', selected: false }];
                    // 获取光标的位置
                    let position = !widgetNode ? tr.selection.from : widgetNode.pos + widgetNode.node.nodeSize;
                    const newNodeArray: Node | Content | Node[] = []
                    const group = nanoid()
                    dynamicOptions.forEach(item => {
                        // 创建新节点（保留原属性）
                        const newNode = this.type.create({
                            ...defaultAttr,
                            ...attrs,
                            id: nanoid(),
                            typeName: attrs.typeName || ControlTypeName[attrs.type || defaultAttr.type],
                            group,
                            label: item.label,
                            value: item.value,
                        },
                            // 设置节点的内容（文本）
                            this.type.schema.text(item.label || "默认文本")  // 使用 text() 创建文本内容
                        );
                        newNodeArray.push(newNode.toJSON());
                    })
                    nextTick(() => {
                        // 聚焦到新节点
                        view.focus();
                    });
                    return commands.insertContentAt(position, newNodeArray);
                }

                // 获取光标的位置
                const position = !widgetNode ? tr.selection.from : widgetNode.pos + widgetNode.node.nodeSize;
                // 创建新节点（保留原属性）
                const newNode = this.type.create({
                    ...defaultAttr,
                    ...attrs,
                    id: nanoid(),
                    typeName: attrs.typeName || ControlTypeName[attrs.type || defaultAttr.type]
                });
                // console.log('widgetNode', position, selection.$from);
                nextTick(() => {
                    // 聚焦到新节点
                    view.focus();
                });
                return commands.insertContentAt(position, newNode);
            },

            updateField: (id, attrs) => ({ editor, state, dispatch }) => {
                if (!isEditorMutationAllowed(editor)) return false;
                if (!id || (attrs.id !== undefined && attrs.id !== id)) return false;
                if (attrs.typeName !== undefined && !isValidTypeName(attrs.typeName)) return false;
                const widgets = findChildren(
                    state.doc,
                    node => node.type.name === this.name && node.attrs.id === id
                );
                if (widgets.length !== 1) return false;

                const { node, pos } = widgets[0];
                const { id: _ignoredIdentity, ...mutableAttrs } = attrs;
                const nextAttrs = {
                    ...node.attrs,
                    ...mutableAttrs,
                    id,
                };
                if (JSON.stringify(nextAttrs) === JSON.stringify(node.attrs)) return false;
                dispatch?.(state.tr.setNodeMarkup(pos, undefined, nextAttrs));
                return true;
            },

            // 更新单选框和复选框的选中状态
            updateFieldAttrs: (id, group, updateParams) => ({ commands, tr, state, dispatch, editor }) => {
                if (!isEditorMutationAllowed(editor)) return false;
                if (!dispatch) return false; // 确保有事务调度能力
                if (!id || !group) {
                    console.warn('updateFieldChecked: id and group are required');
                    return false;
                }


                // 创建新事务避免冲突
                const newTr = state.tr;
                // 获取文档中所有widgetField节点,
                const widgets = findChildren(
                    state.doc,
                    // 筛选统一组别的单选多选组
                    node => node.type.name === this.name && node.attrs.group === group
                );
                // 如果没有找到任何节点，提前返回
                if (widgets.length === 0) {
                    console.warn(`updateFieldChecked: No widgets found in group ${group}`);
                    return false;
                }


                // 如果只更新layout，直接处理并返回
                if (updateParams.layout !== undefined) {
                    let modified = false;
                    widgets.forEach(({ node, pos }) => {
                        if (node.attrs.layout !== updateParams.layout) {
                            modified = true;
                            newTr.setNodeMarkup(pos, undefined, {
                                ...node.attrs,
                                layout: updateParams.layout
                            });
                        }
                    });
                    if (modified) {
                        dispatch(newTr);
                        return true;
                    }
                    return false;
                }

                // 处理其他属性更新
                let modified = false;
                // 新的options属性值
                let newOptions = '';
                // 新的dynamicOptions属性值
                const newDynamicOptions: OptionType[] = []
                let newDataSourceCode = false; // 新的dataSourceCode属性值
                widgets.forEach(widget => {
                    const { node, pos } = widget;
                    const isTargetNode = node.attrs.id === id;
                    const currentChecked = node.attrs.checked;
                    // 判断是否需要更新
                    let newChecked = currentChecked;
                    let newLabel = node.attrs.label;
                    let newValue = node.attrs.value;

                    if (isTargetNode) {
                        // 目标节点设置为传入的checked值
                        // 目标节点根据传入的updateParams更新
                        if (updateParams.checked !== undefined) {
                            newChecked = updateParams.checked;
                        }
                        if (updateParams.label !== undefined) {
                            newLabel = updateParams.label;
                        }
                        if (updateParams.value !== undefined) {
                            newValue = updateParams.value;
                        }
                    } else {
                        // 对于单选框，其他节点设置为false；对于复选框，保持原状态
                        if (node.attrs.type === ControlType.radio) {
                            newChecked = false;
                        }
                    }

                    // 只有当checked状态需要改变时才更新
                    if (currentChecked !== newChecked || node.attrs.label !== newLabel || node.attrs.value !== newValue) {
                        modified = true;
                    }
                    // 如何label发生变化时，更新newDataSourceCode的值
                    if (node.attrs.label !== newLabel) {
                        newDataSourceCode = true;
                    }
                    newOptions += newValue + ':' + newLabel + '\n';
                    // 组装dynamicOptions属性
                    newDynamicOptions.push({
                        value: newValue,
                        label: newLabel,
                        selected: newChecked,
                    })

                })
                // 只有当有实际修改时才派发事务
                if (modified) {
                    // 更改单选组所有选项的属性
                    widgets.forEach((widget, index) => {
                        const { node, pos } = widget;
                        newTr.setNodeMarkup(pos, undefined, {
                            ...node.attrs,
                            checked: newDynamicOptions[index].selected,
                            label: newDynamicOptions[index].label,
                            value: newDynamicOptions[index].value,
                            dynamicOptions: newDynamicOptions, // 更新动态数据源
                            // 删除newoptions属性后面的换行符
                            options: newOptions.replace(/\n$/, ''),
                            dataSourceCode: newDataSourceCode ? '' : node.attrs.dataSourceCode, // 更新dataSourceCode属性
                        });
                    })
                    dispatch(newTr);
                    return true;
                }

                return false

            },

            // 更新单选框和复选框的动态节点
            updateDynamicOptions: (group: string | null, dynamicOptions: OptionType[], options: string) => ({ tr, view, state, dispatch, commands, editor }) => {
                if (!isEditorMutationAllowed(editor)) return false;
                if (!dispatch) return false; // 确保有事务调度能力
                if (!group) return false;
                // 1. 查找当前组的所有节点
                const widgets = findChildren(
                    state.doc,
                    node => node.type.name === this.name && node.attrs.group === group
                ).sort((a, b) => a.pos - b.pos); //按位置升序排序（第一个节点位置最小）

                if (widgets.length === 0) {
                    console.warn(`没有找到相关的组id: ${group}`);
                    return false;
                }

                // 2. 记录第一个节点的位置作为插入点
                const insertPos = widgets[0].pos;
                //   创建新事务避免冲突
                const newTr = state.tr;

                // 3. 从后向前删除所有节点（避免位置偏移）
                for (let i = widgets.length - 1; i >= 0; i--) {
                    const { pos, node } = widgets[i];
                    newTr.delete(pos, pos + node.nodeSize);
                }

                // 4. 创建新节点数组
                const newNodes = dynamicOptions.map(option => {
                    // 使用第一个节点的属性作为基础
                    const baseAttrs = widgets[0].node.attrs;

                    return this.type.create({
                        ...baseAttrs,
                        id: nanoid(), // 生成新ID
                        label: option.label,
                        value: option.value,
                        checked: !!option.selected,
                        dynamicOptions: dynamicOptions, // 更新动态数据源
                        options: options, // 更新options属性
                    }, this.type.schema.text(option.label));
                });

                // 5. 在原始位置插入新节点
                newTr.insert(insertPos, newNodes);
                // newTr.setSelection(TextSelection.create(tr.doc, insertPos));
                dispatch(newTr);

                return true;
            },

            // 新增校验命令
            validateField: () => ({ state, tr, dispatch, commands, editor }) => {
                if (!isEditorMutationAllowed(editor)) return false;
                if (!dispatch) return false; // 确保有事务调度能力

                let allValid = true; // 假设所有校验都通过
                let firstErrorPos: any = null; // 记录第一个错误位置

                // 遍历文档所有节点
                state.doc.descendants((node, pos) => {
                    if (node.type.name === this.name) {
                        const isRequired = node.attrs.isRequired == 1; // 宽松比较
                        const isEmpty = node.textContent.trim() === ''; // 检查是否为空

                        // 必填且内容为空，标记为校验失败
                        const shouldMrkError = isRequired && isEmpty;

                        //  只有当状态变化时才更新节点
                        if (node.attrs.validate !== (shouldMrkError ? 0 : 1)) {
                            tr.setNodeMarkup(pos, undefined, {
                                ...node.attrs,
                                validate: shouldMrkError ? 0 : 1
                            }); // 设置校验失败标记

                            // 发现错误
                            if (shouldMrkError) {
                                allValid = false; // 标记为校验失败

                                // 记录第一个错误位置
                                if (firstErrorPos === null) {
                                    firstErrorPos = pos;
                                }
                            }


                        }
                    }
                })

                // 如果有错误且找到第一个错误位置，聚焦到该节点
                if (!allValid && firstErrorPos !== null) {
                    tr.setSelection(TextSelection.create(tr.doc, firstErrorPos + 1));
                    dispatch(tr);
                    commands.focus();
                }
                return allValid;
            }
        }
    },
    // 添加逻辑以防止内容为空时移除节点
    addKeyboardShortcuts() {
        return {
            ArrowUp: ({ editor }) => commonKeymap(editor, 'ArrowUp'),// 阻止默认的箭头「上」行为
            ArrowDown: ({ editor }) => commonKeymap(editor, 'ArrowDown'),// 阻止默认的箭头「下」行为
            Escape: ({ editor }) => commonKeymap(editor, 'Escape'),// 阻止默认的「Esc」行为
            Enter: ({ editor }) => commonKeymap(editor, 'Enter'),// 阻止默认的「Enter」行为
            Backspace: () => {

                const { state, commands, view } = this.editor;
                if (!isEditorMutationAllowed(this.editor)) return false;
                // console.log('Backspace', commands);
                // 查找当前 widgetField 节点
                const widgetNode = findParentNode(
                    node => node.type.name === this.name
                )(state.selection);
                if (!widgetNode) return false; // 不在节点内
                // node是当前节点，start是节点开始位置，pos是当前光标位置
                const { node, pos } = widgetNode;
                // 节点内容大小（长度）
                const contentSize = node.content.size

                if (contentSize === 0) {
                    /**
                     * 当选中的空节点时，删除节点
                     */
                    return commands.deleteNode(node.type);
                } else if (contentSize === 1) {
                    /**
                     * 实践过程中：当删除最后一个元素的时候，出现了删除了最后一个元素，这个节点就消失了
                     * 解决方案：
                     * 1. 创建新的空节点（保留原节点类型和属性）
                     * 2. 替换原节点
                     * 3. 设置光标到新节点
                     */

                    // 创建新事务
                    const tr = state.tr;

                    // 创建新节点（保留原属性）
                    const newNode = this.type.create(node.attrs);

                    // 替换当前节点
                    tr.replaceWith(pos, pos + node.nodeSize, newNode);

                    // 将光标设置在新节点的零宽空格之前
                    const newPos = pos + 1; // 节点内部位置
                    tr.setSelection(TextSelection.create(tr.doc, newPos));

                    view.dispatch(tr);
                    return true; // 阻止默认Backspace行为
                } else {
                    // 继续后退的默认删除行为
                    return false;
                }


            },
        };
    },
    // 新增：自动校验的插件
    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('widgetFieldWatcher'),
                /**
                 * @description 监听文档变化
                 * appendTransaction 是用于修改文档内容或结构的文档层机制,view.update 是用于响应视图已完成更新的视图层通知
                 * appendTransaction 在文档状态变更后、DOM 更新前执行,view.update 在文档状态和 DOM 更新都完成后执行
                 * 两者本身都有一定的开销。appendTransaction 的主要风险在于可能创建不必要的额外事务或导致循环 ,从而增加处理时间。
                 * view.update 的风险在于其回调函数如果执行耗时操作或触发更多更新，会延迟界面响应。
                 * 总体而言，appendTransaction 更适合需要精确控制文档变更的场景(编辑器中的所有更改（如输入、删除、格式化)，而 view.update 更适合副作用处理。
                 */
                appendTransaction: (transactions, oldState, newState) => {
                    if (!isEditorMutationAllowed(this.editor)) return null;
                    const tr = newState.tr;
                    let modified = false;
                    // 获取文档中所有widgetField节点
                    const widgets = findChildren(
                        newState.doc,
                        node => node.type.name === this.name && (node.attrs.type === ControlType.inputNumber || node.attrs.type === ControlType.radio)
                    ).sort((a, b) => b.pos - a.pos);
                    // console.warn('widgets', widgets);
                    widgets.forEach(widget => {
                        const { node, pos } = widget;
                        const textContent = node.textContent;
                        if (node.attrs.type !== ControlType.inputNumber) return;

                        const numericContent = textContent.replace(/\D/g, '');
                        const contentChanged = numericContent !== textContent;
                        const valueChanged = node.attrs.value !== numericContent;
                        if (!contentChanged && !valueChanged) return;

                        modified = true;
                        tr.setNodeMarkup(pos, undefined, {
                            ...node.attrs,
                            value: numericContent,
                        });

                        if (contentChanged) {
                            const from = pos + 1;
                            const to = pos + node.nodeSize - 1;
                            tr.delete(from, to);
                            if (numericContent) {
                                tr.insertText(numericContent, from);
                            }
                        }


                    });
                    return modified ? tr : null;
                },
                // view: () => ({
                //     update: (view) => {
                //
                //     }
                // })
            })
        ];
    }

});


// 公共的键盘监听事件
/**
 * @params key 键盘的keycode
 */
function commonKeymap(editor: Editor, key: string) {
    if (!isEditorMutationAllowed(editor)) return false;
    const { $from } = editor.state.selection
    const currentNode = $from.parent
    // 检查当前光标是否在 widgetField 节点内
    if (currentNode.type.name === 'widgetField' && currentNode.attrs.type === ControlType.select) {
        // 从注册表获取节点视图实例
        const nodeView = getNodeView(editor, currentNode.attrs.id)
        if (nodeView) {
            const event = new KeyboardEvent('keydown', { key })
            nodeView.exposeProxy?.handleKeyDown(event)
            return true // 阻止默认行为
        }
    }

    // 不在 widgetField 内，让默认行为继续
    return false
}
