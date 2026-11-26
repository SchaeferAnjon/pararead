// 测试用的小 PDF：每页一段英文（Helvetica），pdf.js 读得出字。保版面翻译的测试拿它当原文，假 BabelDOC 拿它写「译文」。
const WORDS = 'stress detection signal model vehicle driver memory compute graph energy layout paragraph table figure result method network sensor latency budget'.split(' ')

/** 第 p 页的原文：60 个词，每页不一样（三连词才分得开） */
export function srcText(p) {
  return Array.from({ length: 60 }, (_, i) => WORDS[(i * (p + 3) + p) % WORDS.length] + (i % 7 === 0 ? ` page${p}` : '')).join(' ')
}
/** 「译文」：每个词前加 x，和原文没有一个三连词相同（untranslatedReason 判成翻好了） */
export const trText = (p) => srcText(p).split(' ').map((w) => `x${w}`).join(' ')

const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`)
function lines(text, n = 80) {
  const out = []
  let cur = ''
  for (const w of text.split(' ')) {
    if (cur && cur.length + w.length + 1 > n) {
      out.push(cur)
      cur = w
    } else cur = cur ? `${cur} ${w}` : w
  }
  if (cur) out.push(cur)
  return out
}

/** 每页一段字的 PDF */
export function makePdf(pages) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  pages.forEach((text, i) => {
    const stream = `BT /F1 10 Tf 12 TL 40 760 Td ${lines(text).map((l) => `(${esc(l)}) '`).join(' ')} ET`
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`)
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  })
  let out = '%PDF-1.4\n'
  const offs = []
  objs.forEach((o, i) => {
    offs.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const x = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
