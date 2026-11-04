// dsh-quick-send · 共享存储层
//
// 纪律（见 shared-phrases/docs/CONTRACT.md）：
//   全量读改写 + 临时文件原子替换 + 损坏 .bad 留证后空表启动
//
// 内容层 phrases.json（共享，双向写）
// 视图层 view.json（本侧本地，只存 pinned/order）

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const SCHEMA_VERSION = 1

/** 共享内容文件默认位置；可用环境变量或 config 覆盖。 */
export function defaultPhrasesFile() {
  if (process.env.DSH_QUICK_SEND_PHRASES_FILE) return process.env.DSH_QUICK_SEND_PHRASES_FILE
  return 'D:\\WORK_VSCODE\\Vibe-coding\\shared-phrases\\phrases.json'
}

/** 本侧视图文件默认位置。 */
export function defaultViewFile() {
  if (process.env.DSH_QUICK_SEND_VIEW_FILE) return process.env.DSH_QUICK_SEND_VIEW_FILE
  return path.join(os.homedir(), '.dsh', 'quick-send', 'view.json')
}

function nowIso() {
  return new Date().toISOString()
}

function genId() {
  const t = Date.now().toString(36)
  const r = Math.floor(Math.random() * 1679616).toString(36).padStart(4, '0')
  return `dsh-${t}-${r}`
}

function isStr(v) {
  return typeof v === 'string'
}

/**
 * 原子写：先写 <file>.tmp，再 rename 覆盖。
 * Windows 上 rename 无法覆盖已存在的目标，故先 unlink 再 rename（同卷内仍是原子的）。
 */
export async function atomicWrite(file, text) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.promises.writeFile(tmp, text, 'utf8')
  try {
    await fs.promises.rename(tmp, file)
  } catch (e) {
    // Windows: 目标已存在时 rename 会失败，退化为先删后改名。
    if (e && (e.code === 'EEXIST' || e.code === 'EPERM')) {
      await fs.promises.rm(file, { force: true })
      await fs.promises.rename(tmp, file)
    } else {
      throw e
    }
  }
}

/** 读文本；解析失败则把原文件改名 .bad 留证，返回 null 交给调用方降级。 */
async function readJsonOrQuarantine(file, tag) {
  let text
  try {
    text = await fs.promises.readFile(file, 'utf8')
  } catch (e) {
    if (e && e.code === 'ENOENT') return null
    throw e
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (text.trim() === '') return null
  try {
    return JSON.parse(text)
  } catch (e) {
    const bad = `${file}.bad-${Date.now()}`
    try {
      await fs.promises.rename(file, bad)
      console.error(`[quick-send] ${tag} corrupt → quarantined at ${bad}`)
    } catch (e2) {
      console.error(`[quick-send] ${tag} corrupt and quarantine failed:`, String(e2))
    }
    return null
  }
}

/** 规范化为契约字段，丢弃未知字段，补默认值。 */
function normalizePhrase(raw, fallbackTime) {
  if (!raw || typeof raw !== 'object') return null
  const id = isStr(raw.id) && raw.id.trim() !== '' ? raw.id.trim() : genId()
  const text = isStr(raw.text) ? raw.text : ''
  if (text === '' && !isStr(raw.title)) return null
  return {
    id,
    title: isStr(raw.title) ? raw.title : '',
    text,
    category: isStr(raw.category) ? raw.category : '',
    createdAt: isStr(raw.createdAt) && raw.createdAt !== '' ? raw.createdAt : fallbackTime,
    updatedAt: isStr(raw.updatedAt) && raw.updatedAt !== '' ? raw.updatedAt : fallbackTime,
  }
}

/** 读共享内容层。文件不存在 → 空表（不播种，避免与 ZCode 抢写）。 */
export async function readPhrases(file) {
  const doc = await readJsonOrQuarantine(file, 'phrases.json')
  if (doc === null) return { schemaVersion: SCHEMA_VERSION, phrases: [] }
  const version = Number(doc.schemaVersion)
  if (!Number.isFinite(version)) {
    throw new Error('phrases.json 缺少合法 schemaVersion')
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `phrases.json 的 schemaVersion=${version} 高于本插件支持的 ${SCHEMA_VERSION}，为避免破坏数据已拒绝。请升级插件。`,
    )
  }
  const list = Array.isArray(doc.phrases) ? doc.phrases : []
  const t = nowIso()
  const seen = new Set()
  const phrases = []
  for (const raw of list) {
    const p = normalizePhrase(raw, t)
    if (!p) continue
    if (seen.has(p.id)) continue // 重复 id 只保留第一条，避免本地视图错乱
    seen.add(p.id)
    phrases.push(p)
  }
  return { schemaVersion: SCHEMA_VERSION, phrases }
}

/** 写共享内容层（全量）。 */
export async function writePhrases(file, phrases) {
  const doc = { schemaVersion: SCHEMA_VERSION, phrases }
  await atomicWrite(file, JSON.stringify(doc, null, 2) + '\n')
  return doc
}

/** 读本地视图层；损坏或缺失 → 空对象（视图丢了不影响内容）。 */
export async function readView(file) {
  const doc = await readJsonOrQuarantine(file, 'view.json')
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return {}
  const view = {}
  for (const [id, v] of Object.entries(doc)) {
    if (!v || typeof v !== 'object') continue
    view[id] = {
      pinned: v.pinned === true,
      order: Number.isFinite(v.order) ? Math.trunc(v.order) : 0,
    }
  }
  return view
}

/** 写本地视图层（全量）。 */
export async function writeView(file, view) {
  await atomicWrite(file, JSON.stringify(view, null, 2) + '\n')
  return view
}

/** 合并内容 + 视图，按「置顶 → 分类 → order → 创建时间」排序，供面板直接渲染。 */
export function mergeForDisplay(phrases, view) {
  const rows = phrases.map((p) => {
    const v = view[p.id] || { pinned: false, order: 0 }
    return { ...p, pinned: v.pinned, order: v.order }
  })
  rows.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const ca = a.category || '\uffff' // 未分类排在同段末尾
    const cb = b.category || '\uffff'
    if (ca !== cb) return ca < cb ? -1 : 1
    if (a.order !== b.order) return a.order - b.order
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
  })
  return rows
}

export { genId, nowIso }
