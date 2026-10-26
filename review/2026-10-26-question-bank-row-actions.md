# 题库状态开关与逻辑删除验收

日期：2026-10-26。范围为用户确认的状态开关、180px居中操作列和逻辑删除；本次不提交或推送，不涉及生产。设计见[增量设计](../docs/superpowers/specs/2026-10-26-question-bank-row-actions-design.md)，执行见[实施计划](../docs/superpowers/plans/2026-10-26-question-bank-row-actions.md)。

## 并行归属与变更边界

沿用Astra：Web worker负责Questions页面与交互测试；后端worker负责实体、029、生命周期与发布保护及定向测试；独立HTTP worker负责真实数据库与历史兼容；root负责合同、文档、集成与获授权本地升级；reviewer独立只读审查。角色使用当前`.codex/agents/*.toml`，未改变配置或模型。Astra引用的DDD附录与`.harness/agents/code-reviewer.md`在当前仓库缺失，使用当前AGENTS、增量合同及requesting-code-review模板补足边界，不虚报已加载缺失文件。

工作树并存人工Tiptap、导入模板／预览、COS计划、画板与全局样式等改动，均保留。本次不恢复考点／审核／题库分值，不扩大为回收站、硬删除或已删恢复。图谱存在陈旧题库覆盖，发现结果经当前源码定向核验。

## 源码合同

- 状态列使用68px文字开关；操作列180px，表头与按钮居中，仅预览／修改／删除。修改复用现有Tiptap弹窗。
- DELETE `/ai/questions/:id`要求questions:write，严格显式版本与启停双基线；身份锁内首次仅标记普通deleted_at并停用，返回原时间的幂等回执，只首次审计。
- 不使用DeleteDateColumn，不增revision、不物理删除身份／版本／媒体引用／试卷关联／release／考试。当前列表和候选显式排除，详情40401，history保留；写入不能复活已删，草稿保留旧引用但新发布阻断。
- 已有发布、个人题单、成绩与旧无release首考继续读取历史事实。029线性承接026完整有效探针，不改000—028或旧登记checksum。

## 独立审查与修复

第一轮Web审查固定差异与4文件SHA匹配，发现两项Important：全部筛选下在途列表GET能覆盖已确认开关；编辑保存只持有局部saving、未参与逐题互锁。原worker补6项真实交互RED→GREEN，保存锁绑定submittedId，未知结果保留该题锁。第二轮复审发现仅丢弃GET会让新页／新类别查询丢失；再补4项receipt／reconciliation×page／category回归RED→GREEN，失效在途GET后按当前query补发GET。最终独立复审逐一执行真实源码调度，无剩余Critical／Important；不将只读内存函数复现当成浏览器验收。

后端／迁移／HTTP候选21文件的固定差异经同一独立席审查，结束SHA仍匹配，无Critical／Important。Reviewer列明未判断的范围由root裁决：Web两项必须修复复审；普通导入沿用原历史重复识别，不在本次偷偷引入已删恢复或重导策略；真实本地与PC结果由root另外核验，不以源码审查替代。

## 自动化证据

初版Web新增16项真实组件测试及Node题库UI64/64通过。root执行完整`npm --prefix web test`为493/493、web目录`npm exec -- vue-tsc --noEmit`退出0；这是审查修复前证据，不替代后续变更验证。外部导入弹窗曾处于6项RED、2处类型错误的开发中状态，后续同一完整命令已通过，未越界修改该会话代码。

HTTP worker已在旧dist取得真实RED：合法新题的DELETE返回404而非200，自有ephemeral MySQL／Redis／API均已清理。随后新增逻辑删除、媒体／快照、幂等审计与发布双顺序检查并取得下列GREEN。

root已独立核验本轮后端候选21文件SHA全部一致，并取得以下最终后端／隔离证据：

- `npm --prefix server test`（含pretest编译）：62文件、1025/1025，退出0。
- `node --test tests/migration-contract.test.mjs tests/question-lifecycle-migration.test.mjs tests/question-bank-without-scores-migration.test.mjs tests/question-soft-delete-migration.test.mjs tests/migration-catalog.test.mjs`：54/54，退出0；覆盖全部迁移目录、029升级／新装／重跑／DDL续跑和结构漂移。
- `node tests/run-e2e.mjs --ephemeral --suite training-question-bank`：通过；删除helper127项，真实两个DataSource先删后发布为40970且零release，先发布后删保留release快照。日志`/tmp/ruleexam-question-soft-delete-bank-green-20261026.log`。
- 同样的ephemeral命令分别选择`training-publishing`、`training-attempts`、`training-records`均通过，自有服务和精确临时目录全部清理。attempts包含删后已评分结果／个人题单／版本／答案／媒体不变、删后补考及旧无release／NULL版本首次开考。日志`/tmp/ruleexam-question-soft-delete-{publishing,attempts,records}-20261026.log`。

首轮新增HTTP断言曾把mysql2默认本地Date解释当成UTC，产生8小时差；改为SQL读取原UTC字面量再核验，无服务端时间实现变更。未把此断言缺陷算成后端故障或跳过时间检查。本轮未重复全部24套：本次新增行为及发布／考试／记录相关风险已覆盖，之前全目录000—028的24套结论仍只属于之前候选。

行内操作最终Web候选由root再次运行：33文件504/504；26项行操作组件回归全绿；Node题库UI64/64，web目录vue-tsc退出0，`node scripts/build.mjs web`原子构建退出0。期间其它会话新增modal-scroll-lock曾1项RED，最终完整命令已全部通过，未越界修改其代码。最终行内候选Questions.vue SHA为`71df753f935e70746380cf80c2c3097f1f7323985ffbd1d831148f7a2eb01d20`，新增spec为`4acff2ff8ba106346469fab1f98b2bffaa9fa077162c33b03692431b8bbf89d3`；后续题型／难度Tag增量单独登记。

## 当前本地开发库升级

用户已授权先备份`127.0.0.1:3306/ruleexam`再执行029、重启当前本地API。root只读预检确认pending仅029；022登记checksum匹配git`8fa0038013`真实原制品，执行step与当前文件完全相同。022/version_authoring原NOT NULL分值探针已合法由025/version_score_nullable完整探针承接，预检核对真实已applied的025后继，不改旧迁移／登记或复活旧结构。正式apply仍使用原runner的完整探针链。

升级脚本为忽略的本地一次性工具，只允许development、端口3000、指定本机库和唯一029；先私有全库备份，再逐表核对39张业务表除新增deleted_at外的完整行摘要与所有旧registry条目。实际结果如下，不将预检通过冒充升级成功。

独立审查029无阻断后，root于本机15:08确认3000监听PID75819及cwd为当前项目，再仅向该进程发送TERM；正式runner成功仅应用029，pending归零。备份目录`/var/folders/_b/8g0796l93xbc8__ccj6vg5y40000gn/T/ruleexam-dev-before-029-qUrViI`权限0700，`ruleexam.sql`权限0600、590754字节，保留未删除。39张业务表全部旧字段行摘要与迁移前完全相同，全部旧registry条目不变，既有52题均deleted_at=NULL，未改账号。随后以既有运行期环境重启API，PID88650；`/api/v1/health`返回code0、mysql=up、redis=up。后续浏览器新增验收题属于单独列明的主动业务写入，不混入“迁移未改旧数据”的断言。

## PC浏览器与未验边界

沿用Kimi“题库瘦身验收”自有标签，未借用用户其它标签。API重启后由用户重新登录；仅新建ID53“行内操作验收20261026：题目删除是否保留历史？”，在页面完成停用→启用、预览、修改题干并保存revision2，然后二次确认删除。删除后启用和全部筛选均为0条；数据库保留身份53、current_version_id=5、deleted_at=`2026-10-26T07:18:14.417Z`以及原版本4/revision1和版本5/revision2，删除未新增revision。原52题旧字段SHA仍为`99e5c44db982d240356c5182352819f9d592fe82bbdf74893b2f08842d42be5a`且deleted_at均NULL，未误删原题。

DOM实测操作列表头和单元格均180px、text-align:center，按钮恰为预览／修改／删除；开关68px且input有精确题目标签。截图`gui-test-screenshots/qbank-row-actions-20261026-before-delete.png`和`qbank-row-actions-20261026-final.png`已实际打开核对，目录忽略、不入库。窄视口使用现有表格横向滚动查看状态及右侧固定操作，不更改公共表格行为。页面已重置筛选，无新建草稿残留。

## 15:20用户追加：题型／难度Tag

用户明确要求参照导入预览，将试题管理“题型/难度”拆为两个独立列，分别使用Element Plus Tag。已采用104／96px并居中，题型info/plain，难度easy-success／hard-danger／历史medium-warning／未知-info，复用全局圆角，无公共样式、API或DB变化。保持现有标签、null未知及历史事实，不改难度目录。

新增5项真实组件回归先因旧合并头RED，再GREEN；行操作组件合计31/31。root固定候选完整Web为33文件510/510，Node题库UI64/64、web目录vue-tsc退出0，追加原子Web构建通过。独立reviewer核对两文件固定SHA，与上一候选去除拆列／映射helper后完全一致，确认未改变已通过的行操作与并发逻辑，无剩余实质发现。受审Questions.vue SHA=`2b3289c36773414ad5a3be9b2d6e0632c11a350e04e53ae56ac2d3be54cf1f05`；spec SHA=`dc5a5e2fde294795d876f03db3bf1f0de1ff54f682634ac6042d2dd9e28330e4`。

收尾期间同文件仍有并行会话修改，未覆盖：Questions.vue去掉人工弹窗的append-to-body属性，其余与上述受审页面完全一致；测试文件也有并行更新。15:30对当前工作树重新运行完整行操作组件31/31、vue-tsc退出0。此时页面SHA=`22fc444fb18991c7ad2e49d3d43bc22eb715b2b385a65421f67384a51a474e82`，spec SHA=`85d830c95611fddafdbd041b939e4f62dd27cf5ff4cfb880cb60f611dfba6b4e`；510/510只对应前述固定候选，不扩大为后续并行改动的完整回归结论。

PC刷新后表头实测为题干／培训类别／题型／难度／状态／更新时间／操作；实际cell包含`.el-tag--info.el-tag--plain`与简单的`.el-tag--success.el-tag--plain`，未知仍为info Tag。截图`gui-test-screenshots/qbank-type-difficulty-tags-20261026.png`已打开核对。只读切换全部筛选查看现有简单／未知，没有改原题状态或重新导入；结束恢复默认筛选。本轮与前述029／删除联调一起完成，未暂存、提交或推送。

## 15:32用户追加：六色、小圆角边框Tag与紧凑列

用户指出三题型不可全灰，要求题型和未知／简单／高难度共六色，且参照Element Plus基础Tag而非胶囊按钮。本次采用单选蓝／多选紫／判断青，未知灰／简单绿／困难红；“高”沿用当前“困难”，不新增档位。题型列104→84px、难度96→80px，继续居中。全局`.el-tag`原有999px圆角及border:none是胶囊外观来源，现仅通过Questions scoped `.question-meta-tag`恢复24px高、4px圆角、1px边框、light浅底和default光标；多选／判断通过局部CSS变量扩展紫／青，不影响全局、导入预览或业务逻辑。

5组真实Tag断言及1项紧凑列回归取得6项预期RED→6/6 GREEN；随后root完整`npm --prefix web test`为33文件511/511，web目录`npm exec -- vue-tsc --noEmit`退出0，`node scripts/build.mjs web`原子构建退出0。固定候选快照为忽略的`.superpowers/sdd/2026-10-26-question-bank-row-actions/tag-presentation-candidate.patch`；页面SHA=`ab6da5e736af9d5174061bbb9dadfd2bc31a02ab923a67540f7a765029cbb90a`，spec SHA=`ce319ed46a62b0bfd6251a1dca27e217807c6cca0c261feaf104676bd1d319c8`。Astra复用原独立reviewer按配置只读复审：SHA匹配，CSS层叠后六色确实不同，84／80px可容纳约定短标签；移除本轮模板／CSS后恰好还原上轮前基线，无业务变化，无剩余实质发现。

PC只读切到全部查看已有数据，实测单选蓝rgb(38,69,173)、多选紫rgb(126,34,206)、简单绿rgb(29,122,82)、未知灰rgb(81,86,95)，1px边框、4px圆角、24px高、无button role，表头实测84／80px居中。截图`gui-test-screenshots/qbank-six-color-tags-20261026.png`已打开核对，忽略不入库；判断青／困难红另由真实组件映射测试及CSS独立审查覆盖，不将截图冒充不存在数据行的验收。未改任何题目、启停或数据库，结束重置筛选并关闭本标签的focus emulation；未提交或推送。

自动化、PC浏览器和生产为不同证据等级。本次不扩展为真实供应商、移动真机、商业AI、COS实施或生产部署验收。
