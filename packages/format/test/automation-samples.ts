/**
 * 自动化的样本（设计页 14-数据库第三批/automations「存进 md 的样子」）：记账那一块（公式、按钮列、按月分组、三条规则），
 * 库里的 .canvas-notes/自动化.md（周记），还有手改过的（注释、四格缩进、认不出的键和一步、几种「当」并在一起）。
 * 单元测试和「打开再保存不变」共用。
 */

/** 设计页那一块，一个字不差 */
export const ACCOUNT_BASE = `filters:
  and:
    - file.inFolder("生活/账目")
formulas:
  收入: if(收支 == "收入", 金额, "")
  支出: if(收支 == "支出", 金额, "")
  结余: number(收入) - number(支出)
properties:
  再记一笔:
    type: button
    do:
      - newRow: {copy: [名字, 金额, 分类, 收支], set: {日期: today()}}
      - open: true
views:
  - type: table
    name: 按月
    groupBy: {property: 日期, by: month, direction: DESC}
    summaries:
      file.name: Count
      formula.收入: Sum
      formula.支出: Sum
      formula.结余: Sum
automations:
  - name: 自动猜分类
    when: {added: true}
    if: 分类.isEmpty()
    do:
      - ai: cell
        prop: 分类
        prompt: 照名字猜是哪一类，只从已有的分类里选
  - name: 交报销单
    when: {changed: 分类, to: 报销}
    do:
      - todo: 交报销单：{{名字}} {{金额}}
        file: 生活/待办.md
        date: 下周一 9:00
  - name: 月底写账单摘要
    when: {every: month, day: last, at: "21:00"}
    missed: once
    do:
      - ai: summary
        rows: 日期.month == today().month
        folder: 生活/记账/账单摘要`

export const ACCOUNT_DOC = `# 2026 记账\n\n每一笔一篇笔记，放在「生活/账目」。\n\n\`\`\`base\n${ACCOUNT_BASE}\n\`\`\`\n\n月底看一眼摘要。\n`

/** 手改过的：四格缩进、注释、几种「当」并在一起、多句的「如果」、关掉的、认不出的键和一步 */
export const HAND_AUTO_BASE = `filters:
    and:
        - file.inFolder("生活/账目")
views:
    - type: table
      name: 全部
automations:
    # 大额的提醒一下
    - name: 大额支出提醒
      when: [{added: true}, {changed: 金额}]   # 新加或者改了金额
      if: {and: [收支 == "支出", 金额 > 500]}
      color: red
      do:
          - notify: 这笔有点大：{{名字}} {{金额}}
          - webhook: https://example.invalid/hook
    - name: 到期提醒
      on: false
      when: {date: 截止, before: 1, at: "9:00"}
      do:
          - todo: '{{名字}} 明天到期'
            date: 明天 9:00`

export const HAND_AUTO_DOC = `# 手改过的自动化\n\n\`\`\`base\n${HAND_AUTO_BASE}\n\`\`\`\n\n后面一段。\n`

/** 库里的 自动化.md（设计页那一段周记，加上整理收件箱） */
export const LIB_DOC = `# 自动化

库里的「当……就……」。

\`\`\`yaml
- name: 周记
  when: {every: week, day: 日, at: "20:00"}
  missed: once
  do:
    - newNote: {folder: 周记, name: "{{年}}-W{{周}}", template: 周记/模板.md, ifExists: keep}
    - command: /写这周的周记
    - notify: 这周的周记建好了
    - todo: 写周记 [[{{新建的那篇}}]]
      file: 周记/待办.md
      date: 今天 21:00
- name: 整理收件箱
  on: false
  when: {every: day, at: "22:00"}
  missed: skip
  do:
    - tidyInbox: true
\`\`\`
`
