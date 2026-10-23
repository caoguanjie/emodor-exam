# main 试卷设计器集成验收记录

日期：2026-10-23。范围以[集成设计](../docs/superpowers/specs/2026-10-23-main-question-paper-designer-integration-design.md)和[实施计划](../docs/superpowers/plans/2026-10-23-main-question-paper-designer-integration.md)为准。当前新增/编辑题目继续使用既有表单，本期只移植完整 PaperDesigner 及其必要依赖。本记录区分源码、自动化、桌面浏览器、真实设备和生产；不能据本页推定未执行的验收通过。

## 候选与范围

当前项目 `/Users/caogj/Documents/emodor/RuleExam`，分支 `main`。初始集成基线为 `525790a62ac0654a2e4d91facc5cff5242ae33d9`；执行中用户并发提交网站配置，HEAD推进至 `c2effd4e5c53baf233e2f00dde27824f2b70c514`，本任务未撤销该提交。本记录在提交前按暂存索引重新构建候选；最终本地提交哈希以交付信息为准，不代表部署。

来源为 `/Users/caogj/.codex/worktrees/155a/RuleExam`，分支 `feature/question-authoring-integration`，来源HEAD `09ddb1f97c179b75289da9a7afec0d59bb62b645`。来源存在未提交候选，不能只用HEAD代表输入。原始来源/dirty/哈希与选择理由见[来源manifest](main-designers-source-manifest-2026-10-23.json)，内容白名单见[内容合同报告](main-designers-content-contract-2026-10-23.md)。来源工作区只读；当前项目既有及并发dirty保留，worker未暂存或提交。

本次整链使用 `tests/run-e2e.mjs --ephemeral` 创建自有MySQL、Redis、数据库、随机密钥和上传目录；不读取 `.env`，不连接开发库，不调用真实短信/腾讯/商业AI。实名只在 `server/test/identity-e2e-main.ts` 测试模块内override真实provider接口；运行时`IDENTITY_PROVIDER`仍为disabled，不增加test-pass。

## 自动化证据

| 检查 | 实际结果 | 证据边界 |
|---|---|---|
| runner RED：`node --test tests/suite-selection.test.mjs` | 22项，20 PASS、2 FAIL；两新增key分别报“未知测试套件” | 有效缺注册红灯；fixture/预期修正不冒充RED |
| runner GREEN：同一命令 | 22/22 PASS，exit0 | 两suite单选和all聚合各只注册一次，沿用隔离生命周期与中断保护 |
| `npm --prefix server run build` | exit0 | TypeScript构建，不代替HTTP、浏览器或生产升级 |
| `npm --prefix server test` | 58个文件、841/841 PASS，exit0 | 服务端全量单测；不是数据库或浏览器验收 |
| 暂存索引导出到独立临时目录后执行server build、`vue-tsc --noEmit`、Vite build、mobile type-check/unit | 全部exit0；mobile 38文件、357/357 PASS、0类型错误 | 验证实际待提交快照，不借用工作区内未暂存的课程、统计或FitsTable并行改动 |
| Web设计器/表单/恢复定向测试 | 9个文件、178/178 PASS | 覆盖设计器宿主、原表单schema3、保存恢复和普通预览/导出 |
| `node --test web/tests/exam-record-detail.test.mjs` | 5/5 PASS | PC管理员结果页声明能力3，并兼容schema2、schema3、legacy与在考不取结果 |
| `node tests/run-e2e.mjs --ephemeral --suite main-question-designers` | 审查补充后593个显式断言PASS，exit0 | 含schema3普通/答案预览与复制布局独立持久化；另每个成功HTTP调用有status断言，不计入593 |
| `node tests/run-e2e.mjs --ephemeral --suite main-question-designers-compatibility` | 35个显式断言PASS，加纯timeout helper，exit0 | read-only/write-only目录与跨owner回执分别覆盖；不把helper内部断言计入显示数量 |
| `node tests/run-e2e.mjs --ephemeral --suite training-question-bank` | exit0 | 本次两档策略相关人工新增/旧题升级fixture适配 |
| `node tests/run-e2e.mjs --ephemeral --suite training-publishing` | exit0；初次发现schema2题图普通表单修订被错误拒绝，根修复后HTTP全套复跑通过 | 这是实际集成回归，未用跳过或放宽断言掩盖；历史unknown/medium与当前新写政策分别覆盖 |
| `node tests/run-e2e.mjs --ephemeral --suite training-question-import` | exit0 | 事务注入故障的预期500日志用于验证回滚，随后重试与整套通过 |
| `node tests/run-e2e.mjs --ephemeral --suite training-ai-question-import` | exit0 | 合法参考文件、目标easy/hard与确认链仍通过 |
| `node tests/run-e2e.mjs --ephemeral --suite smoke` | 85 PASS / 0 FAIL，exit0 | 使用Mock AI，保留真实31秒心跳窗口；学习/旧固定卷/统计/审计回归 |
| `npm --prefix web test -- src/components/question-designers/__tests__/paper-save-recovery.spec.ts` | 47/47 PASS，exit0 | 实际宿主/controller/序列化逻辑，HTTP边界为测试替身；含资料题改副本的筛选零调用拒绝、清空筛选后manual/null来源、重开复用回执版本与源草稿保持 |
| `npm --prefix server test -- test/question-authoring-service.spec.ts` | 17/17 PASS，exit0 | 实际authoring/version service、持久化边界为测试替身；manual创建、来源伪造拒绝、修订来源保持、事务与回执；不是资料题副本独立HTTP全链 |
| `node tests/run-e2e.mjs --ephemeral --suite mobile-h5` | H5构建、两个Playwright关键场景均PASS，exit0 | 桌面Chrome真实API链；不是微信开发工具或真机 |
| `node tests/run-e2e.mjs --ephemeral --suite all` | 两次最终复跑均把已执行suite隔离清理；一次在最后mobile-h5发生瞬时`fetch failed`，该suite随即独立全绿；另一次在已多次通过的training-records出现一次进程内模块导出异常，clean build后该suite独立全绿 | 没有伪报all exit0；所有注册suite均已有本轮通过证据，但单次all命令的干净exit0仍未取得 |
| `git diff --cached --check` | exit0 | 对最终暂存候选核对，无空白错误 |
| 独立reviewer最终复审 | Ready: Yes；无Critical/Important | 含普通导出防答案泄漏、表格列宽、PC结果schema3最后补丁 |

主链覆盖服务端集中目录easy/hard启用、medium停用；上传真实PNG；完整schema3节点/marks族、嵌套列表、表格合并与受控图片的作者commit；同请求回执GET及POST重放；原有create/revise服务端链；答案/难度修改不降级、原稿同步、布局/稳定ID保留；固定卷布局和精确题单发布；能力2开考拒绝且assignment/record/答案零写；能力3开考、安全投影、精确题图票据、稳定ID主动评分、结果和错题。为避免随机碰巧原序掩盖错误，整链在自有fixture库将该题的冻结显示映射明确置为反序`[1,0]`，recover必须显示B/A，提交B仍正确得100；这验证读取/评分合同，不冒充HMAC洗牌算法本身的独立测试。受控图片内容经过匿名短票读取，无JWT入URL。

最终审查补充的真实HTTP验证：普通preview的schema3题返回`content_schema_version=3`与`content_json`精确两键`stem/options`，逐层无答案、解析或管理元数据，富文题面与选项不丢格式；答案端点返回完整schema3 `content_json`、稳定标准答案B和富文解析。copy→GET保留A5、横向、原边距；修改副本为A4/纵向/不同左边距并重新GET确认后，源卷仍保持原布局。本lane只新增HTTP回归并验证根已修复的候选，没有把此次首次GREEN冒充新的RED。

资料题改副本的独立边界：主链没有现成的真实资料AI出题fixture，本轮未扩建此链路。已运行47项宿主测试，证明带来源题修改后计划为manual/null来源副本，非空资料筛选在任何HTTP调用前拒绝，清空后序列化commit/配置/题单、重开复用同一回执版本，源草稿与identity保持；16项服务测试证明manual提交与来源不可伪造/修订来源保持等实际业务逻辑。二者合起来不标为“资料AI题修改副本→真实HTTPcommit→重开”的完整证据，该项仍明确待验。

兼容/安全链覆盖未登录401、学员403、read-only/write-only管理员都可取得非敏感目录、具有questions写权限的其他owner仍无法查询原回执404；恶意链接/来源伪造拒绝；第二题类别关系失败时整个commit的题目/版本/回执回滚；同请求不同内容409；复杂题干无法无损转换整次拒绝；原表单schema3 create生成可重开的作者原稿；schema2普通新建及marks禁令不变；隔离fixture中的历史medium题目/版本/release不改值且旧客户端仍可考；能力2向schema3在考提交时不写答案、不评分；他人record拒绝；到期读状态优先纯timeout，之后submit保持零答案/零评分。通过fixture SQL建立“既有历史medium”只在自有测试库内进行，业务API没有新建medium。

每次suite均执行API重启并复用本次随机密钥/数据库/上传，结束后输出准确PID与根目录清理结果。最新593断言主链的自有库为`ruleexam_test_1a45e43381e5`，根为`ruleexam-a1-7LxKxV`、`ruleexam-training-HhIMNR`；35断言兼容链根为`ruleexam-a1-hqnHrS`、`ruleexam-training-cbhm98`，均已销毁；这些名称仅标识已销毁临时目标，不是业务库。

## 旧E2E难度fixture分类

按字符串命中逐处阅读语义后调整，没有批量替换medium，也没有修改业务代码放行旧fixture：

| 文件 | 变更与保留理由 |
|---|---|
| `tests/e2e-smoke.mjs` | 两个资料AI请求改easy：一项要验证分值合计错误，另一项要验证合法异步出题；不能让停用难度先拦截并掩盖原断言 |
| `tests/training-question-bank.mjs` | 多选合法新增与legacy显式升级改easy；原版本捕获、审核/冲突和客观题语义仍验证 |
| `tests/training-question-import.mjs` | “修正后合法导入”多选改easy，已存集合期望easy/hard；没有让停用medium进入成功导入 |
| `tests/training-ai-question-import.mjs` | 合法参考文件改easy；目标生成仍服务端固定easy/hard，不采用参考难度作为输出事实 |
| `tests/training-publishing.mjs` | 合法新建题图/固定卷/考点计分fixture改easy；stale current版本改hard；随机“错误难度”保持既有停用medium SQL fixture，以免hard作为合法另一池导致错误测试；legacy未知题先断言新发布拒绝/零捕获，再由管理员显式分类easy并审核后发布，原未知revision仍保持NULL和未知审批事实 |
| `tests/question-designer-migration.test.mjs` | 所有历史medium题、已发布/个人快照、答案与成绩fixture原样保留，不作难度改值 |

## 当前文档与源码事实

现行01—07册、README和学员冻结契约已同步schema3独立白名单、客户端能力协商、作者原稿/回执/布局、集中启用难度、原表单无损兼容与历史边界。当前schema为39张业务表+1张迁移元数据表，共40张物理表；022纯追加字段/回执表，旧checksum不变。不把本次临时库测试写成业务库迁移已执行。

集成候选关键文件SHA-256采样（最终根整合后应以最终候选重新固定）：

| 文件 | SHA-256 |
|---|---|
| `server/src/modules/questions/question-authoring.service.ts` | `af0aa9837257376d37df10de2e46b21a3186c8b32253070c250829e02f202a38` |
| `server/src/modules/exams/attempt.service.ts` | `298ff64734eca9d9fbec543d5a5ba633bfdea7e6ddf674c59f711b812e18fd7e` |
| `mobile/src/types/content-v3.ts` | `1a8d3d275bd26a3863506fa4e7e931182561dabb99131a8d85cb801d2eb63d76` |
| `server/src/modules/questions/question-authoring-codec.ts`（schema2题图修订修复后） | `d31233701366ff5fe83e5643a8a76487cd6bcd598c56e7e90839797596b630b1` |
| `server/src/modules/questions/question-authoring-options.controller.ts`（目录OR权限修复后） | `ca4a6646f51351144925956eaf0b3716e364c7c294e6bee4a81551b8d3f31807` |
| `server/src/modules/exams/paper-admin.controller.ts`（schema3普通预览安全部分内容） | `c0baaa1bbb5e3129928c8ffb407224127cfdb2f2bf99285b5da4820ec7f12c72` |
| `server/src/modules/ai/paper.service.ts`（copy布局深拷贝） | `d94588e2407c2d8d45a06ddc9da8bf0c9c737f4c9db044494ed07d36fc620ba3` |
| `tests/main-question-designers.mjs`（593断言） | `0b7ecffab7a7905e9fbedb6b86f8b07b6342771f57280324cab78e96fafa7a21` |
| `tests/main-question-designers-compatibility.mjs`（35断言） | `4593170f5cae6a76145505d2c97e7dbfa5b8717bcb7e6bce4523356ca6e00558` |
| `web/src/views/admin/ExamRecordDetail.vue`（PC结果schema3） | `76f5815b6751a2b947c766501f1b41c20e8bc60192df26dbeffb3857677f94d1` |
| `tests/training-full-flow.mjs`（本人/管理员统一能力3结果） | `af6dffe21694cc908f981ca2fe7765e68cf0236e43b03930a23de381fa1f1c6c` |

## 尚未由本lane证明的验收

| 等级/范围 | 状态 |
|---|---|
| T8原表单与T9完整设计器最终候选、server全测、Web定向/类型/构建、mobile全测/类型 | 已自动验证；暂存索引独立构建再次通过 |
| 最终候选 `--ephemeral --suite all` | 已执行但未取得单次干净exit0；瞬时失败对应suite均已独立复跑通过，边界见自动化表，不扩大成all通过 |
| 同题/同视口来源截图对照、完整PC操作与双向重开 | 待实际桌面浏览器验收；API保真不等于UI原样验收 |
| 100道混合题设计器、拖拽/工具栏、只读/关闭与失败重试 | 单测/源码证据由对应lane登记，桌面操作另验 |
| 中文原生输入法、原生文件选择器 | 未验；自动上传与DOM输入不能替代 |
| 微信开发者工具、微信小程序/手机真机、真实弱网与视频播放 | 未验；MP编译或H5桌面测试不扩大为真机 |
| 真实短信、腾讯实名和商业AI | 未验；本次仅测试模块override/Mock AI |
| 开发/业务/生产库迁移、部署、远程推送 | 未执行；本次全部数据库测试仅自有ephemeral |
| 独立reviewer对最终候选的全链审查 | 已完成，Ready: Yes，无Critical/Important |
