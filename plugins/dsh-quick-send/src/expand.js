// dsh-quick-send · 占位符展开
//
// 契约（仓库 docs/shared-phrases/CONTRACT.md）：
//   {{date}} {{time}} {{datetime}}  —— 本侧实现
//   {{workspace}}                   —— 首版原样保留（当未知占位符）
//   {{clipboard}}                   —— 不支持，原样保留
//   未知 {{xxx}}                    —— 原样保留
//
// 纯函数，便于单测。

function pad(n) {
  return n < 10 ? '0' + n : String(n)
}

/** 本地时区的 YYYY-MM-DD。 */
export function formatDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 本地时区的 HH:mm。 */
export function formatTime(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 本地时区的 YYYY-MM-DD HH:mm:ss。 */
export function formatDateTime(d) {
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g

/**
 * 展开内置时间宏。未知占位符（含 {{workspace}} / {{clipboard}}）原样保留。
 * @param {string} text 原文
 * @param {Date} [now] 注入当前时间，便于测试
 * @returns {string} 展开结果
 */
export function expand(text, now) {
  if (typeof text !== 'string' || text === '') return ''
  const d = now instanceof Date ? now : new Date()
  return text.replace(PLACEHOLDER, (whole, name) => {
    switch (name) {
      case 'date':
        return formatDate(d)
      case 'time':
        return formatTime(d)
      case 'datetime':
        return formatDateTime(d)
      default:
        return whole // 未知占位符原样保留，与 ZCode 侧一致
    }
  })
}

/** 该文本里是否含本侧支持的占位符（用于面板提示）。 */
export function hasSupportedPlaceholder(text) {
  if (typeof text !== 'string') return false
  PLACEHOLDER.lastIndex = 0
  let m
  while ((m = PLACEHOLDER.exec(text)) !== null) {
    if (m[1] === 'date' || m[1] === 'time' || m[1] === 'datetime') return true
  }
  return false
}
