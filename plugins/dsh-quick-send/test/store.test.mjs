// dsh-quick-send 单元测试（node --test）
// 覆盖：占位符展开 / 存储原子写 / 损坏自愈 / schemaVersion 守卫 / 视图合并排序
// 只测纯逻辑，不启动 DSH。

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { expand, formatDate, formatTime, formatDateTime, hasSupportedPlaceholder } from '../src/expand.js'
import {
  readPhrases,
  writePhrases,
  readView,
  writeView,
  mergeForDisplay,
  atomicWrite,
  mutatePhrases,
  defaultPhrasesFile,
  defaultViewFile,
  SCHEMA_VERSION,
} from '../src/store.js'

/**
 * 建临时目录，并登记进 createdDirs —— 测试结束时由 after() 统一清理。
 *
 * 为什么要登记：早期版本只 mkdtemp 不删除，跑一次测试就在系统 TEMP 里
 * 留下十几个目录。实测累积到 1512 个（11/4~11/5 一天多），属于测试自身
 * 的资源泄漏 —— 不是产品 bug，但同样要修，否则长跑 CI 会一直啃磁盘。
 */
const createdDirs = []
function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-test-'))
  createdDirs.push(dir)
  return dir
}

after(() => {
  for (const dir of createdDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch (e) {
      /* 清理失败不致命 */
    }
  }
})

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

// ---- 默认数据路径（0.2.2 回归守门）------------------------------------------
// 背景：0.1.0/0.2.x 曾把作者机器上的 D:\WORK_VSCODE\... 写成默认值，
// 陌生人安装后会在自己的 D 盘凭空建目录。这里锁死「默认值必须跟着用户目录」。

test('defaultPhrasesFile: 默认落在 ~/.dsh/quick-send/ 下，不依赖任何盘符', () => {
  const prev = process.env.DSH_QUICK_SEND_PHRASES_FILE
  delete process.env.DSH_QUICK_SEND_PHRASES_FILE
  try {
    const p = defaultPhrasesFile()
    assert.equal(p, path.join(os.homedir(), '.dsh', 'quick-send', 'phrases.json'))
    assert.ok(!/WORK_VSCODE/i.test(p), '默认路径不得包含作者机器路径')
    assert.ok(p.startsWith(os.homedir()), '默认路径必须位于用户主目录下')
  } finally {
    if (prev !== undefined) process.env.DSH_QUICK_SEND_PHRASES_FILE = prev
  }
})

test('defaultViewFile: 默认落在 ~/.dsh/quick-send/view.json', () => {
  const prev = process.env.DSH_QUICK_SEND_VIEW_FILE
  delete process.env.DSH_QUICK_SEND_VIEW_FILE
  try {
    assert.equal(defaultViewFile(), path.join(os.homedir(), '.dsh', 'quick-send', 'view.json'))
  } finally {
    if (prev !== undefined) process.env.DSH_QUICK_SEND_VIEW_FILE = prev
  }
})

test('defaultPhrasesFile: 环境变量可覆盖（共享给其他客户端时用）', () => {
  const prev = process.env.DSH_QUICK_SEND_PHRASES_FILE
  process.env.DSH_QUICK_SEND_PHRASES_FILE = path.join(tmpDir(), 'shared.json')
  try {
    assert.equal(defaultPhrasesFile(), process.env.DSH_QUICK_SEND_PHRASES_FILE)
  } finally {
    if (prev === undefined) delete process.env.DSH_QUICK_SEND_PHRASES_FILE
    else process.env.DSH_QUICK_SEND_PHRASES_FILE = prev
  }
})
// ---- Client 与 Host 的占位符实现一致性 ----

// 占位符展开有两份实现：Host 的 src/expand.js（权威）和 client.js 里的
// expandText()（浏览器侧，无法 import 宿主模块，只能复制）。两份漂移过一次
// 就会让「浮层里看到的」和「实际插入的」不一致，所以用测试钉死语义。
//
// 做法：从 client.js 源码里抽出 expandText / hasSupportedPlaceholder 的函数体
// 现场编译，与 Host 版逐用例比对。

import { readFileSync } from 'node:fs'

function extractFn(src, name) {
  const start = src.indexOf('function ' + name)
  assert.notEqual(start, -1, '在 client.js 中找不到函数 ' + name)
  let depth = 0
  let i = src.indexOf('{', start)
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return src.slice(start, i + 1)
}

function loadClientExpand() {
  const src = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  const code = [extractFn(src, 'pad'), extractFn(src, 'expandText')].join('\n') + '\nreturn expandText;'
  return new Function(code)()
}

function loadClientHasPlaceholder() {
  const src = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  return new Function(extractFn(src, 'hasSupportedPlaceholder') + '\nreturn hasSupportedPlaceholder;')()
}

// 只比较「形状」，忽略真实时间差异（两边各自取 new Date()）
function shape(s) {
  return String(s)
    .replace(/\d{4}-\d{2}-\d{2}/g, '<D>')
    .replace(/\d{2}:\d{2}(:\d{2})?/g, '<T>')
}

const PLACEHOLDER_CASES = [
  '{{date}}',
  '{{time}}',
  '{{datetime}}',
  '{{ date }}',
  '{{datetime}} 与 {{date}} 与 {{time}}',
  '{{unknown}}',
  '{{workspace}}',
  '{{clipboard}}',
  '{{DATE}}',
  '{{Date}}',
  '{{date',
  '{{}}',
  '{{ }}',
  '{{a1_b2}}',
  '无占位符',
  '',
  '{{date}}\n{{time}}',
  '前{{date}}后',
  '{{ date}}{{time}}',
  '{{{date}}}',
]

test('expand 一致性：Client 与 Host 对全部用例展开结果相同', () => {
  const clientExpand = loadClientExpand()
  const hostNow = new Date(2026, 10, 5, 9, 7, 3)
  for (const input of PLACEHOLDER_CASES) {
    assert.equal(
      shape(clientExpand(input)),
      shape(expand(input, hostNow)),
      '占位符展开结果漂移，input=' + JSON.stringify(input),
    )
  }
})

test('hasSupportedPlaceholder 一致性：Client 与 Host 判定相同', () => {
  const clientHsp = loadClientHasPlaceholder()
  for (const input of PLACEHOLDER_CASES) {
    assert.equal(
      clientHsp(input),
      hasSupportedPlaceholder(input),
      '占位符判定漂移，input=' + JSON.stringify(input),
    )
  }
})

// ---------------------------------------------------------------- revision（跨进程乐观锁）

// CONTRACT §写入纪律 第 5 条：ZCode↔DSH 跨进程用 revision 做乐观锁。
//   - 共享文件顶层 revision: u64，写者持锁期间读 rev、写 rev+1
//   - 发现回退即重读重试
//   - schemaVersion 保持 1（加法演进，缺字段按 0）
//   - DSH 全量写必须同步保留该字段，否则字段被无声抹掉、机制失效
//
// 这组测试专门锁住"不被抹掉"：外部写的字段必须在 DSH 写完后仍然存在。

test('revision：DSH 写入后文件顶层带 revision，且自增', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'phrases.json')
  await writePhrases(file, [])
  const d1 = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(typeof d1.revision, 'number', '首次写入应带 revision 字段')

  const now = new Date().toISOString()
  await writePhrases(file, [{ id: 'a', title: 't', text: 'x', category: '', createdAt: now, updatedAt: now }])
  const d2 = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.ok(d2.revision > d1.revision, 'revision 必须自增')
})

test('revision：外部写入的 revision 不会被 DSH 抹掉（加法演进）', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'phrases.json')
  // 模拟 ZCode 写了一个较高的 revision
  fs.writeFileSync(
    file,
    JSON.stringify({
      schemaVersion: 1,
      revision: 42,
      phrases: [{ id: 'z1', title: 'Z', text: 'z', category: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    }),
    'utf8',
  )

  const doc = await readPhrases(file)
  assert.equal(doc.revision, 42, 'readPhrases 必须读出 revision')
  assert.equal(doc.phrases.length, 1, '条目不能被丢')

  // DSH 再写一次
  const now = new Date().toISOString()
  await writePhrases(file, doc.phrases.concat([{ id: 'a', title: 'A', text: 'a', category: '', createdAt: now, updatedAt: now }]))

  const after = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(typeof after.revision, 'number', 'revision 字段必须仍在')
  assert.ok(after.revision > 42, `revision 必须大于外部写入的 42，实际 ${after.revision}`)
  assert.equal(after.phrases.length, 2, '两边的条目都要在')
})

test('revision：缺失时按 0 处理（老文件兼容）', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'phrases.json')
  fs.writeFileSync(
    file,
    JSON.stringify({ schemaVersion: 1, phrases: [] }),
    'utf8',
  )
  const doc = await readPhrases(file)
  assert.equal(doc.revision, 0, '旧文件没有 revision 时按 0')

  const now = new Date().toISOString()
  await writePhrases(file, [{ id: 'x', title: 't', text: 'x', category: '', createdAt: now, updatedAt: now }])
  const after = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.ok(after.revision >= 1, '写入后 revision 至少为 1')
})

test('revision：非法/负数被视为 0，不崩溃', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'phrases.json')
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, revision: -5, phrases: [] }), 'utf8')
  const doc = await readPhrases(file)
  assert.equal(doc.revision, 0, '负数应归一化为 0')

  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, revision: 'abc', phrases: [] }), 'utf8')
  const doc2 = await readPhrases(file)
  assert.equal(doc2.revision, 0, '非数字应归一化为 0')
})

test('revision：DSH 写不会被外部的旧 revision 覆盖（回退检测）', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'phrases.json')
  const now = new Date().toISOString()
  await writePhrases(file, [{ id: 'a', title: 't', text: 'x', category: '', createdAt: now, updatedAt: now }])
  const revAfterFirst = JSON.parse(fs.readFileSync(file, 'utf8')).revision

  // 模拟另一进程在我们读取之后把 revision 推高了（并发写）、并加了一条
  const cur = JSON.parse(fs.readFileSync(file, 'utf8'))
  cur.revision = revAfterFirst + 100
  cur.phrases.push({ id: 'other', title: 'O', text: 'o', category: '', createdAt: now, updatedAt: now })
  fs.writeFileSync(file, JSON.stringify(cur), 'utf8')

  // DSH 继续写：不能把 revision 退回、也不能丢 other 的条目
  const doc = await readPhrases(file)
  assert.equal(doc.revision, revAfterFirst + 100, '必须读到外部推高的 revision')
  await writePhrases(file, doc.phrases)
  const after = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.ok(after.revision > revAfterFirst + 100, 'DSH 写入后在外部 revision 基础上继续自增，绝不回退')
  assert.equal(after.phrases.length, 2, '外部新增的条目不能丢')
})

// ---------------------------------------------------------------- 跨进程锁

// 教训（实测）：只靠 revision CAS **不能**防丢数据。
// 4 进程 × 8 次并发写，仅用 revision 仍稳定丢 1 条（31/32）——
// 因为 check 与 write 之间存在窗口，两个写者能同时通过校验再先后覆盖。
// 必须用 create_new 独占锁把「读-改-写」整体串起来。
//
// 以下锁的是「锁机制本身」的正确性，跨进程行为另由 _stab 演练验证。

// 锁位置契约：必须锚在 phrases.json **所在目录**，不能是本侧任意固定目录。
// 跨侧互斥全靠这个锚点与对侧对齐——ZCode ≥0.5.7 用 phrases_path().parent()，
// 本侧用 dirname(phrasesFile)，两者必须指向同一个 quick-send.lock。
// 这条一旦回归（比如又把锁挪回 ~/.dsh/quick-send/），跨侧互斥就无声失效。
test('锁位置：锁文件锚在 phrases.json 同目录（含深层子目录）', async () => {
  const dir = tmpDir()
  const deep = path.join(dir, 'a', 'b', 'c')
  const file = path.join(deep, 'phrases.json')
  const expectedLock = path.join(deep, 'quick-send.lock')
  const now = new Date().toISOString()
  await writePhrases(file, [], undefined)

  // 手动占住 deep 目录下的锁 → 写入必须等待，证明锁就取在这里
  fs.mkdirSync(deep, { recursive: true })
  fs.writeFileSync(expectedLock, '', 'utf8')
  let done = false
  const p = mutatePhrases(file, (doc) => {
    doc.phrases.push({ id: 'a', title: 't', text: 'x', category: '', createdAt: now, updatedAt: now })
  }).then(() => { done = true })

  await new Promise((r) => setTimeout(r, 150))
  assert.equal(done, false, `锁应取在 ${expectedLock}；写提前完成说明锚点不对`)
  fs.rmSync(expectedLock, { force: true })
  await p
  assert.equal(done, true)
})

test('跨进程锁：创建后可释放，锁文件不留残留', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'phrases.json')
  const now = new Date().toISOString()
  await writePhrases(file, [{ id: 'a', title: 't', text: 'x', category: '', createdAt: now, updatedAt: now }])
  const lock = path.join(dir, 'quick-send.lock')
  assert.ok(!fs.existsSync(lock), '正常写完不应残留锁文件')
})

test('跨进程锁：锁文件被占用时，写入会等待而非覆盖', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'phrases.json')
  const now = new Date().toISOString()
  await writePhrases(file, [{ id: 'a', title: 't', text: 'x', category: '', createdAt: now, updatedAt: now }])
  const lock = path.join(dir, 'quick-send.lock')

  // 手动占锁（模拟另一进程持有），mtime 设为现在 → 不算过期
  fs.writeFileSync(lock, '', 'utf8')
  const t0 = Date.now()
  let done = false
  const p = mutatePhrases(file, (doc) => {
    doc.phrases.push({ id: 'b', title: 'b', text: 'b', category: '', createdAt: now, updatedAt: now })
  }).then(() => { done = true })

  // 150ms 后释放锁，写入应随即完成
  await new Promise((r) => setTimeout(r, 150))
  assert.equal(done, false, '锁被占用时不应立即写入')
  fs.rmSync(lock, { force: true })
  await p
  assert.equal(done, true, '释放锁后应完成写入')

  const doc = await readPhrases(file)
  assert.equal(doc.phrases.length, 2, '等待后写入的数据要完整')
  assert.ok(Date.now() - t0 >= 100, '确实等待过')
})

test('跨进程锁：过期锁（持有者崩溃残留）会被抢占', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'phrases.json')
  const now = new Date().toISOString()
  await writePhrases(file, [], undefined)
  const lock = path.join(dir, 'quick-send.lock')

  // 造一个「11 秒前」的残留锁（超过 LOCK_STALE_MS=10s）
  fs.writeFileSync(lock, '', 'utf8')
  const old = new Date(Date.now() - 11000)
  fs.utimesSync(lock, old, old)

  const t0 = Date.now()
  await mutatePhrases(file, (doc) => {
    doc.phrases.push({ id: 'x', title: 'x', text: 'x', category: '', createdAt: now, updatedAt: now })
  })
  const elapsed = Date.now() - t0
  assert.ok(elapsed < 2000, `过期锁应立即抢占，实际耗时 ${elapsed}ms`)
  const doc = await readPhrases(file)
  assert.equal(doc.phrases.length, 1)
})

test('跨进程锁：mutate 抛错时锁也会释放（finally 保证）', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'phrases.json')
  await writePhrases(file, [], undefined)
  const lock = path.join(dir, 'quick-send.lock')

  await assert.rejects(
    () => mutatePhrases(file, () => { throw new Error('boom') }),
    /boom/,
  )
  assert.ok(!fs.existsSync(lock), '异常路径必须释放锁，否则后续写入全卡死')

  // 后续写入应正常工作
  const now = new Date().toISOString()
  await mutatePhrases(file, (doc) => {
    doc.phrases.push({ id: 'ok', title: 'ok', text: 'ok', category: '', createdAt: now, updatedAt: now })
  })
  const doc = await readPhrases(file)
  assert.equal(doc.phrases.length, 1)
})

test('跨进程锁：mutate 被重试时 id 不能重新生成（保证幂等）', async () => {
  const dir = tmpDir()
  const file = path.join(dir, 'phrases.json')
  await writePhrases(file, [], undefined)

  // mutate 内部用固定 id（模拟 agent-tools 先算好 id 再写），
  // 重试不应产生第二条
  const now = new Date().toISOString()
  const fixedId = 'fixed-id-1'
  await mutatePhrases(file, (doc) => {
    if (!doc.phrases.some((p) => p.id === fixedId)) {
      doc.phrases.push({ id: fixedId, title: 't', text: 'x', category: '', createdAt: now, updatedAt: now })
    }
  })
  const doc = await readPhrases(file)
  assert.equal(doc.phrases.length, 1, '幂等 mutate 不会因重试产生重复条目')
})
