import { t } from '@shared/i18n'
import { useState } from 'react'
import { shownTrStyle, STUDY_STYLES, TR_STYLES, trStyleName, trStyleYields, type TrStyle } from '@shared/trStyles'
import type { SettingsView } from '@shared/types'
import { Segmented } from '../lib/ui'

// 「显示」弹层里的译文样式：十二格，每格一小段英文加译文的真样子；鼠标停在一格上，正文先换成这种
export function TrStyleTiles(props: { settings: SettingsView; onPick: (s: TrStyle) => void; onPreview: (s: TrStyle | null) => void; wide?: boolean; bare?: boolean }) {
  const s = props.settings
  const senseOn = s.display === 'both' && s.senseGroups
  return (
    <div className="tr-tiles-wrap">
      {!props.bare && (
        <div className="aa-sub">
          <span>{t('译文样式')}</span>
          <span className="r">{t('鼠标停在一格上，正文先换给你看')}</span>
        </div>
      )}
      <div className={'tr-tiles' + (props.wide ? ' wide' : '')} onMouseLeave={() => props.onPreview(null)} data-part="译文样式格子">
        {TR_STYLES.map((k) => (
          <button key={k} className={'tr-tile' + (s.trStyle === k ? ' on' : '')} data-style={k} onMouseEnter={() => props.onPreview(k)} onClick={() => props.onPick(k)}>
            <TrSample style={k} />
            <span className="lb">
              {trStyleName(k)}
              <span className="tile-tag">{trStyleYields(k, senseOn, s.senseStyle) ? t('意群时不画') : k === 'text' ? t('默认') : STUDY_STYLES.has(k) ? t('学习') : ''}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// 一小段样张：和正文用同一套样式类
export function TrSample(props: { style: TrStyle; en?: string; zh?: string }) {
  return (
    <div className={`reflow tr-sample tr-${props.style}`}>
      <div className="blk">
        <div className="src" lang="en">
          {props.en ?? 'in-memory'}
        </div>
        <div className="tr" lang="zh-Hans">
          <div className="tr-text">
            <p>{props.zh ?? '存内计算'}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// 设置 › 翻译 里的预览：两段样张，照正文的样式类画，能切上下和左右（样张是论文原文和它的译文，不跟界面语言变）
const PREVIEW: [string, number][][][] = [
  [
    [['In almost any computing system today,', 0], ['data is processed by the processor', 1], ['and stored inside the memory.', 2]],
    [['在当今几乎任何计算系统中，', 0], ['数据由处理器处理，', 1], ['并存储在内存中。', 2]]
  ],
  [
    [['Over the last few decades,', 0], ['computer architects have enjoyed', 1], ['orders of magnitude improvement in computer performance.', 2]],
    [['在过去几十年里，', 0], ['计算机架构师享受到了', 1], ['计算机性能数量级的提升。', 2]]
  ]
]

export function TrPreview(props: { settings: SettingsView; preview: TrStyle | null }) {
  const s = props.settings
  const [lay, setLay] = useState<'stack' | 'side'>(s.trLayout)
  const senseOn = s.senseGroups
  const style = shownTrStyle(props.preview ?? s.trStyle, senseOn, s.senseStyle)
  const piece = (arr: [string, number][], sep: string) =>
    senseOn
      ? arr.map(([x, c], i) => (
          <span key={i}>
            <span className="sg" data-c={c % 4}>
              {x}
            </span>
            {i < arr.length - 1 ? sep : ''}
          </span>
        ))
      : arr.map((x) => x[0]).join(sep)
  return (
    <div className="tr-preview" data-part="译文样式预览">
      <div className="tp-head">
        <span>{t('预览')}</span>
        <Segmented
          className="sm"
          value={lay}
          onChange={setLay}
          options={[
            { value: 'stack', label: t('上下') },
            { value: 'side', label: t('左右') }
          ]}
        />
      </div>
      <div className={`reflow display-both tr-${style} sg-${s.senseStyle}${lay === 'side' ? ' lay-side' : ''}`}>
        {PREVIEW.map(([en, zh], i) =>
          senseOn ? (
            <div key={i} className="blk paragraph senses">
              <div className="src" lang="en">
                <span className="sen" style={{ gridRow: 1, gridColumn: 1 }}>
                  {piece(en, ' ')}
                </span>
              </div>
              <div className="tr" lang="zh-Hans">
                <div className="tr-text">
                  <span className="sen" style={{ gridRow: lay === 'side' ? 1 : 2, gridColumn: lay === 'side' ? 2 : 1 }}>
                    <span className="sen-in">{piece(zh, '')}</span>
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div key={i} className="blk paragraph">
              <div className="src" lang="en">
                {piece(en, ' ')}
              </div>
              <div className="tr" lang="zh-Hans">
                <div className="tr-text">
                  <p>{piece(zh, '')}</p>
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  )
}
