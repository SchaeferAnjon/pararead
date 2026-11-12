// 回答末尾的「接着问：a|b|c」拆出来当建议问题
export function splitFollowups(content: string): { body: string; follow: string[] } {
  const m = /\n\s*\**接着问\**[:：]\s*([^\n]*)\s*$/.exec(content)
  if (!m) return { body: content, follow: [] }
  const follow = m[1]
    .split(/[|｜]/)
    .map((s) => s.trim().replace(/^[-*\d.、\s]+/, ''))
    .filter(Boolean)
    .slice(0, 3)
  return { body: content.slice(0, m.index).trimEnd(), follow }
}
