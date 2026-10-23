import { useDebounceFn } from '@vueuse/core';
import { effectScope, onBeforeUnmount, ref, watch } from "vue";
import { nanoid } from "../extensions/WidgetNodes";
import type { OptionType, TemplateControl } from "../type";
import dataSourceList from '../utils/dataSourceList.json'
import Fuse from "fuse.js";

type DataSourceItem = { dictionaryID: string; name: string; code: string };
const dataSourceItems = dataSourceList.result.items as DataSourceItem[];


export function useDynamicOptions({
    dataSourceCodeFunc,
    optionsFunc
}: {
    // 响应式数据源编码
    dataSourceCodeFunc: () => string | null | undefined,
    // 响应式静态选项（可以是字符串）
    optionsFunc: () => string | undefined;
}) {
    // 最终动态选项
    const dynamicOptions = ref<OptionType[]>([]);
    const scope = effectScope();
    // 处理数据字典选项
    const processDataSource = (code: string): OptionType[] => {
        if (!dataSourceItems.length) return [];

        const fuse = new Fuse(dataSourceItems, {
            keys: ['dictionaryID'],
            includeScore: true
        });

        return fuse.search(code).map(item => ({
            label: item.item.name,
            value: item.item.code,
            selected: false
        }));
    };

    // 处理静态选项
    const processStaticOptions = (optionString: string | undefined): OptionType[] => {
        if (!optionString) {
            return []
        }
        return optionString.split("\n").reduce((result: OptionType[], line) => {
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
    scope.run(() => {

        const staticOptionsDebounce = useDebounceFn(() => {
            // 如果有动态数据源，就不需要处理静态选项
            if (dataSourceCodeFunc()) {
                return;
            }
            dynamicOptions.value = processStaticOptions(optionsFunc());
        }, 500)
        // 监听数据源code变化， 这里不用设置immediate，因为数据源变化的时候，静态选项也会变化
        watch(dataSourceCodeFunc, (code) => {
            if (code) {
                dynamicOptions.value = processDataSource(code);
            } else {
                // 如果是空值
                dynamicOptions.value = processStaticOptions(optionsFunc());
            }
        })
        // 监听静态选项变化,
        watch(optionsFunc, staticOptionsDebounce, { immediate: true })
    })

    onBeforeUnmount(() => {
        scope.stop()
    })

    return {
        dynamicOptions
    };
}




export const commonWidgetData: Partial<TemplateControl>[] = [{
    id: nanoid(),
    name: '通用',
    icon: 'general',
    children: [
        {
            id: nanoid(),
            name: '选择',
            children: [
                {
                    id: nanoid(),
                    name: "下拉",
                    isRequired: 0,
                    isEdit: 0,
                    isUnderline: 0,
                    placeholder: "选项下拉框",
                    width: 8,
                    type: 2,
                    typeName: '下拉',
                    tag: 0,
                    attr: null,
                    refKey: null,
                    sort: 30,
                },
                {
                    id: nanoid(),
                    name: "多选",
                    isRequired: 0,
                    isEdit: 0,
                    isUnderline: 0,
                    placeholder: "多选",
                    width: 3,
                    type: 5,
                    typeName: '多选',
                    tag: 0,
                    attr: null,
                    refKey: null,
                    sort: 50
                },
                {
                    id: nanoid(),
                    name: "单选",
                    isRequired: 0,
                    isEdit: 0,
                    isUnderline: 0,
                    placeholder: "单选",
                    typeName: '单选',
                    width: 3,
                    type: 7,
                    tag: 0,
                    attr: null,
                    refKey: null,
                    sort: 140
                },
                {
                    id: nanoid(),
                    name: "人员信息",
                    isRequired: 0,
                    isEdit: 0,
                    isUnderline: 0,
                    placeholder: "人员信息",
                    typeName: "人员信息",
                    width: 4,
                    type: 2,
                    options: "staff_1:人员一\nstaff_2:人员二",
                    tag: 0,
                    attr: null,
                    refKey: null,
                    sort: 1080
                },
            ]
        },

        {
            id: nanoid(),
            name: '文本输入',
            children: [
                {
                    id: nanoid(),
                    name: "文本输入",
                    isRequired: 0,
                    isEdit: 0,
                    isUnderline: 0,
                    placeholder: "文本输入",
                    typeName: "文本输入",
                    width: 8,
                    type: 1,
                    tag: 0,
                    attr: null,
                    refKey: null,
                    sort: 10,
                    children: []
                },
                {
                    id: nanoid(),
                    name: "数字输入",
                    isRequired: 0,
                    isEdit: 0,
                    isUnderline: 0,
                    placeholder: "数字输入",
                    typeName: "数字输入",
                    width: 8,
                    type: 4,
                    tag: 0,
                    attr: null,
                    refKey: null,
                    sort: 20
                },

            ]
        },
        {
            id: nanoid(),
            name: '其他',
            children: [
                {
                    id: nanoid(),
                    name: "日期时间",
                    isRequired: 0,
                    isEdit: 0,
                    isUnderline: 0,
                    placeholder: "日期时间",
                    typeName: "日期时间",
                    width: 8,
                    type: 3,
                    tag: 0,
                    attr: null,
                    refKey: null,
                    sort: 40
                },
                {
                    id: nanoid(),
                    name: "地理位置",
                    isRequired: 0,
                    isEdit: 0,
                    isUnderline: 0,
                    placeholder: "地理位置",
                    typeName: "地理位置",
                    width: 8,
                    type: 6,
                    tag: 0,
                    attr: null,
                    refKey: null,
                    sort: 60
                }
            ]
        },





    ]
}]
