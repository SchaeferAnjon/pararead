// 在论文页里跑，认出这一页的论文信息，返回 { items: [...] }。一页一篇的看 <meta> 里的引用信息（出版社、arXiv、PubMed 都用
// Highwire 的 citation_* 或 Dublin Core）；Google Scholar 的结果页一页多篇，一条一条读。只读页面，不改页面。
;(() => {
  const metas = (...names) => {
    const out = []
    for (const m of document.querySelectorAll('meta')) {
      const n = (m.getAttribute('name') || m.getAttribute('property') || '').toLowerCase()
      const v = (m.getAttribute('content') || '').trim()
      if (v && names.includes(n)) out.push(v)
    }
    return out
  }
  // 按给的先后挑：前面的名字有就用前面的（不是按页面里出现的先后）
  const one = (...names) => {
    for (const n of names) {
      const v = metas(n)[0]
      if (v) return v
    }
    return ''
  }
  const abs = (u) => {
    try {
      return u ? new URL(u, location.href).href : ''
    } catch {
      return ''
    }
  }
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
  // 「姓, 名」写成「名 姓」
  const person = (s) => {
    const p = clean(s).split(',')
    return p.length === 2 && p[1].trim() ? `${p[1].trim()} ${p[0].trim()}` : clean(s)
  }
  const yearOf = (s) => (/\b(1[89]|20)\d{2}\b/.exec(s || '') || [])[0] || ''
  const doiOf = (s) => (/10\.\d{4,9}\/[^\s"'<>]+/.exec(s || '') || [])[0]?.replace(/[.,;)]+$/, '') || ''

  // Google Scholar 的结果页：一条结果一篇
  if (/(^|\.)scholar\.google\./.test(location.hostname) && document.querySelector('.gs_r .gs_rt')) {
    const items = []
    for (const r of document.querySelectorAll('.gs_r.gs_or')) {
      const a = r.querySelector('.gs_rt a')
      const title = clean((a || r.querySelector('.gs_rt'))?.textContent).replace(/^\[[A-Z]+\]\s*/, '')
      if (!title) continue
      // 「A Author, B Author - Venue, 2020 - publisher.com」
      const line = clean(r.querySelector('.gs_a')?.textContent)
      const parts = line.split(' - ')
      const pdf = r.querySelector('.gs_or_ggsm a, .gs_ggs a')
      items.push({
        title,
        authors: (parts[0] || '').split(',').map((x) => clean(x).replace(/…$/, '')).filter(Boolean),
        year: yearOf(parts[1] || line),
        venue: clean((parts[1] || '').replace(/,?\s*\b(1[89]|20)\d{2}\b.*$/, '').replace(/…/g, '')),
        url: abs(a?.getAttribute('href')) || location.href,
        pdfUrl: pdf && /pdf/i.test(pdf.textContent + pdf.getAttribute('href')) ? abs(pdf.getAttribute('href')) : '',
        abstract: clean(r.querySelector('.gs_rs')?.textContent)
      })
    }
    return { items }
  }

  // 这一页本身就是 PDF
  if (document.contentType === 'application/pdf') {
    const name = decodeURIComponent(location.pathname.split('/').pop() || '').replace(/\.pdf$/i, '')
    return { items: [{ title: clean(document.title) || name, authors: [], url: location.href, pdfUrl: location.href }] }
  }

  const title = one('citation_title', 'dc.title', 'dcterms.title', 'eprints.title')
  if (!title) return { items: [] }
  let authors = metas('citation_author', 'dc.creator', 'dcterms.creator', 'eprints.creators_name').map(person)
  if (!authors.length) authors = one('citation_authors').split(/;/).map(person).filter(Boolean)
  const arxiv = one('citation_arxiv_id') || (/arxiv\.org\/(?:abs|pdf)\/([\w.\/-]+?)(?:v\d+)?(?:\.pdf)?$/i.exec(location.href) || [])[1] || ''
  const first = one('citation_firstpage', 'prism.startingpage')
  const last = one('citation_lastpage', 'prism.endingpage')
  let pdfUrl = abs(one('citation_pdf_url', 'eprints.document_url'))
  if (!pdfUrl && arxiv) pdfUrl = `https://arxiv.org/pdf/${arxiv}`
  if (!pdfUrl) {
    const a = [...document.querySelectorAll('a[href]')].find((x) => /\.pdf($|[?#])/i.test(x.getAttribute('href')) && /pdf|全文|下载/i.test(x.textContent + (x.getAttribute('title') || '') + (x.getAttribute('aria-label') || '')))
    if (a) pdfUrl = abs(a.getAttribute('href'))
  }
  const abstract = [one('citation_abstract'), one('dc.description', 'dcterms.abstract', 'eprints.abstract'), one('og:description', 'description')].map(clean).find((x) => x.length > 80) || ''
  return {
    items: [
      {
        title: clean(title),
        authors,
        year: yearOf(one('citation_publication_date', 'citation_date', 'citation_online_date', 'citation_year', 'dc.date', 'dcterms.date', 'prism.publicationdate')),
        venue: clean(one('citation_journal_title', 'citation_conference_title', 'citation_inbook_title', 'citation_book_title', 'prism.publicationname', 'citation_dissertation_institution')) || (arxiv ? 'arXiv' : ''),
        doi: doiOf(one('citation_doi', 'prism.doi', 'dc.identifier.doi')) || doiOf(metas('dc.identifier', 'dcterms.identifier').join(' ')),
        arxiv,
        volume: one('citation_volume', 'prism.volume'),
        issue: one('citation_issue', 'prism.number'),
        pages: first ? (last && last !== first ? `${first}-${last}` : first) : '',
        publisher: clean(one('citation_publisher', 'dc.publisher')),
        abstract,
        url: location.href,
        pdfUrl
      }
    ]
  }
})()
