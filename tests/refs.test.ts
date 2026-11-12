import { describe, expect, it } from 'vitest'
import { citationText, formatCitation, splitName } from '../src/shared/cite'
import { chunkMarkdown } from '../src/shared/chunk'
import { expandCite, findReferences, listFigures, CITE_RE } from '../src/shared/refs'

const paper = {
  title: 'SIMPLER MAGIC: Synthesis and Mapping of In-Memory Logic Executed in a Single Row to Improve Throughput',
  authors: ['Rotem Ben-Hur', 'Ronny Ronen', 'Ameer Haj-Ali', 'Debjyoti Bhattacharjee'],
  year: 2020,
  venue: 'IEEE Transactions on Computer-Aided Design of Integrated Circuits and Systems',
  volume: '39',
  issue: '10',
  pages: '2434-2447',
  doi: '10.1109/TCAD.2019.2931188',
  url: null,
  publisher: 'IEEE',
  arxiv: null
}

describe('引用格式', () => {
  it('拆名字', () => {
    expect(splitName('Rotem Ben-Hur')).toEqual({ first: 'Rotem', last: 'Ben-Hur' })
    expect(splitName('Kvatinsky, Shahar')).toEqual({ first: 'Shahar', last: 'Kvatinsky' })
    expect(splitName('张三')).toEqual({ first: '', last: '张三' })
  })
  it('GB/T 7714 超过三人写 et al，期刊标 [J]', () => {
    expect(formatCitation(paper, 'gbt')).toBe(
      'BEN-HUR R, RONEN R, HAJ-ALI A, et al. SIMPLER MAGIC: Synthesis and Mapping of In-Memory Logic Executed in a Single Row to Improve Throughput[J]. IEEE Transactions on Computer-Aided Design of Integrated Circuits and Systems, 2020, 39(10): 2434-2447. DOI: 10.1109/TCAD.2019.2931188.'
    )
  })
  it('APA、IEEE、MLA', () => {
    expect(citationText(paper, 'apa')).toBe(
      'Ben-Hur, R., Ronen, R., Haj-Ali, A., & Bhattacharjee, D. (2020). SIMPLER MAGIC: Synthesis and Mapping of In-Memory Logic Executed in a Single Row to Improve Throughput. IEEE Transactions on Computer-Aided Design of Integrated Circuits and Systems, 39(10), 2434–2447. https://doi.org/10.1109/TCAD.2019.2931188'
    )
    expect(citationText(paper, 'ieee')).toMatch(/^R\. Ben-Hur, R\. Ronen, A\. Haj-Ali, and D\. Bhattacharjee, “SIMPLER MAGIC.*,” IEEE Transactions .*, vol\. 39, no\. 10, pp\. 2434–2447, 2020, doi: 10\.1109\/TCAD\.2019\.2931188\.$/)
    expect(citationText(paper, 'mla')).toMatch(/^Ben-Hur, Rotem, et al\. “SIMPLER MAGIC.*\.” IEEE .*, vol\. 39, no\. 10, 2020, pp\. 2434–2447\./)
  })
  it('BibTeX 的键和字段', () => {
    const b = formatCitation(paper, 'bibtex')
    expect(b).toMatch(/^@article\{benhur2020simpler,/)
    expect(b).toContain('author = {Ben-Hur, Rotem and Ronen, Ronny and Haj-Ali, Ameer and Bhattacharjee, Debjyoti}')
    expect(b).toContain('pages = {2434--2447}')
  })
})

describe('参考文献和引用号', () => {
  const md = `# Paper\n\n## I. INTRODUCTION\n\nAs shown in [2], [4]–[6] and [1, 3].\n\n![](data:image/png;base64,AAA)\n\nFig. 2. The crossbar array.\n\n## REFERENCES\n\n[1] A. Author, “First,” 2019. [2] B. Author, “Second,” 2020.\n\n[3] C. Author, “Third,” in Proc. DAC, 2021.\n\n## APPENDIX\n\nExtra.`
  const blocks = chunkMarkdown(md)
  it('拆出参考文献条目，到下一个同级标题为止', () => {
    const refs = findReferences(blocks)
    expect(refs.map((r) => r.n)).toEqual(['1', '2', '3'])
    expect(refs[1].text).toBe('B. Author, “Second,” 2020.')
  })
  it('引用号展开范围和列表', () => {
    const found = [...'As shown in [2], [4]–[6] and [1, 3].'.matchAll(CITE_RE)].map((m) => expandCite(m[1]))
    expect(found).toEqual([['2'], ['4'], ['6'], ['1', '3']])
    expect(expandCite('4–6')).toEqual(['4', '5', '6'])
  })
  it('图表清单配上图注', () => {
    const f = listFigures(blocks)
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ kind: 'figure', label: 'Fig. 2', caption: 'The crossbar array.' })
  })
})
