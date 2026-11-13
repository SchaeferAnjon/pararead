// 点开插件时的小窗：看 ParaRead 开着没有，认出这一页的论文，点一下存进去。
const zh = navigator.language.toLowerCase().startsWith('zh')
const T = zh
  ? { on: '已连上', off: '没开着', none: '这一页没认出论文信息。打开论文的详情页（有题名、作者的那一页）再点。', open: '先打开 ParaRead，再点一次。', save: '存进 ParaRead', saveN: (n) => `把选中的 ${n} 篇存进 ParaRead`, saving: '正在存…', pdf: '有 PDF', nopdf: '没找到 PDF，只存信息', added: '已存进文献库', duplicate: '文献库里已经有了', link: '没下到 PDF，只存了信息', failed: '没存上', offline: 'ParaRead 没开着' }
  : { on: 'Connected', off: 'Not running', none: 'No paper found on this page. Open the paper\'s own page (with title and authors) and try again.', open: 'Open ParaRead first, then click again.', save: 'Save to ParaRead', saveN: (n) => `Save ${n} selected to ParaRead`, saving: 'Saving…', pdf: 'PDF found', nopdf: 'No PDF found, saving details only', added: 'Saved to library', duplicate: 'Already in library', link: 'PDF not available, saved details only', failed: 'Not saved', offline: 'ParaRead is not running' }
const $ = (id) => document.getElementById(id)
const send = (msg) => chrome.runtime.sendMessage(msg)
const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text) n.textContent = text
  return n
}

async function activeTab() {
  // 测试时把这个页面开成一个标签页，用 ?tab= 指定要存哪个标签页
  const id = Number(new URLSearchParams(location.search).get('tab'))
  return id ? chrome.tabs.get(id) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
}

async function detect(tab) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['detect.js'] })
    if (r?.result?.items?.length) return r.result.items
  } catch {
    // 浏览器自带的 PDF 阅读器、商店页这些地方进不去：下面按网址判断
  }
  if (/\.pdf($|[?#])/i.test(tab.url || '')) return [{ title: (tab.title || '').replace(/\.pdf$/i, '') || decodeURIComponent(tab.url.split('/').pop().split(/[?#]/)[0]).replace(/\.pdf$/i, ''), authors: [], url: tab.url, pdfUrl: tab.url }]
  return []
}

async function main() {
  const [app, tab] = await Promise.all([send({ type: 'ping' }), activeTab()])
  $('app').textContent = app ? T.on : T.off
  $('app').className = app ? 'ok' : 'off'
  const items = await detect(tab)
  const list = $('list')
  if (!items.length) return void list.append(el('div', 'empty', T.none))
  const rows = items.map((it) => {
    const row = el('label', 'item')
    const box = el('input')
    box.type = 'checkbox'
    box.checked = items.length === 1
    if (items.length === 1) box.hidden = true
    const body = el('div')
    const status = el('div', 's', it.pdfUrl ? T.pdf : T.nopdf)
    body.append(el('div', 't', it.title), el('div', 'd', [it.authors.slice(0, 3).join(', ') + (it.authors.length > 3 ? ' …' : ''), it.venue, it.year].filter(Boolean).join(' · ')), status)
    row.append(box, body)
    list.append(row)
    return { it, box, status }
  })
  const go = $('go')
  const picked = () => rows.filter((r) => r.box.checked && !r.done)
  const label = () => {
    const n = picked().length
    go.textContent = items.length === 1 ? T.save : T.saveN(n)
    go.disabled = !n
    go.hidden = rows.every((r) => r.done)
  }
  rows.forEach((r) => r.box.addEventListener('change', label))
  label()
  go.hidden = false
  if (!app) list.append(el('div', 'empty', T.open))
  go.addEventListener('click', async () => {
    go.disabled = true
    for (const r of picked()) {
      r.status.className = 's'
      r.status.textContent = T.saving
      const res = await send({ type: 'save', item: r.it })
      const st = res?.status ?? 'failed'
      r.status.className = 's ' + (st === 'added' || st === 'duplicate' ? 'ok' : st === 'link' ? '' : 'bad')
      r.status.textContent = T[st] + (st === 'failed' && res?.error ? `: ${res.error}` : '')
      r.status.dataset.status = st
      if (st === 'added' || st === 'duplicate' || st === 'link') (r.done = true), (r.box.disabled = true)
    }
    label()
  })
}
main()
