// cyrb53：纯 JS 的 53 位字符串哈希，主进程和界面都能用，用来给段落和译文做缓存键。
export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return n.toString(16).padStart(14, '0')
}

// 段落文字归一化：空白合并、去掉首尾空白。flash 和 basic 两档对同一段的输出空白常不同。
export function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

// 段落哈希只看文字本身；译文缓存键再拼上目标语言。
export function paraHash(text: string): string {
  return cyrb53(normalizeText(text))
}

export function translationKey(text: string, lang: string): string {
  return cyrb53(lang + '\n' + normalizeText(text))
}

/** 意群缓存的键：这一段原文和它现在的译文（译文重翻了就重新要一次）；版本号在切法改了的时候加一 */
export function sensesKey(en: string, zh: string): string {
  return cyrb53(`senses1\n${en}\n${zh}`)
}
