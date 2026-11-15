// 灵感库的 IPC：收、改、删、全库列表、AI 转述（存下来，再用不再花额度）、送进 Word
import { ipcMain } from 'electron'
import { sectionForText, sectionsOf } from '../shared/chunk'
import { ideaSegments } from '../shared/ideas'
import { t } from '../shared/i18n'
import { pageOfText } from '../shared/refs'
import type { Idea, IdeaHow } from '../shared/types'
import type { Ctx } from './ctx'
import { getPaper } from './db'
import { allIdeas, deleteIdea, getIdea, listIdeas, saveIdea } from './ideasDb'
import type { WordAddin } from './wordAddin'

export function registerIdeas(c: Ctx, o: { touch: () => void; word: () => WordAddin }): { paraphrase: (id: string, lang: 'en' | 'zh', again?: boolean) => Promise<string> } {
  const { db, library, ai } = c
  const changed = (): void => {
    o.touch()
    c.broadcast('ideas:changed', null)
  }

  ipcMain.handle('idea:list', (_e, paperId: string) => listIdeas(db, paperId))
  ipcMain.handle('idea:all', () => allIdeas(db))
  ipcMain.handle('idea:save', (_e, i: Idea) => {
    // 对照模式里收的没有页码：按原句去原文每页的字里找；原文模式收的按原句在重排里找它在哪一节（找不到用界面按页给的）
    if (i.page === null) i.page = pageOfText(library.pageTexts(i.paperId), i.text)
    if (i.mode === 'pdf') {
      const doc = library.reflowDoc(i.paperId)
      if (doc) i.section = sectionForText(doc.blocks, sectionsOf(doc.blocks), i.text) ?? i.section
    }
    saveIdea(db, i)
    changed()
    return getIdea(db, i.id)
  })
  ipcMain.handle('idea:delete', (_e, id: string) => {
    deleteIdea(db, id)
    changed()
  })

  // 转述：只在点了的时候问 AI，一条一种语言问一次，存在这条灵感上（跟着同步）
  const paraphrase = async (id: string, lang: 'en' | 'zh', again = false): Promise<string> => {
    const i = getIdea(db, id)
    if (!i) throw new Error(t('这条灵感已经删了'))
    if (i.paraphrase?.[lang] && !again) return i.paraphrase[lang]!
    const p = getPaper(db, i.paperId)
    const out = await ai.once(
      [
        {
          role: 'system',
          content: [
            `把论文里的一句话用${lang === 'en' ? '学术英语' : '学术中文'}转述，给用户写论文时引用（引用号由软件加，不要写 [1]、作者、年份）。`,
            '要求：意思不变、不加原句没有的信息；换掉原句的句式和大部分措辞，不能只换几个词；一句话，带句末标点；术语照原文的写法。',
            i.use ? `用户想这样用它：${i.use}` : '',
            again && i.paraphrase?.[lang] ? `换一个说法，别和这一句一样：${i.paraphrase[lang]}` : '',
            '只输出转述的那一句。',
            lang === 'en' ? 'Write the paraphrase in English.' : ''
          ]
            .filter(Boolean)
            .join('\n')
        },
        { role: 'user', content: `论文：《${p?.title ?? ''}》\n原句：${i.text}` }
      ],
      { timeoutMs: 60_000 }
    )
    const text = out.trim().replace(/^["“「]|["”」]$/g, '').trim()
    if (!text) throw new Error(t('AI 没给出转述，再试一次'))
    const cur = getIdea(db, id)
    if (cur) {
      saveIdea(db, { ...cur, paraphrase: { ...(cur.paraphrase ?? {}), [lang]: text }, updatedAt: Math.max(Date.now(), cur.updatedAt + 1) })
      changed()
    }
    return text
  }
  ipcMain.handle('idea:paraphrase', (_e, id: string, lang: 'en' | 'zh', again?: boolean) => paraphrase(id, lang, !!again))

  // 送进 Word：排进 Word 窗格的收件箱，窗格开着就插在光标处（不另起一段）
  ipcMain.handle('idea:toWord', (_e, id: string, how: IdeaHow, lang: 'en' | 'zh') => {
    const word = o.word()
    if (!word.serving()) throw new Error('word-off')
    const i = getIdea(db, id)
    const p = i && getPaper(db, i.paperId)
    if (!i || !p) throw new Error(t('这条灵感已经删了'))
    const para = how === 'paraphrase' ? i.paraphrase?.[lang] : ''
    if (how === 'paraphrase' && !para) throw new Error(t('先转述这一句'))
    word.push({ id: crypto.randomUUID(), createdAt: Date.now(), title: t('灵感'), inline: true, segments: ideaSegments(i, how, para), items: [word.brief(p)] })
    return { paneOpen: word.paneOpen() }
  })

  return { paraphrase }
}
