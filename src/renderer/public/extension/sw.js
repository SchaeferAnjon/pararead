// 后台：问 ParaRead 开着没有；存一篇时先带着浏览器里的登录状态把 PDF 下下来，再连信息一起发给本机的 ParaRead。
// 下载和发送放在这里做，弹出的小窗关了也不会断。
const APP = 'http://127.0.0.1:27485'
const HEAD = { 'X-ParaRead-Connector': '1' }

async function ping() {
  try {
    const r = await fetch(`${APP}/ping`, { headers: HEAD })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

// 下到的要真是 PDF（出版社没权限时给的是登录页）
async function pdfOf(url) {
  try {
    const r = await fetch(url, { credentials: 'include' })
    if (!r.ok) return null
    const buf = new Uint8Array(await r.arrayBuffer())
    if (buf.length < 5 || String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== '%PDF') return null
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000))
    return btoa(bin)
  } catch {
    return null
  }
}

async function save(item) {
  const pdf = item.pdfUrl ? await pdfOf(item.pdfUrl) : null
  const { url, pdfUrl, ...rest } = item
  const meta = Object.fromEntries(Object.entries(rest).filter(([, v]) => (Array.isArray(v) ? v.length : v !== '' && v != null)))
  if (meta.year) meta.year = Number(meta.year)
  try {
    const r = await fetch(`${APP}/save`, { method: 'POST', headers: { ...HEAD, 'Content-Type': 'application/json' }, body: JSON.stringify({ url, meta, pdfUrl: pdfUrl || null, pdf }) })
    return r.ok ? await r.json() : { status: 'failed', title: item.title, error: `HTTP ${r.status}` }
  } catch (e) {
    return { status: 'offline', title: item.title, error: String(e && e.message) }
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'ping') ping().then(reply)
  else if (msg.type === 'save') save(msg.item).then(reply)
  else return false
  return true
})
