# OKNote

> 一款 Windows 桌面备忘录应用，围绕「日历事件 + 便签 + 标签视图」组织日常信息。支持常驻托盘、贴边自动收起、自由浮动便签、日历下方挂载区和可同步编辑事件的视图便签。
>
> 本项目由 [Qoder](https://qoder.com) 辅助开发。

![OKNote 日历和挂载便签](./assets/image-20260506224159512.png)

![OKNote 桌面便签](./assets/image-20260506224319350.png)

<img src="./assets/image-20260506224411181.png" alt="OKNote 便签版本记录" style="zoom: 50%;" />

## 功能特性

### 日历

- **月/周视图**：以周一为起始日，支持月视图、周视图、月份前后切换和年月快速跳转。
- **事件管理**：支持单日事件、跨日事件、时间段、全天事件、备注和删除。
- **事件标签**：可在设置中维护标签名称和颜色，日历、固定区和视图便签会同步使用标签。
- **自适应可读性**：事件文字会根据背景与透明度自动选择高对比颜色；用户显式设置文字颜色时优先尊重用户设置。
- **中国法定节假日**：自动标注节假日名称和斜线背景，2024-2030 年按官方公告标注，其他年份按农历节日推算。
- **农历日期**：内置 1900-2100 年农历换算，用于春节、端午、中秋等节日计算。
- **贴边自动收起**：日历窗口贴屏幕边缘时可自动收起/展开，收起状态由主进程根据系统鼠标坐标判断，并使用原生窗口动画减少闪动。
- **可调挂载区**：日历与下方固定区/挂载区之间可拖拽调整高度，大小会持久化。

### 便签

- **独立便签**：每张便签都是独立透明窗口，可在桌面自由拖动、调整透明度、编辑标题和待办。
- **视图便签**：按指定标签回显日历事件，并支持从便签中新增、编辑和删除对应事件。
- **日历挂载**：便签可拖入日历下方挂载区，变成日历的一部分；隐藏后重新显示会保留挂载状态。
- **固定区回显**：日历左下固定区显示当天事件，并支持按标签筛选。
- **立体轮播**：挂载便签较多时，下方区域以正面便签 + 左右倾斜便签呈现，可左右切换并带移动动画。
- **待办清单**：独立便签支持 checkbox 待办、行内编辑、删除和完成态。
- **外观区分**：视图便签和独立便签使用不同的标识、内容布局和纹理层，即使调整不透明度也能区分用途。

### 设置与管理

- **外观设置**：支持浅色/深色主题、全局字体、字号、日历/便签背景色和透明度。
- **便签管理**：集中显示所有便签，区分视图便签和独立便签，可显示、隐藏、删除。
- **标签管理**：维护事件标签，标签删除后会同步清理事件引用。
- **窗口优先级**：设置窗口始终显示在日历与便签窗口之上。
- **开机自启**：可配置随系统启动。

### 系统集成

- **系统托盘**：常驻托盘图标，右键菜单支持新建便签、新建事件、显示/隐藏日历、整理便签、打开设置和退出。
- **窗口记忆**：便签位置、大小、透明度、挂载状态和日历挂载区高度会持久化。
- **本地 JSON 存储**：所有数据存放在 Electron `userData` 目录，不依赖云端服务。

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 框架 | React 18 + TypeScript |
| 构建 | Vite 6 |
| 桌面 | Electron 41 |
| 状态管理 | Zustand 5 |
| 样式 | Tailwind CSS 3 + CSS Variables |
| 动画 | Framer Motion 11 + CSS transition |
| 图标 | Lucide React |
| 日期处理 | date-fns 4 |
| UI 基元 | Radix UI Tooltip / Slot |
| 打包 | electron-builder NSIS |

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9
- Windows 10 / 11

### 安装与运行

```bash
git clone https://github.com/Zhujunjiforyou/OKNote.git
cd OKNote

npm install

# 浏览器开发模式，不包含 Electron 专属能力
npm run dev

# Electron 桌面开发模式
npm run electron:dev

# 预览构建产物
npm run electron:preview

# 打包 Windows 安装程序，输出到 release/
npm run electron:build
```

常用检查命令：

```bash
npm run lint
npm run build
node --check electron/main.cjs
```

## 使用指南

### 日历窗口

| 操作 | 方式 |
| --- | --- |
| 切换月份 | 点击标题栏左右箭头 |
| 快速跳转 | 点击标题栏中间的年月 |
| 回到今天 | 点击「今天」 |
| 新建事件 | 点击「+ 事件」，或在日期格右键选择 |
| 查看当天事件 | 双击日期格 |
| 编辑/删除事件 | 点击事件后在详情或编辑面板中操作 |
| 调整挂载区高度 | 拖动日历与下方区域之间的小横条 |
| 切换月/周视图 | 右上角「月 / 周」切换 |

### 便签窗口

| 操作 | 方式 |
| --- | --- |
| 新建独立便签 | 托盘菜单或日历「+ 便签」菜单 |
| 新建视图便签 | 日历「+ 便签」菜单中选择标签 |
| 编辑标题 | 双击便签标题 |
| 添加待办 | 独立便签底部输入内容后回车 |
| 编辑事件 | 在视图便签中点击事件，打开外部编辑面板 |
| 挂载到日历 | 将独立便签拖到日历右下挂载区域 |
| 取消挂载 | 在挂载便签菜单中选择取消挂载 |
| 隐藏/显示 | 通过便签菜单或设置页便签管理操作 |

### 设置窗口

| 标签页 | 功能 |
| --- | --- |
| 全局 | 主题、开机自启、全局字体和字号 |
| 日历 | 日历背景、透明度、文字和预览 |
| 便签 | 便签背景、透明度、文字和预览 |
| 管理 | 便签显示/隐藏/删除，区分视图便签和独立便签 |
| 标签 | 新增、编辑、删除事件标签 |

## 项目结构

```text
OKNote/
├─ electron/
│  ├─ main.cjs                  # Electron 主进程：窗口、托盘、IPC、持久化、贴边收起
│  └─ preload.cjs               # 暴露安全的 Electron API 给渲染进程
├─ scripts/
│  └─ killport.cjs              # 开发模式启动前清理 Vite 端口
├─ src/
│  ├─ App.tsx                   # Hash 路由分发：calendar、note、settings
│  ├─ main.tsx                  # React 入口
│  ├─ index.css                 # Tailwind、全局变量、窗口和挂载区样式
│  ├─ components/
│  │  ├─ calendar/              # 日历网格、事件表单、事件详情
│  │  ├─ dock/                  # 日历下方固定区、挂载区、便签轮播
│  │  ├─ notes/                 # 待办项、视图事件列表、快速事件表单
│  │  ├─ ui/                    # 通用 UI 基元
│  │  └─ windows/               # CalendarWindow、NoteWindow、SettingsWindow
│  ├─ hooks/
│  │  └─ useAppSettings.ts      # 设置同步 hook
│  ├─ lib/
│  │  ├─ holidays.ts            # 节假日数据与算法
│  │  ├─ lunar-calendar.ts      # 农历换算
│  │  └─ utils.ts               # 通用工具、颜色可读性、便签归一化
│  ├─ stores/
│  │  ├─ app.store.ts           # 全局状态
│  │  ├─ calendar.store.ts      # 事件、日期导航、标签过滤
│  │  ├─ notes.store.ts         # 便签、待办、倒计时
│  │  └─ tag.store.ts           # 事件标签
│  └─ types/
│     ├─ calendar.types.ts      # 日历事件类型
│     ├─ electron.d.ts          # Electron API 类型
│     ├─ notes.types.ts         # 便签与待办类型
│     └─ tag.types.ts           # 标签类型
├─ assets/                      # README 演示图
├─ package.json
├─ vite.config.ts
└─ tailwind.config.ts
```

## 数据存储

所有数据以 JSON 文件形式存储在 Electron `userData` 目录：

| 文件 | 内容 |
| --- | --- |
| `settings.json` | 主题、字体、颜色、透明度、开机自启等设置 |
| `events.json` | 所有日历事件 |
| `tags.json` | 事件标签 |
| `note_{id}.json` | 每张便签的标题、颜色、内容、透明度、挂载状态和隐藏状态 |
| `countdowns.json` | 倒计时数据 |
| `window-bounds.json` | 窗口位置、大小和贴边状态 |

数据写入使用防抖和原子写入，减少频繁 I/O 和异常退出造成的损坏风险。

## License

MIT

---

<p align="center">Made for Windows desktop</p>
