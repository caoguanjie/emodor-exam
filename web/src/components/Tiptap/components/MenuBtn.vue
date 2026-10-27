<template>
    <div class="menu-btn-groups">
        <div class="menu-btn-group">
            <el-tooltip class="box-item" effect="dark" content="撤销" placement="bottom" :offset="5" :hide-after="0"
                :show-arrow="false" popper-class="ruleexam-tiptap-tooltip-btn">
                <button type="button" class="menu-btn-item" @click="editor?.chain().focus().undo().run()"
                    :disabled="!editor?.can().chain().focus().undo().run()">
                    <SvgIcon icon-class="arrow-go-back-fill">
                    </SvgIcon>
                </button>
            </el-tooltip>

            <el-tooltip class="box-item" effect="dark" content="重做" placement="bottom" :offset="5" :hide-after="0"
                :show-arrow="false" popper-class="ruleexam-tiptap-tooltip-btn">
                <button type="button" class="menu-btn-item" @click="editor?.chain().focus().redo().run()"
                    :disabled="!editor?.can().chain().focus().redo().run()">
                    <SvgIcon icon-class="arrow-go-forward-fill"></SvgIcon>
                </button>
            </el-tooltip>
            <el-tooltip class="box-item" effect="dark" content="清除格式" placement="bottom" :offset="5" :hide-after="0"
                :show-arrow="false" popper-class="ruleexam-tiptap-tooltip-btn">
                <button type="button" class="menu-btn-item" @click="editor?.commands?.clearFormat()">
                    <SvgIcon icon-class="eraser-line"></SvgIcon>
                </button>
            </el-tooltip>
        </div>
        <div v-if="$slots['insert-action']" class="menu-btn-group">
            <slot name="insert-action" />
        </div>
        <div class="menu-btn-group">
            <el-popover placement="bottom" width="95" :visible="state.showFontPopover" :offset="5" :hide-after="0"
                :show-arrow="false" popper-class="ruleexam-tiptap-popover-menu">
                <ul class="fits-dropdown-menu" @click="state.showFontPopover = false"
                    v-click-outside="($event: any) => closeAllPopover($event, ignoreFontPopverElement, 'showFontPopover')">
                    <li class="fits-dropdown-item" @click="editor.chain().focus().setFontFamily('SimSun').run()">
                        <span>宋体</span>
                    </li>
                    <li class="fits-dropdown-item" @click="editor.chain().focus().setFontFamily('SimHei').run()">
                        <span>黑体</span>
                    </li>
                    <li class="fits-dropdown-item"
                        @click="editor.chain().focus().setFontFamily('Microsoft YaHei').run()">
                        <span>微软雅黑</span>
                    </li>
                    <li class="fits-dropdown-item" @click="editor.chain().focus().setFontFamily('FangSong').run()">
                        <span>仿宋</span>
                    </li>
                    <li class="fits-dropdown-item" @click="editor.chain().focus().setFontFamily('KaiTi').run()">
                        <span>楷体</span>
                    </li>
                </ul>
                <template #reference>
                    <button type="button" class="menu-btn-item" @click="state.showFontPopover = !state.showFontPopover"
                        ref="ignoreFontPopverElement">
                        <span class="menu-btn-item_name">{{ fontFamily }}</span>
                        <SvgIcon icon-class="arrow-down-s-line" style="color: #aab4bf"></SvgIcon>
                    </button>
                </template>
            </el-popover>
            <el-popover placement="bottom" width="65" :visible="state.showFontSizePopover" :offset="5" :hide-after="0"
                :show-arrow="false" popper-class="ruleexam-tiptap-popover-menu">
                <ul class="fits-dropdown-menu" @click="state.showFontSizePopover = false"
                    v-click-outside="($event: any) => closeAllPopover($event, ignoreFontSizePopverElement, 'showFontSizePopover')">
                    <li class="fits-dropdown-item" v-for="item in 28" :key="item"
                        @click="editor?.chain().focus().setFontSize(`${item + 8}pt`).run()">
                        <span>{{ item + 8 }}</span>
                    </li>

                </ul>
                <template #reference>
                    <button type="button" class="menu-btn-item" @click="state.showFontSizePopover = !state.showFontSizePopover"
                        ref="ignoreFontSizePopverElement" :aria-label="`字号：${fontSize} 磅（pt）`">
                        <span class="menu-btn-item_name">{{ fontSize }} pt</span>
                        <SvgIcon icon-class="arrow-down-s-line" style="color: #aab4bf"></SvgIcon>
                    </button>
                </template>
            </el-popover>
            <el-tooltip effect="dark" content="字号，单位：磅（pt）" placement="top" :offset="5"
                :show-after="0" :hide-after="0" :show-arrow="false" popper-class="ruleexam-tiptap-tooltip-btn"
                virtual-triggering :virtual-ref="ignoreFontSizePopverElement" />
            <el-tooltip class="box-item" effect="dark" content="加粗" placement="bottom" :offset="5" :hide-after="0"
                :show-arrow="false" popper-class="ruleexam-tiptap-tooltip-btn">
                <button type="button" class="menu-btn-item" @click.stop="editor?.chain().focus().toggleBold().run()"
                    :disabled="!editor?.can().chain().focus().toggleBold().run()"
                    :class="{ 'is-active': editor?.isActive('bold') }">
                    <SvgIcon icon-class="bold"></SvgIcon>
                </button>
            </el-tooltip>
            <el-tooltip class="box-item" effect="dark" content="斜体" placement="bottom" :offset="5" :hide-after="0"
                :show-arrow="false" popper-class="ruleexam-tiptap-tooltip-btn">
                <button type="button" class="menu-btn-item" @click="editor?.chain().focus().toggleItalic().run()"
                    :disabled="!editor?.can().chain().focus().toggleItalic().run()"
                    :class="{ 'is-active': editor?.isActive('italic') }">
                    <SvgIcon icon-class="italic"></SvgIcon>
                </button>
            </el-tooltip>
            <el-tooltip class="box-item" effect="dark" content="下划线" placement="bottom" :offset="5" :hide-after="0"
                :show-arrow="false" popper-class="ruleexam-tiptap-tooltip-btn">
                <button type="button" class="menu-btn-item" @click="editor?.chain().focus().toggleUnderline().run()"
                    :disabled="!editor?.can().chain().focus().toggleUnderline().run()"
                    :class="{ 'is-active': editor?.isActive('underline') }">
                    <SvgIcon icon-class="underline"></SvgIcon>
                </button>
            </el-tooltip>
            <el-popover placement="bottom" width="216" :visible="state.showFontColorPopover" :offset="5" :hide-after="0"
                :show-arrow="false" popper-class="ruleexam-tiptap-popover-menu">
                <ul class="fits-dropdown-menu" @click="state.showFontColorPopover = false"
                    v-click-outside="($event: any) => closeAllPopover($event, ignoreFontColorPopverElement, 'showFontColorPopover')">
                    <div class="item-color-dropdown">
                        <div class="item-color-dropdown-group">
                            <div class="item-color-dropdown-item" style="background: rgb(255, 255, 255);"
                                @click="editor?.chain().focus().setColor('rgb(255, 255, 255)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(0, 0, 0);"
                                @click="editor?.chain().focus().setColor('rgb(0, 0, 0)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(41, 114, 245);"
                                @click="editor?.chain().focus().setColor('rgb(41, 114, 245)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(49, 155, 98);"
                                @click="editor?.chain().focus().setColor('rgb(49, 155, 98)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(222, 60, 54);"
                                @click="editor?.chain().focus().setColor('rgb(222, 60, 54)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(248, 136, 38);"
                                @click="editor?.chain().focus().setColor('rgb(248, 136, 38)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(245, 196, 2);"
                                @click="editor?.chain().focus().setColor('rgb(245, 196, 2)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(154, 57, 215);"
                                @click="editor?.chain().focus().setColor('rgb(154, 57, 215)').run()"></div>
                        </div>
                        <div class="item-color-dropdown-group">
                            <div class="item-color-dropdown-item" style="background: rgb(191, 191, 191);"
                                @click="editor?.chain().focus().setColor('rgb(191, 191, 191)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(127, 127, 127);"
                                @click="editor?.chain().focus().setColor('rgb(127, 127, 127)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(154, 190, 255);"
                                @click="editor?.chain().focus().setColor('rgb(154, 190, 255)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(152, 215, 182);"
                                @click="editor?.chain().focus().setColor('rgb(152, 215, 182)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(255, 157, 153);"
                                @click="editor?.chain().focus().setColor('rgb(255, 157, 153)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(255, 186, 132);"
                                @click="editor?.chain().focus().setColor('rgb(255, 186, 132)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(255, 226, 112);"
                                @click="editor?.chain().focus().setColor('rgb(255, 226, 112)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(213, 143, 255);"
                                @click="editor?.chain().focus().setColor('rgb(213, 143, 255)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(165, 165, 165);"
                                @click="editor?.chain().focus().setColor('rgb(165, 165, 165)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(63, 63, 63);"
                                @click="editor?.chain().focus().setColor('rgb(63, 63, 63)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(20, 80, 184);"
                                @click="editor?.chain().focus().setColor('rgb(20, 80, 184)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(40, 124, 80);"
                                @click="editor?.chain().focus().setColor('rgb(40, 124, 80)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(158, 30, 27);"
                                @click="editor?.chain().focus().setColor('rgb(158, 30, 27)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(185, 96, 20);"
                                @click="editor?.chain().focus().setColor('rgb(185, 96, 20)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(163, 130, 0);"
                                @click="editor?.chain().focus().setColor('rgb(163, 130, 0)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(95, 34, 129);"
                                @click="editor?.chain().focus().setColor('rgb(95, 34, 129)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(147, 147, 147);"
                                @click="editor?.chain().focus().setColor('rgb(147, 147, 147)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(13, 13, 13);"
                                @click="editor?.chain().focus().setColor('rgb(13, 13, 13)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(13, 48, 110);"
                                @click="editor?.chain().focus().setColor('rgb(13, 48, 110)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(24, 79, 50);"
                                @click="editor?.chain().focus().setColor('rgb(24, 79, 50)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(88, 18, 13);"
                                @click="editor?.chain().focus().setColor('rgb(88, 18, 13)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(92, 48, 10);"
                                @click="editor?.chain().focus().setColor('rgb(92, 48, 10)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(103, 83, 0);"
                                @click="editor?.chain().focus().setColor('rgb(103, 83, 0)').run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(59, 21, 81);"
                                @click="editor?.chain().focus().setColor('rgb(59, 21, 81)').run()"></div>
                        </div>
                        <div class="item-color-dropdown-button">
                            <el-button size="small"
                                style="width: 100%;--el-button-text-color: var(--fits-base-main-color)"
                                @click="editor.chain().focus().unsetColor().run()">
                                默认
                            </el-button>
                        </div>
                    </div>

                </ul>
                <template #reference>
                    <button type="button" class="menu-btn-item" @click="state.showFontColorPopover = true"
                        ref="ignoreFontColorPopverElement">
                        <div class="menu-btn-item_underline"
                            @click.stop="editor?.chain().focus().setColor(editor?.getAttributes('textStyle').color || '#000').run()">
                            <SvgIcon icon-class="font-size"></SvgIcon>
                            <div class="menu-btn-item-active-color"
                                :style="{ backgroundColor: editor?.getAttributes('textStyle').color || '#000' }">
                            </div>
                        </div>

                        <SvgIcon icon-class="arrow-down-s-line" style="color: #aab4bf"></SvgIcon>
                    </button>
                </template>
            </el-popover>
            <el-popover placement="bottom" width="216" :visible="state.showBackgroundColorPopover" :offset="5"
                :hide-after="0" :show-arrow="false" popper-class="ruleexam-tiptap-popover-menu">
                <ul class="fits-dropdown-menu" @click="state.showBackgroundColorPopover = false"
                    v-click-outside="($event: any) => closeAllPopover($event, ignoreBackgroundColorPopverElement, 'showBackgroundColorPopover')">
                    <div class="item-color-dropdown">
                        <div class="item-color-dropdown-group">
                            <div class="item-color-dropdown-item" style="background: rgb(255, 255, 255);" @click="editor?.chain().focus().setHighlight({
                                color: 'rgb(255, 255, 255)'
                            }).run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(0, 0, 0);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(0, 0, 0)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(41, 114, 245);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(41, 114, 245)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(49, 155, 98);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(49, 155, 98)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(222, 60, 54);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(222, 60, 54)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(248, 136, 38);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(248, 136, 38)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(245, 196, 2);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(245, 196, 2)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(154, 57, 215);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(154, 57, 215)' }).run()">
                            </div>
                        </div>
                        <div class="item-color-dropdown-group">
                            <div class="item-color-dropdown-item" style="background: rgb(191, 191, 191);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(191, 191, 191)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(127, 127, 127);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(127, 127, 127)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(154, 190, 255);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(154, 190, 255)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(152, 215, 182);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(152, 215, 182)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(255, 157, 153);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(255, 157, 153)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(255, 186, 132);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(255, 186, 132)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(255, 226, 112);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(255, 226, 112)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(213, 143, 255);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(213, 143, 255)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(165, 165, 165);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(165, 165, 165)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(63, 63, 63);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(63, 63, 63)' }).run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(20, 80, 184);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(20, 80, 184)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(40, 124, 80);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(40, 124, 80)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(158, 30, 27);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(158, 30, 27)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(185, 96, 20);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(185, 96, 20)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(163, 130, 0);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(163, 130, 0)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(95, 34, 129);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(95, 34, 129)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(147, 147, 147);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(147, 147, 147)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(13, 13, 13);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(13, 13, 13)' }).run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(13, 48, 110);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(13, 48, 110)' }).run()">
                            </div>
                            <div class="item-color-dropdown-item" style="background: rgb(24, 79, 50);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(24, 79, 50)' }).run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(88, 18, 13);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(88, 18, 13)' }).run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(92, 48, 10);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(92, 48, 10)' }).run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(103, 83, 0);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(103, 83, 0)' }).run()"></div>
                            <div class="item-color-dropdown-item" style="background: rgb(59, 21, 81);"
                                @click="editor?.chain().focus().setHighlight({ color: 'rgb(59, 21, 81)' }).run()"></div>
                        </div>
                        <div class="item-color-dropdown-button">
                            <el-button size="small"
                                style="width: 100%;--el-button-text-color: var(--fits-base-main-color)"
                                @click="editor.chain().focus().unsetHighlight().run()">
                                默认
                            </el-button>
                        </div>
                    </div>

                </ul>
                <template #reference>
                    <button type="button" class="menu-btn-item" @click="state.showBackgroundColorPopover = true"
                        ref="ignoreBackgroundColorPopverElement">
                        <div class="menu-btn-item_underline"
                            @click.stop="editor?.chain().focus().setHighlight({ color: editor?.getAttributes('highlight').color || '#000' }).run()">
                            <SvgIcon icon-class="mark-pen-line"></SvgIcon>
                            <div class="menu-btn-item-active-color"
                                :style="{ backgroundColor: editor?.getAttributes('highlight').color || '#000' }">
                            </div>
                        </div>

                        <SvgIcon icon-class="arrow-down-s-line" style="color: #aab4bf"></SvgIcon>
                    </button>
                </template>
            </el-popover>

        </div>
        <div class="menu-btn-group">
            <el-popover placement="bottom" width="150" trigger="click" v-model:visible="state.showParagraphPopover"
                :offset="5" :show-arrow="false" popper-class="ruleexam-tiptap-popover-menu"
                @hide="state.showTextAlign = false; state.showLineHeightPopover = false">
                <div class="fits-dropdown-menu" style="overflow: visible" @mousedown.prevent>
                    <el-popover placement="right-start" width="90" trigger="click" :teleported="false" v-model:visible="state.showLineHeightPopover" :offset="5" :hide-after="0"
                        :show-arrow="false" popper-class="ruleexam-tiptap-popover-menu">
                        <ul class="fits-dropdown-menu" @click="state.showLineHeightPopover = false; state.showParagraphPopover = false">
                            <li class="fits-dropdown-item" v-for="(item, index) in lineHeightArray" :key="index"
                                @click="editor.chain().focus().setLineHeight(item.toString()).run()">
                                <span>{{ item }}</span>
                            </li>

                        </ul>
                        <template #reference>
                            <button type="button" class="fits-dropdown-item paragraph-menu-action" :aria-expanded="state.showLineHeightPopover">
                                <SvgIcon icon-class="line-height" /><span>行距</span>
                                <SvgIcon icon-class="arrow-down-s-line" style="margin-left: auto; transform: rotate(-90deg)"></SvgIcon>
                            </button>
                        </template>
                    </el-popover>
                    <el-popover placement="right-start" width="130" trigger="click" v-model:visible="state.showTextAlign"
                        :teleported="false" :offset="5" :show-arrow="false" popper-class="ruleexam-tiptap-popover-menu">
                        <ul class="fits-dropdown-menu" @click="state.showTextAlign = false; state.showParagraphPopover = false"
                            @mousedown.prevent>
                            <li class="fits-dropdown-item" @click="editor?.chain().focus().setTextAlign('center').run()"
                                :class="{ 'is-active': editor?.isActive({ textAlign: 'center' }) }">
                                <SvgIcon icon-class="align-center"></SvgIcon>
                                <span style="font-size: 12px">居中对齐</span>
                            </li>
                            <li class="fits-dropdown-item" @click="editor?.chain().focus().setTextAlign('justify').run()"
                                :class="{ 'is-active': editor?.isActive({ textAlign: 'justify' }) }">
                                <SvgIcon icon-class="align-justify"></SvgIcon>
                                <span style="font-size: 12px">两端对齐</span>
                            </li>
                            <li class="fits-dropdown-item" :class="{ 'is-active': editor?.isActive({ textAlign: 'left' }) }"
                                @click="editor?.chain().focus().setTextAlign('left').run()">
                                <SvgIcon icon-class="align-left"></SvgIcon>
                                <span style="font-size: 12px">左对齐</span>
                            </li>
                            <li class="fits-dropdown-item" @click="editor.chain().focus().setTextAlign('right').run()"
                                :class="{ 'is-active': editor?.isActive({ textAlign: 'right' }) }">
                                <SvgIcon icon-class="align-right"></SvgIcon>
                                <span style="font-size: 12px">右对齐</span>
                            </li>

                        </ul>
                        <template #reference>
                            <button type="button" class="fits-dropdown-item paragraph-menu-action" :aria-expanded="state.showTextAlign">
                                <SvgIcon :icon-class="textAlign" /><span>对齐方式</span>
                                <SvgIcon icon-class="arrow-down-s-line" style="margin-left: auto; transform: rotate(-90deg)" />
                            </button>
                        </template>
                    </el-popover>
                    <button type="button" class="fits-dropdown-item paragraph-menu-action"
                        @click="editor?.chain().focus().increaseIndent().run(); state.showParagraphPopover = false">
                        <SvgIcon icon-class="indent-increase" /><span>增加缩进</span>
                    </button>
                    <button type="button" class="fits-dropdown-item paragraph-menu-action"
                        @click="editor?.chain().focus().decreaseIndent().run(); state.showParagraphPopover = false">
                        <SvgIcon icon-class="indent-decrease" /><span>减少缩进</span>
                    </button>
                </div>
                <template #reference>
                    <button type="button" class="menu-btn-item" @mousedown.prevent :aria-expanded="state.showParagraphPopover" aria-label="段落">
                        <SvgIcon :icon-class="textAlign" />
                        <span class="menu-btn-item_name" style="margin-left: 4px">段落</span>
                        <SvgIcon icon-class="arrow-down-s-line" style="color: #aab4bf" />
                    </button>
                </template>
            </el-popover>
        </div>
        <div class="menu-btn-group">
            <el-popover placement="bottom" width="150" trigger="click" v-model:visible="state.showInsertPopover" :offset="5" :hide-after="0"
                @hide="state.showTablePopover = false"
                :show-arrow="false" popper-class="ruleexam-tiptap-popover-menu">
                <ul class="fits-dropdown-menu" style="overflow: visible" @mousedown.prevent>
                    <!-- 表格选择 -->
                    <el-popover class="box-item" :offset="0" trigger="hover" v-model:visible="state.showTablePopover"
                        :teleported="false" width="185" :show-arrow="false" :hide-after="0" placement="right-start">
                        <div ref="ignoreTablePopverElement">
                            <!-- 行列提示 -->
                            <div class="grid-header">
                                {{ selectedCols }} × {{ selectedRows }} 表格
                            </div>
                            <!-- 表格选择网格 -->
                            <div class="table-grid" @mousemove="handleMouseMove" @click.stop="insertTable">
                                <div v-for="row in maxRows" :key="row" class="table-grid-row">
                                    <div v-for="col in maxCols" :key="col" class="table-grid-cell" :class="{
                                        'active': row <= selectedRows && col <= selectedCols
                                    }"></div>
                                </div>
                            </div>
                        </div>
                        <template #reference>
                            <li class="fits-dropdown-item">
                                <SvgIcon icon-class="table-view"></SvgIcon>
                                <span>表格</span>
                            </li>
                        </template>
                    </el-popover>

                    <li class="fits-dropdown-item" @click="editor.chain().focus().setHorizontalRule().run(); state.showInsertPopover = false">
                        <SvgIcon icon-class="page-separator"></SvgIcon>
                        <span>分隔线</span>
                    </li>
                    <li>
                        <button type="button" class="fits-dropdown-item paragraph-menu-action"
                            @click="editor?.chain().focus().toggleSuperscript().run(); state.showInsertPopover = false"
                            :disabled="!editor?.can().chain().focus().toggleSuperscript().run()"
                            :class="{ 'is-active': editor?.isActive('superscript') }">
                            <SvgIcon icon-class="superscript" /><span>上标</span>
                        </button>
                    </li>
                    <li>
                        <button type="button" class="fits-dropdown-item paragraph-menu-action"
                            @click="editor?.chain().focus().toggleSubscript().run(); state.showInsertPopover = false"
                            :disabled="!editor?.can().chain().focus().toggleSubscript().run()"
                            :class="{ 'is-active': editor?.isActive('subscript') }">
                            <SvgIcon icon-class="subscript" /><span>下标</span>
                        </button>
                    </li>
                    <li>
                        <button type="button" class="fits-dropdown-item paragraph-menu-action"
                            @click="editor?.chain().focus().toggleStrike().run(); state.showInsertPopover = false"
                            :disabled="!editor?.can().chain().focus().toggleStrike().run()"
                            :class="{ 'is-active': editor?.isActive('strike') }">
                            <SvgIcon icon-class="strikethrough" /><span>删除线</span>
                        </button>
                    </li>
                </ul>
                <template #reference>
                    <button type="button" class="menu-btn-item" @mousedown.prevent :aria-expanded="state.showInsertPopover" aria-label="插入">
                        <SvgIcon icon-class="add-circle-line" style="margin-right: 4px;"></SvgIcon>
                        <span class="menu-btn-item_name">插入</span>
                        <SvgIcon icon-class="arrow-down-s-line" style="color: #aab4bf"></SvgIcon>
                    </button>
                </template>
            </el-popover>
        </div>
    </div>
</template>

<script lang='ts' setup>
import SvgIcon from './SvgIcon.vue';
import { Editor } from '@tiptap/vue-3';
import { ClickOutside as vClickOutside } from 'element-plus';
import { computed, nextTick, reactive, ref } from 'vue';
const props = defineProps({
    editor: {
        type: Editor,
        default: null
    }
})

const state = reactive({
    // 显示插入的popver
    showFontPopover: false,
    // 显示字体选择的popover
    showFontSizePopover: false,
    // 显示字体大小的popover
    showLineHeightPopover: false,
    // 显示行高的popover
    showInsertPopover: false,
    showParagraphPopover: false,
    // 对齐方式
    showTextAlign: false,
    // 设置颜色
    showBackgroundColorPopover: false,
    // 设置字体颜色
    showFontColorPopover: false,
    // 表格
    showTablePopover: false,

})

const lineHeightArray = ref([1, 1.2, 1.5, 1.75, 2, 2.5, 3])
const ignoreFontPopverElement = ref();
const ignoreFontSizePopverElement = ref();
const ignoreBackgroundColorPopverElement = ref();
const ignoreFontColorPopverElement = ref();
const ignoreTablePopverElement = ref(); // 忽略点击的元素
// 对齐方式
const textAlign = computed(() => {
    if (props.editor?.isActive({ textAlign: 'left' })) {
        return 'align-left'
    } else if (props.editor?.isActive({ textAlign: 'center' })) {
        return 'align-center'
    } else if (props.editor?.isActive({ textAlign: 'right' })) {
        return 'align-right'
    } else if (props.editor?.isActive({ textAlign: 'justify' })) {
        return 'align-justify'
    } else {
        return 'align-center'
    }
})
// 字体选择
const fontFamily = computed(() => {
    if (props.editor?.isActive({ fontFamily: 'SimSun' })) {
        return '宋体'
    } else if (props.editor?.isActive({ fontFamily: 'SimHei' })) {
        return '黑体'
    } else if (props.editor?.isActive({ fontFamily: 'KaiTi' })) {
        return '楷体'
    } else if (props.editor?.isActive({ fontFamily: 'FangSong' })) {
        return '仿宋'
    } else if (props.editor?.isActive({ fontFamily: 'Microsoft YaHei' })) {
        return '微软雅黑'
    } else {
        return '宋体'
    }
})
// 字体大小选择
const fontSize = computed(() => {
    for (let i = 9; i <= 36; i++) {
        if (props.editor?.isActive('textStyle', { fontSize: `${i}pt` })) {
            // console.warn(i);
            return i.toString();
        }
    }
    return '11'; // 或者你可以返回一个默认值
});
// 网格配置
const maxRows = 6
const maxCols = 10
const selectedRows = ref(0)
const selectedCols = ref(0)
const hoverRow = ref(0)
const hoverCol = ref(0)

// 鼠标移动处理
const handleMouseMove = (event: MouseEvent) => {
    // if (!popoverVisible.value) return

    const grid = event.currentTarget as HTMLElement
    const rect = grid.getBoundingClientRect()

    // 计算鼠标在网格中的位置
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    // 计算行/列索引（+1 因为索引从1开始）
    hoverCol.value = Math.min(maxCols, Math.floor(x / 16) + 1)
    hoverRow.value = Math.min(maxRows, Math.floor(y / 16) + 1)

    // 更新选择
    selectedRows.value = hoverRow.value
    selectedCols.value = hoverCol.value
}
function insertTable() {
    if (selectedRows.value <= 0 || selectedCols.value <= 0) {
        return;
    }
    // 插入表格
    props.editor?.chain().focus().insertTable({
        rows: selectedRows.value,
        cols: selectedCols.value,
        withHeaderRow: true
    }).run()
    state.showTablePopover = false;
    nextTick(() => {
        // 关闭父级弹窗
        state.showInsertPopover = false;
    })
}
function closeAllPopover(event: any, ignoreElement: any, varName: string) {
    if (ignoreElement?.contains(event.target)) {
        return;
    }
    state[varName as keyof typeof state] = false; // 关闭弹框
    // console.log('点击了外部区域', state);

}
function handleMouseLeaveTable(event: MouseEvent) {
    const grid = event.currentTarget as HTMLElement
    // 鼠标离开表格选项时，判断是否在弹框中
    if (ignoreTablePopverElement?.value?.contains(grid)) {
        return;
    }
    state.showTablePopover = false; // 关闭弹框
}
</script>
<style lang='scss' scoped>
.paragraph-menu-action { width: 100%; border: 0; font: inherit; color: inherit; text-align: left; }
.menu-btn-groups {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;

    .menu-btn-group {
        display: flex;
        position: relative;

        .menu-btn-item {
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            height: 24px;
            margin: 0 5px;
            padding: 0 6px;
            border: none;
            background: transparent;
            outline: none;

            &:hover,
            &.is-active {
                background: #e6eaee;
                border-radius: 3px;
            }

            &_name {
                font-size: 13px;
                white-space: nowrap;
                user-select: none;
            }
        }

        &::after {
            background: #e6eaee;
            content: "";
            display: block;
            height: 14px;
            position: absolute;
            right: 0;
            top: 6px;
            width: 1px;
        }

        &:last-child {
            &::after {
                display: none;
            }
        }

    }

    .menu-btn-item-active-color {
        background: #000;
        height: 2px;
        outline: 1px solid #e6eaee;
        width: 12px;
    }


}

// 表格配置
.table-grid {
    user-select: none;
}

.table-grid-row {
    display: flex;
    margin-bottom: 2px;

    &:last-child {
        margin-bottom: 0;
    }
}

.table-grid-cell {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 1px solid rgba(0, 0, 0, .08);
    margin-right: 2px;
    transition: all 0.1s;
    box-sizing: border-box;
}

.table-grid-cell.active {
    background-color: #9adeff;
    /* 选中区域颜色 */
    // border-color: #409eff;
}

// .table-grid-cell.hover {
//     background-color: #e6f7ff;
//     /* 悬停单元格颜色 */
// }

.grid-header {
    color: #7a8794;
    font-size: 12px;
    line-height: 12px;
    margin-bottom: 4px;
}
</style>
<style lang='scss'>
.ruleexam-tiptap-tooltip-btn {
    padding: 2px 5px !important;
    font-size: 11px !important;
    line-height: 16px !important;
}

.ruleexam-tiptap-popover-menu {
    --el-popover-padding: 0 !important;
    min-width: 50px !important;

    .fits-dropdown-menu {
        padding: 4px;
        margin: 0;
        list-style: none;
        max-height: 300px;
        overflow-y: auto;
        overflow-y: overlay;
    }

    .fits-dropdown-item {
        padding: 6px 12px;
        display: flex;
        height: 32px;
        user-select: none;
        cursor: pointer;
        align-items: center;
        border-radius: 4px;
        background-color: #fff;
        list-style: none;
        white-space: normal;

        &:hover,
        &.is-active {
            background-color: #f2f4f7;
        }

        &+.fits-dropdown-item {
            margin-top: 2px;
        }

        &>span {
            margin-left: 4px;
        }


    }

    .item-color-dropdown {
        // 调色板
        width: 206px;

        .item-color-dropdown-group {
            padding: 8px;

            &:not(:first-child) {
                border-top: 1px solid #eff3f6;
            }
        }

        .item-color-dropdown-item {
            border: 1px solid rgba(0, 0, 0, .078);
            -webkit-box-sizing: border-box;
            box-sizing: border-box;
            cursor: pointer;
            display: inline-block;
            height: 20px;
            margin-left: 4px;
            width: 20px;

            &:nth-of-type(8n+1) {
                margin-left: 0;
            }

            &:hover {
                outline: 1px solid #000;
            }
        }

        .item-color-dropdown-button {
            padding: 0 8px 8px;
        }

    }
}
</style>
