// AI 看得到公式（2026-11-24）：MinerU 快速解析（flash）把公式裁成图放进重排的 Markdown，给 AI 的全文里只剩「[图]」，AI 看不到原文的公式。
// 每篇第一次问 AI 时，把重排里的公式图交给设置 › AI 服务里那家的看图模型转成 LaTeX（一次 8 张，两路一起），按图的指纹存在
// reflow/<id>/formulas.json；以后给 AI 的全文里公式就是 LaTeX（library.aiMarkdown）。重排看法照旧显示原图，转错了也不改原文。
// 认哪张图是公式、怎么问、怎么读回答在共用包 @cn/format 的 formula.ts（画布笔记读 PDF 也用）。
import { writeFileSync } from 'node:fs'
import { formulaLatexAsk, type FormulaLatex, LATEX_BATCH, type MdFormulaImage, parseLatexReply } from '@cn/format'
import type { Ai } from './ai'
import type { ContentPart } from './glm'
import type { Library } from './library'

export interface FormulaDeps {
  library: Library
  ai: Ai
  log: (msg: string) => void
}

/** 一批最多等多久（看图模型想得久时） */
const BATCH_MS = 90_000

export function makeFormulas(d: FormulaDeps) {
  const running = new Map<string, Promise<void>>()

  async function convert(paperId: string, todo: MdFormulaImage[], signal?: AbortSignal): Promise<void> {
    const batches: MdFormulaImage[][] = []
    for (let i = 0; i < todo.length; i += LATEX_BATCH) batches.push(todo.slice(i, i + LATEX_BATCH))
    const got: FormulaLatex = {}
    const t0 = Date.now()
    let failed = ''
    const one = async (b: MdFormulaImage[]) => {
      const content: ContentPart[] = [...b.map((f) => ({ type: 'image_url' as const, image_url: { url: `data:${f.mime};base64,${f.data}` } })), { type: 'text', text: formulaLatexAsk(b.length) }]
      try {
        const reply = await d.ai.once([{ role: 'user', content }], { kind: 'vision', timeoutMs: BATCH_MS, ...(signal ? { signal } : {}) })
        parseLatexReply(reply, b.length).forEach((tex, i) => {
          if (tex !== undefined) got[b[i]!.key] = tex
        })
      } catch (e) {
        failed = (e as Error).message
      }
    }
    // 两路一起：一篇几十个公式也就几批
    for (let i = 0; i < batches.length; i += 2) await Promise.all(batches.slice(i, i + 2).map(one))
    if (Object.keys(got).length) {
      // 读最新的再合（同一篇两处同时转时不互相盖掉）
      writeFileSync(d.library.formulasPath(paperId), JSON.stringify({ ...d.library.formulaLatex(paperId), ...got }, null, 1))
    }
    d.log(`公式图转 LaTeX ${paperId}：${todo.length} 张，${((Date.now() - t0) / 1000).toFixed(1)} 秒，转好 ${Object.values(got).filter(Boolean).length}，不是公式 ${Object.values(got).filter((x) => x === null).length}${failed ? `，有一批失败：${failed}` : ''}`)
  }

  /**
   * 这一篇还没转的公式图转成 LaTeX（同一篇同时只转一次）。返回转完以后还剩的（转失败、看图模型没配好）：
   * 问的时候把这几张图直接带给 AI
   */
  async function ensure(paperId: string, signal?: AbortSignal): Promise<MdFormulaImage[]> {
    const now = d.library.aiMarkdown(paperId)
    if (!now?.pending.length) return []
    if (!d.ai.ready()) return now.pending
    let p = running.get(paperId)
    if (!p) {
      p = convert(paperId, now.pending, signal).finally(() => running.delete(paperId))
      running.set(paperId, p)
    }
    await p
    return d.library.aiMarkdown(paperId)?.pending ?? []
  }

  return { ensure }
}

export type Formulas = ReturnType<typeof makeFormulas>
