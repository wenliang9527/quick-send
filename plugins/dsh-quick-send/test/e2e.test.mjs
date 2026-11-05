// dsh-quick-send · 端到端测试（node --test）
//
// 用真实的 http.Server 挂上 Host 半区注册的端点，走完整 HTTP 往返。
// 覆盖：CRUD 全链路、视图与排序、错误码、中文无损、跨侧共享读写、契约形状守卫。
//
// 设计：不启动 DSH，只把 webServer 换成一个把 register() 收到的 handler
// 挂到真的 http.Server 上的替身——这样测的是真实的请求/响应路径。

import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const INDEX = path.join(here, '..', 'src', 'index.js')

/** 启一个隔离实例：独立临时目录 + 真实 http.Server。 */
async function startHost(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-e2e-'))
  const phrasesFile = path.join(dir, 'phrases.json')
  const viewFile = path.join(dir, 'view.json')

  const { apply } = await import('file://' + INDEX.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:'))
  const routes = []
  const ws = { register(def) { routes.push(def); return () => {} } }
  const ctx = {
    get: (k) => (k === 'webServer' ? ws : undefined),
    inject(_names, cb) { cb({ webServer: ws }) },
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  }
  apply(ctx, Object.assign({ phrasesFile, viewFile }, config || {}))

  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0]
    const r = routes.find((x) => x.path === url)
    if (!r) { res.writeHead(404).end('no route'); return }
    r.handler(req, res)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + server.address().port

  return {
    base,
    dir,
    phrasesFile,
    viewFile,
    close: () => new Promise((r) => server.close(r)),
    async get(p) {
      const res = await fetch(base + p)
      return { code: res.status, body: await res.json() }
    },
    async post(p, obj) {
      const res = await fetch(base + p, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(obj || {}),
      })
      return { code: res.status, body: await res.json() }
    },
    readPhrases: () => JSON.parse(fs.readFileSync(phrasesFile, 'utf8')),
    readView: () => JSON.parse(fs.readFileSync(viewFile, 'utf8')),
  }
}

// ---------------------------------------------------------------- 基础 CRUD

test('空表启动：list 返回空 phrases 与空 categories', async () => {
  const h = await startHost()
  try {
    const r = await h.get('/__quick-send/list')
    assert.equal(r.code, 200)
    assert.equal(r.body.schemaVersion, 1)
    assert.deepEqual(r.body.phrases, [])
    assert.deepEqual(r.body.categories, [])
  } finally { await h.close() }
})

test('新建：返回列表，id 带 dsh- 前缀，中文与换行无损', async () => {
  const h = await startHost()
  try {
    const text = '第一行\n第二行 "引号" 与 \'单引号\''
    const r = await h.post('/__quick-send/save', { title: '中文标题', text, category: '开发' })
    assert.equal(r.code, 200)
    assert.equal(r.body.phrases.length, 1)
    const p = r.body.phrases[0]
    assert.match(p.id, /^dsh-/)
    assert.equal(p.text, text, '中文/换行/引号必须逐字节无损')
    assert.equal(p.title, '中文标题')
    assert.equal(p.category, '开发')
    assert.deepEqual(r.body.categories, ['开发'])
  } finally { await h.close() }
})

test('新建：多个分类去重排序后返回', async () => {
  const h = await startHost()
  try {
    await h.post('/__quick-send/save', { title: 'a', text: 'x', category: '写作' })
    await h.post('/__quick-send/save', { title: 'b', text: 'y', category: '开发' })
    await h.post('/__quick-send/save', { title: 'c', text: 'z', category: '写作' })
    const r = await h.get('/__quick-send/list')
    assert.deepEqual(r.body.categories, ['写作', '开发'].sort())
  } finally { await h.close() }
})

test('编辑：带 id 更新，总数不变，updatedAt 变新', async () => {
  const h = await startHost()
  try {
    const created = await h.post('/__quick-send/save', { title: '旧', text: '旧正文', category: 'A' })
    const id = created.body.phrases[0].id
    const before = created.body.phrases[0]

    await new Promise((r) => setTimeout(r, 5))
    const r = await h.post('/__quick-send/save', { id, title: '新', text: '新正文', category: 'B' })
    assert.equal(r.body.phrases.length, 1, '编辑不应新增条目')
    const p = r.body.phrases[0]
    assert.equal(p.id, id, 'id 不应变')
    assert.equal(p.title, '新')
    assert.equal(p.text, '新正文')
    assert.equal(p.createdAt, before.createdAt, 'createdAt 不应变')
    assert.ok(p.updatedAt >= before.updatedAt, 'updatedAt 应更新')
  } finally { await h.close() }
})

test('删除：移除条目并清理本侧 view', async () => {
  const h = await startHost()
  try {
    const a = await h.post('/__quick-send/save', { title: 'A', text: 'aa' })
    const idA = a.body.phrases[0].id
    const b = await h.post('/__quick-send/save', { title: 'B', text: 'bb' })
    const idB = b.body.phrases.find((p) => p.title === 'B').id

    await h.post('/__quick-send/view', { id: idA, pinned: true })
    assert.equal(h.readView()[idA].pinned, true)

    const r = await h.post('/__quick-send/delete', { id: idA })
    assert.equal(r.code, 200)
    assert.deepEqual(r.body.phrases.map((p) => p.id), [idB])
    assert.equal(h.readView()[idA], undefined, '删除后应清掉该 id 的 view')
  } finally { await h.close() }
})

// ---------------------------------------------------------------- 校验与错误码

test('校验：正文为空或纯空白返回 400', async () => {
  const h = await startHost()
  try {
    for (const text of ['', '   ', '\n\t ']) {
      const r = await h.post('/__quick-send/save', { title: 't', text })
      assert.equal(r.code, 400, `text=${JSON.stringify(text)} 应被拒`)
      assert.match(r.body.error, /正文不能为空/)
    }
  } finally { await h.close() }
})

test('校验：缺少 id 的操作返回 400，不存在返回 404', async () => {
  const h = await startHost()
  try {
    assert.equal((await h.post('/__quick-send/delete', {})).code, 400)
    assert.equal((await h.post('/__quick-send/delete', { id: 'nope' })).code, 404)
    assert.equal((await h.post('/__quick-send/view', {})).code, 400)
    assert.equal((await h.post('/__quick-send/reorder', { id: 'x', direction: 'sideways' })).code, 400)
    assert.equal((await h.post('/__quick-send/reorder', { id: 'missing', direction: 'up' })).code, 404)
  } finally { await h.close() }
})

test('校验：请求体不是合法 JSON 返回 400', async () => {
  const h = await startHost()
  try {
    const res = await fetch(h.base + '/__quick-send/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    })
    assert.equal(res.status, 400)
  } finally { await h.close() }
})

test('方法不允许：用错 method 返回 405', async () => {
  const h = await startHost()
  try {
    const r1 = await fetch(h.base + '/__quick-send/save')
    assert.equal(r1.status, 405)
    const r2 = await fetch(h.base + '/__quick-send/list', { method: 'POST', body: '{}' })
    assert.equal(r2.status, 405)
  } finally { await h.close() }
})

test('未知路径返回 404（不落到别的端点）', async () => {
  const h = await startHost()
  try {
    const res = await fetch(h.base + '/__quick-send/nope')
    assert.equal(res.status, 404)
  } finally { await h.close() }
})

// ---------------------------------------------------------------- 长度上限

test('长度上限：超长标题/正文/分类被静默截断', async () => {
  const h = await startHost()
  try {
    const r = await h.post('/__quick-send/save', {
      title: 'T'.repeat(200),
      text: 'X'.repeat(25000),
      category: 'C'.repeat(50),
    })
    const p = r.body.phrases[0]
    assert.equal(p.title.length, 120, '标题应截断到 120')
    assert.equal(p.text.length, 20000, '正文应截断到 20000')
    assert.equal(p.category.length, 20, '分类应截断到 20')
  } finally { await h.close() }
})

// ---------------------------------------------------------------- 视图与排序

test('置顶：pinned 排在未置顶之前', async () => {
  const h = await startHost()
  try {
    await h.post('/__quick-send/save', { title: 'A', text: 'a', category: 'Z' })
    const b = await h.post('/__quick-send/save', { title: 'B', text: 'b', category: 'A' })
    const idB = b.body.phrases.find((p) => p.title === 'B').id

    const r = await h.post('/__quick-send/view', { id: idB, pinned: true })
    assert.equal(r.body.phrases[0].id, idB, '置顶项应排第一')
    assert.equal(r.body.phrases[0].pinned, true)
  } finally { await h.close() }
})

test('排序：同段内 up/down 相邻交换', async () => {
  const h = await startHost()
  try {
    const created = []
    for (const t of ['1', '2', '3']) {
      const r = await h.post('/__quick-send/save', { title: t, text: t, category: 'S' })
      created.push(r.body.phrases.find((p) => p.title === t).id)
    }
    // 初始顺序按创建时间升序
    let list = (await h.get('/__quick-send/list')).body.phrases.map((p) => p.title)
    assert.deepEqual(list, ['1', '2', '3'])

    // 把「3」上移一位
    let r = await h.post('/__quick-send/reorder', { id: created[2], direction: 'up' })
    list = r.body.phrases.map((p) => p.title)
    assert.deepEqual(list, ['1', '3', '2'], '上移应换到相邻位置')

    // 再上移一位
    r = await h.post('/__quick-send/reorder', { id: created[2], direction: 'up' })
    list = r.body.phrases.map((p) => p.title)
    assert.deepEqual(list, ['3', '1', '2'])

    // 下移
    r = await h.post('/__quick-send/reorder', { id: created[2], direction: 'down' })
    list = r.body.phrases.map((p) => p.title)
    assert.deepEqual(list, ['1', '3', '2'])
  } finally { await h.close() }
})

test('排序：跨分类不移动（只在同段内交换）', async () => {
  const h = await startHost()
  try {
    const a = await h.post('/__quick-send/save', { title: 'A', text: 'a', category: 'X' })
    const idA = a.body.phrases[0].id
    await h.post('/__quick-send/save', { title: 'B', text: 'b', category: 'Y' })

    const before = (await h.get('/__quick-send/list')).body.phrases.map((p) => p.title)
    const r = await h.post('/__quick-send/reorder', { id: idA, direction: 'down' })
    const after = r.body.phrases.map((p) => p.title)
    assert.deepEqual(after, before, '跨分类不应发生移动')
  } finally { await h.close() }
})

test('视图与内容分离：view.json 只存 pinned/order，不含正文', async () => {
  const h = await startHost()
  try {
    const r = await h.post('/__quick-send/save', { title: '机密标题', text: '机密正文', category: 'S' })
    const id = r.body.phrases[0].id
    await h.post('/__quick-send/view', { id, pinned: true })

    const view = h.readView()
    assert.deepEqual(view[id], { pinned: true, order: 0 })
    const dumped = JSON.stringify(view)
    assert.ok(!dumped.includes('机密'), 'view.json 不应包含任何正文或标题')
  } finally { await h.close() }
})

// ---------------------------------------------------------------- 契约形状

test('契约：phrases.json 顶层与条目字段严格符合六字段', async () => {
  const h = await startHost()
  try {
    await h.post('/__quick-send/save', { title: 't', text: 'x', category: 'c' })
    const doc = h.readPhrases()
    assert.equal(doc.schemaVersion, 1)
    assert.ok(Array.isArray(doc.phrases))
    const keys = Object.keys(doc.phrases[0]).sort().join(',')
    assert.equal(keys, 'category,createdAt,id,text,title,updatedAt', '字段必须严格为契约六项')
    assert.ok(!/^\d+$/.test(String(doc.phrases[0].createdAt)), 'createdAt 应为 ISO 字符串，不是数字')
    assert.match(doc.phrases[0].createdAt, /^\d{4}-\d{2}-\d{2}T/)
  } finally { await h.close() }
})

test('原子写：多次写后目录里不残留 .tmp', async () => {
  const h = await startHost()
  try {
    for (let i = 0; i < 5; i++) {
      await h.post('/__quick-send/save', { title: 't' + i, text: 'x' + i })
    }
    const leftovers = fs.readdirSync(h.dir).filter((f) => f.endsWith('.tmp'))
    assert.deepEqual(leftovers, [])
  } finally { await h.close() }
})

// ---------------------------------------------------------------- 跨侧共享

test('跨侧共享：外部改写 phrases.json 后 list 能读到（模拟 ZCode 写入）', async () => {
  const h = await startHost()
  try {
    await h.post('/__quick-send/save', { title: 'DSH 写的', text: 'dsd' })

    // 模拟 ZCode 侧直接改文件
    const doc = h.readPhrases()
    const now = new Date().toISOString()
    doc.phrases.push({
      id: 'a45019d5-eb19-4426-a198-b0299e35b0a6',
      title: 'ZCode 写的',
      text: '来自另一侧的正文',
      category: '跨侧',
      createdAt: now,
      updatedAt: now,
    })
    fs.writeFileSync(h.phrasesFile, JSON.stringify(doc, null, 2), 'utf8')

    const r = await h.get('/__quick-send/list')
    const titles = r.body.phrases.map((p) => p.title)
    assert.ok(titles.includes('ZCode 写的'), '应读到外部写入的条目')
    assert.ok(titles.includes('DSH 写的'), '原有条目不应丢')
    assert.ok(r.body.categories.includes('跨侧'))
  } finally { await h.close() }
})

test('跨侧共享：不强制 id 前缀，UUID 与自定义 id 都能处理', async () => {
  const h = await startHost()
  try {
    const now = new Date().toISOString()
    fs.writeFileSync(
      h.phrasesFile,
      JSON.stringify({
        schemaVersion: 1,
        phrases: [
          { id: 'a45019d5-eb19-4426-a198-b0299e35b0a6', title: 'UUID', text: 'u', createdAt: now, updatedAt: now },
          { id: '1234567890-99-1', title: '数字式', text: 'n', createdAt: now, updatedAt: now },
        ],
      }),
      'utf8',
    )
    const r = await h.get('/__quick-send/list')
    assert.equal(r.body.phrases.length, 2, '异构 id 都应保留')
  } finally { await h.close() }
})

test('跨侧共享：写到共享文件的内容可被另一实例读到', async () => {
  const a = await startHost()
  const dir = a.dir
  try {
    await a.post('/__quick-send/save', { title: '实例A写的', text: 'from A' })
    const aDoc = a.readPhrases()
    await a.close()

    // 第二个实例指向同一 phrases.json（各自独立 view）
    const b = await startHost({ phrasesFile: a.phrasesFile, viewFile: path.join(dir, 'view-b.json') })
    try {
      const r = await b.get('/__quick-send/list')
      assert.ok(r.body.phrases.some((p) => p.title === '实例A写的'), '实例 B 应读到实例 A 写入的内容')
    } finally { await b.close() }
  } catch (e) {
    await a.close().catch(() => {})
    throw e
  }
})

// ---------------------------------------------------------------- 容错

test('容错：phrases.json 损坏时隔离为 .bad 并空表启动', async () => {
  const h = await startHost()
  try {
    fs.writeFileSync(h.phrasesFile, '{ broken json', 'utf8')
    const r = await h.get('/__quick-send/list')
    assert.equal(r.code, 200)
    assert.deepEqual(r.body.phrases, [], '损坏后应空表启动')
    const bad = fs.readdirSync(h.dir).filter((f) => f.includes('.bad-'))
    assert.equal(bad.length, 1, '应留下 .bad 证据文件')
  } finally { await h.close() }
})

test('容错：schemaVersion 过高时拒绝写入并报错', async () => {
  const h = await startHost()
  try {
    fs.writeFileSync(h.phrasesFile, JSON.stringify({ schemaVersion: 99, phrases: [] }), 'utf8')
    const list = await h.get('/__quick-send/list')
    assert.equal(list.code, 500, 'list 应报错而不是静默降级')
    assert.match(list.body.error, /schemaVersion=99/)

    const save = await h.post('/__quick-send/save', { title: 't', text: 'x' })
    assert.equal(save.code, 500, 'save 也不应写入')
  } finally { await h.close() }
})

test('容错：view.json 损坏不影响内容读取', async () => {
  const h = await startHost()
  try {
    await h.post('/__quick-send/save', { title: '保住了', text: 'x' })
    fs.writeFileSync(h.viewFile, 'not json at all', 'utf8')

    const r = await h.get('/__quick-send/list')
    assert.equal(r.code, 200)
    assert.equal(r.body.phrases.length, 1, '内容不应因视图损坏而丢')
    assert.equal(r.body.phrases[0].pinned, false, '视图应降级为默认值')
  } finally { await h.close() }
})

// ---------------------------------------------------------------- paths

test('paths：返回实际文件路径与 panelSlot', async () => {
  const h = await startHost()
  try {
    const r = await h.get('/__quick-send/paths')
    assert.equal(r.body.phrasesFile, h.phrasesFile)
    assert.equal(r.body.viewFile, h.viewFile)
    assert.equal(r.body.panelSlot, 'overlay', '默认应为 overlay')
  } finally { await h.close() }
})

test('paths：config 指定 dock 时返回 dock', async () => {
  const h = await startHost({ panelSlot: 'dock' })
  try {
    const r = await h.get('/__quick-send/paths')
    assert.equal(r.body.panelSlot, 'dock')
  } finally { await h.close() }
})

// ---------------------------------------------------------------- 并发写

// 并发写曾导致两类事故（0.3.1 及以前）：
//   1. atomicWrite 用固定 `${file}.tmp`，两个并发写抢同一临时名 → ENOENT 崩溃
//   2. read → modify → write 之间无锁 → 后写者覆盖先写者的新增（lost update）
// 这两条测试锁住修复，防止回归。

test('并发写：同时新增 8 条，一条都不能丢', async () => {
  const h = await startHost()
  try {
    const n = 8
    const results = await Promise.all(
      Array.from({ length: n }, (_, i) =>
        h.post('/__quick-send/save', { title: '并发' + i, text: 'body-' + i }),
      ),
    )
    for (const r of results) assert.equal(r.code, 200, '并发写不应报错')
    const list = await h.get('/__quick-send/list')
    assert.equal(list.body.phrases.length, n, `期望 ${n} 条，实际 ${list.body.phrases.length} 条（丢数据）`)
    const titles = list.body.phrases.map((p) => p.title).sort()
    assert.deepEqual(titles, Array.from({ length: n }, (_, i) => '并发' + i).sort())
  } finally { await h.close() }
})

test('并发写：新增与删除交错时总数正确', async () => {
  const h = await startHost()
  try {
    const first = await h.post('/__quick-send/save', { title: '待删', text: 'x' })
    const delId = first.body.phrases[0].id

    await Promise.all([
      h.post('/__quick-send/save', { title: 'A', text: 'a' }),
      h.post('/__quick-send/save', { title: 'B', text: 'b' }),
      h.post('/__quick-send/delete', { id: delId }),
      h.post('/__quick-send/save', { title: 'C', text: 'c' }),
    ])

    const list = await h.get('/__quick-send/list')
    assert.equal(list.body.phrases.length, 3, '应剩 A/B/C 三条')
    assert.ok(!list.body.phrases.some((p) => p.id === delId), '被删的条目不应复活')
  } finally { await h.close() }
})

test('并发写：目录里不残留 .tmp 文件', async () => {
  const h = await startHost()
  try {
    await Promise.all(
      Array.from({ length: 6 }, (_, i) => h.post('/__quick-send/save', { title: 't' + i, text: 'b' + i })),
    )
    const leftovers = fs.readdirSync(h.dir).filter((f) => f.includes('.tmp'))
    assert.deepEqual(leftovers, [], '并发写后不应留下临时文件：' + leftovers.join(','))
  } finally { await h.close() }
})

// ---------------------------------------------------------------- 同源校验

// 端点无鉴权，挂在 DSH 的 loopback 服务上。不加校验时，用户浏览器里任意恶意页面
// 都能 POST /__quick-send/delete 清空常用语。以下三条锁住同源保护。

test('同源校验：跨源 POST 被拒绝且不改数据', async () => {
  const h = await startHost()
  try {
    const seeded = await h.post('/__quick-send/save', { title: '要保住', text: 'x' })
    assert.equal(seeded.code, 200)
    const id = seeded.body.phrases[0].id

    const res = await fetch(h.base + '/__quick-send/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ id }),
    })
    assert.equal(res.status, 403, '跨源请求必须 403')

    const list = await h.get('/__quick-send/list')
    assert.equal(list.body.phrases.length, 1, '跨源请求不得删掉数据')
  } finally { await h.close() }
})

test('同源校验：跨源 GET 也被拒绝', async () => {
  const h = await startHost()
  try {
    const res = await fetch(h.base + '/__quick-send/list', {
      headers: { origin: 'https://evil.example' },
    })
    assert.equal(res.status, 403, '跨源读同样要挡（内容可能含隐私）')
  } finally { await h.close() }
})

test('同源校验：同源请求与无 Origin 请求正常放行', async () => {
  const h = await startHost()
  try {
    // 带上与 Host 一致的 Origin
    const same = new URL(h.base)
    const r1 = await fetch(h.base + '/__quick-send/list', {
      headers: { origin: same.origin },
    })
    assert.equal(r1.status, 200, '同源应放行')

    // 无 Origin（curl / 服务端调用）
    const r2 = await fetch(h.base + '/__quick-send/list')
    assert.equal(r2.status, 200, '无 Origin 应放行')
  } finally { await h.close() }
})
