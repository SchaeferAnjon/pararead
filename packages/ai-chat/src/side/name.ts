import { t } from '@cn/ai-engines/shared'

/** 旁支里空着回车问的那句：中文原句当键，发出去时照界面语言 t(ASK_THIS)（AI 照它的语言答） */
export const ASK_THIS = '讲讲这句' // 不翻：键，发出去、显示的地方翻；认名字时中英都认

/** 里面有汉字、假名、韩文：照中文的规矩按字截；没有的（英文这些）按整词截 */
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/

/** 英文按整词截，连省略号最多 max 个字符；一个词就超了的才在词中间截；截掉的末尾标点去掉 */
export function cutWords(s: string, max: number): string {
  if (s.length <= max) return s
  const head = s.slice(0, max)
  const sp = head.lastIndexOf(' ')
  const cut = sp > 0 ? head.slice(0, sp) : s.slice(0, max - 1)
  return cut.replace(/[\s,.;:!?·–—-]+$/, '') + '…'
}

/** 旁支名字的长度：中文问的第一句 16 字、选的那一句 8 字；英文都按整词截，连省略号 18 个字符：就地展开的旁支头上（Side thread · 名字 + 三个按钮）在 1440 宽时放得下，不再被省略号截第二次（设计复审） */
const cut = (s: string, zh: number) => (CJK.test(s) ? (s.length > zh ? s.slice(0, zh) + '…' : s) : cutWords(s, 18))

/**
 * 旁支的名字（task-4edsc 原型 nameOf）：改过的；没改过用问的第一句（16 字，末尾的问号、句号去掉；空着问的「讲讲这句」不算），
 * 再没有用那一句的头 8 个字；还没问过是「新旁支」。英文的按整词截（cut）。
 * askThis：「讲讲这句」在别的界面语言里的说法（换过界面语言，以前那条旁支发出去的是另一种话），宿主给；中文原句和这会儿的说法总是认
 */
export function sideName(s: { name?: string; quote: string; msgs: readonly { role: string; text?: string }[] }, askThis: readonly string[] = []): string {
  if (s.name?.trim()) return s.name.trim()
  const first = s.msgs
    .find((m) => m.role === 'user')
    ?.text?.replace(/\s+/g, ' ')
    .trim()
    .replace(/[？?。！!，,、；;：:.]+$/, '')
  if (!first) return t('新旁支')
  if (first !== ASK_THIS && first !== t(ASK_THIS) && !askThis.includes(first)) return cut(first, 16)
  const q = s.quote.replace(/\s+/g, ' ').trim()
  return cut(q, 8)
}

/** 旁支问了几问 */
export const sideAsks = (s: { msgs: readonly { role: string }[] }) => s.msgs.filter((m) => m.role === 'user').length
