/**
 * AI 引擎（主进程那一层），画布笔记、画布今日、ParaRead 共用：起本机命令行（Claude Code、Codex、Gemini、OpenCode）、
 * 直接问 API（Key 那几家）和本机模型（Ollama、LM Studio），找命令行、盯版本和模型、存 Key、借画布笔记的 Key。
 * 只用 Node 的 child_process、fs、os、path、crypto；t() 由宿主经 ./shared 的 setI18n 交；不引 Electron，也不引哪个软件自己的文件
 * （test/no-apps.test.ts、packages/ai-chat/test/no-electron.test.ts 守着）。不碰 Node 的那一半在 '@cn/ai-engines/shared'。
 */
export * from './engines'
export * from './gate-map'
export * from './engine-api'
export * from './engine-check'
export * from './engine-models'
export * from './engine-proc'
export * from './engine-update'
export * from './engine-watch'
export * from './engine-list'
export * from './cli'
export * from './jsonrpc'
export * from './keys'
export * from './side-prompt'
export * from './pasted'
