/*
 * @Author: caoguanjie
 * @Date: 2025-06-19 11:48:30
 * @Last Modified by: caoguanjie
 * @Last Modified time: 2025-06-19 16:18:41
 * 文件描述：控制tiptap富文本的编辑器的段落行高
 * 如果使用Fontsize自定义拓展的类似的方法的话，它是使用textstyle相关的属性来控制，但是这个是直接控制某选中节点的行高，不是段落的行高。
 * 下面的这个方法还是有问题的，当你一旦选中了某个行高，所有的段落都会默认这个行高，因为addGlobalAttributes添加是全局属性，一旦选中，就会改变所有段落。（待优化）
 */
import { Extension, type CommandProps } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export const PARAGRAPH_LINE_HEIGHTS = ['1', '1.2', '1.5', '1.75', '2', '2.5', '3'] as const;

function isParagraphLineHeight(value: unknown): value is typeof PARAGRAPH_LINE_HEIGHTS[number] {
    return typeof value === 'string'
        && PARAGRAPH_LINE_HEIGHTS.some(lineHeight => lineHeight === value);
}

function updateSelectedBlockLineHeight(
    { state, dispatch }: Pick<CommandProps, 'state' | 'dispatch'>,
    types: string[],
    lineHeight: typeof PARAGRAPH_LINE_HEIGHTS[number] | null,
): boolean {
    const { selection } = state;
    const transaction = state.tr;
    let matched = false;

    const updateNode = (node: ProseMirrorNode, position: number) => {
        if (!types.includes(node.type.name)) return;
        matched = true;
        if (node.attrs.lineHeight === lineHeight) return;
        transaction.setNodeMarkup(position, undefined, {
            ...node.attrs,
            lineHeight,
        });
    };

    if (selection.empty) {
        for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
            const node = selection.$from.node(depth);
            if (!types.includes(node.type.name)) continue;
            updateNode(node, selection.$from.before(depth));
            break;
        }
    } else {
        state.doc.nodesBetween(selection.from, selection.to, (node, position) => {
            updateNode(node, position);
        });
    }

    if (dispatch && transaction.docChanged) dispatch(transaction);
    return matched;
}

export interface ParagraphLineHeightOptions {
    /**
     * The types where the text align attribute can be applied.
     * @default []
     * @example ['paragraph', 'heading', 'listItem']
     */
    types: string[],
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        lineHeight: {
            /**
             * 设置行高
             * @example editor.commands.setLineHeight()
             */
            setLineHeight: (lineHeight: string) => ReturnType;
            /**
             * 取消行高
             * @example editor.commands.unsetLineHeight()
             */
            unsetLineHeight: () => ReturnType,
        }
    }
}

// 自定义缩进扩展
export const ParagraphLineHeight = Extension.create<ParagraphLineHeightOptions>({
    name: 'paragraphLineHeight',
    addOptions() {
        return {
            types: ['paragraph', 'heading', 'listItem'], // 可以缩进的节点类型
        };
    },
    // 使用属性在内容中存储附加信息
    addGlobalAttributes() {
        return [{
            types: this.options.types,
            attributes: {
                lineHeight: {
                    default: 0,
                    parseHTML: element => {
                        const value = element.style.lineHeight.replace(/['"]+/g, "");
                        return isParagraphLineHeight(value) ? value : 0;
                    },
                    // 返回将在输出中渲染的 HTML 属性
                    renderHTML: attributes => {
                        if (!isParagraphLineHeight(attributes.lineHeight)) return {};
                        return {
                            style: `line-height: ${attributes.lineHeight}`,
                        };
                    },
                },
            },
        }]
    },

    addCommands() {
        return {

            setLineHeight: (lineHeight) => (props) => {
                if (!isParagraphLineHeight(lineHeight)) return false;
                return updateSelectedBlockLineHeight(props, this.options.types, lineHeight);
            },

            unsetLineHeight: () => (props) => (
                updateSelectedBlockLineHeight(props, this.options.types, null)
            ),

        }
    }

})
