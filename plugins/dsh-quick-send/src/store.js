// dsh-quick-send · 共享存储层
//
// 纪律（见仓库 docs/shared-phrases/CONTRACT.md）：
//   全量读改写 + 临时文件原子替换 + 损坏 .bad 留证后空表启动
//
// 内容层 phrases.json（共享，双向写）
// 视图层 view.json（本侧本地，只存 pinned/order）

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const SCHEMA_VERSION = 1

/**
 * 内容文件默认位置：跟着用户目录走，开箱即用、不依赖任何绝对路径。
 *
 * 纪律：这里**不得**出现任何具体的盘符或机器路径。想和 ZCode 等其他客户端共享，
 * 由使用者在 profile 的 cordis.patch.yml 里显式配置 phrasesFile 指向同一个文件
 * （见 README「两种装法」），而不是把某台机器的路径写成默认值。
 *
 * 优先级：config.phrasesFile（index.js 处理）> 环境变量 > ~/.dsh/quick-send/phrases.json
 */
export function defaultPhrasesFile() {
  if (process.env.DSH_QUICK_SEND_PHRASES_FILE) return process.env.DSH_QUICK_SEND_PHRASES_FILE
  return path.join(os.homedir(), '.dsh', 'quick-send', 'phrases.json')
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

let tmpSeq = 0

/**
 * 原子写：先写唯一的临时文件，再 rename 覆盖。
 *
 * 临时名必须**唯一**（进程号 + 单调序号 + 随机数）。早期用固定的 `<file>.tmp`
 * 会让两个并发写抢同一个临时名：先完成的一方把 tmp 改名走，另一方 rename 时
 * 目标已不存在 → ENOENT 崩溃。唯一名让每个写者互不干扰。
 *
 * Windows 上 rename 无法覆盖已存在的目标，故退化为先 unlink 再 rename
 * （同卷内 rename 本身仍是原子的，读者永远看到完整的旧文件或完整的新文件）。
 */
export async function atomicWrite(file, text) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  tmpSeq = (tmpSeq + 1) % 1e9
  const rand = Math.random().toString(36).slice(2, 10)
  const tmp = `${file}.${process.pid}.${tmpSeq}.${rand}.tmp`
  await fs.promises.writeFile(tmp, text, 'utf8')
  try {
    await fs.promises.rename(tmp, file)
  } catch (e) {
    if (e && (e.code === 'EEXIST' || e.code === 'EPERM')) {
      try {
        await fs.promises.rm(file, { force: true })
        await fs.promises.rename(tmp, file)
      } catch (e2) {
        await fs.promises.rm(tmp, { force: true })
        throw e2
      }
    } else {
      // 失败时清掉自己的临时文件，不给下次留垃圾
      await fs.promises.rm(tmp, { force: true })
      throw e
    }
  }
}

/**
 * 进程内写串行队列。
 *
 * read → modify → write 之间没有任何锁，两个并发请求会交错：
 * 双方都读到同一份旧快照，后写者用「旧快照 + 自己那条」覆盖文件，
 * 先写者新增的条目被静默抹掉（lost update）。实测 2 个并发就丢。
 *
 * 把「读改写」整体串起来即可根除进程内竞态。跨进程（ZCode 与 DSH 同时写）
 * 仍需 revision 机制，那属于 CONTRACT §4 的已知边界，不在本层解决。
 */
let writeChain = Promise.resolve()

function withWriteLock(fn) {
  const run = writeChain.then(fn, fn)
  // 无论成功失败都让队列继续，避免一次异常卡死后续所有写
  writeChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** mutate 的返回值含义：{ skipWrite: true } 表示本次没有任何改动，不必落盘。 */
function isSkip(out) {
  return out !== null && typeof out === 'object' && out.skipWrite === true
}

/**
 * 原子地读改写内容层：整个 read → mutate → write 在进程内串行执行。
 * mutate 返回 { skipWrite: true } 时跳过写盘（用于「没有实际改动」的场景，
 * 避免无谓地刷新 mtime、触发另一侧的变更检测）。
 * @param {string} file phrases.json 路径
 * @param {(doc: {schemaVersion:number, phrases:object[]}) => (any|Promise<any>)} mutate
 *   就地修改 doc，可返回任意结果；返回的值会作为本函数的结果。
 */
export function mutatePhrases(file, mutate) {
  return withWriteLock(async () => {
    const doc = await readPhrases(file)
    const out = await mutate(doc)
    if (!isSkip(out)) await writePhrases(file, doc.phrases)
    return out
  })
}

/**
 * 原子地读改写视图层，语义同 mutatePhrases。
 * @param {string} file view.json 路径
 * @param {(view: object) => (any|Promise<any>)} mutate
 */
export function mutateView(file, mutate) {
  return withWriteLock(async () => {
    const view = await readView(file)
    const out = await mutate(view)
    if (!isSkip(out)) await writeView(file, view)
    return out
  })
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
