# H5 视频播完仍显示 84%：排查记录

初次范围：用户要求先排查，只读查询本机数据库、检查源码与运行只读验证。随后用户授权在 `weifabao` 分支修复，实施与验证见文末；未修改历史学习数据或数据库结构。

## 已确认事实

- 本机第一章第一讲存在与截图一致的记录（record 3 / lesson_version 4）：duration_ms=347200、coverage_ms=294361、confirmed_position_ms=316298、is_completed=0。目录按 floor(coverage_ms / duration_ms * 100) 显示，结果为84。刷新仍为84与持久化数据一致。
- 缺失覆盖共52839毫秒，其中开头19661毫秒、结尾30902毫秒、中间2276毫秒。完成门槛为95%，当前缺少35479毫秒才达到门槛；单补尾段仍不足95%。
- 该记录存在多个ended会话，其中session 11有174648毫秒计入，session 14最终位置347200、计入0。库中只保存最后锚点，不能还原每拍事件及全部缺失原因。

## 已复现的结算缺陷

本机 Edge 无头浏览器播放内存生成的约1.4秒视频，自然结束事件顺序：

```text
play  position=0         ended=false
pause position=1.402571  ended=true
ended position=1.402571  ended=true
```

uni-h5 将原生pause和ended分别转发。VideoPanel.vue未区分自然结束产生的pause，video.ts直接上报paused，随后上报ended。

`server/src/modules/video-learning/coverage.ts`只允许前拍playing且本拍playing/ended计入区间。收到paused时不结算，却将位置和状态更新为新锚点；随后ended既没有playing前态，也没有位置增量，尾段因此永久遗漏。

用现有server/dist结算函数代入最后覆盖点316298、结尾347200、服务端间隔30902毫秒：

```text
playing → paused → ended：计入0 + 0毫秒
playing → ended：计入30902毫秒
```

暂停、缓冲、切后台也采用同一不结算边界规则，可能遗漏前一个心跳之后的已播放片段。这里确认的是规则行为，不能从最终库记录断言开头19661毫秒具体由哪个事件造成。

## 后续修复方向（尚未实施）

1. 识别自然结束pause，保证最后合法播放区间可以结算；保留服务端实际时间、45秒上限、2秒容差与跳播校验。
2. 核对正常暂停/缓冲/后台边界的最后有效区间处理，并同步相应设计契约，不能通过结束即100%绕过覆盖校验。
3. 回归自然pause→ended、短视频、长视频续签、缓冲恢复与断点续播；已有覆盖缺口不会因修复自动补齐，不能伪造历史学习事实。

验证边界：浏览器事件顺序由本机Edge真实媒体元素复现，结算结果由现有构建函数复现；未取得截图手机浏览器的逐拍请求日志，未声称已完成手机实测或生产验证。

## weifabao 修复实施

服务端 `coverage.ts` 改为按上一锚点的状态结算：上一锚点为playing时，进入paused/buffering/background/ended的边界拍也结算此前合法播放区间，然后保存当前锚点。自然结束pause→ended的尾段在pause拍保存，ended拍不会重复计入。暂停/缓冲/后台期间及恢复playing首拍仍零累计，序号幂等、服务端实际时间、2秒跳播容差、45秒上限、95%去重覆盖完成门槛均保留。

不改移动端请求字段或UI，不需要更换H5播放器；不新增表、列或迁移，init.sql与entities保持原结构。设计00/03—07册、README及冻结契约已同步边界语义。

验证：

- 先运行新增/调整的算法回归，旧实现11项失败，确认能捕获缺陷；修复后算法48项通过。
- 服务端定向回归：video-coverage、video-mobile-contract、paper-learning、training-statistics，4文件共104项通过；npm test前置tsc构建成功。服务层测试覆盖12秒短片、100秒跨周期影片的start→playing→pause→ended→close，核对保存的覆盖、首次完成时间和结束所有权。
- 移动端原有video-session/course-store：132项测试及类型断言通过，无类型错误。沙箱初跑有临时目录rename EPERM，正常宿主权限重跑通过。
- 服务端全量复核：正常宿主权限下86文件通过、7文件失败，1552项通过、16项失败、2项跳过。失败涉及审计、媒体存储/发布及Windows文件行为等其他模块，全量未通过；不扩大本次修复范围。工作区另有并发修改，统计为当次运行快照。
- HTTP隔离套件已补pause→ended回归并通过node语法检查，但未运行成功：启动器固定使用macOS `/opt/homebrew/...` MySQL/Redis路径，本机Windows报 `ephemeral MySQL binary not found`。未改用开发库，不声称HTTP数据库联调通过。
- git diff --check通过。尚未重启现有API、部署或完成手机真机复验。

历史覆盖缺口不会自动回填；修复生效后需从头实际重看缺失区间，重新合并有效覆盖。该84%记录仅补末尾30.9秒仍不足95%，开头19.7秒缺口也需真实观看，不能伪造完成。
