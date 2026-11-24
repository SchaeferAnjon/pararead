/**
 * 数据库第三批的样本：设计页「存进 md 的完整样子」那一块（五个视图、嵌套筛选、status / relation / rollup / formulas），
 * 课程计划八讲、练习七题（照原型的数据），还有以前的写法、手改过的、带注释的块。单元测试和「打开再保存不变」共用。
 */

/** 设计页那一块，一个字不差 */
export const ECP_BASE = `filters:
  and:
    - file.inFolder("课程/ecp/课程计划")
formulas:
  进度: (已看 / 节数 * 100).round() + "%"
properties:
  状态:
    type: status
    groups:
      待开始: [未开始]
      进行中: [在学]
      完成: [学完]
  练习:
    type: relation
    to: 课程/ecp/练习
    twoWay: 所属讲
  做完几题:
    type: rollup
    via: 练习
    prop: 做完
    calc: checked/all
views:
  - type: table
    name: 全部
    order:
      - file.name
      - 状态
      - 日期
      - formula.进度
      - 练习
      - 做完几题
  - type: kanban
    name: 看板
    groupBy:
      property: 状态
      direction: ASC
  - type: calendar
    name: 日历
    date: 日期
  - type: cards
    name: 画廊
  - type: table
    name: 没学完的
    order:
      - file.name
      - 状态
      - 日期
      - formula.进度
    filters:
      and:
        - 状态 != "学完"
        - or:
            - 日期 <= today() + "7d"
            - 日期.isEmpty()
    sort:
      - property: 日期
        direction: ASC`

/** 放这一块的那篇文档 */
export const ECP_DOC = `# ecp 课程计划\n\n这学期每周两讲，期末前留一周复习。\n\n## 进度\n\n\`\`\`base\n${ECP_BASE}\n\`\`\`\n\n## 备注\n\n第7讲的日期还没排；第4讲前要读完 7.1 到 7.3。\n`

const lec = (状态: string, 日期: string, 已看: number, 节数: number, 练习: string[], body: string) =>
  `---\n状态: ${状态}\n${日期 ? `日期: ${日期}\n` : ''}已看: ${已看}\n节数: ${节数}\n${练习.length ? `练习: [${练习.map((x) => `"[[${x}]]"`).join(', ')}]\n` : ''}---\n\n## 要点\n\n${body}\n`

/** 课程/ecp/课程计划 里的八讲（第2、3、4讲正文里有图，画廊露图） */
export const LECTURES: Record<string, string> = {
  '课程/ecp/课程计划/第1讲 绪论.md': lec('学完', '2026-11-10', 3, 3, ['练习 1.1'], '经济学研究稀缺资源怎么分配。这一讲讲机会成本和边际思考。\n- [x] 读第1章'),
  '课程/ecp/课程计划/第2讲 需求和效用.md': lec('学完', '2026-11-12', 4, 4, ['练习 2.1', '练习 2.2'], '需求曲线向下倾斜，均衡点在两条线相交处。\n\n![需求曲线](第2讲%20需求和效用/需求曲线.png)'),
  '课程/ecp/课程计划/第3讲 生产.md': lec('在学', '2026-11-17', 2, 4, ['练习 3.1', '练习 3.2'], '短期只有劳动能变，边际产量先升后降。\n\n![[边际产量.png]]\n\n- [ ] 看完第3、4节视频'),
  '课程/ecp/课程计划/第4讲 市场结构.md': lec('在学', '2026-11-24', 1, 3, ['练习 4.1'], '完全竞争、垄断竞争、寡头、垄断四种。\n\n<img src="市场.png" width="300">'),
  '课程/ecp/课程计划/第5讲 博弈初步.md': lec('未开始', '2026-11-26', 0, 4, ['练习 5.1'], '囚徒困境、占优策略、纳什均衡。'),
  '课程/ecp/课程计划/第6讲 信息不对称.md': lec('未开始', '2026-12-01', 0, 3, [], '逆向选择和道德风险：二手车市场的例子。'),
  '课程/ecp/课程计划/第7讲 外部性.md': lec('未开始', '', 0, 3, [], '日期还没排。庇古税、科斯定理。'),
  '课程/ecp/课程计划/第8讲 复习.md': lec('未开始', '2026-12-08', 0, 2, [], '把前七讲的练习再做一遍。'),
}

const ex = (done: boolean, 讲: string[]) => `---\n做完: ${done}\n所属讲: [${讲.map((x) => `"[[${x}]]"`).join(', ')}]\n---\n\n## 题目\n\n照课本这一节的例子再算一遍。\n`

/** 课程/ecp/练习 里的七题：所属讲是关联两边写的那一边 */
export const EXERCISES: Record<string, string> = {
  '课程/ecp/练习/练习 1.1.md': ex(true, ['第1讲 绪论']),
  '课程/ecp/练习/练习 2.1.md': ex(true, ['第2讲 需求和效用']),
  '课程/ecp/练习/练习 2.2.md': ex(true, ['第2讲 需求和效用']),
  '课程/ecp/练习/练习 3.1.md': ex(true, ['第3讲 生产']),
  // 手改过的：所属讲写成一行一项的列表
  '课程/ecp/练习/练习 3.2.md': '---\n做完: false\n所属讲:\n  - "[[第3讲 生产]]"\n---\n\n## 题目\n\n照课本这一节的例子再算一遍。\n',
  '课程/ecp/练习/练习 4.1.md': ex(false, ['第4讲 市场结构']),
  '课程/ecp/练习/练习 5.1.md': ex(false, ['第5讲 博弈初步']),
}

export const records = (m: Record<string, string>) => Object.entries(m).map(([path, text]) => ({ path, text }))

/** 以前（第二批）的表头写出来的块：一个视图，筛选写在最外层，列宽、计算、加过列（properties 在最后） */
export const OLD_BASE = `filters:
  and:
    - file.inFolder("读书/书单")
    - 状态 != "放弃"
    - 评分 >= 8
views:
  - type: table
    name: 在读的书
    order:
      - file.name
      - 作者
      - 评分
    sort:
      - property: 评分
        direction: DESC
    columnSize:
      作者: 160
    summaries:
      评分: Average
properties:
  标签:
    type: multi`

/** 以前「任一满足」的写法：数据源文件夹始终要满足，and 里套 or */
export const OLD_OR_BASE = `filters:
  and:
    - file.inFolder("读书/书单")
    - or:
        - 状态 == "在读"
        - 读完 >= today() - "7d"
views:
  - type: table
    name: 表格
    order:
      - file.name
      - 状态`

/** 手改过的：四格缩进、「键:」下面不缩进的列表、单引号、一行的列表、注释（整行的、行尾的）、空行、认不出的键 */
export const HAND_BASE = `# 读书清单（手改过）
filters:
    and:
    - file.inFolder('读书/书单')   # 数据源

formulas:
    读了几天: if(读完.isEmpty(), "", 读完 - 开始)
    "备 注": '"《" + file.name + "》"'

views:
    # 第一个：在读的
    - type: table
      name: '在读 #1'
      limit: 20
      order: [file.name, 作者, "评 分"]
      filters:
          or:
          - 状态 == '在读'   # 单引号的字
          - '!读完.isEmpty()'
          - file.hasTag("书")
    - type: gallery
      name: 封面
      image: none
      displayName: 不认的键`

/** 带注释、Obsidian 别的写法的：not 组、套两层、一句的 filters、groupBy 写成一个字 */
export const ODD_BASE = `filters: file.inFolder("项目/住宿")
views:
  - type: kanban
    name: 按城市
    groupBy: 城市   # 一个字的写法
    filters:
      not:
        - 价格 > 2000
        - and:
            - 城市 == "雷克雅未克"
            - or:
                - 晚数 > 3
                - 晚数.isEmpty()
  - type: list
    name: 别的软件的看法`

/** AI 列（设计「AI 生成一列」存进 md 的样子）：课程计划那一块多一列「练习题」（新建一篇笔记、关联过来）和一列单独选了家的「难度」 */
export const AI_BASE = `filters:
  and:
    - file.inFolder("课程/ecp/课程计划")
properties:
  练习题:
    type: ai
    prompt: 每一讲的练习题
    output: note
    folder: 课程/ecp/练习题
    twoWay: 所属讲
    reads: note
    newRows: auto
  难度:
    type: ai
    prompt: 这一讲对初学者难不难：易、中、难
    output: select
    reads: note
    newRows: manual
    ai: claude/claude-sonnet-5-5/high
views:
  - type: table
    name: 全部
    order:
      - file.name
      - 状态
      - 日期
      - 练习题
      - 难度`

/** 放这一块的那篇文档 */
export const AI_DOC = `# ecp AI 列\n\n\`\`\`base\n${AI_BASE}\n\`\`\`\n`

/** 一讲：AI 写的「练习题」「难度」两格，「AI填的」记着两列 */
export const AI_LECTURE = '---\n状态: 在学\n已看: 2\n节数: 4\n练习题: "[[第3讲 生产 练习题]]"\n难度: 中\nAI填的: 练习题, 难度\n---\n\n## 要点\n\n短期只有劳动能变，边际产量先升后降。\n'

/** 新建的那篇练习题：开头「所属讲」连回去，正文是带引擎标志的 [!ai] 块，块下面是自己写的答案 */
export const AI_NOTE = '---\n所属讲: "[[第3讲 生产]]"\n---\n\n> [!ai] 练习题 · Claude Code · Opus 5.5 · 读了《第3讲 生产》\n> 1. 短期里为什么只有劳动能变？\n> 2. 边际产量为什么先升后降？\n> 3. 平均产量最高点为什么正好和边际产量相交？\n\n我的答案：第 1 题，因为厂房一时改不了。\n'

/**
 * 表底合计（task-i921u「通用合计」）：公式列（收入、支出、结余）、按月分组、按周分组、一行写的 groupBy（认不出的 by: total 原样留着）、
 * 新的几种计算（Count、PercentFilled、SumShare、PercentChecked）、视图里的注释。数据只是举例
 */
export const SUMS_BASE = `filters:
  and:
    - file.inFolder("生活/账目")
formulas:
  收入: if(收支 == "收入", 金额, "")
  支出: if(收支 == "支出", 金额, "")
  结余: if(收支 == "收入", 金额, 0 - 金额)
views:
  - type: table
    name: 按月
    order:
      - file.name
      - 日期
      - 金额
      - 分类
      - 收支
      - formula.收入
      - formula.支出
      - formula.结余
    groupBy:
      property: 日期
      by: month
      direction: DESC
    summaries:
      file.name: Count
      formula.收入: Sum
      formula.支出: Sum
      formula.结余: Sum
  - type: table
    name: 按分类
    # 只看支出，组按小计从大到小（by: total 以后做，现在原样留着）
    order: [file.name, 分类, formula.支出]
    filters:
      and:
        - 收支 == "支出"
    groupBy: {property: 分类, by: total, direction: DESC}
    summaries:
      formula.支出: SumShare
      分类: PercentFilled
  - type: table
    name: 全部
    order: [file.name, 日期, 金额, 报销了]
    groupBy: {property: 日期, by: week}
    summaries:
      日期: Range
      金额: Median
      报销了: PercentChecked`

export const SUMS_DOC = `# 账目\n\n每笔一条，月底看结余。\n\n\`\`\`base\n${SUMS_BASE}\n\`\`\`\n\n上面按月分组，组头是这个月的小计。\n`

const pay = (日期: string, 金额: number, 分类: string, 收支: string, 报销了 = false) =>
  `---\n${日期 ? `日期: ${日期}\n` : ''}金额: ${金额}\n${分类 ? `分类: ${分类}\n` : ''}收支: ${收支}\n报销了: ${报销了}\n---\n`

/** 生活/账目 里的十条：三个月，一条没写日期、一条没写分类，一条去年的 */
export const SUMS_ROWS: Record<string, string> = {
  '生活/账目/工资 11月.md': pay('2026-11-05', 8800, '工资', '收入'),
  '生活/账目/房租 11月.md': pay('2026-11-01', 2600, '住房', '支出'),
  '生活/账目/午饭.md': pay('2026-11-20', 41, '餐饮', '支出', true),
  '生活/账目/地铁.md': pay('2026-11-22', 6, '交通', '支出'),
  '生活/账目/工资 10月.md': pay('2026-10-05', 8200, '工资', '收入'),
  '生活/账目/房租 10月.md': pay('2026-10-01', 2600, '住房', '支出'),
  '生活/账目/书.md': pay('2026-10-18', 89, '', '支出'),
  '生活/账目/工资 9月.md': pay('2026-09-05', 8200, '工资', '收入'),
  '生活/账目/年货.md': pay('2025-12-30', 300, '日用', '支出'),
  '生活/账目/没记日子的.md': pay('', 20, '餐饮', '支出'),
}
