/** 两段字按行比：哪些行没了、哪些行是新的（最长公共子序列，测试用：查「只改动到的那几行」） */
export function lineDiff(a: string, b: string): { removed: string[]; added: string[] } {
  const x = a.split('\n')
  const y = b.split('\n')
  const n = x.length
  const m = y.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
  const removed: string[] = []
  const added: string[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) removed.push(x[i++]!)
    else added.push(y[j++]!)
  }
  while (i < n) removed.push(x[i++]!)
  while (j < m) added.push(y[j++]!)
  return { removed, added }
}
