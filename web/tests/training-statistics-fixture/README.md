# 培训统计页面视觉夹具

在该工作区启动现有 web Vite 后访问 `/tests/training-statistics-fixture/`。夹具挂载真实 `TrainingStatistics.vue`、Element Plus 与公共样式，仅将当前页面的 Axios adapter 和内存 Pinia 身份替换为三场考试的示例数据。不读取凭据、不写登录存储、不连接业务 API，不代表真实后端或生产验收。

可检查：考试名和类别查询、成绩分析与返回列表、分难度补充指标、性别、分数和用时排序、排名翻页与课程区域折叠。排序只改变展示顺序，名次由示例服务保留；`window.trainingStatisticsFixtureCalls` 可核对分页和导出查询。导出按钮只记录请求并明确提示需要真实后端，不生成伪 Excel。

地址参数 `?empty` 显示空列表，`?error` 模拟详情失败，`?no-export` 使用无导出权限身份。夹具由根任务负责启动与浏览器操作。
