import { memo } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

const remark = [remarkGfm, remarkMath]
// MinerU 的脚注会带 style="color:#6b7280"，去掉内联样式，颜色只走 token
function stripStyles() {
  return (tree: unknown): void => {
    const walk = (n: { properties?: Record<string, unknown>; children?: unknown[] }): void => {
      if (n.properties && 'style' in n.properties) delete n.properties.style
      n.children?.forEach((c) => walk(c as typeof n))
    }
    walk(tree as { children?: unknown[] })
  }
}
// MinerU 的 LaTeX 里有 KaTeX 不认的文本模式命令（\textleftarrows 之类）：映射成数学模式的同名符号；
// 还认不出的显示原 LaTeX，用次要字色，不用 KaTeX 默认的红色
const KATEX = {
  throwOnError: false,
  strict: 'ignore',
  errorColor: 'var(--text-2)',
  macros: {
    '\\textleftarrows': '\\leftleftarrows',
    '\\textrightarrows': '\\rightrightarrows',
    '\\textleftarrow': '\\leftarrow',
    '\\textrightarrow': '\\rightarrow',
    '\\textuparrow': '\\uparrow',
    '\\textdownarrow': '\\downarrow',
    '\\textdegree': '^{\\circ}',
    '\\textperthousand': '\\text{‰}',
    '\\textmu': '\\mu',
    '\\textalpha': '\\alpha',
    '\\textbeta': '\\beta',
    '\\textpm': '\\pm',
    '\\texttimes': '\\times',
    '\\textdiv': '\\div',
    '\\textbullet': '\\bullet',
    '\\mathbbm': '\\mathbb',
    '\\bm': '\\boldsymbol',
    '\\mathbfit': '\\boldsymbol',
    '\\Bar': '\\bar',
    '\\overbar': '\\overline',
    '\\lVert': '\\|',
    '\\rVert': '\\|'
  }
}
const rehypeWithRaw = [rehypeRaw, stripStyles, [rehypeKatex, KATEX]] as never
const rehypeNoRaw = [[rehypeKatex, KATEX]] as never

// MinerU 和 GLM 输出都是 Markdown：公式 $...$ / $$...$$，上下标和表格是 HTML。
// raw 只给本地 MinerU 的内容和模型回答用（都在本机渲染，不加载外部资源，CSP 也拦了外链脚本）。
// react-markdown 默认会去掉 data: 链接；MinerU 把图片以 data:image 内嵌，要放行（只放行图片）
function keepDataImages(url: string): string {
  if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(url)) return url
  return defaultUrlTransform(url)
}

export const Markdown = memo(function Markdown(props: { text: string; inline?: boolean; raw?: boolean; className?: string }) {
  const comps = props.inline ? { p: ({ children }: { children?: React.ReactNode }) => <>{children}</> } : undefined
  const Wrap = props.inline ? 'span' : 'div'
  return (
    <Wrap className={props.className}>
      <ReactMarkdown
        remarkPlugins={remark}
        rehypePlugins={props.raw === false ? rehypeNoRaw : rehypeWithRaw}
        urlTransform={keepDataImages}
        components={{
          ...comps,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          )
        }}
      >
        {props.text}
      </ReactMarkdown>
    </Wrap>
  )
})
