// 测试用的假 Office.js（scripts/e2e/word.mjs 拿它顶替微软 CDN 上的 office.js）：内存里一个文档，
// 只实现任务窗格用到的那几个接口，但照真 Office.js 的规矩来：属性要先 load 再 sync 才能读，写操作到 sync 才生效，
// 读到的是 load 那一刻的值。它能验证我们的调用顺序和结果，验证不了真 Word 的行为。
;(() => {
  // 文档 = 一串节点：文字，或者内容控件
  const doc = { nodes: [{ text: '正文开头。' }], settings: {}, cursor: null, selected: null, sets: { 1.1: true, 1.3: true } }
  window.__doc = doc
  window.__docText = () => doc.nodes.map((n) => n.text).join('')
  window.__ccs = () => doc.nodes.filter((n) => n.cc).map((n) => ({ tag: n.tag, title: n.title, text: n.text, html: n.html ?? null }))
  const strip = (html) => html.replace(/<\/p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

  function makeCtx() {
    const pending = [] // 到 sync 才做的事
    const guard = (obj, live, props) => {
      const snap = {}
      for (const p of props)
        Object.defineProperty(obj, p, {
          get() {
            if (!(p in snap)) throw new Error(`PropertyNotLoaded: ${p}（先 load 再 sync）`)
            return snap[p]
          },
          set(v) {
            pending.push(() => (live()[p] = v))
          }
        })
      obj.load = (what) => {
        const names = String(what ?? props.join(',')).split(',').map((s) => s.trim().replace(/^items\//, ''))
        pending.push(() => names.forEach((n) => props.includes(n) && (snap[n] = live()[n])))
      }
      return obj
    }
    const ccProxy = (node) =>
      guard(
        {
          insertText(text, where) {
            if (where !== 'Replace') throw new Error('假 Word 的内容控件只支持 Replace')
            pending.push(() => ((node.text = text), delete node.html))
          },
          insertHtml(html, where) {
            if (where !== 'Replace') throw new Error('假 Word 的内容控件只支持 Replace')
            pending.push(() => ((node.html = html), (node.text = strip(html))))
          },
          select() {
            pending.push(() => (doc.selected = node))
          },
          getRange() {
            return { select: () => pending.push(() => (doc.cursor = null)) }
          }
        },
        () => node,
        ['tag', 'title', 'text']
      )
    // 新插的一段文字（在文档末尾，或者在光标所在控件的后面）包成内容控件
    const insertNode = (text) => {
      const node = { text, cc: false, tag: '', title: '' }
      pending.push(() => {
        const at = doc.cursor ? doc.nodes.indexOf(doc.cursor) + 1 : doc.nodes.length
        doc.nodes.splice(at, 0, node)
      })
      return { insertContentControl: () => (pending.push(() => (node.cc = true)), ccProxy(node)) }
    }
    const body = guard(
      {
        contentControls: {
          items: [],
          load(what) {
            pending.push(() => {
              this.items = doc.nodes.filter((n) => n.cc).map((n) => {
                const p = ccProxy(n)
                p.load(what)
                return p
              })
            })
          }
        }
      },
      () => ({ text: window.__docText() }),
      ['text']
    )
    return {
      document: {
        body,
        getSelection() {
          const cur = doc.cursor
          const parent = guard({ }, () => ({ tag: cur?.tag ?? '', isNullObject: !cur }), ['tag', 'isNullObject'])
          // 真 Office.js 里 isNullObject 在 sync 之后就能读，不用单独 load
          const loadTag = parent.load
          parent.load = (w) => (loadTag(w), loadTag('isNullObject'))
          // 新段：段本身是一个文字节点，往段末 insertText 的依次排在它后面
          const insertParagraph = (text) => {
            const p = insertNode('\n' + text)
            return { ...p, insertText: (t, where) => (where === 'End' ? insertNode(t) : (() => { throw new Error('假 Word 的段落只支持 End') })()) }
          }
          return { parentContentControlOrNullObject: parent, insertText: (text) => insertNode(text), insertParagraph }
        }
      },
      async sync() {
        // 一轮里先做完写，再做读：后面排队的 load 能读到前面的写
        while (pending.length) pending.shift()()
      }
    }
  }

  window.Word = { run: async (fn) => fn(makeCtx()) }
  window.Office = {
    onReady(cb) {
      const info = { host: 'Word', platform: 'Mac' }
      cb?.(info)
      return Promise.resolve(info)
    },
    context: {
      requirements: { isSetSupported: (_n, v) => !!doc.sets[v ?? '1.1'] },
      document: {
        settings: {
          get: (k) => (k in doc.settings ? JSON.parse(doc.settings[k]) : null),
          set: (k, v) => (doc.settings[k] = JSON.stringify(v)),
          saveAsync: (cb) => setTimeout(() => cb({ status: 'succeeded' }), 0)
        }
      }
    }
  }
})()
