// 选区和文字偏移的换算。对照模式按「段落元素里的字符偏移」存高亮，原文模式按页内归一化矩形存。

function textNodes(root: Node): Text[] {
  const out: Text[] = []
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = w.nextNode())) out.push(n as Text)
  return out
}

export function offsetsIn(root: Element, range: Range): { start: number; end: number } | null {
  const total = root.textContent?.length ?? 0
  const pre = document.createRange()
  pre.selectNodeContents(root)
  let start = 0
  let end = total
  if (root.contains(range.startContainer)) {
    pre.setEnd(range.startContainer, range.startOffset)
    start = pre.toString().length
  }
  if (root.contains(range.endContainer)) {
    const pre2 = document.createRange()
    pre2.selectNodeContents(root)
    pre2.setEnd(range.endContainer, range.endOffset)
    end = pre2.toString().length
  }
  if (end <= start) return null
  return { start, end }
}

export function rangeAt(root: Element, start: number, end: number): Range | null {
  let pos = 0
  const r = document.createRange()
  let hasStart = false
  for (const t of textNodes(root)) {
    const len = t.data.length
    if (!hasStart && start <= pos + len) {
      r.setStart(t, Math.max(0, start - pos))
      hasStart = true
    }
    if (hasStart && end <= pos + len) {
      r.setEnd(t, Math.max(0, end - pos))
      return r
    }
    pos += len
  }
  if (hasStart) {
    const nodes = textNodes(root)
    const last = nodes[nodes.length - 1]
    r.setEnd(last, last.data.length)
    return r
  }
  return null
}

// 在一个元素（例如 pdf.js 文字层）里找一段文字，忽略空白和连字符差异
export function findTextRange(root: Element, needle: string): Range | null {
  const nodes = textNodes(root)
  let flat = ''
  const map: { node: Text; off: number }[] = []
  for (const t of nodes) {
    for (let i = 0; i < t.data.length; i++) {
      const ch = t.data[i]
      if (/[\s\-‐]/.test(ch)) continue
      flat += ch.toLowerCase()
      map.push({ node: t, off: i })
    }
  }
  const n = needle.replace(/[\s\-‐]/g, '').toLowerCase()
  if (n.length < 2) return null
  let i = flat.indexOf(n)
  if (i < 0) {
    // Scholaread 的原文里有 ⊕、→ 之类符号，文字层可能不同；退一步只找前 30 个字母数字
    const alnum = n.replace(/[^a-z0-9]/g, '')
    const flatAlnum: number[] = []
    let s = ''
    for (let k = 0; k < flat.length; k++)
      if (/[a-z0-9]/.test(flat[k])) {
        s += flat[k]
        flatAlnum.push(k)
      }
    const j = s.indexOf(alnum.slice(0, 30))
    if (j < 0 || alnum.length < 4) return null
    const endIdx = Math.min(flatAlnum.length - 1, j + alnum.length - 1)
    i = flatAlnum[j]
    const r = document.createRange()
    r.setStart(map[i].node, map[i].off)
    const e = map[flatAlnum[endIdx]]
    r.setEnd(e.node, e.off + 1)
    return r
  }
  const r = document.createRange()
  r.setStart(map[i].node, map[i].off)
  const e = map[i + n.length - 1]
  r.setEnd(e.node, e.off + 1)
  return r
}

// 选区矩形合并成行，转成相对页面的 0 到 1 坐标
export function normRects(range: Range, page: Element): number[][] {
  const pr = page.getBoundingClientRect()
  const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5)
  const lines: DOMRect[] = []
  for (const r of rects) {
    const l = lines.find((x) => Math.abs(x.top - r.top) < r.height * 0.5 && Math.abs(x.bottom - r.bottom) < r.height * 0.6 && r.left - x.right < 12)
    if (l) {
      const left = Math.min(l.left, r.left)
      const right = Math.max(l.right, r.right)
      const top = Math.min(l.top, r.top)
      const bottom = Math.max(l.bottom, r.bottom)
      lines[lines.indexOf(l)] = new DOMRect(left, top, right - left, bottom - top)
    } else lines.push(DOMRect.fromRect(r))
  }
  return lines
    .filter((r) => r.left < pr.right && r.right > pr.left && r.top < pr.bottom && r.bottom > pr.top)
    .map((r) => [(r.left - pr.left) / pr.width, (r.top - pr.top) / pr.height, r.width / pr.width, r.height / pr.height].map((v) => Math.round(v * 10000) / 10000))
}

export function selectionText(sel: Selection): string {
  return sel
    .toString()
    .replace(/\s*\n\s*/g, ' ')
    .replace(/(\w)- (\w)/g, '$1$2')
    .trim()
}
