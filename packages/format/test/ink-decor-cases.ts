/**
 * 白板装饰（ink-decor.ts）的样例：ink-decor.test.ts 和 iPhone / iPad 那份 Swift（CanvasCore/Ink/InkDecor.swift）的对照测试共用
 * （apps/apple/test/ink-decor-fixtures.test.ts 导出成 Fixtures/ink-decor-cases.json）。
 */
import { eraseCase, INK_DOC } from './ink-cases'

/** 一块白板的笔迹加装饰：笔迹照旧，后面挂卡的胶带、钉在白板上的胶带、自带贴纸、拖进来的图贴纸、手改的一行、两行坏的 */
export const DECOR_DOC =
  INK_DOC +
  '{"tape":"t1aaaaaa","on":"a3","at":"tl","pat":"mint","len":80,"rot":-40,"seed":2}\n' +
  '{"tape":"t2bbbbbb","x":1240,"y":380.25,"pat":"stars","len":150,"rot":-18,"seed":8,"t":1764050000000}\n' +
  '{"sticker":"s1cccccc","k":"coffee","x":648,"y":50,"w":76,"rot":10}\n' +
  '{"sticker":"s2dddddd","src":"附件/手环.png","on":"k1","x":120,"y":-12.5,"w":200,"rot":-6,"by":{"device":"iPad"}}\n' +
  '{ "rot": 3, "sticker": "s3eeeeee", "k": "zd", "x": 10, "y": 20, "w": 96 }\n' +
  '{"tape":"bad1","pat":"mint","len":-3,"rot":0,"seed":1}\n' +
  '{"sticker":"bad2","k":"star","src":"x.png","x":0,"y":0,"w":10}\n'

/** 合并的样例：base、local（Mac）、remote（iPad） */
export const DECOR_MERGE_CASES: { name: string; base: string; local: string; remote: string }[] = (() => {
  const base = DECOR_DOC
  const coffee = '{"sticker":"s1cccccc","k":"coffee","x":648,"y":50,"w":76,"rot":10}'
  const tape2 = '{"tape":"t2bbbbbb","x":1240,"y":380.25,"pat":"stars","len":150,"rot":-18,"seed":8,"t":1764050000000}'
  const moved = (x: number, t: number) => `{"sticker":"s1cccccc","k":"coffee","x":${x},"y":50,"w":76,"rot":10,"t":${t}}`
  return [
    { name: '两边各贴了一样', base, local: base + '{"sticker":"macs0001","k":"star","x":10,"y":10,"w":76,"rot":0}\n', remote: base + '{"tape":"ipdt0001","on":"d2","at":"br","pat":"dots","len":84,"rot":-38,"seed":5}\n' },
    { name: '一边挪贴纸、另一边换胶带花样', base, local: base.replace(coffee, moved(700, 1764060000000)), remote: base.replace(tape2, tape2.replace('"stars"', '"kraft"').replace('1764050000000', '1764060000500')) },
    { name: '同一张贴纸两边都挪了：取后挪的', base, local: base.replace(coffee, moved(700, 1764070000900)), remote: base.replace(coffee, moved(500, 1764070000100)) },
    { name: '同一张贴纸两边都挪了、时间一样：取 keep 那边', base, local: base.replace(coffee, moved(700, 1764070000000)), remote: base.replace(coffee, moved(500, 1764070000000)) },
    { name: '一边删了贴纸、另一边挪了它：留挪过的', base, local: base.replace(coffee + '\n', ''), remote: base.replace(coffee, moved(520, 1764080000000)) },
    { name: '一边放到最上面、另一边写了一笔', base, local: base.replace(coffee + '\n', '') + coffee + '\n', remote: base + '{"g":"ipdg0003","x":5,"y":5}\n{"id":"ipds0005","g":"ipdg0003","pen":"pen","c":"#1d2421","p":"0,0,300,500,0"}\n' },
    { name: '两边都删了同一样', base, local: base.replace(tape2 + '\n', ''), remote: base.replace(tape2 + '\n', '') },
    { name: '一边橡皮擦断一笔、另一边挪了贴纸', base, local: base.replace(coffee, moved(610, 1764090000000)), remote: eraseCase(base, 'r8f2k1zq', [[0, 8], [14, 24]], ['ipdc0101', 'ipdc0102'], 1764090000500) },
  ]
})()

/** 卡片样式、便签、列样式的样例：一篇白板（和 board-fixtures 一样按 splitDoc 的列、卡下标挑） */
export const DECOR_CARD_DOC =
  '# 组会\n\n## 方向\n<!-- column style=header color=2 -->\n\n驾驶压力识别 + 图网络。\n\n<!-- card id=d2 style=outline color=1 -->\n情绪识别：E4 手环。\n\n<!-- card id=n3 x=250 y=498 note=pink rot=-2.5 -->\n问 Nima：数据什么时候给？\n\n## 这周\n\n- [x] 读完 C73\n- [ ] 跑通特征\n\n## 下周\n<!-- column x=900 y=40 -->\n\n空着\n'
