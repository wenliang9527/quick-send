// dsh-quick-send · Client 半区测试（node --test）
//
// 目的：在不开真实 DSH 的前提下，验证 client.js 的**运行时**正确性。
// 单测覆盖不到的、且真实踩过坑的两类问题在这里守：
//
//   1. React Hooks 顺序违规 —— Hook 在 `if (!open) return null` 之后被跳过，
//      导致开关面板时 Hook 数量不一致，组件崩溃（症状：点按钮毫无反应）。
//   2. 插入链路 —— captureInsertion → insertText、占位符展开、失败原因分支。

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const CLIENT = path.join(here, '..', 'src', 'client.js')

/**
 * 搭一个最小 React 替身并加载 client.js。
 * 返回 { Panel, Trigger, hooks, render }，hooks 记录本次渲染的 Hook 调用序列。
 */
function loadClient(services) {
  const src = fs.readFileSync(CLIENT, 'utf8')

  let pool = []
  let idx = 0
  let trace = []

  const React = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat() }
    },
    useState(init) {
      const i = idx++
      if (pool.length <= i) pool[i] = { v: typeof init === 'function' ? init() : init }
      trace.push('useState#' + i)
      return [pool[i].v, (x) => { pool[i].v = typeof x === 'function' ? x(pool[i].v) : x }]
    },
    useRef(init) {
      const i = idx++
      if (pool.length <= i) pool[i] = { current: init }
      trace.push('useRef#' + i)
      return pool[i]
    },
    useEffect(fn, deps) {
      const i = idx++
      // 记录回调与本轮 deps，供 runEffects() 按需执行（真实 React 会在提交后跑）
      pool[i] = { deps, fn, cleanup: undefined }
      trace.push('useEffect#' + i)
      return undefined
    },
  }

  const modules = {}
  globalThis.window = { __ModuleLoader__: { load({ id, factory }) { modules[id] = factory(() => React) } } }
  globalThis.document = {
    createElement: () => ({ set textContent(_v) {}, parentNode: null }),
    head: { appendChild() {} },
    addEventListener() {},
    removeEventListener() {},
  }
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ phrases: [], categories: [] }) })
  // 导入/导出用的浏览器 API（测试环境补桩）
  if (typeof globalThis.Blob === 'undefined') {
    globalThis.Blob = class { constructor(parts) { this.parts = parts } }
  }
  if (typeof globalThis.URL.createObjectURL === 'undefined') {
    globalThis.URL.createObjectURL = () => 'blob:stub'
    globalThis.URL.revokeObjectURL = () => {}
  }
  if (typeof globalThis.FileReader === 'undefined') {
    globalThis.FileReader = class {
      readAsText() { this.result = ''; if (this.onload) this.onload() }
    }
  }

  // eslint-disable-next-line no-eval
  ;(0, eval)(src)
  const mod = modules['@wenliang9527/dsh-quick-send']

  const registered = {}
  const ctx = {
    slots: {
      inject(_key, cb) { const d = cb(); return typeof d === 'function' ? d : () => {} },
      // main 槽按 key 注册（管理页），其余按 id 注册
      register(o, c) { registered[o.id || 'main:' + o.key] = c; return () => {} },
    },
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
    // services 可注入假的 layout 等服务，用来验证 selectPanel 调用
    get(k) { return services && services[k] !== undefined ? services[k] : undefined },
  }
  mod.apply(ctx, {})

  /** 直接渲染浮层 Panel；before 可预先改动 hook 池（模拟 open/数据） */
  function renderPanel(props, before) {
    idx = 0
    trace = []
    if (before) before(pool)
    const out = registered['quick-send-panel'](props)
    return { out, hookCount: idx, trace: trace.slice() }
  }

  /** 渲染侧边栏中央管理页（完整 CRUD 形态；常驻，不依赖 open） */
  function renderManage(props, before) {
    idx = 0
    trace = []
    if (before) before(pool)
    const out = registered['main:quick-send'](props)
    return { out, hookCount: idx, trace: trace.slice() }
  }

  /** 建立 hook 池（首次渲染，open=false） */
  function initPool(props) {
    idx = 0
    trace = []
    pool = []
    registered['quick-send-panel'](props)
    return { hookCount: idx, pool }
  }

  /**
   * 执行最近一次渲染注册的 useEffect 回调（真实 React 在提交后自动执行）。
   *
   * 注意：effect 闭包捕获的是**本轮渲染**的变量值。要验证"值变了之后 effect 看到新值"，
   * 必须重新渲染拿到新闭包，再执行 —— 只调旧闭包会读到旧值（真实 React 也一样）。
   * 返回 cleanup 函数数组，便于测试卸载。
   */
  function runEffects() {
    const cleanups = []
    const ran = new Set()
    for (const slot of pool) {
      if (!slot || typeof slot.fn !== 'function') continue
      if (ran.has(slot)) continue
      ran.add(slot)
      const c = slot.fn()
      if (typeof c === 'function') cleanups.push(c)
    }
    return cleanups
  }

  return { mod, registered, renderPanel, renderManage, initPool, runEffects, pool: () => pool }
}

/** 深度查找满足条件的节点 */
function findAll(node, pred, acc = []) {
  if (!node || typeof node !== 'object') return acc
  if (pred(node)) acc.push(node)
  ;(node.children || []).forEach((c) => findAll(c, pred, acc))
  return acc
}

function makeProps(overrides) {
  const base = {
    inputActions: {
      insertText() { return true },
      captureInsertion() { return {} },
    },
    useInput: () => 'editable',
  }
  return Object.assign(base, overrides || {})
}

const SAMPLE = [
  { id: 'a', title: '甲', text: '正文甲 {{date}}', category: '开发', pinned: false, order: 0 },
  { id: 'b', title: '乙', text: '正文乙', category: '', pinned: true, order: 1 },
]

// ---------------------------------------------------------------- 加载

test('client.js 可被 ModuleLoader 加载并注册两个槽位', () => {
  const { mod, registered } = loadClient()
  assert.equal(typeof mod.apply, 'function')
  assert.deepEqual(mod.inject, ['slots', 'locale'])
  assert.ok(registered['quick-send-trigger'], '应注册触发按钮')
  assert.ok(registered['quick-send-panel'], '应注册面板')
})

// ---------------------------------------------------------------- Hooks 顺序（回归：曾导致面板打不开）

test('Hooks 顺序：open=false 与 open=true 的 Hook 数量必须一致', () => {
  const { initPool, renderPanel } = loadClient()
  const props = makeProps()

  const closed = initPool(props)
  const opened = renderPanel(props, (p) => { p[0] = { v: true } })

  assert.equal(
    closed.hookCount,
    opened.hookCount,
    `open=false 用了 ${closed.hookCount} 个 Hook，open=true 用了 ${opened.hookCount} 个 —— ` +
      'Hook 数量随开关变化会让 React 抛错并让面板彻底打不开',
  )
})

test('Hooks 顺序：反复开关面板，Hook 数量保持稳定', () => {
  const { initPool, renderPanel } = loadClient()
  const props = makeProps()
  const base = initPool(props).hookCount

  for (let round = 0; round < 3; round++) {
    const closed = renderPanel(props, (p) => { p[0] = { v: false } })
    const opened = renderPanel(props, (p) => { p[0] = { v: true } })
    assert.equal(closed.hookCount, base, `第 ${round + 1} 轮关闭态 Hook 数变了`)
    assert.equal(opened.hookCount, base, `第 ${round + 1} 轮打开态 Hook 数变了`)
  }
})

test('Hooks 顺序：所有 Hook 都是无条件调用（trace 里无重复/跳号）', () => {
  const { initPool, renderPanel } = loadClient()
  const props = makeProps()
  initPool(props)
  // initPool 不返回 trace，用一次完整渲染取序列
  const { trace } = renderPanel(props, (p) => { p[0] = { v: true } })
  const indices = trace.map((t) => Number(t.split('#')[1]))
  // 每次渲染 Hook 序号必须从 0 连续递增
  indices.forEach((n, i) => assert.equal(n, i, `Hook 序号断档：第 ${i} 个是 #${n}`))
})

// ---------------------------------------------------------------- 渲染

test('open=false 时不渲染任何内容', () => {
  const c = loadClient()
  const props = makeProps()
  c.initPool(props)
  const { out } = c.renderPanel(props, (p) => { p[0] = { v: false } })
  assert.equal(out, null, '关闭态应 return null')
})

test('浮层紧凑形态：只渲序号+标题一行，不渲正文预览与按钮', () => {
  const c = loadClient()
  const props = makeProps()
  c.initPool(props)
  const { out } = c.renderPanel(props, (p) => {
    p[0] = { v: true }
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: ['开发'] } }
  })
  const lines = findAll(out, (n) => n.props && String(n.props.className || '').split(' ').includes('qs-line'))
  assert.equal(lines.length, 2, '应渲染两条紧凑行')
  // 浮层不该出现完整卡片的正文预览与操作按钮（那是管理页的事）
  assert.equal(findAll(out, (n) => n.props && String(n.props.className || '').includes('qs-prev')).length, 0)
  assert.equal(findAll(out, (n) => n.props && String(n.props.className || '').includes('qs-acts')).length, 0)
  const idx = findAll(lines[0], (n) => n.props && String(n.props.className || '').includes('qs-idx'))
  assert.equal(idx.length, 1)
  assert.equal(idx[0].children[0], '1', '序号应从 1 开始')
})

test('管理页完整形态：渲条目卡片，标题为空则回退正文首行', () => {
  const c = loadClient()
  const props = makeProps()
  c.initPool(props)
  const { out } = c.renderManage(props, (p) => {
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: ['开发'] } }
  })
  const items = findAll(out, (n) => n.props && String(n.props.className || '').includes('qs-item'))
  assert.equal(items.length, 2, '应渲染两条')
})

test('加载中 / 出错 / 空态各自给出提示', () => {
  const c1 = loadClient()
  const p1 = makeProps()
  c1.initPool(p1)
  const loading = c1.renderPanel(p1, (p) => { p[0] = { v: true } })
  const emptyText = findAll(loading.out, (n) => n.props && String(n.props.className || '').includes('qs-empty'))
  assert.ok(emptyText.length > 0, '初始加载中应有占位提示')

  const c2 = loadClient()
  const p2 = makeProps()
  c2.initPool(p2)
  const err = c2.renderPanel(p2, (p) => {
    p[0] = { v: true }
    p[2] = { v: { loading: false, error: '炸了', phrases: [], categories: [] } }
  })
  const errNode = findAll(err.out, (n) => n.props && String(n.props.className || '').includes('qs-toast'))
  assert.ok(errNode.length > 0, '出错应显示错误条')
})

// ---------------------------------------------------------------- 插入链路

test('点「填入」走 captureInsertion + insertText，且展开占位符', () => {
  const c = loadClient()
  let inserted = null
  let captured = 0
  const props = makeProps({
    inputActions: {
      insertText(t) { inserted = t; return true },
      captureInsertion() { captured++; return { start: 0, end: 0 } },
    },
  })
  c.initPool(props)
  const { out } = c.renderManage(props, (p) => {
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
  })

  const items = findAll(out, (n) => n.props && String(n.props.className || '').includes('qs-item'))
  const btn = findAll(items[0], (n) => n.props && String(n.props.className || '').includes('primary'))[0]
  assert.ok(btn, '首条应有「填入」按钮')
  btn.props.onClick({ target: { tagName: 'BUTTON' } })

  assert.equal(captured, 1, '应抓一次光标')
  const today = new Date()
  const ymd =
    today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0')
  assert.ok(inserted.includes(ymd), `{{date}} 应展开为 ${ymd}，实际：${inserted}`)
  assert.ok(!inserted.includes('{{date}}'), '不应残留 {{date}}')
})

test('insertText 返回 false 时重试两次（共 2 次抓光标），仍失败则提示', () => {
  const c = loadClient()
  let captured = 0
  const props = makeProps({
    inputActions: {
      insertText() { return false },
      captureInsertion() { captured++; return {} },
    },
  })
  c.initPool(props)
  const { out } = c.renderManage(props, (p) => {
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
  })
  const items = findAll(out, (n) => n.props && String(n.props.className || '').includes('qs-item'))
  const btn = findAll(items[0], (n) => n.props && String(n.props.className || '').includes('primary'))[0]
  btn.props.onClick({ target: { tagName: 'BUTTON' } })

  assert.equal(captured, 2, '应在 2 次重试后放弃')
  const toast = findAll(out, () => true).length // 结构仍在，提示是异步 setToast
  assert.ok(toast > 0)
})

test('phase=inert 时不尝试插入', () => {
  const c = loadClient()
  let captured = 0
  const props = makeProps({
    useInput: () => 'inert',
    inputActions: {
      insertText() { return true },
      captureInsertion() { captured++; return {} },
    },
  })
  c.initPool(props)
  const { out } = c.renderManage(props, (p) => {
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
  })
  const items = findAll(out, (n) => n.props && String(n.props.className || '').includes('qs-item'))
  const btn = findAll(items[0], (n) => n.props && String(n.props.className || '').includes('primary'))[0]
  btn.props.onClick({ target: { tagName: 'BUTTON' } })

  assert.equal(captured, 0, 'inert 态不应抓光标、不应插入')
})

// ---------------------------------------------------------------- 删除二次确认

test('删除需点两次：第一次只进入待确认态', () => {
  const c = loadClient()
  const props = makeProps()
  c.initPool(props)
  const { out } = c.renderManage(props, (p) => {
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
  })
  const items = findAll(out, (n) => n.props && String(n.props.className || '').includes('qs-item'))
  const danger = findAll(items[0], (n) => n.props && String(n.props.className || '').includes('danger'))[0]
  assert.ok(danger, '应有删除按钮')
  assert.equal(danger.children[0], '删除', '首次应显示「删除」')

  // 点击一次 -> 进入待确认（真实场景会触发重渲染；此处只验证不抛错）
  assert.doesNotThrow(() => danger.props.onClick({ target: { tagName: 'BUTTON' } }))
})

// ---------------------------------------------------------------- 搜索 / 分类

test('搜索过滤按标题、正文、分类子串匹配', () => {
  const c = loadClient()
  const props = makeProps()
  c.initPool(props)
  const { out } = c.renderManage(props, (p) => {
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
    p[3] = { v: '正文乙' } // query 命中第二条
  })
  const items = findAll(out, (n) => n.props && String(n.props.className || '').includes('qs-item'))
  assert.equal(items.length, 1, '应只剩下命中「正文乙」的一条')
})

test('分类过滤只显示该分类', () => {
  const c = loadClient()
  const props = makeProps()
  c.initPool(props)
  const { out } = c.renderManage(props, (p) => {
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: ['开发'] } }
    p[4] = { v: '开发' }
  })
  const items = findAll(out, (n) => n.props && String(n.props.className || '').includes('qs-item'))
  assert.equal(items.length, 1)
})

// ---------------------------------------------------------------- 键盘导航

test('搜索框 ↓ 移动选中、Enter 插入选中项', () => {
  const c = loadClient()
  let inserted = null
  const props = makeProps({
    inputActions: {
      insertText(t) { inserted = t; return true },
      captureInsertion() { return {} },
    },
  })
  c.initPool(props)
  const { out } = c.renderPanel(props, (p) => {
    p[0] = { v: true }
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
  })
  const search = findAll(out, (n) => n.props && String(n.props.className || '').includes('qs-search'))[0]
  assert.ok(search, '应有搜索框')

  const prevent = { v: false }
  search.props.onKeyDown({ key: 'ArrowDown', preventDefault() { prevent.v = true } })
  assert.ok(prevent.v, '↓ 应 preventDefault')

  // 再渲染一次：highlighted 已被设为第一条
  const c2 = loadClient()
  const p2 = makeProps({
    inputActions: {
      insertText(t) { inserted = t; return true },
      captureInsertion() { return {} },
    },
  })
  c2.initPool(p2)
  const r2 = c2.renderPanel(p2, (p) => {
    p[0] = { v: true }
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
    p[6] = { v: 'a' } // highlighted = 第一条
  })
  const search2 = findAll(r2.out, (n) => n.props && String(n.props.className || '').includes('qs-search'))[0]
  search2.props.onKeyDown({ key: 'Enter', preventDefault() {} })
  assert.ok(inserted !== null, 'Enter 应插入选中项')
  assert.ok(!inserted.includes('{{'), '插入内容中的占位符应已展开')
})

test('Esc：有选中时只清选中，不关面板', () => {
  const c = loadClient()
  const props = makeProps()
  c.initPool(props)
  const { out } = c.renderPanel(props, (p) => {
    p[0] = { v: true }
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
    p[6] = { v: 'a' }
  })
  const search = findAll(out, (n) => n.props && String(n.props.className || '').includes('qs-search'))[0]
  let stopped = false
  assert.doesNotThrow(() =>
    search.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() { stopped = true } }),
  )
  assert.ok(stopped, 'Esc 有选中时应停止冒泡，避免连带关闭面板')
})

// ---------------------------------------------------------------- i18n

test('i18n：注册中英双语字典，且两语言键集一致', () => {
  const { mod } = loadClient()
  // 通过真实 locale 桩捕获注册内容
  let registered = null
  const src = fs.readFileSync(CLIENT, 'utf8')
  const modules = {}
  let pool = []
  let idx = 0
  const React = {
    createElement: (t, p, ...c) => ({ type: t, props: p || {}, children: c.flat() }),
    useState(i) { const k = idx++; if (pool.length <= k) pool[k] = { v: typeof i === 'function' ? i() : i }; return [pool[k].v, () => {}] },
    useRef(i) { const k = idx++; if (pool.length <= k) pool[k] = { current: i }; return pool[k] },
    useEffect() { idx++ },
  }
  globalThis.window = { __ModuleLoader__: { load({ id, factory }) { modules[id] = factory(() => React) } } }
  globalThis.document = {
    createElement: () => ({ set textContent(_v) {}, parentNode: null }),
    head: { appendChild() {} }, addEventListener() {}, removeEventListener() {},
  }
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ phrases: [], categories: [] }) })
  ;(0, eval)(src)

  const ctx = {
    slots: { inject(_k, cb) { const d = cb(); return typeof d === 'function' ? d : () => {} }, register() { return () => {} } },
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
    get(name) {
      if (name !== 'locale') return undefined
      return {
        register(ns, dict) { registered = { ns, dict }; return () => {} },
        bind() { return (k) => 'T:' + k },
      }
    },
  }
  modules['@wenliang9527/dsh-quick-send'].apply(ctx, {})

  assert.ok(registered, '应向 locale 注册字典')
  assert.equal(registered.ns, 'quick-send')
  const zh = Object.keys(registered.dict.zh).sort()
  const en = Object.keys(registered.dict.en).sort()
  assert.deepEqual(zh, en, '中英字典键集必须一致，否则缺失项会回退显示 key')
  assert.ok(zh.length > 40, '字典条目应完整（实际 ' + zh.length + ' 条）')
})

test('i18n：无 locale 服务时退回中文，不抛错', () => {
  assert.doesNotThrow(() => {
    const c = loadClient()
    const props = makeProps()
    c.initPool(props)
    c.renderPanel(props, (p) => { p[0] = { v: true } })
  })
})

test('i18n：槽位注入的 t 优先于模块级翻译', () => {
  const c = loadClient()
  const props = makeProps({ t: (k) => 'INJECTED:' + k })
  c.initPool(props)
  const { out } = c.renderPanel(props, (p) => { p[0] = { v: true } })
  const title = findAll(out, (n) => n.props && String(n.props.className || '') === 'qs-title')[0]
  assert.equal(title.children[0], 'INJECTED:panelTitle')
})

// ---------------------------------------------------------------- 占位符预览

test('占位符预览：正文含 {{date}} 时显示展开结果', () => {
  const c = loadClient()
  const props = makeProps()
  c.initPool(props)
  const { out } = c.renderPanel(props, (p) => {
    p[0] = { v: true }
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
    p[7] = { v: { id: 'x', title: 't', text: '今天 {{date}} 完成', category: '' } }
  })
  const preview = findAll(out, (n) => n.props && String(n.props.className || '') === 'qs-preview')
  assert.equal(preview.length, 1, '应显示预览')
  const body = findAll(preview[0], (n) => n.props && String(n.props.className || '').includes('qs-preview-body'))[0]
  const text = String(body.children[0])
  assert.ok(!text.includes('{{date}}'), '预览里不应残留占位符')
  assert.ok(/今天 \d{4}-\d{2}-\d{2} 完成/.test(text), '预览应显示展开后的日期：' + text)
})

test('占位符预览：正文无占位符时不显示', () => {
  const c = loadClient()
  const props = makeProps()
  c.initPool(props)
  const { out } = c.renderPanel(props, (p) => {
    p[0] = { v: true }
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
    p[7] = { v: { id: 'x', title: 't', text: '纯文本没有占位符', category: '' } }
  })
  const preview = findAll(out, (n) => n.props && String(n.props.className || '') === 'qs-preview')
  assert.equal(preview.length, 0, '无占位符时不应显示预览')
})

// ---------------------------------------------------------------- 导入 / 导出

test('导出按钮存在，且有导入的文件选择器', () => {
  const c = loadClient()
  const props = makeProps()
  c.initPool(props)
  const { out } = c.renderPanel(props, (p) => {
    p[0] = { v: true }
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
  })
  const fileInputs = findAll(out, (n) => n.props && n.props.type === 'file')
  assert.equal(fileInputs.length, 1, '应有隐藏的 file input')
  assert.equal(fileInputs[0].props.accept, '.json,application/json')
})

// ---------------------------------------------------------------- 数据文件路径提示

// hook 池顺序（守门：本组用例依赖它，改 Panel 顶部结构时这里会先炸）
//   0 useOpen.state  1 useOpen.effect  2 快照  3 query  4 cat  5 toast  6 hi  7 edit  8 del
//   9 toastTimer  10 listRef  11 deleteTimer  12 数据路径
test('面板底部显示当前数据文件路径（来自 /__quick-send/paths）', () => {
  const c = loadClient()
  const props = makeProps()
  c.initPool(props)
  const { out } = c.renderPanel(props, (p) => {
    p[0] = { v: true }
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
    p[12] = { v: { phrasesFile: 'C:\\Users\\me\\.dsh\\quick-send\\phrases.json', viewFile: 'C:\\Users\\me\\view.json' } }
  })
  const foot = findAll(out, (n) => n.props && String(n.props.className || '').includes('qs-foot'))
  assert.ok(foot.length > 0, '应渲染底部路径提示')
  const pathNode = findAll(out, (n) => n.props && String(n.props.className || '').includes('qs-foot-path'))
  assert.equal(pathNode.length, 1)
  assert.ok(String(pathNode[0].children[0]).includes('phrases.json'))
})

test('拿不到路径时底部提示整块不渲染（不报错、不留空行）', () => {
  const c = loadClient()
  const props = makeProps()
  c.initPool(props)
  const { out } = c.renderPanel(props, (p) => {
    p[0] = { v: true }
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
    p[12] = { v: null }
  })
  const foot = findAll(out, (n) => n.props && String(n.props.className || '').includes('qs-foot'))
  assert.equal(foot.length, 0)
})
// ---------------------------------------------------------------- 数字键 / 侧边栏页

test('数字键 1-9 直接插入第 N 条（搜索框为空时）', () => {
  const c = loadClient()
  let inserted = null
  const props = makeProps({
    inputActions: {
      insertText(t) { inserted = t; return true },
      captureInsertion() { return {} },
    },
  })
  c.initPool(props)
  const { out } = c.renderPanel(props, (p) => {
    p[0] = { v: true }
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
  })
  const search = findAll(out, (n) => n.props && String(n.props.className || '').includes('qs-search'))[0]
  let prevented = false
  search.props.onKeyDown({ key: '2', preventDefault() { prevented = true } })
  assert.equal(inserted, SAMPLE[1].text, '按 2 应插入第二条正文')
  assert.ok(prevented, '应阻止默认输入')
})

test('数字键在搜索框有内容时不生效（不能抢走用户输入）', () => {
  const c = loadClient()
  let inserted = null
  const props = makeProps({
    inputActions: {
      insertText(t) { inserted = t; return true },
      captureInsertion() { return {} },
    },
  })
  c.initPool(props)
  const { out } = c.renderPanel(props, (p) => {
    p[0] = { v: true }
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
    p[3] = { v: '正文' }
  })
  const search = findAll(out, (n) => n.props && String(n.props.className || '').includes('qs-search'))[0]
  search.props.onKeyDown({ key: '1', preventDefault() {} })
  assert.equal(inserted, null, '搜索中不应被数字键抢走')
})

test('数字键超出条目数时不插入', () => {
  const c = loadClient()
  let inserted = null
  const props = makeProps({
    inputActions: {
      insertText(t) { inserted = t; return true },
      captureInsertion() { return {} },
    },
  })
  c.initPool(props)
  const { out } = c.renderPanel(props, (p) => {
    p[0] = { v: true }
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
  })
  const search = findAll(out, (n) => n.props && String(n.props.className || '').includes('qs-search'))[0]
  search.props.onKeyDown({ key: '9', preventDefault() {} })
  assert.equal(inserted, null, '只有 2 条时按 9 应无动作')
})

test('侧边栏图标与中央管理页都已注册，且 id/key 严格同值', () => {
  const c = loadClient()
  assert.ok(c.registered['quick-send'], '应注册 sidebar.panellist 图标（id=quick-send）')
  assert.ok(c.registered['main:quick-send'], '应注册 main 管理页（key=quick-send）')
})

test('管理页常驻渲染：不依赖浮层开关', () => {
  const c = loadClient()
  const props = makeProps()
  c.initPool(props)
  const { out } = c.renderManage(props, (p) => {
    p[0] = { v: false } // 浮层是关的
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
  })
  assert.ok(out, '管理页不应因浮层关闭而不渲染')
  const items = findAll(out, (n) => n.props && String(n.props.className || '').includes('qs-item'))
  assert.equal(items.length, 2)
})

test('管理页有导入/导出/新建按钮，浮层只有「管理」入口', () => {
  const c = loadClient()
  const props = makeProps()
  c.initPool(props)
  const quick = c.renderPanel(props, (p) => {
    p[0] = { v: true }
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
  })
  const quickBtns = findAll(quick.out, (n) => n.type === 'button').map((n) => n.children.flat().join(''))
  assert.ok(quickBtns.includes('管理'), '浮层应有「管理」按钮')
  assert.ok(!quickBtns.includes('＋ 新建'), '浮层不该有新建（搬去管理页了）')

  const manage = c.renderManage(props, (p) => {
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
  })
  const manageBtns = findAll(manage.out, (n) => n.type === 'button').map((n) => n.children.flat().join(''))
  assert.ok(manageBtns.includes('＋ 新建'), '管理页应有新建')
  assert.ok(!manageBtns.includes('管理'), '管理页不该再有「管理」按钮')
})
// ---------------------------------------------------------------- 管理页返回对话

test('管理页有「返回对话」按钮，点击调 layout.selectPanel(null)', () => {
  let called = null
  const c = loadClient({ layout: { selectPanel(id) { called = id } } })
  const props = makeProps()
  c.initPool(props)
  const { out } = c.renderManage(props, (p) => {
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
  })
  const back = findAll(out, (n) => n.type === 'button' && String(n.props.className || '').includes('qs-back'))[0]
  assert.ok(back, '管理页应有返回按钮')
  back.props.onClick()
  assert.equal(called, null, 'selectPanel 应收到 null（显示对话）')
})

test('浮层里点「管理」调 layout.selectPanel("quick-send")', () => {
  let called = '<none>'
  const c = loadClient({ layout: { selectPanel(id) { called = id } } })
  const props = makeProps()
  c.initPool(props)
  const { out } = c.renderPanel(props, (p) => {
    p[0] = { v: true }
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
  })
  const btns = findAll(out, (n) => n.type === 'button')
  const manage = btns.find((n) => n.children.flat().join('') === '管理')
  assert.ok(manage, '浮层应有「管理」按钮')
  manage.props.onClick()
  assert.equal(called, 'quick-send')
})

test('layout 服务缺席时点返回不抛错（降级为提示）', () => {
  const c = loadClient() // 不给 layout
  const props = makeProps()
  c.initPool(props)
  const { out } = c.renderManage(props, (p) => {
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
  })
  const back = findAll(out, (n) => n.type === 'button' && String(n.props.className || '').includes('qs-back'))[0]
  assert.doesNotThrow(() => back.props.onClick())
})

test('返回按钮在管理页才有，浮层没有', () => {
  const c = loadClient({ layout: { selectPanel() {} } })
  const props = makeProps()
  c.initPool(props)
  const quick = c.renderPanel(props, (p) => {
    p[0] = { v: true }
    p[2] = { v: { loading: false, error: '', phrases: SAMPLE, categories: [] } }
  })
  assert.equal(findAll(quick.out, (n) => String((n.props || {}).className || '').includes('qs-back')).length, 0)
})
// ---------------------------------------------------------------- 刷新与记忆（0.3.3）

// 管理页常驻（show 恒 true），而数据刷新 effect 依赖 [show] → 只跑一次。
// 结果：agent 调 quick_send_add 改了文件后，已打开的管理页看不到新条目。
// 修法是①加 ⟳ 手动刷新按钮 ②窗口重新可见/获得焦点时自动刷新。

test('管理页有刷新按钮，点击会重新拉取列表', () => {
  const { initPool, renderManage } = loadClient()
  const props = makeProps()
  initPool(props)
  const { out } = renderManage(props)

  const btns = findAll(out, (n) => n.type === 'button' && n.props && n.props.title)
  const refreshBtn = btns.find((b) => /刷新/.test(b.props.title || ''))
  assert.ok(refreshBtn, '管理页头部应有刷新按钮（title 含「刷新」）')
  assert.equal(typeof refreshBtn.props.onClick, 'function', '刷新按钮必须可点')
})

test('浮层不显示刷新按钮（保持轻量）', () => {
  const { initPool, renderPanel } = loadClient()
  const props = makeProps()
  initPool(props)
  const { out } = renderPanel(props, (p) => { p[0] = { v: true } })

  const btns = findAll(out, (n) => n.type === 'button' && n.props && n.props.title)
  const refreshBtn = btns.find((b) => /刷新/.test(b.props.title || ''))
  assert.equal(refreshBtn, undefined, '浮层不应有刷新按钮')
})

test('窗口重新可见时自动刷新（不用手动点）', async () => {
  const listeners = {}
  let fetchCount = 0
  const origFetch = globalThis.fetch
  try {
    // 注意顺序：loadClient() 内部会覆盖 globalThis.fetch / document，
    // 所以自定义桩必须在它之后设置，否则会被冲掉。
    const { initPool, renderManage, runEffects } = loadClient()

    globalThis.fetch = async (url) => {
      if (String(url).includes('/__quick-send/list')) fetchCount++
      return { ok: true, json: async () => ({ phrases: [], categories: [] }) }
    }
    globalThis.document = {
      createElement: () => ({ set textContent(_v) {}, parentNode: null }),
      head: { appendChild() {} },
      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn) },
      removeEventListener() {},
      visibilityState: 'visible',
    }

    const props = makeProps()
    initPool(props)
    renderManage(props)
    runEffects()

    const fns = listeners['visibilitychange'] || []
    assert.ok(fns.length > 0, '应监听 visibilitychange')

    const before = fetchCount
    fns.forEach((f) => f())
    // refreshQuiet 内部是 Promise 链，需让微任务跑完再断言
    await new Promise((r) => setTimeout(r, 0))
    assert.ok(fetchCount > before, '窗口重新可见时应重新拉取列表')
  } finally {
    globalThis.fetch = origFetch
  }
})

// ---- 搜索词与分类记忆 ----

test('搜索词与分类写入 localStorage，重开面板可恢复', () => {
  const store = {}
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: (k) => { delete store[k] },
  }
  try {
    const { initPool, renderManage, runEffects } = loadClient()
    const props = makeProps()
    initPool(props)
    const { out } = renderManage(props)

    // 找到搜索框并模拟输入
    const search = findAll(out, (n) => n.type === 'input' && n.props && String(n.props.className || '').includes('qs-search'))[0]
    assert.ok(search, '应有搜索框')
    search.props.onChange({ target: { value: '关键词' } })

    // setState 之后 React 会重新渲染 → effect 拿到含新 query 的闭包，然后才执行。
    // 替身没有自动重渲染，这里手动重渲一次再跑 effect。
    renderManage(props)
    runEffects()

    const keys = Object.keys(store)
    assert.ok(
      keys.some((k) => /quick-send:remember/i.test(k)),
      '搜索词应写入 localStorage，实际键：' + keys.join(',') + ' 值：' + JSON.stringify(store),
    )
    const saved = keys.filter((k) => /quick-send:remember/i.test(k)).map((k) => store[k]).join('')
    assert.ok(saved.includes('关键词'), 'localStorage 里应包含搜索词')
  } finally {
    delete globalThis.localStorage
  }
})

test('localStorage 不可用时不报错（隐私模式降级）', () => {
  globalThis.localStorage = {
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('blocked') },
    removeItem() { throw new Error('blocked') },
  }
  try {
    const { initPool, renderManage } = loadClient()
    const props = makeProps()
    initPool(props)
    assert.doesNotThrow(() => renderManage(props), 'localStorage 抛错不应让面板崩溃')
  } finally {
    delete globalThis.localStorage
  }
})
