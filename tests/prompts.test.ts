// 公式守则（0.2.1）：AI 不能说「公式是图片看不到」再拿通常写法冒充原文
import { describe, expect, it } from 'vitest'
import { chatSystem, explainMessages, FORMULA_RULE } from '../src/main/prompts'

describe('讲公式的规矩', () => {
  it('守则说清三件事：照原文还原、读不清直说或请框、通常写法放后面并标明', () => {
    expect(FORMULA_RULE).toMatch(/照材料里原文的写法还原/)
    expect(FORMULA_RULE).toMatch(/不要说公式是图片看不到/)
    expect(FORMULA_RULE).toMatch(/原文公式读不清/)
    expect(FORMULA_RULE).toMatch(/请框一下这个公式/)
    expect(FORMULA_RULE).toMatch(/不拿通常的写法冒充原文/)
    expect(FORMULA_RULE).toMatch(/放在原文那一版之后.*这是通常的写法，和原文可能不同/)
  })
  it('右栏问答和划词讲解的系统提示都带着它', () => {
    expect(chatSystem({ title: 'T', context: 'C', truncated: false, lang: '简体中文' })).toContain(FORMULA_RULE)
    expect(JSON.stringify(explainMessages({ text: 'x', paragraph: 'p', title: 'T', lang: '简体中文' }))).toContain(JSON.stringify(FORMULA_RULE).slice(1, -1))
  })
})
