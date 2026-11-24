/** 按段合并的样例（para-merge.test.ts 和 iPhone / iPad 那份 Swift 的对照测试共用，apps/apple/test/format-fixtures.test.ts） */
const base = '# 冰岛旅游\n\n## 第一天 · 雷克雅未克\n\n落地先去租车，取车点在航站楼对面。\n\n晚上去 Sky Lagoon，提前两天订。\n\n## 第二天 · 黄金圈\n\n辛格维利尔国家公园：两块大陆板块中间的裂缝。\n\n## 想去的\n\n黑沙滩 Vík，风大，离浪远一点。\n'

export const PARA_CASES: { name: string; base: string; local: string; remote: string }[] = [
  {
    name: 'Mac 改第一天第一段、iPhone 改第二天那段',
    base,
    local: base.replace('辛格维利尔国家公园：两块大陆板块中间的裂缝。', '辛格维利尔国家公园：两块大陆板块中间的裂缝，可以在湖里潜水。'),
    remote: base.replace('取车点在航站楼对面。', '取车点在航站楼对面，记得带驾照。'),
  },
  {
    name: '两边都改了同一句',
    base,
    local: base.replace('晚上去 Sky Lagoon，提前两天订。', '晚上去 Blue Lagoon，提前两天订。'),
    remote: base.replace('晚上去 Sky Lagoon，提前两天订。', '晚上去 Sky Lagoon，提前三天订。'),
  },
  {
    name: 'Mac 给一段加字、iPhone 把这段挪到另一节',
    base,
    local: base.replace('黑沙滩 Vík，风大，离浪远一点。\n', '').replace('## 想去的\n\n', '## 想去的\n').replace('辛格维利尔国家公园：两块大陆板块中间的裂缝。\n', '辛格维利尔国家公园：两块大陆板块中间的裂缝。\n\n黑沙滩 Vík，风大，离浪远一点。\n'),
    remote: base.replace('黑沙滩 Vík，风大，离浪远一点。', '黑沙滩 Vík，风大，离浪远一点。玄武岩柱很好拍。'),
  },
  {
    name: '同一段改了不同的句子',
    base: '落地先去租车。取车点在航站楼对面。晚上去泡温泉。\n',
    local: '落地先去租四驱车。取车点在航站楼对面。晚上去泡温泉。\n',
    remote: '落地先去租车。取车点在航站楼对面。晚上去泡蓝湖温泉。\n',
  },
  {
    name: '两边都在文末加了一段',
    base: '第一段。\n',
    local: '第一段。\n\niPhone 加的。\n',
    remote: '第一段。\n\nMac 加的。\n',
  },
  {
    name: 'frontmatter 里两边各改一行',
    base: '---\n类型: 笔记\n课程: ecp\n---\n# 题目\n',
    local: '---\n类型: 笔记\n课程: ecpc\n---\n# 题目\n',
    remote: '---\n类型: 书摘\n课程: ecp\n---\n# 题目\n',
  },
  {
    name: '一边删了一段、另一边改了它',
    base: '甲。\n\n乙。\n\n丙。\n',
    local: '甲。\n\n乙改了。\n\n丙。\n',
    remote: '甲。\n\n丙。\n',
  },
  { name: '文末没换行、一边加字', base: '最后一行', local: '最后一行，加字', remote: '最后一行' },
  { name: '空文件', base: '', local: '新写的\n', remote: '' },
]

