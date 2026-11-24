/**
 * 文件字节和编辑器文字之间的转换。规矩：encodeNote(decodeNote(bytes)) 与 bytes 一个字节都不差，
 * 这样「打开再保存」不会在 Git 里留下假改动。
 *
 * 编辑器里一律用 \n；换行风格、BOM 记在 NoteMeta 里，写回时还原。
 */

export type Eol = '\n' | '\r\n'

export interface NoteMeta {
  /** 文件开头有 UTF-8 BOM */
  bom: boolean
  /** 写回时用的换行 */
  eol: Eol
  /** 文件里 \n 和 \r\n 混用 */
  mixedEol: boolean
  /** 混用时每个换行原来是哪种，按顺序。行数没变就照它写回；行数变了统一成 eol */
  lineEols?: Eol[]
  /** 不是合法 UTF-8，或者有单独的 \r：只能只读打开，否则保存会改坏文件 */
  readOnly: boolean
}

export interface DecodedNote {
  text: string
  meta: NoteMeta
}

const BOM = [0xef, 0xbb, 0xbf]

export const DEFAULT_META: NoteMeta = { bom: false, eol: '\n', mixedEol: false, readOnly: false }

export function decodeNote(bytes: Uint8Array): DecodedNote {
  const bom = bytes.length >= 3 && bytes[0] === BOM[0] && bytes[1] === BOM[1] && bytes[2] === BOM[2]
  const body = bom ? bytes.subarray(3) : bytes
  let raw: string
  try {
    raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body)
  } catch {
    raw = new TextDecoder('utf-8', { ignoreBOM: true }).decode(body)
    return { text: raw, meta: { bom, eol: '\n', mixedEol: false, readOnly: true } }
  }

  const crlf = countOf(raw, '\r\n')
  const cr = countOf(raw, '\r')
  const lf = countOf(raw, '\n')
  // 单独的 \r（老 Mac 换行）编辑器会当换行，写回就变了
  if (cr !== crlf) return { text: raw, meta: { bom, eol: '\n', mixedEol: false, readOnly: true } }

  const bareLf = lf - crlf
  const eol: Eol = crlf > bareLf ? '\r\n' : '\n'
  const mixedEol = crlf > 0 && bareLf > 0
  const text = crlf > 0 ? raw.replaceAll('\r\n', '\n') : raw
  const meta: NoteMeta = { bom, eol, mixedEol, readOnly: false }
  if (mixedEol) meta.lineEols = Array.from(raw.matchAll(/\r?\n/g), (m) => m[0] as Eol)
  return { text, meta }
}

export function encodeNote(text: string, meta: NoteMeta): Uint8Array {
  if (meta.readOnly) throw new Error('这个文件只能只读打开，不能写回')
  let body: string
  const eols = meta.lineEols
  if (eols && eols.length === countOf(text, '\n')) {
    let i = 0
    body = text.replace(/\n/g, () => eols[i++]!)
  } else {
    body = meta.eol === '\r\n' ? text.replaceAll('\n', '\r\n') : text
  }
  const encoded = new TextEncoder().encode(body)
  if (!meta.bom) return encoded
  const out = new Uint8Array(encoded.length + 3)
  out.set(BOM, 0)
  out.set(encoded, 3)
  return out
}

function countOf(s: string, needle: string): number {
  let n = 0
  for (let i = s.indexOf(needle); i !== -1; i = s.indexOf(needle, i + needle.length)) n++
  return n
}
