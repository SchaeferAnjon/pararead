// 标志图：宿主用 Vite 打包（?raw 拿 SVG 原文，.png 拿网址）
declare module '*.svg?raw' {
  const svg: string
  export default svg
}
declare module '*.png' {
  const url: string
  export default url
}
declare module '*.css'
