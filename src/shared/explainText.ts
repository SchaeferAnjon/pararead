// 讲解的字：最新一版、去掉分节标签的纯文字。不引翻译表（i18n.ts 载入九种语言的 JSON），
// explain.ts 和写配对笔记的 pairedNote.ts 共用，画布笔记那边的测试（apps/notes/e2e/pararead-note.spec.ts）也能直接载入。
import type { ExplainRecord, ExplainVersion } from './types'

export function latest(rec: ExplainRecord | null | undefined): ExplainVersion | null {
  return rec?.versions.at(-1) ?? null
}

/** 讲解的一版去掉分节标签，给接着问时的 AI 看（它知道刚才讲了什么） */
export function plainExplain(raw: string): string {
  return raw
    .replace(/<\/?[a-z]+>/g, '\n')
    .replace(/\s*\|\|\s*/g, '：')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
