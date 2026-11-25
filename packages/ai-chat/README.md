# @cn/ai-chat

AI 对话框的界面那一层，画布笔记和 ParaRead 共用（共用代码计划第 6 步，2026-11-23 搬好）。以画布笔记读 PDF 的对话（`apps/notes/src/renderer/reading/ReadingAi.tsx`）为底：画布笔记的样子和行为不变，ParaRead 用同一套组件拼出一样的对话框。不引 Electron、Node 模块和软件自己的全局（`window.cn`、`window.api`、`app()`），宿主经 `UiHost`、`ChatHost` 接进来（`src/host.ts`）。许可证 GPL-3.0-or-later。

## 有什么

| 子路径 | 导出 | 是什么 |
|---|---|---|
| `./host` | `THEME_VARS` `ICON_NAMES` `UiHost` `ChatHost` `ChatEngine` `ChatPick` `ChatAiState` `StepView` `AiErrorView` `AiErrorAct` `KeyId` | 宿主接口 |
| `./context` | `setAiChatHost` `AiChatProvider` `useUi` `useChat` `uiNow` `Icon` | 交宿主、取宿主 |
| `./composer` | `AiInput` `useComposer` `Composer` `Mat` `Lead` `useConvPick` `AiPicks` `PicksProps` `OmniProps` `omniTip` `MatMsg` `sendText` `matsHint` `QuoteCap` | 输入框（顶上一排材料、贴多图、底行「+ · 谁来答 · 模型 · effort · 发送」、下面全能那一行、开旁支时缩成一行）、发出去带材料的那一条、回答里选一段的「引用 · 拷贝」浮条 |
| `./mentions` | `Mention` `MentionKind` `AtItem` `MENTION_ICON` `tokenOf` `mentionRanges` `liveMentions` `atQuery` `eraseMention` `snapOut` | @ 点名的文档：字里照旧是「@标题」，哪几段是胶囊、退格整颗删、光标跳过胶囊（纯函数，存对话的类型也引） |
| `./mention` | `MentionChip` `MentionText` `MentionLayers` `AtMenu` | 胶囊（发出去那条里、输入框里叠在 textarea 上下的两层）和 @ 候选 |
| `./materials` | `Material` `markOf` `numberOf` `renumberMarks` `shiftMarks` `withMaterials` `countLine` `imageNames` `checkMaterials` `MAX_MATERIALS` `PASTED_NAME` | 材料和字里的编号 ①②（纯函数，主进程也引） |
| `./paste` | `imageFiles` `toBytes` `MAX_PASTED` | 粘贴、拖进来的图 |
| `./ai-picker` | `AiPicker` `engineFamily` `openEnginePick` `Family` `FamilyLead` `PickerValue` | 先选家再选模型再选 effort（bar：输入框底行；box：设置里） |
| `./engine-logo` | `EngineLogo` `ByLogo` `LOGO_SVG` `GEMINI_PNG` `logoIcon` | 各家标志（图在 `src/assets/engine-logos/`） |
| `./ai-error` | `AiError` | AI 没答出来：一行说明、下一步、「看原话」 |
| `./chat-toc` | `ChatToc` `TocSide` | 对话目录（右边贴边的横线和浮层） |
| `./steps` | `StepRow` | AI 动手的一步 |
| `./turns` | `UserTurn` `AnswerTurn` | 你发的那句、AI 的回答（回答头、步骤、正在想、正文） |
| `./answer-bar` | `AnswerBar` `AbMenu` `fitBar` `ChangeBar` `UndoButton` 和类型 | 回答下面那排、收不收改动（以前在 `@cn/design`） |
| `./side/AskBox` | `AskBox` `AskBoxView` `highlightBottom` | 回答里选中一句的小框（问这句 · 引用） |
| `./side/SideInline` | `SideInline` `SideView` `SideMsgView` `SideInlineProps` | 旁支就地展开的那一块 |
| `./side/host` | `useSideHost` `placeHost` `showSide` `blockOf` | 旁支挂在被问那句所在的那一段后面 |
| `./side/marks` | `applyMarks` `sideGroups` `groupMark` `flashMark` `badgeEl` `rangeText` `foldText` `closeRun` `Mark` | 问过的那句划虚线、插小标 |
| `./side/name` | `sideName` `sideAsks` `cutWords` `ASK_THIS` | 旁支的名字 |
| `./use-dismiss` | `useDismiss` | 弹层点外面、esc、失焦收起 |
| `./chat-jump` | `jumpToChat` `useChatJump` `jumpDone` | 跳到某段对话的某条回答 |

`.`（`src/index.ts`）把上面全导出。画布笔记引子路径（只把用到的那几个和它们的 css 带进来，样式表的先后和搬之前一样）。

## 宿主要交什么

启动时、第一次画之前交一次，界面语言换了再交一次 `UiHost`（用到的组件跟着重画）：

```ts
import { setAiChatHost } from '@cn/ai-chat/context'
setAiChatHost(ui, chat)
```

不只靠 React context：画布笔记的编辑器部件（文档里的旁支、预览卡）各自 `createRoot`，context 传不进去。一个窗口里要两套宿主时用 `<AiChatProvider ui chat>` 包住那一块。

`UiHost`（文案、图标、快捷键）：

- `t(key, p?)`：中文原句当键，`{name}` 放变量。组件外的几句（材料的「3段引用」、引擎菜单的组名、出错说明里的字）走 `@cn/ai-engines/shared` 的 `t()`，宿主照旧 `setI18n` 一次。
- `icon(name, { size, className })`：按名字画图标。名字见下表；回答下面那排的动作图标是宿主自己交进 `AnswerBar` 的名字，也走它。
- `iconEl(name, size)`：同一个图标画成元素（回答里问过那句后面的小标，不在 React 里）。
- `isKey(e, id)`、`keyLabel(id)`：`'quote'`（引用选中的那段，画布笔记 ⇧⌘L）、`'ask-page'`（选着时也是引用，画布笔记 ⌘↵）。
- `engineLogo?(id, size)`：认不出的那一家的标志（ParaRead 自己那一家）；不给画终端图标。
- `inputGlow?(running)`：AI 在答时输入框边上那一圈光；不给就没有。

`ChatHost`（组件要的引擎、贴图、正文、拷贝）：

- `aiEngines()`：`{ engines, chat, omni, none, intro }`，列表、AI 对话那一行、全能开关、一家都没接上、第一次开 AI 那句看过没有。
- `onAiPrefsChanged(cb)`：设置变了叫一声，返回退订。
- `aiSetEngine(id)`：底行换了谁来答。
- `aiSetOmni(on)`：全能开关。
- `aiPickCli?(id)`：「装在别处？指定位置…」；不给菜单里没有这一项。
- `aiPaste(bytes, mime)`：存贴的图，返回名字。
- `aiPickImages(room)`：底行「+」系统选图框。
- `pastedUrl(name)`：存好的图在界面上的网址。
- `renderMarkdown(text, { conv, steps?, live? })`：回答正文画成节点（宿主的 Markdown、公式、能点开的引用）。
- `plainAnswer(text)`：回答原文去掉宿主自己的标记（拷贝、放进主对话用）。
- `copy(text)`：拷贝。
- `openAiSettings()`：「去设置 › AI」。
- `aiErrorView(raw, engine?)`：AI 没答出来的原话认成哪种、怎么说、能点哪几步。
- `openMention?(m)`：点 @ 胶囊（输入框里、发出去那条里）打开那篇；不给点了没反应。

## @ 点名文档（@文档胶囊，2026-11-24）

- `AiInput` 给 `at={(q) => AtItem[]}` 就有 @：打「@几个字」弹候选（最多 8 篇，已点的不列），第一条亮着，Tab、↵ 选上（↵ 不发送），↑↓ 换，esc 只收菜单；输入法组字时这几个键是输入法的，候选底下那行说「先选好字」。不给 `at` 没有 @（ParaRead、画布今日现在都没给）。
- 选上的在 `c.mentions`，字里是「@标题 」；有胶囊时 textarea 的字透明，`MentionLayers` 下面一层照同样的排法画字和胶囊、上面一层透明的只在胶囊上接鼠标（`data-tip` 路径、点了 `openMention`）。退格、Delete 碰到胶囊整颗删，光标走不进胶囊。
- 发出去时宿主把 `c.mentions` 记在那条消息上，`UserTurn` / `MatMsg` 的 `mentions` 把字里的「@标题」画成 `MentionChip`。

问、停、收事件不在 `ChatHost` 里：发问和存对话是宿主自己的 store（画布笔记 `AiPanel.tsx`、`reading/store.ts`），组件只拿回调（`onSend`、`onStop`、`onAsk`……）。

引擎的 id 是任意字：画布笔记交那十家（`EngineId`），ParaRead 可以多一家自己的；`useConvPick<P, E>` 照 `P`、`E` 带回宿主自己的类型。认不出的那一家名字取 `EngineInfo.label`，标志走 `UiHost.engineLogo`。

## 图标名

`ICON_NAMES`（Codicons 的叫法，画布笔记交 Codicons，`apps/notes/test/ai-chat-icons.test.ts` 核对都有）：

`add` `ai` `arrow-down` `arrow-swap` `arrow-up` `check` `chevron-down` `chevron-right` `chip` `close` `comment` `comment-discussion` `copy` `discard` `edit` `ellipsis` `error` `file-code` `file-media` `file-pdf` `file-text` `git-compare` `globe` `layout` `loading` `note` `play` `primitive-square` `quote` `refresh` `reply` `settings` `settings-gear` `terminal`

`ai` 不是 Codicon：画「AI 对话现在用的那一家」的标志（选中一句的小框里「问这句」前面那颗）。

## 样子

- 包里的 css（`composer.css`、`mention.css`、`ai-picker.css`、`ai-error.css`、`chat-toc.css`、`steps.css`、`turns.css`、`answer-bar.css`、`side/side-inline.css`）跟着组件引进来。只用 `THEME_VARS` 里的 73 个变量；画布笔记的短名字（`--t2`、`--acc`、`--line2`……）都带默认值 `var(--t2, var(--text-2))`，ParaRead 不定义也照它自己的颜色画（`test/theme-vars.test.ts` 查）。
- 读 PDF 那一套（气泡里的图、问的那句、分隔行 `.daysep`、闪一下）挂在 `.reading-ai` 下面：ParaRead 的对话那一格带 `reading-ai` 和 `ai` 两个 class。
- 组件还用到宿主的几样全局样子：按钮 `.btn .btn-xs .btn-sm`、`.lnk`、`.truncate`、转圈 `.spin`（`@keyframes spin`）、弹层出来 `@keyframes blk-in`、悬停提示读 `data-tip` / `data-side`（画布笔记的提示层）。ParaRead 那边同名的照旧，没有的补上。

## ParaRead 怎么接

2026-11-23 已接上：宿主 `apps/pararead/src/renderer/src/lib/aiChatHost.tsx`，对话那一格 `components/ChatPanel.tsx`（`UserTurn`、`AnswerTurn`、`AnswerBar`、`ChatToc`、`AskBox`、`AiInput`；没用旁支）。ParaRead 那家的标志走 `engineLogo`，全能模式那一行的话用 `OmniProps.say` 换成 ParaRead 的说法；`.eng-logo` 的格子样子在画布笔记的 app.css 里，ParaRead 在 `styles/aichat.css` 补了一份。

1. `apps/pararead` 的 package.json 加 `"@cn/ai-chat": "workspace:*"`（还有 `@cn/ai-engines`）。
2. 界面启动时 `setAiChatHost(ui, chat)`：`t` 把 `{name}` 换成它自己的写法（ParaRead 的 `t()` 是 `{0}`），`icon` 照 `ICON_NAMES` 做 lucide 对照，`ChatHost` 接 `window.api`。
3. 对话那一格照 `ReadingAi.tsx` 拼：`.msgs` 列表里 `UserTurn` / `AnswerTurn`（下面放 `AnswerBar`），列表外 `ChatToc`、`AskBox`、开着的旁支 `SideInline`（`useSideHost` 挂进回答）、底下 `AiInput`（`useComposer` + `useConvPick` 的 `picks`、`omni`）。
4. 组件里的中文要进 ParaRead 的翻译表：`apps/pararead/scripts/i18n.mjs` 把 `packages/ai-chat/src` 一起扫（认 `t(`、`tNow(` 两种叫法）。

## 没搬的

- `cite.tsx`（回答里的引用点了出预览卡）、`link-card.tsx`（文档里的链接卡）：卡里的内容全是库里的东西（笔记几行、PDF 缩略图、白板卡、数据库一行、待办、提交），外壳是编辑器的 `Popover`、点法挂在 CodeMirror 上，拆不出一个不缠库的外壳。宿主在自己的 `renderMarkdown` 里画链接、自己接点击（画布笔记 `installCiteClicks` 在整个窗口上接 `a.cite`）。
- `side-core.ts`、`doc-side.tsx`、`file-side.tsx`：写进笔记文件的旁支（`> [!side]`、`@cn/format` 的 `sideInsert`、读写笔记、画布笔记自己的 `ai:side` 请求），是画布笔记库的格式，ParaRead 的旁支存在它自己的 store。
- `AiPanel.tsx`、`ReadingAi.tsx` 本身、`answer-row.tsx`（回答下面那排在画布笔记这边：插进文档、存进收件箱、快捷回复表）：缠着白板、整理、梦游、库，留在画布笔记，用包里的组件画。
