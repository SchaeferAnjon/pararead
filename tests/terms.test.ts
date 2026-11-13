import { describe, expect, it } from 'vitest'
import { locateTerms, termOf, termRegex } from '../src/shared/terms'

const T = (term: string) => ({ term, zh: '', explain: '' })

describe('术语：在正文里找', () => {
  it('长的先匹配，整词、不分大小写、断行也算', () => {
    const terms = [T('carry'), T('carry lookback'), T('IMC')]
    const re = termRegex(terms)!
    const text = 'The Carry\nLookback scheme beats plain carry chains. IMCs are not IMC.'
    expect([...text.matchAll(re)].map((m) => m[0])).toEqual(['Carry\nLookback', 'carry', 'IMC'])
    expect(termOf(terms, 'Carry\nLookback')?.term).toBe('carry lookback')
  })

  it('带连字符、括号这些符号的术语照样找', () => {
    const re = termRegex([T('In-Memory Computing'), T('P99')])!
    expect([...'Memristive in-memory computing has P99 latency.'.matchAll(re)].map((m) => m[0])).toEqual(['in-memory computing', 'P99'])
  })

  it('数每个术语出现几次、在哪几段', () => {
    const w = locateTerms([T('memristor'), T('MAGIC'), T('absent')], [
      { id: 'a', md: 'A memristor is used. Each memristor stores a bit.' },
      { id: 'b', md: 'MAGIC gates use memristors.' },
      { id: 'c', md: 'Using MAGIC again.' }
    ])
    expect(w.get('memristor')).toEqual({ count: 2, blocks: ['a'] })
    expect(w.get('MAGIC')).toEqual({ count: 2, blocks: ['b', 'c'] })
    expect(w.get('absent')).toEqual({ count: 0, blocks: [] })
  })

  it('没有术语、术语太短：不匹配', () => {
    expect(termRegex([])).toBeNull()
    expect(termRegex([T('a')])).toBeNull()
  })
})
