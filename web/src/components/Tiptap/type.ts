
import type { JSONContent } from '@tiptap/core';

export type EditorProfile = 'plain' | 'rich' | 'question';
export type EditorMode = 'edit' | 'preview' | 'review';
export type EditorPresentation = 'inline' | 'dialog';

// 模板设置
export class TiptapTemplate {
    // tiptap模板内容, edit.getJSON()
    templateContent: JSONContent
    // 模板基础设置
    templateSetting: TemplateSetting
    // 创建者
    creator: string
    // 创建时间
    createTime: string
    // 更新者
    updater: string
    // 更新时间
    updateTime: string
    constructor(data: any = {}) {
        this.templateContent = data?.templateContent || { type: 'doc', content: [{ type: 'paragraph' }] }
        this.templateSetting = new TemplateSetting(data?.templateSetting);
        this.creator = data?.creator || "";
        this.createTime = data?.createTime || "";
        this.updater = data?.updater || "";
        this.updateTime = data?.updateTime || "";

    }
}

export class TemplateSetting {
    /**
     * 模板名称
     *
     */
    templateName: string;
    /**
   * 页面大小，例如 "A4"
   */
    pageSize: string;

    /**
     * 页面边距减少设置
     */
    pageSizeReduce: PageSizeReduce;
    /**
   * 页面方向，1 表示纵向，2 表示横向
   */
    pageOrientation: number;
    constructor(data: any = {}) {
        this.templateName = data?.templateName || "未命名文书"
        this.pageSize = data?.pageSize || "A4"
        this.pageSizeReduce = new PageSizeReduce(data?.pageSizeReduce)
        this.pageOrientation = data?.pageOrientation || 1
    }

}

export class PageSizeReduce {
    /**
        * 上边距，单位为mm
        */
    top: number;

    /**
     * 左边距，单位为mm
     */
    left: number;

    /**
     * 右边距，单位为mm
     */
    right: number;

    /**
     * 下边距，单位为mm
     */
    bottom: number;
    constructor(data: any = {}) {
        this.top = data?.top ?? 15
        this.left = data?.left ?? 15
        this.right = data?.right ?? 15
        this.bottom = data?.bottom ?? 15
    }
}
export enum ControlType {
    // 文本输入
    text = 1,
    // 下拉选择
    select = 2,
    // 日期选择
    date = 3,
    // 数字输入
    inputNumber = 4,
    // 多选
    checkbox = 5,
    // 地理位置
    location = 6,
    // 单选
    radio = 7,
}
// 控件类型的中文
export const ControlTypeName: { [key in ControlType]: string } = {
    [ControlType.text]: "文本输入",
    [ControlType.select]: "下拉选择",
    [ControlType.date]: "日期选择",
    [ControlType.inputNumber]: "数字输入",
    [ControlType.checkbox]: "多选",
    [ControlType.location]: "地理位置",
    [ControlType.radio]: "单选"
}
// 对齐方式
export enum AlignType {
    // 左对齐
    left = 1,
    // 居中对齐
    center = 2,
    // 右对齐
    right = 3,
}
// 对齐方式的中文
export const AlignTypeName: { [key in AlignType]: string } = {
    [AlignType.left]: "左对齐",
    [AlignType.center]: "居中对齐",
    [AlignType.right]: "右对齐",
}
// 下拉选择，单选，多选的数据类型
export type OptionType = {
    /**
     * 选项的值
     */
    value: string | number;
    /**
     * 选项的标签
     */
    label: string;
    /**
     * 是否选择
     */
    selected?: boolean;
}
// 对齐方式的下拉选项
export const AlignTypeOptions: OptionType[] = Object.entries(AlignTypeName).map(([key, value]) => ({ label: value, value: Number(key) }))

// 时间格式的下拉选项
export const DateFormatOptions = [
    { label: "年-月-日", value: "YYYY-MM-DD" },
    { label: "年/月/日", value: "YYYY/MM/DD" },
    { label: "月/日/年", value: "MM/DD/YYYY" },
    { label: "日-月-年", value: "DD-MM-YYYY" },
    { label: "日/月/年", value: "DD/MM/YYYY" },
    { label: "年-月", value: "YYYY-MM" },
    { label: "年/月", value: "YYYY/MM" },
    { label: "月-年", value: "MM-YYYY" },
    { label: "月/年", value: "MM/YYYY" },
    { label: "年-月-日 时:分:秒", value: "YYYY-MM-DD HH:mm:ss" },
    { label: "年/月/日 时:分:秒", value: "YYYY/MM/DD HH:mm:ss" },
    { label: "年-月-日 时:分", value: "YYYY-MM-DD HH:mm" },
    { label: "年/月/日 时:分", value: "YYYY/MM/DD HH:mm" },
]
// 排列方式的下拉选项
export const LayoutOptions = [
    { label: "上下排列", value: 2 },
    { label: "左右排列", value: 1 },
]

function normalizeFlag(value: unknown): 0 | 1 {
    return value === 1 || value === '1' || value === true ? 1 : 0;
}


// 模板控件配置
export class TemplateControl {
    /**
    * 唯一标识符
    */
    id: string;

    /**
     * 控件名称
     */
    name: string;

    /**
     * 是否必填，0 表示否，1 表示是
     */
    isRequired: number;

    /**
     * 是否可编辑，0 表示否，1 表示是
     */
    isEdit: number;

    /**
     * 是否下划线，0 表示否，1 表示是
     */
    isUnderline: number;

    /**
     * 是否只读，0 表示否，1 表示是
     */
    isReadonly: number;

    /**
     * 占位符文本
     */
    placeholder: string;

    /**
     * 对齐方式
     */
    align: AlignType;

    /**
     * 宽度，就是显示字数，每个字数是11pt，如果8个字，则宽度为88pt
     */
    width: number;
    /**
     * 文字大小
     */
    fontSize: number;

    /**
     * 类型
     */
    type: ControlType;
    /**
     * 类型名称
     */
    typeName: string;

    /**
     * 控件的值
     */
    value: string;
    /**
     * 控件的值
     */
    label: string;

    /**
     * 标签,用这个来分组
     */
    tag: number;

    /**
     * 分组id
     */
    group: string | null;

    /**
    * 选中
    */
    checked: boolean;

    /**
     * 属性，可以为 null
     */
    attr: any;

    /**
     * 引用键，可以为 null
     */
    refKey: any;

    /**
     * 数据来源，记录数据字典的code值
     */
    dataSourceCode: string | null;

    /**
     * 选择项,下拉选择的数据项
     * 例如：[{label: "选项1", value: "1"}, {label: "选项2", value: "2"}]
     */
    options: string;
    /**
     * 动态选项，下拉选择数据项
     * 通过数据字典获取dataSourceCode，或者options静态选项获取
     */
    dynamicOptions: OptionType[];

    /**
     * 是否多选，0 表示否，1 表示是
     */
    isMultiple: number;
    /**
     * 时间格式
     */
    dateFormat: string;
    /**
     * 排列方式
     * 2 表示上下排列，1 表示左右排列
     */
    layout: number;
    /**
     * 计算公式
     */
    formula: string;

    /**
    * 控件图标
    */
    icon: string;

    /**
     * 排序顺序
     */
    sort: number;
    // 父级id
    parentId: string;
    // 子级
    children: Partial<TemplateControl>[];
    constructor(data: any = {}) {
        this.id = data?.id || ""
        this.name = data?.name || ""
        this.isRequired = normalizeFlag(data?.isRequired)
        this.isEdit = normalizeFlag(data?.isEdit)
        this.isUnderline = normalizeFlag(data?.isUnderline)
        this.isReadonly = normalizeFlag(data?.isReadonly)
        this.placeholder = data?.placeholder || ""
        this.width = data?.width || 0
        this.fontSize = data?.fontSize || 11
        this.type = data?.type || ControlType.text
        this.tag = data?.tag || 0
        this.group = typeof data?.group === 'string' && data.group ? data.group : null
        this.attr = data?.attr || null
        this.refKey = data?.refKey || null
        this.sort = data?.sort || 0
        this.typeName = data?.typeName || ControlTypeName[this.type]
        this.align = [AlignType.left, AlignType.center, AlignType.right].includes(Number(data?.align))
            ? Number(data.align) as AlignType
            : AlignType.left
        this.options = data?.options ?? "1:选项1\n2:选项2\n3:选项3"
        this.isMultiple = normalizeFlag(data?.isMultiple)
        this.dateFormat = data?.dateFormat || "YYYY-MM-DD"
        this.layout = data?.layout === 2 || data?.layout === '2' ? 2 : 1
        this.formula = data?.formula || ""
        this.icon = data?.icon || ""
        this.value = data?.value || ""
        this.dataSourceCode = data?.dataSourceCode === '' ? '' : null
        this.checked = data?.checked === true || data?.checked === 1 || data?.checked === '1'
        this.label = data?.label
        this.dynamicOptions = Array.isArray(data?.dynamicOptions) ? data.dynamicOptions : []
        this.parentId = data?.parentId || ""
        this.children = data?.children || []
    }

    /**
     * 获取下拉选项,options是多行文本字符串，字段之间以英文冒号( : )分隔，多条记录以换行分隔，则转换为数组
     * @description 处理逻辑如下：
     * 1、按第一个冒号分割（支持 value 中包含冒号）
     * 2、自动跳过无效行（空行或缺少冒号）
     * 3、返回标准 {label, value} 数组
     */
    get optionItems(): OptionType[] {
        if (!this.options) {
            return []
        }
        return this.options.split("\n").reduce((result: OptionType[], line) => {
            // 1. 去除前后空格
            const trimmedLine = line.trim();
            //  2. 跳过空行
            if (!trimmedLine) return result;
            // 3. 根据冒号分割
            const parts = trimmedLine.split(':');
            if (parts.length >= 2) {
                // 取第一个冒号作为分隔符, 感叹号是非空断言操作符
                const value = parts.shift()!;
                const label = parts.join(':');

                if (label) {
                    result.push({ label, value, selected: false });
                }
            }
            return result;
        }, [])
    }

    // 获取




}
