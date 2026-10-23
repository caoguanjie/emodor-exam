/*
 * @Author: caoguanjie
 * @Date: 2025-06-19 11:48:30
 * @Last Modified by: caoguanjie
 * @Last Modified time: 2025-06-19 16:18:41
 * 文件描述：控制tiptap富文本的编辑器的缩进、缩减的拓展模块
 */
import { Extension } from '@tiptap/core';

export interface IndentExtensionOptions {
    /**
     * The types where the text align attribute can be applied.
     * @default []
     * @example ['paragraph', 'heading', 'listItem']
     */
    types: string[],
    /**
     * 最大的缩减等级
     * @default null
     * @example 'center'
     */
    maxIndent: number,
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        indent: {
            /**
             * 增加缩进
             * Set the text indent attribute
             * @example editor.commands.increaseIndent()
             */
            increaseIndent: () => ReturnType,
            /**
             * 减少缩进
             * Unset the text indent attribute
             * @example editor.commands.decreaseIndent()
             */
            decreaseIndent: () => ReturnType,
            // 检查是否可以增加缩进
            canIndent: () => ReturnType,
            canDecreaseIndent: () => ReturnType,
        }
    }
}

// 自定义缩进扩展
export const IndentExtension = Extension.create({
    name: 'indent',
    addOptions() {
        return {
            // 最大缩进等级
            maxIndent: 10,
            types: ['paragraph', 'heading', 'listItem'], // 可以缩进的节点类型
        };
    },
    // 使用属性在内容中存储附加信息
    addGlobalAttributes() {
        return [{
            types: this.options.types,
            attributes: {
                indent: {
                    default: 0,
                    parseHTML: element => {
                        const match = /^([0-9]|10)(?:em)?$/.exec(element.style.textIndent.trim());
                        return match ? Number(match[1]) : 0;
                    },
                    // 返回将在输出中渲染的 HTML 属性
                    renderHTML: attributes => {
                        const indent = Number(attributes.indent);
                        if (!Number.isInteger(indent) || indent < 1 || indent > this.options.maxIndent) return {};
                        return {
                            style: `text-indent: ${indent}em`
                        };
                    },
                },
            },
        }]
    },
    // addCommands() {
    //     return {
    //         setTextAlign: (alignment: string) => ({ commands }) => {
    //             if (!this.options.alignments.includes(alignment)) {
    //                 return false
    //             }

    //             return this.options.types
    //                 .map(type => commands.updateAttributes(type, { textAlign: alignment }))
    //                 .every(response => response)
    //         },

    //         unsetTextAlign: () => ({ commands }) => {
    //             return this.options.types
    //                 .map(type => commands.resetAttributes(type, 'textAlign'))
    //                 .every(response => response)
    //         },

    //         toggleTextAlign: alignment => ({ editor, commands }) => {
    //             if (!this.options.alignments.includes(alignment)) {
    //                 return false
    //             }

    //             if (editor.isActive({ textAlign: alignment })) {
    //                 return commands.unsetTextAlign()
    //             }
    //             return commands.setTextAlign(alignment)
    //         },
    //     }
    // },
    addCommands() {
        return {
            // 缩进
            increaseIndent: () => ({ commands, state }) => {
                const { selection } = state;
                const { $from } = selection;
                const node = $from.node($from.depth);
                const indent = Number(node.attrs.indent) || 0;
                // console.warn(indent, node);
                if (indent >= this.options.maxIndent) return false;
                // return this.options.types
                //     .map(type => commands.updateAttributes(type, { indent: indent + 1 }))
                //     .every(response => response)
                return commands.updateAttributes(node.type.name, {
                    indent: indent + 1
                });
            },

            decreaseIndent: () => ({ commands, state }) => {
                const { selection } = state;
                const { $from } = selection;
                const node = $from.node($from.depth);
                const indent = Number(node.attrs.indent) || 0;

                if (indent <= 0) return false;

                return commands.updateAttributes(node.type.name, {
                    indent: indent - 1
                });
            },
            // 检查是否可以增加缩进
            canIndent: () => ({ state }: any) => {
                const { selection } = state;
                const { $from } = selection;
                const node = $from.node($from.depth);
                const indent = Number(node.attrs.indent) || 0;
                return indent < this.options.maxIndent;
            },

            // 检查是否可以减少缩进
            canDecreaseIndent: () => ({ state }: any) => {
                const { selection } = state;
                const { $from } = selection;
                const node = $from.node($from.depth);
                const indent = Number(node.attrs.indent) || 0;
                return indent > 0;
            }
        }
    }

})
