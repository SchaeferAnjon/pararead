import { describe, expect, it } from 'vitest'
import { abstractFromText, findArxiv, findDoi, oaAbstract, oaHit, parseArxivAtom, parseCrossref } from '../src/main/meta'

describe('元数据', () => {
  it('从文字里找 DOI 和 arXiv 号', () => {
    expect(findDoi('Digital Object Identifier 10.1109/TCAD.2019.2931188. Manuscript')).toBe('10.1109/TCAD.2019.2931188')
    expect(findArxiv('arXiv:1706.03762v7 [cs.CL] 2 Aug 2023')).toBe('1706.03762')
    expect(findArxiv('https://arxiv.org/pdf/2401.01234v2')).toBe('2401.01234')
    expect(findDoi('no id here')).toBeNull()
  })
  it('第一页文字里取摘要，到 Index Terms 为止', () => {
    const t = 'Title\nAbstract—In-memory processing can dramatically improve the latency and energy consumption of computing systems by minimizing data transfer.\nIndex Terms—Memristor, MAGIC'
    expect(abstractFromText(t)).toBe('In-memory processing can dramatically improve the latency and energy consumption of computing systems by minimizing data transfer.')
  })
  it('Crossref 的作品转成元数据', () => {
    const m = parseCrossref({
      title: ['SIMPLER MAGIC'],
      author: [{ given: 'Rotem', family: 'Ben-Hur' }],
      'container-title': ['IEEE TCAD'],
      issued: { 'date-parts': [[2020, 10, 1]] },
      volume: '39',
      issue: '10',
      page: '2434-2447',
      abstract: '<jats:p>Abstract In-memory processing.</jats:p>',
      DOI: '10.1109/x'
    })
    expect(m).toMatchObject({ title: 'SIMPLER MAGIC', authors: ['Rotem Ben-Hur'], year: 2020, published: '2020-10-01', venue: 'IEEE TCAD', pages: '2434-2447', abstract: 'In-memory processing.' })
  })
  it('arXiv 的 Atom 取标题、作者、摘要、PDF', () => {
    const xml = `<feed><entry><id>http://arxiv.org/abs/1706.03762v7</id><published>2017-06-12T17:57:34Z</published><title>Attention Is All
 You Need</title><summary> The dominant &amp; sequence </summary><author><name>Ashish Vaswani</name></author><author><name>Noam Shazeer</name></author></entry></feed>`
    const [m] = parseArxivAtom(xml)
    expect(m).toMatchObject({ title: 'Attention Is All You Need', authors: ['Ashish Vaswani', 'Noam Shazeer'], arxiv: '1706.03762', year: 2017, abstract: 'The dominant & sequence', pdfUrl: 'https://arxiv.org/pdf/1706.03762' })
  })
  it('OpenAlex 的倒排摘要拼回原文', () => {
    expect(oaAbstract({ In: [0], memory: [1], 'processing.': [2] })).toBe('In memory processing.')
    const h = oaHit({ id: 'W1', title: 'T', doi: 'https://doi.org/10.1/abc', publication_year: 2020, best_oa_location: { pdf_url: null, landing_page_url: 'https://arxiv.org/abs/2001.00001' } })
    expect(h).toMatchObject({ doi: '10.1/abc', arxiv: '2001.00001', pdfUrl: 'https://arxiv.org/pdf/2001.00001' })
  })
})
