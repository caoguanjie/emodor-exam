/*
 * @Author: caoguanjie
 * @Date: 2025-06-19 16:45:41
 * @Last Modified by: caoguanjie
 * @Last Modified time: 2025-06-19 16:52:24
 * @Description: 清除格式
 */
import { Extension } from '@tiptap/core';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        clearFormat: {
            /**
             * 增加缩进
             * @example editor.commands.clearFormat()
             */
            clearFormat: () => ReturnType,
        }
    }
}

export const ClearFormat = Extension.create({
    name: 'clearFormat',
    addCommands() {
        return {
            clearFormat: () => ({ commands, state }) => {
                // 移除所有文本样式
                commands.unsetAllMarks();

                // 清除段落样式
                commands.clearNodes();

                // 重置文本对齐
                commands.setTextAlign('left');

                // 重置缩进
                commands.updateAttributes('paragraph', { indent: 0 });
                commands.updateAttributes('heading', { indent: 0 });
                commands.updateAttributes('listItem', { indent: 0 });
                return true;
            }
        }
    }

})
