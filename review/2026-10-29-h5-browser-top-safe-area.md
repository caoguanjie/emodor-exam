# H5 浏览器顶部安全区修复

## 问题与定位

用户反馈 vivo 浏览器地址栏与「我的错题本」导航之间出现一段空白，同机其他浏览器没有该现象。

此前 H5 声明 `viewport-fit=cover`，全局 `--app-safe-area-top` 直接使用浏览器的 `env(safe-area-inset-top)`。`AppPage` 将其用于顶部 padding，`AppTopBar` 将其用于固定导航 top；两处配合形成同一段顶部占位，并非两个高度相加。浏览器已经避让状态栏但仍报告非零顶部 inset 时，页面会再额外下移。

浏览器模拟注入顶部 inset=44px、底部 inset=20px，修复前页面顶部 padding 实际为 44px，重现了该触发路径。未取得用户 vivo 真机环境数值，不能把模拟结果等同于该型号浏览器的最终复测。

## 修复

- H5 viewport 改为 `viewport-fit=contain`，由浏览器负责屏幕顶部与刘海区域避让。[Chromium 对应实现说明](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/ui/android/display_cutout.md)
- 仅 H5 将 `--app-safe-area-top` 设为 0，浏览器报告非零 inset 时也不再额外留白；统一覆盖普通页面、登录页和答题页。
- 保留底部安全区变量；微信小程序继续使用原生 statusBarHeight 和胶囊坐标计算。

## 验证

- `npm --prefix mobile run type-check` 通过。
- `npm --prefix mobile run test:unit -- native-navigation.spec.ts` 通过，运行与类型检查共报告 14 项通过。
- `h5-safe-area.spec.ts` 的 3 项浏览器回归通过：错题本、登录、答题。检查了实际 CSS env=44px、页面 padding/top=0、导航与正文衔接、底部 inset=20px 保留，以及顶部 inset 恢复 0 后的布局。
- 浏览器回归使用本机 Edge（Chromium）；本机 Chrome 的默认 UA 样式异常（head/style 可见）导致其布局结果不可用，因此改用 Edge 完成验证。
- `node scripts/build.mjs h5` 通过，原子更新本地 `dist/mobile/`。构建有现存 Sass legacy-js-api 弃用提示。

## 未验边界

尚未完成 vivo、iOS Safari、微信小程序真机复测，也未部署远程站点。上线更新 H5 产物后，应在反馈问题的 vivo 浏览器刷新页面，确认顶部空白消失，并检查横屏刘海区域和底部按钮。
