// dsh-quick-send · Agent 工具测试（node --test）
//
// 验证 4 个工具的 schema 契约与执行行为。重点守住三条纪律：
//   1. update/delete 只认 id，不认标题（标题可能重复）
//   2. delete 必须显式 confirm:true
//   3. 写操作标记为不可并发

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const MOD = 'file://' + path.join(here, '..', 'src', 'agent-tools.js').replace(/\\/g, '/')

/**
 * 本文件每个用例都调 setup() 建临时目录，跑一次测试会建 25 个。
 * 早期不清理，实测在系统 TEMP 累积到 1512 个 —— 测试自身的资源泄漏。
 * 这里统一登记，结束时一次性删除。
 */
const createdDirs = []
after(() => {
  for (const dir of createdDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch (e) {
      /* 清理失败不致命 */
    }
  }
})

/** 搭一个只记录注册的假 tools 服务，返回 { tools, call(name,args) } */
async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-tool-'))
  createdDirs.push(dir)
  const phrasesFile = path.join(dir, 'phrases.json')
  fs.writeFileSync(phrasesFile, JSON.stringify({ schemaVersion: 1, phrases: [] }), 'utf8')

  const { registerAgentTools } = await import(MOD)
  const registry = new Map()
  const fakeTools = {
    register(def) {
      registry.set(def.name, def)
      return () => registry.delete(def.name)
    },
  }
  const ctx = { get: (k) => (k === 'tools' ? fakeTools : undefined) }
  const dispose = registerAgentTools({ phrasesFile, ctx })

  return {
    dir,
    phrasesFile,
    registry,
    dispose,
    read: () => JSON.parse(fs.readFileSync(phrasesFile, 'utf8')),
    async call(name, args) {
      const def = registry.get(name)
      if (!def) throw new Error('no tool: ' + name)
      return def.execute(args, {})
    },
    def: (name) => registry.get(name),
  }
}

// ---------------------------------------------------------------- 注册与 schema

test('注册 4 个工具，名称符合命名约定', async () => {
  const t = await setup()
  assert.deepEqual(
    [...t.registry.keys()].sort(),
    ['quick_send_add', 'quick_send_delete', 'quick_send_list', 'quick_send_update'],
  )
  for (const def of t.registry.values()) {
    assert.match(def.name, /^quick_send_[a-z]+$/, `${def.name} 应为 snake_case`)
    assert.ok(def.description.length > 20, `${def.name} 需要清晰 description`)
    assert.equal(def.parameters.type, 'object')
    assert.ok(def.output && def.output.schema && typeof def.output.render === 'function')
    assert.equal(typeof def.execute, 'function')
  }
  t.dispose()
})

test('update / delete 的定位只接受 id，不接受按标题定位', async () => {
  const t = await setup()

  // delete 只应有 id + confirm（confirm 是安全开关，非定位）
  const delProps = Object.keys(t.def('quick_send_delete').parameters.properties).sort()
  assert.deepEqual(delProps, ['confirm', 'id'], 'delete 只应有 id 与 confirm')
  assert.ok(t.def('quick_send_delete').parameters.required.includes('id'))

  // update 的 title 是「要改成的新标题」（可修改字段），不是定位参数。
  // 定位参数必须只有 id：用一个不存在的 id 调 update，确认它不会靠 title 找条目。
  const upd = t.def('quick_send_update')
  assert.ok(upd.parameters.required.includes('id'), 'update 的 id 必须 required')
  assert.ok(
    !Object.keys(upd.parameters.required).includes('title'),
    'update 的 title 不应是必填（它是可选的新值）',
  )

  // 关键行为验证：只有 title 没有 id 时，必须报「缺少 id」而不是按标题匹配
  await assert.rejects(() => t.call('quick_send_update', { title: '任意' }), /缺少 id/)

  t.dispose()
})

test('delete 的 confirm 是必填参数', async () => {
  const t = await setup()
  const def = t.def('quick_send_delete')
  assert.ok(def.parameters.properties.confirm, '应有 confirm 参数')
  assert.ok(def.parameters.required.includes('confirm'), 'confirm 必须 required')
  assert.equal(def.parameters.properties.confirm.type, 'boolean')
  t.dispose()
})

test('只有 list 标记为可并发，写操作都不可并发', async () => {
  const t = await setup()
  assert.equal(t.def('quick_send_list').isConcurrencySafe(), true)
  assert.equal(t.def('quick_send_add').isConcurrencySafe(), false)
  assert.equal(t.def('quick_send_update').isConcurrencySafe(), false)
  assert.equal(t.def('quick_send_delete').isConcurrencySafe(), false)
  t.dispose()
})

// ---------------------------------------------------------------- add

test('add：写入六字段，id 带 dsh-agent- 前缀', async () => {
  const t = await setup()
  const r = await t.call('quick_send_add', { title: '周报模板', text: '本周完成：{{date}}', category: '写作' })
  assert.match(r.id, /^dsh-agent-/, 'id 应有 dsh-agent- 前缀')
  assert.equal(r.total, 1)

  const doc = t.read()
  const p = doc.phrases[0]
  assert.deepEqual(
    Object.keys(p).sort(),
    ['category', 'createdAt', 'id', 'text', 'title', 'updatedAt'],
    '必须严格六字段',
  )
  assert.equal(p.text, '本周完成：{{date}}', '占位符应原样存储')
  assert.equal(p.title, '周报模板')
  assert.equal(p.category, '写作')
  assert.match(p.createdAt, /^\d{4}-\d{2}-\d{2}T/, 'createdAt 应为 ISO')
  t.dispose()
})

test('add：正文为空或纯空白报错', async () => {
  const t = await setup()
  for (const text of ['', '   ', '\n\t']) {
    await assert.rejects(() => t.call('quick_send_add', { text }), /正文不能为空/)
  }
  assert.equal(t.read().phrases.length, 0, '失败的调用不应写入')
  t.dispose()
})

test('add：超长字段被截断（120 / 20000 / 20）', async () => {
  const t = await setup()
  await t.call('quick_send_add', {
    title: 'T'.repeat(200),
    text: 'X'.repeat(25000),
    category: 'C'.repeat(50),
  })
  const p = t.read().phrases[0]
  assert.equal(p.title.length, 120)
  assert.equal(p.text.length, 20000)
  assert.equal(p.category.length, 20)
  t.dispose()
})

test('add：可以省略 title 和 category', async () => {
  const t = await setup()
  const r = await t.call('quick_send_add', { text: '只有正文' })
  assert.equal(r.title, '')
  assert.equal(r.category, '')
  t.dispose()
})

// ---------------------------------------------------------------- list

test('list：默认不返回正文，includeText 才返回', async () => {
  const t = await setup()
  await t.call('quick_send_add', { title: 'A', text: '正文A', category: 'X' })

  const lean = await t.call('quick_send_list', {})
  assert.equal(lean.total, 1)
  assert.equal(lean.phrases[0].id !== undefined, true, '应返回 id')
  assert.equal(lean.phrases[0].text, undefined, '默认不应含正文')

  const full = await t.call('quick_send_list', { includeText: true })
  assert.equal(full.phrases[0].text, '正文A')
  t.dispose()
})

test('list：按分类过滤', async () => {
  const t = await setup()
  await t.call('quick_send_add', { title: 'A', text: 'a', category: 'X' })
  await t.call('quick_send_add', { title: 'B', text: 'b', category: 'Y' })
  const r = await t.call('quick_send_list', { category: 'X' })
  assert.equal(r.total, 1)
  assert.equal(r.phrases[0].title, 'A')
  assert.deepEqual(r.categories, ['X', 'Y'])
  t.dispose()
})

test('list：按关键词过滤标题/正文/分类，大小写不敏感', async () => {
  const t = await setup()
  await t.call('quick_send_add', { title: 'Code Review', text: 'review the diff', category: 'dev' })
  await t.call('quick_send_add', { title: '周报', text: '写周报', category: '写作' })

  assert.equal((await t.call('quick_send_list', { query: 'code' })).total, 1, '标题大小写不敏感')
  assert.equal((await t.call('quick_send_list', { query: 'REVIEW' })).total, 1, '正文大小写不敏感')
  assert.equal((await t.call('quick_send_list', { query: '写作' })).total, 1, '分类可匹配')
  assert.equal((await t.call('quick_send_list', { query: '不存在' })).total, 0)
  t.dispose()
})

// ---------------------------------------------------------------- update

test('update：按 id 改指定字段，未传的保持不变', async () => {
  const t = await setup()
  const { id } = await t.call('quick_send_add', { title: '旧', text: '旧正文', category: 'X' })

  const r = await t.call('quick_send_update', { id, title: '新' })
  assert.deepEqual(r.changed, ['title'], '只应改 title')

  const p = t.read().phrases[0]
  assert.equal(p.title, '新')
  assert.equal(p.text, '旧正文', '未传的 text 不应变')
  assert.equal(p.category, 'X', '未传的 category 不应变')
  assert.equal(p.id, id, 'id 不应变')
  t.dispose()
})

test('update：id 与 createdAt 保持不变，updatedAt 更新', async () => {
  const t = await setup()
  const { id } = await t.call('quick_send_add', { title: 'A', text: 'a' })
  const before = t.read().phrases[0]

  await new Promise((r) => setTimeout(r, 5))
  await t.call('quick_send_update', { id, text: 'b' })
  const after = t.read().phrases[0]

  assert.equal(after.id, before.id, 'id 必须保持不变（否则另一侧 view.json 会失效）')
  assert.equal(after.createdAt, before.createdAt, 'createdAt 不应变')
  assert.ok(after.updatedAt >= before.updatedAt, 'updatedAt 应更新')
  t.dispose()
})

test('update：id 不存在时报错并提示先 list', async () => {
  const t = await setup()
  await assert.rejects(
    () => t.call('quick_send_update', { id: 'nope', title: 'x' }),
    /未找到.*quick_send_list/s,
  )
  t.dispose()
})

test('update：缺 id 报错', async () => {
  const t = await setup()
  await assert.rejects(() => t.call('quick_send_update', { title: 'x' }), /缺少 id/)
  t.dispose()
})

test('update：正文改成空白时报错', async () => {
  const t = await setup()
  const { id } = await t.call('quick_send_add', { text: 'ok' })
  await assert.rejects(() => t.call('quick_send_update', { id, text: '  ' }), /正文不能为空/)
  assert.equal(t.read().phrases[0].text, 'ok', '失败时不应改动原值')
  t.dispose()
})

test('update：没有任何可改字段时 changed 为空，不写盘', async () => {
  const t = await setup()
  const { id } = await t.call('quick_send_add', { title: 'A', text: 'a' })
  const before = fs.statSync(t.phrasesFile).mtimeMs

  const r = await t.call('quick_send_update', { id })
  assert.deepEqual(r.changed, [])

  const after = fs.statSync(t.phrasesFile).mtimeMs
  assert.equal(after, before, '无改动时不应写文件')
  t.dispose()
})

test('update：值没变时不计入 changed', async () => {
  const t = await setup()
  const { id } = await t.call('quick_send_add', { title: 'A', text: 'a' })
  const r = await t.call('quick_send_update', { id, title: 'A' })
  assert.deepEqual(r.changed, [], '传入相同值不应算改动')
  t.dispose()
})

// ---------------------------------------------------------------- delete

test('delete：必须 confirm:true 才执行', async () => {
  const t = await setup()
  const { id } = await t.call('quick_send_add', { title: 'A', text: 'a' })

  await assert.rejects(() => t.call('quick_send_delete', { id, confirm: false }), /confirm:true/)
  await assert.rejects(() => t.call('quick_send_delete', { id }), /confirm:true/)
  assert.equal(t.read().phrases.length, 1, '未确认时不应删除')

  const r = await t.call('quick_send_delete', { id, confirm: true })
  assert.equal(r.deleted, id)
  assert.equal(r.total, 0)
  assert.equal(t.read().phrases.length, 0)
  t.dispose()
})

test('delete：id 不存在报错', async () => {
  const t = await setup()
  await assert.rejects(() => t.call('quick_send_delete', { id: 'nope', confirm: true }), /未找到/)
  t.dispose()
})

// ---------------------------------------------------------------- 同标题场景（纪律守门）

test('同标题的两条条目，update 只能命中 id 指定的那条', async () => {
  const t = await setup()
  // 用户手动建了两条同名短语（真实场景：共享文件里可能已存在重复标题）
  const a = await t.call('quick_send_add', { title: '新建笔记', text: '第一条的正文' })
  const b = await t.call('quick_send_add', { title: '新建笔记', text: '第二条的正文' })
  assert.notEqual(a.id, b.id, '两条应有不同 id')

  await t.call('quick_send_update', { id: b.id, title: '已改名' })

  const doc = t.read()
  const first = doc.phrases.find((p) => p.id === a.id)
  const second = doc.phrases.find((p) => p.id === b.id)
  assert.equal(first.title, '新建笔记', '同标题的另一条不应被改')
  assert.equal(second.title, '已改名', '只应改 id 指定的那条')
  t.dispose()
})

test('同标题场景下 delete 也只删 id 指定的那条', async () => {
  const t = await setup()
  const a = await t.call('quick_send_add', { title: '重复', text: 'a' })
  const b = await t.call('quick_send_add', { title: '重复', text: 'b' })

  await t.call('quick_send_delete', { id: a.id, confirm: true })
  const doc = t.read()
  assert.equal(doc.phrases.length, 1)
  assert.equal(doc.phrases[0].id, b.id, '应保留未被指定的那条')
  t.dispose()
})

// ---------------------------------------------------------------- 渲染

test('各工具的 render 能产出可读文本', async () => {
  const t = await setup()
  const added = await t.call('quick_send_add', { title: 'A', text: 'a', category: 'X' })

  const listOut = t.def('quick_send_list').output.render({}, await t.call('quick_send_list', { includeText: true }))
  assert.ok(listOut[0].text.includes('A'))
  assert.ok(listOut[0].text.includes(added.id), 'list 文本里应能看到 id')

  const addOut = t.def('quick_send_add').output.render({}, added)
  assert.ok(addOut[0].text.includes('已新增'))

  const upd = await t.call('quick_send_update', { id: added.id, title: 'B' })
  assert.ok(t.def('quick_send_update').output.render({}, upd)[0].text.includes('已更新'))

  const del = await t.call('quick_send_delete', { id: added.id, confirm: true })
  assert.ok(t.def('quick_send_delete').output.render({}, del)[0].text.includes('已删除'))
  t.dispose()
})

test('list 空结果时 render 给出明确提示', async () => {
  const t = await setup()
  const out = t.def('quick_send_list').output.render({}, await t.call('quick_send_list', {}))
  assert.ok(out[0].text.includes('没有匹配'))
  t.dispose()
})

// ---------------------------------------------------------------- 降级

test('tools 服务不可用时不抛错，返回空 disposer', async () => {
  const { registerAgentTools } = await import(MOD)
  const ctx = { get: () => undefined }
  let dispose
  assert.doesNotThrow(() => {
    dispose = registerAgentTools({ phrasesFile: 'x.json', ctx })
  })
  assert.equal(typeof dispose, 'function')
  assert.doesNotThrow(() => dispose())
})
