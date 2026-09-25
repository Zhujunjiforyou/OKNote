# OKNote 图标

应用图标使用暖白日历纸页、炭灰手绘轮廓、墨蓝色 OK 字样和右下折角，纸页外侧透明。

## 源文件

| 文件 | 用途 |
| --- | --- |
| [app-icon.svg](app-icon.svg) | 应用图标母版，1254 × 1254，用于 40px 及以上尺寸 |
| [app-icon-small.svg](app-icon-small.svg) | 24 × 24 的简化轮廓，用于 16、20、24、32px 尺寸及网页图标 |
| [app-icon.png](app-icon.png) | 母版导出的透明 PNG |
| [tray-template.svg](tray-template.svg) | macOS 菜单栏单色模板，18 × 18 |
| [icon-paths.json](../../src/components/ui/icon-paths.json) | 界面图标的共享路径，24 × 24，由 `icons.tsx` 提供 React 组件 |

应用图标颜色为墨蓝 `#326991`、炭灰 `#29353d`、暖白 `#fcfbf7` 和折角灰 `#eeece7`。OK 字样由矢量路径绘制，不依赖字体。界面图标默认线宽为 1.8，使用圆端点、圆连接和 `currentColor`。

## 导出

运行 `npm run prepare:icon`，由 `scripts/create-app-icon.cjs` 生成 Windows ICO、macOS ICNS、16–1024px PNG 和菜单栏 18px / 36px 模板。输出位于 `build/icons/`，尺寸与浅深背景预览位于 `build/icons/preview.html`。

修改时编辑 SVG 或共享路径文件，再重新导出。16–32px 使用小尺寸源，较大尺寸使用母版；检查小尺寸下 OK 字样、装订和折角是否清晰。
