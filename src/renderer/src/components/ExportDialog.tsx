import { Info } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Paper } from '@shared/types'
import { api, errText } from '../api'
import { Segmented, Switch, useToast } from '../lib/ui'
import { Thumb } from './Library'
import { Modal, ModalHead } from './PaperInfo'
import { t } from '@shared/i18n'

type Layout = 'both' | 'src' | 'tr'

// 导出重排后的 PDF：双语 / 只要原文 / 只要译文，可带高亮，笔记作页边旁注；A4，按对照模式的排版
export function ExportDialog(props: { id: string; onClose: () => void }) {
  const toast = useToast()
  const [p, setP] = useState<Paper | null>(null)
  const [layout, setLayout] = useState<Layout>('both')
  const [hl, setHl] = useState(true)
  const [notes, setNotes] = useState(true)
  const [prog, setProg] = useState<{ percent: number; stage: string } | null>(null)

  useEffect(() => {
    void api.getPaper(props.id).then(setP)
    return api.onExportProgress((x) => x.paperId === props.id && setProg({ percent: x.percent, stage: x.stage }))
  }, [props.id])

  if (!p) return null
  const ready = !!p.reflow.ready
  const name = { both: t('双语'), src: t('原文'), tr: t('译文') }[layout]

  const run = async (): Promise<void> => {
    setProg({ percent: 0, stage: t('准备') })
    try {
      const f = await api.exportPdf(p.id, { layout, highlights: hl, notes })
      if (f) {
        toast(t('已导出 {0}', f.replace(/^.*\//, '')))
        props.onClose()
      } else setProg(null)
    } catch (e) {
      toast(t('导出失败：{0}', errText(e)))
      setProg(null)
    }
  }

  const line = (label: string, c: React.ReactNode) => (
    <div className="ex-line">
      <span>{label}</span>
      <div>{c}</div>
    </div>
  )
  return (
    <Modal width={640} label={t('导出{0} PDF', name)} onClose={() => !prog && props.onClose()}>
      <ModalHead title={t('导出{0} PDF', name)} sub={t('{0} · 按对照模式的排版导出，公式和图保持原样。', p.title.length > 48 ? p.title.slice(0, 48) + '…' : p.title)} onClose={props.onClose} />
      <div className="m-bd" style={{ flexDirection: 'row', gap: 24 }}>
        <div className="ex-prev">
          <Thumb p={p} width={170} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {line(
            t('内容'),
            <Segmented
              className="sm"
              value={layout}
              onChange={setLayout}
              options={[
                { value: 'both', label: t('双语') },
                { value: 'src', label: t('只要原文') },
                { value: 'tr', label: t('只要译文') }
              ]}
            />
          )}
          {line(
            t('高亮'),
            <>
              <Switch on={hl} onChange={setHl} label={t('带上高亮')} />
              <span className="hint">{t('带上你的 4 色高亮')}</span>
            </>
          )}
          {line(
            t('笔记'),
            <>
              <Switch on={notes} onChange={setNotes} label={t('带上笔记')} />
              <span className="hint">{t('作为页边旁注')}</span>
            </>
          )}
          {line(t('纸张'), <span className="hint">{t('A4，浅色')}</span>)}
          {!ready ? (
            <div className="callout warn">
              <Info size={14} />
              <span>{t('这篇还没重排好，重排好以后才能导出。')}</span>
            </div>
          ) : (
            layout !== 'src' && (
              <div className="callout">
                <Info size={14} />
                <span>{t('没翻译的段落会先翻完再排版，长文要等一两分钟。')}</span>
              </div>
            )
          )}
          {prog && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              <div className="hint num">
                {prog.stage} · {prog.percent}%
              </div>
              <span className="bar accent">
                <i style={{ width: `${prog.percent}%` }} />
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="m-ft">
        <span className="spacer" />
        <button className="btn" disabled={!!prog} onClick={props.onClose}>
          {t('取消')}
        </button>
        <button className="btn primary" disabled={!ready || !!prog} onClick={() => void run()}>
          {prog ? <span className="spin spin-12" /> : null}
          {t('导出')}
        </button>
      </div>
    </Modal>
  )
}
