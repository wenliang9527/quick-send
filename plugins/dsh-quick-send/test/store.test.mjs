// dsh-quick-send 单元测试（node --test）
// 覆盖：占位符展开 / 存储原子写 / 损坏自愈 / schemaVersion 守卫 / 视图合并排序
// 只测纯逻辑，不启动 DSH。

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { expand, formatDate, formatTime, formatDateTime } from '../src/expand.js'
import {
  readPhrases,
  writePhrases,
  readView,
  writeView,
  mergeForDisplay,
  atomicWrite,
  SCHEMA_VERSION,
} from '../src/store.js'

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qs-test-'))
}

// ---- expand ----

test('expand: 三个时间宏按本地时区展开', () => {
  const d = new Date(2026, 10, 5, 9, 7, 3) // 本地 2026-11-05 09:07:03
  assert.equal(expand('{{date}}', d), '2026-11-05')
  assert.equal(expand('{{time}}', d), '09:07')
  assert.equal(expand('{{datetime}}', d), '2026-11-05 09:07:03')
})

test('expand: 允许占位符内空格', () => {
  const d = new Date(2026, 0, 2, 3, 4, 5)
  assert.equal(expand('{{ date }}', d), '2026-01-02')
})

test('expand: {{workspace}} 与 {{clipboard}} 原样保留', () => {
  const d = new Date(2026, 0, 1)
  assert.equal(expand('{{workspace}}', d), '{{workspace}}')
  assert.equal(expand('{{clipboard}}', d), '{{clipboard}}')
})

test('expand: 未知占位符原样保留，不报错', () => {
  const d = new Date(2026, 0, 1)
  assert.equal(expand('{{foo}} {{bar_1}}', d), '{{foo}} {{bar_1}}')
})

test('expand: 同一文本多处出现各自展开', () => {
  const d = new Date(2026, 5, 15, 12, 0, 0)
  assert.equal(expand('{{date}} → {{date}}', d), '2026-06-15 → 2026-06-15')
})

test('expand: 空/非字符串安全', () => {
  assert.equal(expand(''), '')
  assert.equal(expand(null), '')
  assert.equal(expand(undefined), '')
})

test('expand: 不含占位符时原文返回', () => {
  assert.equal(expand('纯中文文本', new Date()), '纯中文文本')
})

// ---- store: phrases ----

test('readPhrases: 文件不存在返回空表', async () => {
  const dir = tmpDir()
  const doc = await readPhrases(path.join(dir, 'phrases.json'))
  assert.equal(doc.schemaVersion, SCHEMA_VERSION)
  assert.deepEqual(doc.phrases, [])
})

test('writePhrases + readPhrases 往返一致', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'phrases.json')
  const now = new Date().toISOString()
  const input = [
    { id: 'dsh-a', title: '标题A', text: '正文A {{date}}', category: '开发', createdAt: now, updatedAt: now },
  ]
  await writePhrases(file, input)
  const doc = await readPhrases(file)
  assert.equal(doc.phrases.length, 1)
  assert.deepEqual(doc.phrases[0], input[0])
})

test('readPhrases: 中文与换行无损', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'phrases.json')
  const now = new Date().toISOString()
  const text = '第一行\n第二行 "带引号" 与 \'单引号\''
  await writePhrases(file, [{ id: 'x', title: '中文', text, category: '', createdAt: now, updatedAt: now }])
  const doc = await readPhrases(file)
  assert.equal(doc.phrases[0].text, text)
  assert.equal(doc.phrases[0].title, '中文')
})

test('readPhrases: 损坏文件被隔离为 .bad 并空表启动', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'phrases.json')
  fs.writeFileSync(file, '{ this is not json', 'utf8')
  const doc = await readPhrases(file)
  assert.deepEqual(doc.phrases, [])
  const badFiles = fs.readdirSync(dir).filter((f) => f.indexOf('.bad-') >= 0)
  assert.equal(badFiles.length, 1, '应留下一个 .bad 证据文件')
  assert.equal(fs.existsSync(file), false, '原文件应被移走')
})

test('readPhrases: schemaVersion 高于支持版本时抛错，不静默降级', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'phrases.json')
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 99, phrases: [] }), 'utf8')
  await assert.rejects(() => readPhrases(file), /schemaVersion=99/)
})

test('readPhrases: 缺 schemaVersion 抛错', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'phrases.json')
  fs.writeFileSync(file, JSON.stringify({ phrases: [] }), 'utf8')
  await assert.rejects(() => readPhrases(file), /schemaVersion/)
})

test('readPhrases: 重复 id 只保留第一条', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'phrases.json')
  const now = new Date().toISOString()
  fs.writeFileSync(
    file,
    JSON.stringify({
      schemaVersion: 1,
      phrases: [
        { id: 'dup', title: 'A', text: 'a', createdAt: now, updatedAt: now },
        { id: 'dup', title: 'B', text: 'b', createdAt: now, updatedAt: now },
      ],
    }),
    'utf8',
  )
  const doc = await readPhrases(file)
  assert.equal(doc.phrases.length, 1)
  assert.equal(doc.phrases[0].title, 'A')
})

test('readPhrases: 丢掉未知字段，补齐缺失的 title/category', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'phrases.json')
  fs.writeFileSync(
    file,
    JSON.stringify({
      schemaVersion: 1,
      phrases: [{ id: 'k', text: '只有正文', junk: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    }),
    'utf8',
  )
  const doc = await readPhrases(file)
  assert.equal(doc.phrases[0].title, '')
  assert.equal(doc.phrases[0].category, '')
  assert.equal('junk' in doc.phrases[0], false)
})

test('readPhrases: BOM 开头可正常解析', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'phrases.json')
  const now = new Date().toISOString()
  fs.writeFileSync(
    file,
    '\ufeff' + JSON.stringify({ schemaVersion: 1, phrases: [{ id: 'b', text: 't', createdAt: now, updatedAt: now }] }),
    'utf8',
  )
  const doc = await readPhrases(file)
  assert.equal(doc.phrases.length, 1)
})

test('atomicWrite: 不留下 .tmp 残留', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'out.json')
  await atomicWrite(file, '{"a":1}')
  const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))
  assert.deepEqual(leftovers, [])
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1 })
})

test('atomicWrite: 重复覆盖同一路径成功', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'out.json')
  await atomicWrite(file, '{"n":1}')
  await atomicWrite(file, '{"n":2}')
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { n: 2 })
})

// ---- store: view ----

test('readView: 缺失返回空对象', async () => {
  const dir = tmpDir()
  assert.deepEqual(await readView(path.join(dir, 'view.json')), {})
})

test('view 往返一致，非法字段被规范化', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'view.json')
  await writeView(file, { a: { pinned: true, order: 3 } })
  const v = await readView(file)
  assert.deepEqual(v, { a: { pinned: true, order: 3 } })

  fs.writeFileSync(file, JSON.stringify({ b: { pinned: 'yes', order: 'x' } }), 'utf8')
  assert.deepEqual(await readView(file), { b: { pinned: false, order: 0 } })
})

test('readView: 损坏视图文件降级为空对象（不影响内容）', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'view.json')
  fs.writeFileSync(file, 'not json', 'utf8')
  assert.deepEqual(await readView(file), {})
})

// ---- mergeForDisplay ----

test('mergeForDisplay: 置顶优先，其次分类，再 order', () => {
  const n = new Date().toISOString()
  const phrases = [
    { id: '1', title: '常规-开发', text: 'x', category: '开发', createdAt: n, updatedAt: n },
    { id: '2', title: '置顶', text: 'x', category: '写作', createdAt: n, updatedAt: n },
    { id: '3', title: '常规-写作', text: 'x', category: '写作', createdAt: n, updatedAt: n },
  ]
  const view = { '2': { pinned: true, order: 5 } }
  const rows = mergeForDisplay(phrases, view)
  // 置顶在前；其余按分类名排序（"写作" < "开发" 的码点序）。
  assert.deepEqual(rows.map((r) => r.id), ['2', '3', '1'])
})

test('mergeForDisplay: 同段内按 order 升序', () => {
  const n = new Date().toISOString()
  const phrases = [
    { id: 'a', title: 'A', text: '', category: 'C', createdAt: n, updatedAt: n },
    { id: 'b', title: 'B', text: '', category: 'C', createdAt: n, updatedAt: n },
  ]
  const rows = mergeForDisplay(phrases, { a: { pinned: false, order: 9 }, b: { pinned: false, order: 1 } })
  assert.deepEqual(rows.map((r) => r.id), ['b', 'a'])
})

test('mergeForDisplay: 未分类排在同段末尾', () => {
  const n = new Date().toISOString()
  const phrases = [
    { id: 'none', title: 'N', text: '', category: '', createdAt: n, updatedAt: n },
    { id: 'cat', title: 'C', text: '', category: '开发', createdAt: n, updatedAt: n },
  ]
  const rows = mergeForDisplay(phrases, {})
  assert.deepEqual(rows.map((r) => r.id), ['cat', 'none'])
})

test('mergeForDisplay: 视图缺失时补默认值不报错', () => {
  const n = new Date().toISOString()
  const rows = mergeForDisplay([{ id: 'x', title: 'X', text: '', category: '', createdAt: n, updatedAt: n }], {})
  assert.equal(rows[0].pinned, false)
  assert.equal(rows[0].order, 0)
})
