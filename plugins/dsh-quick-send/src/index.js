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
//
// 另外向 ctx.tools 注册 4 个 agent 工具（见 agent-tools.js）：
//   quick_send_list / quick_send_add / quick_send_update / quick_send_delete

import {
  defaultPhrasesFile,
  defaultViewFile,
  readPhrases,
  readView,
  mergeForDisplay,
  genId,
  nowIso,
  mutatePhrases,
  mutateView,
} from './store.js'
import { registerAgentTools } from './agent-tools.js'

const name = '@wenliang9527/dsh-quick-send'

// inject 保持空数组是有意的，不是遗漏：
//
//   webServer —— 本插件是 Web 插件（package.json 的 dsh.client.platform = 'web'），
//                实际运行一定有；但若声明成硬依赖，在无 HTTP 载体的组合里
//                apply 将永远不执行，连带 agent 工具一起失效。
//   tools     —— 真正可选：有的组合没装工具注册表，此时只失去 agent 工具，
//                面板与端点照常工作。
//
// 两者都在 apply 里用 ctx.get 探测、取不到再 ctx.inject 等待，属于「降级可用」，
// 比声明硬依赖更稳。见 DEV-NOTES §3「inject 缺失是静默失败的头号原因」——
// 那条讲的是「要用的服务必须等到就绪」，这里通过显式 inject 回调满足同一要求。
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
    const title = clampStr(body && body.title, MAX_TITLE)
    const text = clampStr(body && body.text, MAX_TEXT)
    const category = clampStr(body && body.category, MAX_CATEGORY)
    if (text.trim() === '') {
      throw Object.assign(new Error('正文不能为空'), { status: 400 })
    }
    const id = body && typeof body.id === 'string' ? body.id : ''
    const t = nowIso()
    // 读-改-写整体加锁：并发保存时不会互相覆盖
    await mutatePhrases(phrasesFile, (doc) => {
      const idx = id ? doc.phrases.findIndex((p) => p.id === id) : -1
      if (idx >= 0) {
        const cur = doc.phrases[idx]
        doc.phrases[idx] = { ...cur, title, text, category, updatedAt: t }
      } else {
        doc.phrases.push({ id: id || genId(), title, text, category, createdAt: t, updatedAt: t })
      }
    })
    return snapshot()
  }

  async function remove(body) {
    const id = body && typeof body.id === 'string' ? body.id : ''
    if (!id) throw Object.assign(new Error('缺少 id'), { status: 400 })
    const removed = await mutatePhrases(phrasesFile, (doc) => {
      const before = doc.phrases.length
      doc.phrases = doc.phrases.filter((p) => p.id !== id)
      return doc.phrases.length !== before
    })
    if (!removed) {
      throw Object.assign(new Error('未找到该条目'), { status: 404 })
    }
    // 顺手清掉该 id 的本地视图，避免残留
    await mutateView(viewFile, (view) => {
      if (view[id]) delete view[id]
    })
    return snapshot()
  }

  async function setView(body) {
    const id = body && typeof body.id === 'string' ? body.id : ''
    if (!id) throw Object.assign(new Error('缺少 id'), { status: 400 })
    await mutateView(viewFile, (view) => {
      const cur = view[id] || { pinned: false, order: 0 }
      view[id] = {
        pinned: typeof body.pinned === 'boolean' ? body.pinned : cur.pinned,
        order: Number.isFinite(body.order) ? Math.trunc(body.order) : cur.order,
      }
    })
    return snapshot()
  }

  /** 同段内相邻交换 order：只在同一 pinned 段 + 同一 category 段内移动。 */
  async function reorder(body) {
    const id = body && typeof body.id === 'string' ? body.id : ''
    const direction = body && body.direction
    if (!id || (direction !== 'up' && direction !== 'down')) {
      throw Object.assign(new Error('参数无效'), { status: 400 })
    }
    const step = direction === 'up' ? -1 : 1
    // 排序要基于最新快照，所以整个「读快照 + 归一化 + 交换」放进同一把锁
    const found = await mutateView(viewFile, async (view) => {
      const doc = await readPhrases(phrasesFile)
      const rows = mergeForDisplay(doc.phrases, view)
      const i = rows.findIndex((r) => r.id === id)
      if (i < 0) return false
      const cur = rows[i]
      // 规范化该段 order 为 0..n-1 后再交换，避免历史 order 值混乱导致交换无效
      const seg = rows.filter((r) => r.pinned === cur.pinned && r.category === cur.category)
      seg.forEach((r, k) => {
        view[r.id] = { pinned: r.pinned, order: k }
      })
      const si = seg.findIndex((r) => r.id === id)
      const sj = si + step
      if (sj < 0 || sj >= seg.length) return true
      const a = seg[si].id
      const b = seg[sj].id
      const ao = view[a].order
      view[a].order = view[b].order
      view[b].order = ao
      return true
    })
    if (!found) throw Object.assign(new Error('未找到该条目'), { status: 404 })
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

  /**
   * 同源校验：挡掉「本机任意网页用 fetch 打本插件端点」的攻击面。
   *
   * 端点挂在 DSH 的 loopback HTTP 服务上，没有鉴权。不加判断的话，
   * 用户浏览器里任何一个恶意页面都能 `POST /__quick-send/delete` 清空常用语，
   * 或 `GET /list` 把内容读走。
   *
   * 判定：浏览器发起的跨源请求一定带 Origin 头，其 host 与 Host 头不一致即为跨源。
   * 无 Origin（curl、服务端调用、同源导航）放行，避免误伤正常调用。
   */
  function isSameOrigin(req) {
    const origin = req.headers && req.headers.origin
    if (!origin) return true
    const host = req.headers && req.headers.host
    if (!host) return false
    let originHost
    try {
      originHost = new URL(origin).host
    } catch (e) {
      return false // "null" 或畸形 Origin 一律拒绝
    }
    return originHost === host
  }

  function route(handler) {
    return async (req, res) => {
      if (!isSameOrigin(req)) {
        sendJson(res, 403, { error: '拒绝跨源请求' })
        return
      }
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
        handler: route(async () => ({
          phrasesFile,
          viewFile,
          // 面板容器位置，供 Client 半区决定注册到哪个槽位
          panelSlot: typeof cfg.panelSlot === 'string' && cfg.panelSlot === 'dock' ? 'dock' : 'overlay',
        })),
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

  const ws = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
  if (ws !== undefined) {
    registerEndpoints(ws, ctx)
  } else if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (sub) => {
      const w = sub && sub.webServer !== undefined ? sub.webServer : sub && typeof sub.get === 'function' ? sub.get('webServer') : undefined
      if (w !== undefined) registerEndpoints(w, sub)
    })
  }

  // ---- Agent 工具：让模型能直接读写常用语 ----
  // tools 服务可能晚于本插件就绪：先试直接取，取不到再等注入。
  // 注意 ctx.inject 回调拿到的是子作用域对象，上面直接挂着服务本身，
  // 不一定有 get()，所以这里把服务显式传给 registerAgentTools。
  const mountTools = (toolsService) => {
    ctx.effect(() => registerAgentTools({ phrasesFile, tools: toolsService }))
  }
  const toolsNow = typeof ctx.get === 'function' ? ctx.get('tools') : undefined
  if (toolsNow !== undefined) {
    mountTools(toolsNow)
  } else if (typeof ctx.inject === 'function') {
    ctx.inject(['tools'], (sub) => {
      const t = sub && sub.tools !== undefined ? sub.tools : sub && typeof sub.get === 'function' ? sub.get('tools') : undefined
      if (t !== undefined) mountTools(t)
    })
  }

  console.log('[quick-send] host ready')
  console.log('[quick-send]   phrases:', phrasesFile)
  console.log('[quick-send]   view   :', viewFile)
}

export { inject, name }
