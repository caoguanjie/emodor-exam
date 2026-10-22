# 公共列表布局

参考项目：`gooodwork/.worktrees/pc-admin-migration/admin/src/fits-components/Table/FitsTable/`。
从 `FitsTable.vue`、`FitsListSeach.vue` 提取查询区、操作区、表格区、分页区的组织方式，适配当前项目的 Element Plus。
不是整套 VXE 组件的原样迁入，不引入 VXE、FormCreate、用户偏好存储或参考项目的配色。

```vue
<FitsTable>
  <template #search>
    <FitsListSearch>
      <el-form-item label="名称"><el-input v-model="query.keyword" /></el-form-item>
      <template #actions><el-button @click="search">查询</el-button></template>
    </FitsListSearch>
  </template>
  <template #actions><el-button @click="create">新增</el-button></template>
  <el-table :data="items"><!-- 现有列和行操作 --></el-table>
  <template #pagination><el-pagination ... /></template>
</FitsTable>
```

- 页面负责字段、权限、请求、加载/错误、数据、分页事件及弹窗，组件不接管业务状态。
- 插槽按需提供；没有查询、操作或分页就不渲染对应区域。树表和全量列表无需虚设分页。
- `FitsListSearch` 默认内联布局和 88px 标签宽度；可以透传 Element Plus 表单属性与提交事件。不自动查询或重置，仅阻止原生表单跳转。
- 保留真正的业务操作。没有搜索显隐、列设置、通用刷新、通用导出、全屏等右上角工具栏。
- 样式只作用于公共组件；颜色沿用现有 `--re-*` 与 Element Plus 主题，不修改全局主题。
