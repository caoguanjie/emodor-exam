# 撤回发布回草稿

用户明确要求撤回后原卷回到草稿，恢复题目/题单/试卷属性编辑、预览及重新发布；覆盖旧withdrawn终态合同。按Astra并行处理前后端与只读探索，不经过SDD。

- withdraw锁内published/历史withdrawn→draft；已发布过的draft重复撤回幂等，原生草稿/归档拒绝。
- 草稿普通和答案预览读当前题单；重新发布递增release版本，旧release/assignment/records不改。
- 原已开始考试继续旧卷，新学员在重新发布后拿新卷，已有assignment补考仍按原冻结规则。
- 新增041兼容training withdrawn，旧040及checksum不改。有历史引用的草稿保留删除保护，不清理考试数据。
- 前端以API刷新后的真实draft恢复权限按钮，取消/失败/忙状态不回归。
- 单元、前端交互、隔离API撤回-修改-预览-再发布与版本保护测试；独立reviewer审查固定差异，root窄范围集成。

本次不改legacy/归档、不引入软删除、不提交/推送、不做真机测试。
