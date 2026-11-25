/**
 * 哪些不是笔记、不是附件（一份清单、一个判断）：扫库的地方（梦游、归类和改名、清理没用到的附件、附件「被 N 篇用」、搜索、
 * 相关、生长图、目录树、AI 和 MCP 读库）都用 isAppFile 跳过它们，不各写各的。
 *
 * 一、软件自己的文件（APP_DIRS、APP_FILE_NAMES）：`.canvas-notes/`（首页、左栏、置顶、对话、字幕）、画布今日的 `.canvas-tasks/`、
 *    画布订阅的 `.canvas-feeds/`、各文件夹的 `.首页.json` 和 `.首页模板.json`、空文件夹的 `.gitkeep`。
 * 二、一切 `.` 开头的文件和文件夹（.git、.DS_Store、.obsidian、.trash……）：用户在访达里看不到，不是他放进来的笔记。
 * 三、笔记旁边软件写的文件（NOTE_SIDE_FILES）：放在这篇自己的附件文件夹里（`附件/<笔记>/<名字>`），是这篇的一部分，
 *    不是一张能单独清掉的附件。现在只有白板笔迹 `笔迹.ink`（ink.ts）；以后白板装饰线这类同样放在附件文件夹里的，名字加进这里。
 *
 * Git 那边（@cn/git 的 isInternalPath、HIDE_INTERNAL）用的也是这份：一和二算软件自己的（提交说明不写、历史默认藏）；
 * 三是用户写的（笔迹），提交、历史、最近删掉的照常列。不依赖 Electron 和 Node（iPad 版照着移植）。
 */
import { ATTACHMENTS_DIR } from './attachments'

/** 白板笔迹的文件名（附件/<白板>/笔迹.ink，规格在 ink.ts） */
export const INK_FILE = '笔迹.ink'

/** 软件自己的文件夹（库的最外层） */
export const APP_DIRS = ['.canvas-notes', '.canvas-tasks', '.canvas-feeds'] as const
/** 软件在各个文件夹里写的文件 */
export const APP_FILE_NAMES = ['.首页.json', '.首页模板.json', '.gitkeep'] as const
/** 笔记附件文件夹里软件写的、属于这篇的文件（附件/<笔记>/<名字>） */
export const NOTE_SIDE_FILES = [INK_FILE] as const

const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)

/** 路径里有一段是 . 开头的（隐藏的文件或文件夹，软件自己的 .canvas-notes/ 也是） */
export function isHiddenPath(p: string): boolean {
  return p.split('/').some((s) => s.startsWith('.') && s !== '.' && s !== '..')
}

/** 笔记旁边软件写的文件（附件/<笔记>/笔迹.ink） */
export function isNoteSideFile(p: string): boolean {
  return p.startsWith(ATTACHMENTS_DIR + '/') && p.indexOf('/', ATTACHMENTS_DIR.length + 1) > ATTACHMENTS_DIR.length + 1 && (NOTE_SIDE_FILES as readonly string[]).includes(baseOf(p))
}

/** 不是笔记、不是附件：软件自己的、隐藏的、笔记旁边软件写的。扫库时跳过 */
export function isAppFile(p: string): boolean {
  return isHiddenPath(p) || isNoteSideFile(p)
}
