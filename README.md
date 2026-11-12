# ParaRead

Mac 上读英文论文：把 PDF 重排成好读的版面，每段原文下面跟一段译文；划词翻译和解释、带出处的 AI 问答、一页速览、文献库、高亮和笔记。

Read English papers on your Mac: a reflowed layout with a translation under every paragraph, translate and explain on selection, AI answers with sources, a one-page glance, a library, highlights and notes.

- 官网 / Website：https://pararead.us-cloud.uk
- 下载 / Download：[最新版 Latest release](https://github.com/SchaeferAnjon/pararead/releases/latest)（macOS 13+，Apple 芯片 / Apple silicon）
- 许可 / License：GPL-3.0

不用注册账号。填你自己的 AI Key（DeepSeek、智谱、通义、Kimi、豆包、OpenAI、Gemini、Claude 等）永久免费；不想配 Key 可以买会员。论文、重排的结果、高亮和笔记都存在你的电脑上。

第一次打开时如果提示无法验证开发者：打开「系统设置 › 隐私与安全性」，拉到最下面点「仍要打开」。

## 它做什么

- 重排：双栏的 PDF 排成单栏，公式、表格、图和参考文献留在原来的位置。精细重排用开源的 [MinerU](https://github.com/opendatalab/MinerU)，在本机跑，应用第一次打开时自己下载。
- 对照翻译：一段原文一段译文，翻过的存在本机。译文有 9 种语言。
- 划词翻译、解释，截图翻译（图、表、公式）。
- AI 问答：回答带出处，点一下跳回原文；最多 20 篇一起问。
- 速览、高亮、笔记、参考文献弹层、导出双语 PDF、引用格式（GB/T 7714、APA、MLA、IEEE、BibTeX）。
- 文献库：拖进来自动补全信息，能从 Zotero 导入，多台 Mac 用 iCloud 云盘同步。
- Word 引用插件：在 Word 里从文献库插入引用、生成参考文献表。

## 自己编译

要 Node 22 以上和 Xcode 命令行工具。

```bash
npm install          # npm 11 起要在 package.json 的 allowScripts 里放行原生模块的安装脚本（已经写好）
npm run rebuild      # better-sqlite3 按 Electron 的 ABI 重编
npm run dev          # 开发模式
npm test             # 单元测试，用 Electron 自带的 Node 跑
npm run typecheck
npm run dist:dir     # 打一个没签 Developer ID 的 .app 到 release/mac-arm64
```

自己编译的版本填自己的 Key，功能一样。

- 代码：`src/main`（主进程：文献库、重排、AI、同步、会员、Word 插件的本机服务）、`src/renderer`（界面，React）、`src/shared`（两边共用）、`website`（官网）。
- 界面文案的翻译表在 `src/i18n`，`node scripts/i18n.mjs` 补齐缺的。
- 端到端脚本在 `scripts/e2e`，用 Playwright 驱动真窗口：`E2E_PAPER=<一篇论文的 PDF> node scripts/e2e/smoke.mjs <数据目录>`。
- 运行参数：`--data-dir=<目录>` 把数据放到别的目录（测试用），默认 `~/Library/Application Support/ParaRead`。

## 反馈

在这个仓库开 issue，或者发邮件到 infoschaeferanjon@gmail.com。
