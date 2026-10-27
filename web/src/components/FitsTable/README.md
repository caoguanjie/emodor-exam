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
  <el-table :data="items">
    <!-- 现有数据列 -->
    <el-table-column label="操作">
      <template #default="{ row }">
        <FitsTableActions>
          <FitsTableAction v-if="canEdit" @click="edit(row)">编辑</FitsTableAction>
          <FitsTableAction type="warning" :disabled="row.pending" @click="disable(row)">停用</FitsTableAction>
          <FitsTableAction type="danger" :loading="row.resetting" @click="resetPassword(row)">重置密码</FitsTableAction>
        </FitsTableActions>
      </template>
    </el-table-column>
  </el-table>
  <template #pagination><el-pagination ... /></template>
</FitsTable>
```

- 页面负责字段、权限、请求、加载/错误、数据、分页事件及弹窗，组件不接管业务状态。
- 插槽按需提供；没有查询、操作或分页就不渲染对应区域。树表和全量列表无需虚设分页。
- `FitsListSearch` 默认使用等宽网格和 88px 标签宽度。每列最小 310px（容器不足时不超出容器），按可用宽度自动换行；字段内容最大 260px，输入框、选择器和日期控件填满内容区。768px 及以下改为单列并取消内容区最大宽度，查询与重置按钮保持自然宽度、8px 间距。
- 特殊筛选字段也遵循统一标签和控件布局，不在页面内另设控件宽度；公共样式只匹配筛选表单的直接字段和控件，不影响嵌套输入框或弹窗表单。Element Plus 表单属性与提交事件仍可透传，查询、重置、权限和业务状态仍由页面维护；组件仅阻止原生表单跳转。
- `FitsTableActions` 负责行操作的换行和 10px 间距，全部操作被 `v-if` 隐藏时不留下空容器。只重置容器内相邻按钮的默认外边距。
- 行操作结构依据参考目录内 `FitsTable.vue`，以及 `admin/src/views/system-manage/user/components/userManage.vue` 行操作的 10px 间距、下划线。参考源的按钮字号为 12px，本项目按用户最新要求统一为 14px，左右各保留 4px 内边距；不迁入工具栏的实心按钮样式。
- `FitsTableAction` 使用现有 Element Plus 配色，默认 `primary`，停用用 `warning`、重置/删除用 `danger`，颜色按业务语义指定。统一强制 link、无底色无边框，不接收 text/bg/tag 改成其他外观或标签；仍是可聚焦的原生 button，保留键盘焦点提示。
- 行按钮属性、事件和插槽透传给 Element Plus；`disabled` / `loading` 时禁止点击。权限、确认、请求与业务状态仍由页面维护；新增、查询和弹窗按钮不使用行操作组件。
- 行按钮在默认、hover、active 状态均无阴影和抬升位移，不继承全局 primary 实心按钮的效果；普通按钮继续保留原有样式。
- 保留真正的业务操作。没有搜索显隐、列设置、通用刷新、通用导出、全屏等右上角工具栏。
- 样式只作用于公共组件；颜色沿用现有 `--re-*` 与 Element Plus 主题，不修改全局主题。
