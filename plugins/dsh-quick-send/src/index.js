// dsh-quick-send · Host 半区
//
// 内容：共享 phrases.json（双向写）
// 视图：本侧 view.json（pinned/order）
// 通道：webServer HTTP 端点（照 prompt-vault 已验证的 webServer 模式）
//
//   GET  /__quick-send/list    -> { schemaVersion, phrases:[...merged], categories:[...] }
//   POST /__quick-send/save    { id?, title, text, category } -> list
//   POST /__quick-send/delete  { id }                          -> list
//   POST /__quick-send/view    { id, pinned?, order? }         -> list
//   POST /__quick-send/reorder { id, direction:'up'|'down' }   -> list
//   GET  /__quick-send/paths   -> { phrasesFile, viewFile }    （面板显示数据位置）

import {
  defaultPhrasesFile,
  defaultViewFile,
  readPhrases,
  writePhrases,
  readView,
  writeView,
  mergeForDisplay,
  genId,
  nowIso,
} from './store.js'

const name = 'dsh-quick-send'
const inject = []

const MAX_TITLE = 120
const MAX_TEXT = 20000
const MAX_CATEGORY = 20

function clampStr(v, max) {
  if (typeof v !== 'string') return ''
  return v.length > max ? v.slice(0, max) : v
}

export function apply(ctx, config) {
  const cfg = config && typeof config === 'object' ? config : {}
  const phrasesFile = typeof cfg.phrasesFile === 'string' && cfg.phrasesFile.trim() !== ''
    ? cfg.phrasesFile
    : defaultPhrasesFile()
  const viewFile = typeof cfg.viewFile === 'string' && cfg.viewFile.trim() !== ''
    ? cfg.viewFile
    : defaultViewFile()

  async function snapshot() {
    const doc = await readPhrases(phrasesFile)
    const view = await readView(viewFile)
    const rows = mergeForDisplay(doc.phrases, view)
    const categories = []
    for (const r of rows) {
      if (r.category && !categories.includes(r.category)) categories.push(r.category)
    }
    categories.sort()
    return { schemaVersion: doc.schemaVersion, phrases: rows, categories }
  }

  async function save(body) {
    const doc = await readPhrases(phrasesFile)
    const title = clampStr(body && body.title, MAX_TITLE)
    const text = clampStr(body && body.text, MAX_TEXT)
    const category = clampStr(body && body.category, MAX_CATEGORY)
    if (text.trim() === '') {
      throw Object.assign(new Error('正文不能为空'), { status: 400 })
    }
    const id = body && typeof body.id === 'string' ? body.id : ''
    const t = nowIso()
    const idx = id ? doc.phrases.findIndex((p) => p.id === id) : -1
    if (idx >= 0) {
      const cur = doc.phrases[idx]
      doc.phrases[idx] = { ...cur, title, text, category, updatedAt: t }
    } else {
      doc.phrases.push({ id: id || genId(), title, text, category, createdAt: t, updatedAt: t })
    }
    await writePhrases(phrasesFile, doc.phrases)
    return snapshot()
  }

  async function remove(body) {
    const doc = await readPhrases(phrasesFile)
    const id = body && typeof body.id === 'string' ? body.id : ''
    if (!id) throw Object.assign(new Error('缺少 id'), { status: 400 })
    const before = doc.phrases.length
    doc.phrases = doc.phrases.filter((p) => p.id !== id)
    if (doc.phrases.length === before) {
      throw Object.assign(new Error('未找到该条目'), { status: 404 })
    }
    await writePhrases(phrasesFile, doc.phrases)
    // 顺手清掉该 id 的本地视图，避免残留
    const view = await readView(viewFile)
    if (view[id]) {
      delete view[id]
      await writeView(viewFile, view)
    }
    return snapshot()
  }

  async function setView(body) {
    const id = body && typeof body.id === 'string' ? body.id : ''
    if (!id) throw Object.assign(new Error('缺少 id'), { status: 400 })
    const view = await readView(viewFile)
    const cur = view[id] || { pinned: false, order: 0 }
    view[id] = {
      pinned: typeof body.pinned === 'boolean' ? body.pinned : cur.pinned,
      order: Number.isFinite(body.order) ? Math.trunc(body.order) : cur.order,
    }
    await writeView(viewFile, view)
    return snapshot()
  }

  /** 同段内相邻交换 order：只在同一 pinned 段 + 同一 category 段内移动。 */
  async function reorder(body) {
    const id = body && typeof body.id === 'string' ? body.id : ''
    const direction = body && body.direction
    if (!id || (direction !== 'up' && direction !== 'down')) {
      throw Object.assign(new Error('参数无效'), { status: 400 })
    }
    const snap = await snapshot()
    const rows = snap.phrases
    const i = rows.findIndex((r) => r.id === id)
    if (i < 0) throw Object.assign(new Error('未找到该条目'), { status: 404 })
    const cur = rows[i]
    const step = direction === 'up' ? -1 : 1
    // 找同段内相邻项
    let j = i + step
    if (j < 0 || j >= rows.length) return snap
    const other = rows[j]
    if (other.pinned !== cur.pinned || other.category !== cur.category) return snap

    const view = await readView(viewFile)
    // 规范化该段 order 为 0..n-1 后再交换，避免历史 order 值混乱导致交换无效
    const seg = rows.filter((r) => r.pinned === cur.pinned && r.category === cur.category)
    seg.forEach((r, k) => {
      view[r.id] = { pinned: r.pinned, order: k }
    })
    const si = seg.findIndex((r) => r.id === id)
    const sj = si + step
    if (sj < 0 || sj >= seg.length) {
      await writeView(viewFile, view)
      return snapshot()
    }
    const a = seg[si].id
    const b = seg[sj].id
    const ao = view[a].order
    view[a].order = view[b].order
    view[b].order = ao
    await writeView(viewFile, view)
    return snapshot()
  }

  function sendJson(res, status, obj) {
    const body = JSON.stringify(obj)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    })
    res.end(body)
  }

  async function readBody(req) {
    let raw = ''
    try {
      for await (const chunk of req) raw += chunk
    } catch (e) {
      /* ignore */
    }
    if (!raw) return {}
    try {
      return JSON.parse(raw)
    } catch (e) {
      throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 })
    }
  }

  function route(handler) {
    return async (req, res) => {
      try {
        sendJson(res, 200, await handler(req))
      } catch (e) {
        const status = e && Number.isFinite(e.status) ? e.status : 500
        if (status >= 500) console.error('[quick-send]', String(e && e.message ? e.message : e))
        sendJson(res, status, { error: String(e && e.message ? e.message : e) })
      }
    }
  }

  const registerEndpoints = (ws, targetCtx) => {
    const defs = [
      { path: '/__quick-send/list', method: 'GET', handler: route(async () => snapshot()) },
      {
        path: '/__quick-send/save',
        method: 'POST',
        handler: route(async (req) => save(await readBody(req))),
      },
      {
        path: '/__quick-send/delete',
        method: 'POST',
        handler: route(async (req) => remove(await readBody(req))),
      },
      {
        path: '/__quick-send/view',
        method: 'POST',
        handler: route(async (req) => setView(await readBody(req))),
      },
      {
        path: '/__quick-send/reorder',
        method: 'POST',
        handler: route(async (req) => reorder(await readBody(req))),
      },
      {
        path: '/__quick-send/paths',
        method: 'GET',
        handler: route(async () => ({ phrasesFile, viewFile })),
      },
    ]
    for (const def of defs) {
      targetCtx.effect(() =>
        ws.register({
          kind: 'exact',
          path: def.path,
          handler: (req, res) => {
            if (req.method !== def.method) {
              return sendJson(res, 405, { error: 'method not allowed' })
            }
            return def.handler(req, res)
          },
        }),
      )
    }
  }

  const ws = ctx.get('webServer')
  if (ws !== undefined) {
    registerEndpoints(ws, ctx)
  } else {
    ctx.inject(['webServer'], (sub) => registerEndpoints(sub.webServer, sub))
  }

  console.log('[quick-send] host ready')
  console.log('[quick-send]   phrases:', phrasesFile)
  console.log('[quick-send]   view   :', viewFile)
}

export { inject, name }
