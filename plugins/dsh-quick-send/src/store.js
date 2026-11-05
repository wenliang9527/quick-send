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

/** 跨进程 CAS 冲突时的最大重试次数。 */
const CAS_RETRIES = 5

/** 跨进程锁参数，与 ZCode store.rs 对齐（LOCK_TIMEOUT=5s / LOCK_STALE=10s / 25ms 轮询）。 */
const LOCK_TIMEOUT_MS = 5000
const LOCK_STALE_MS = 10000
const LOCK_RETRY_MS = 25

/**
 * 跨进程写锁文件路径。
 *
 * ZCode 侧用 `<数据目录>/quick-send.lock`；DSH 侧只知道 phrases.json 的完整路径，
 * 所以取**同目录**下的同名文件。两侧配同一个 phrases.json 时目录相同 → 天然互斥。
 * 文件名必须与 ZCode 完全一致，否则各锁各的，等于没锁。
 */
function lockPathFor(file) {
  return path.join(path.dirname(file), 'quick-send.lock')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 抢跨进程独占锁（create_new 语义），与 ZCode store.rs 的 acquire_data_lock 对齐。
 *
 * 以「文件存在」为持锁标志：创建成功即持有，删除即释放。
 * 持有者崩溃会留下残留锁，因此超过 LOCK_STALE_MS 的锁视为过期直接抢占。
 *
 * @returns {Promise<() => Promise<void>>} 释放函数
 */
async function acquireFileLock(file) {
  const lockPath = lockPathFor(file)
  await fs.promises.mkdir(path.dirname(lockPath), { recursive: true })
  const deadline = Date.now() + LOCK_TIMEOUT_MS

  for (;;) {
    try {
      // wx = O_CREAT|O_EXCL，等价 Rust 的 create_new(true)
      const fh = await fs.promises.open(lockPath, 'wx')
      await fh.close()
      return async () => {
        try {
          await fs.promises.rm(lockPath, { force: true })
        } catch (e) {
          /* 释放失败不致命：会被逾期机制回收 */
        }
      }
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e
      // 锁被占：判断是否持有者已崩溃（逾期）
      let stale = false
      try {
        const st = await fs.promises.stat(lockPath)
        stale = Date.now() - st.mtimeMs > LOCK_STALE_MS
      } catch (e2) {
        // stat 失败：锁可能刚被释放，直接重试
        continue
      }
      if (stale) {
        try {
          await fs.promises.rm(lockPath, { force: true })
        } catch (e2) {
          /* ignore */
        }
        continue
      }
      if (Date.now() >= deadline) {
        throw new Error('获取数据锁超时：另一进程正在写入或锁残留，请稍后重试')
      }
      await sleep(LOCK_RETRY_MS)
    }
  }
}

/**
 * 只读文件顶层的 revision，用于写入前校验。
 * 不复用 readPhrases：后者会做完整规范化（逐条 normalize、去重），
 * 校验路径上纯属浪费；而且文件此刻可能正被对面写坏，越轻越好。
 *
 * 返回：
 *   - 数字：文件当前 revision
 *   - 0   ：文件不存在或为空（等价于「全新文件」，revision 视作 0）
 *   - -1  ：**读到了但解析不了**（可能对面正写到一半），调用方应重试
 *
 * 区分 0 与 -1 很重要：文件不存在必须等价于 revision 0，否则首次创建
 * 会被误判成永久冲突，陷入重试死循环。
 */
async function readRevisionOnly(file) {
  let raw
  try {
    raw = await fs.promises.readFile(file, 'utf8')
  } catch (e) {
    // ENOENT：全新文件，等价 revision 0（与 readPhrases 的语义一致）
    if (e && e.code === 'ENOENT') return 0
    return -1
  }
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  if (text.trim() === '') return 0
  try {
    const parsed = JSON.parse(text)
    return normalizeRevision(parsed && parsed.revision)
  } catch (e) {
    return -1 // 解析失败：可能正被覆盖写，让调用方重试
  }
}

/**
 * 原子地读改写内容层：**跨进程文件锁**内完成 read → mutate → write，
 * 外加快照校验兜底。这是跨进程安全的关键。
 *
 * 为什么必须用文件锁，光靠 revision 不够：
 * revision 只能「事后发现」冲突，而 check 与 write 之间始终存在窗口 ——
 * 实测 4 进程 × 8 次并发写，仅靠 revision CAS 仍稳定丢 1 条（31/32）。
 * 两个写者可以同时通过校验、然后先后覆盖。要真正互斥必须持有独占锁。
 *
 * 分层（与 CONTRACT §写入纪律 第 5 条一致）：
 *   1. 进程内队列 withWriteLock —— 挡住同进程并发
 *   2. 跨进程文件锁 acquireFileLock —— 挡住 ZCode / 其他 DSH 实例
 *   3. revision 校验 —— 兜底：万一有人不守锁（如老版本 ZCode），
 *      至少能发现并重试，而不是静默覆盖
 *
 * mutate 可能被调用多次，因此必须是**纯操作**：只基于传入的 doc 计算，
 * 不要在里面对外部状态做自增、写文件等有副作用的动作。
 *
 * @param {string} file phrases.json 路径
 * @param {(doc: {schemaVersion:number, revision:number, phrases:object[]}) => (any|Promise<any>)} mutate
 *   就地修改 doc，可返回任意结果；返回的值会作为本函数的结果。
 */
export function mutatePhrases(file, mutate) {
  return withWriteLock(async () => {
    const release = await acquireFileLock(file)
    try {
      for (let attempt = 0; attempt <= CAS_RETRIES; attempt++) {
        const doc = await readPhrases(file)
        const out = await mutate(doc)
        if (isSkip(out)) return out

        // 持锁期间理论上没人能改；这里仍校验一次，防的是不守锁的写者
        const currentRev = await readRevisionOnly(file)
        if (currentRev !== doc.revision) {
          if (attempt === CAS_RETRIES) {
            throw new Error(
              `phrases.json 并发冲突重试 ${CAS_RETRIES} 次仍失败，请重试操作（最后一次读到 revision ${currentRev}，期望 ${doc.revision}）`,
            )
          }
          continue
        }

        await writePhrases(file, doc.phrases, doc.revision)
        return out
      }
      throw new Error('unreachable')
    } finally {
      await release()
    }
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

/**
 * 归一化 revision：非法值/负数/缺失一律按 0（老文件兼容，加法演进）。
 * CONTRACT §写入纪律 第 5 条：schemaVersion 保持 1，revision 是加法字段。
 */
function normalizeRevision(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

/** 读共享内容层。文件不存在 → 空表（不播种，避免与 ZCode 抢写）。 */
export async function readPhrases(file) {
  const doc = await readJsonOrQuarantine(file, 'phrases.json')
  if (doc === null) return { schemaVersion: SCHEMA_VERSION, revision: 0, phrases: [] }
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
  return { schemaVersion: SCHEMA_VERSION, revision: normalizeRevision(doc.revision), phrases }
}

/**
 * 写共享内容层（全量）。
 *
 * revision 是跨进程乐观锁的载体（CONTRACT §写入纪律 第 5 条）：
 *   - **不能**重置为 0 或忽略输入值，否则另一进程推高的 revision 会被无声抹掉、
 *     回退检测永久失效（契约明确点名的坑）。
 *   - 从磁盘读当前值，取 max(磁盘, 传入) + 1。用 max 而不是直接 +1，
 *     是因为传入值可能来自更早的读取（并发场景），max 保证永不回退。
 *
 * @param {string} file phrases.json 路径
 * @param {object[]} phrases 全量条目
 * @param {number} [baseRevision] 调用方读到的 revision；缺省按读磁盘值处理
 */
export async function writePhrases(file, phrases, baseRevision) {
  // 读磁盘当前 revision，避免把别人推高的值抹掉
  let diskRev = 0
  try {
    const raw = await fs.promises.readFile(file, 'utf8')
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
    if (text.trim() !== '') {
      const parsed = JSON.parse(text)
      diskRev = normalizeRevision(parsed && parsed.revision)
    }
  } catch (e) {
    // 文件不存在 / 损坏 / 非法 JSON：当作 0，随后整体覆盖（损坏已在 read 阶段隔离过）
    diskRev = 0
  }
  const base = Number.isFinite(baseRevision) ? normalizeRevision(baseRevision) : 0
  const revision = Math.max(diskRev, base) + 1
  const doc = { schemaVersion: SCHEMA_VERSION, revision, phrases }
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
