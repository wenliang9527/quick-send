// dsh-quick-send · 斜杠命令 /quick-send 测试（node --test）
//
// 守什么：斜杠命令是唯一一处「用户边打字边遍历」的入口，
// query 解析错了会表现为「敲了斜杠什么都没出现」或「菜单被常用语挤满」，
// 两者都只能靠真机才发现，所以在这里钉死。
//
// 不用 mock 内部函数，而是按 DSH 真实契约（InputTriggerSource）注册一个假
// inputTriggers 服务，然后从外面调 candidates/onPick —— 这样测到的是
// 宿主实际会看到的形状。

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const CLIENT = path.join(here, '..', 'src', 'client.js')

const PHRASES = [
  { id: 'p1', title: '新建笔记', text: '帮我新建一篇笔记', category: 'Obsidian', pinned: false, order: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'p2', title: '总结进展', text: '请总结当前进展', category: '', pinned: false, order: 1, createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
  { id: 'p3', title: '日期戳', text: '今天的日期是 {{date}}', category: '工具', pinned: false, order: 2, createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z' },
]

/**
 * 加载 client.js 并装一个假的 inputTriggers 服务。
 * @param opts.withService false 时故意不提供该服务，验证降级
 * @param opts.phrases 覆盖返回的数据
 */
function loadClient(opts) {
  const o = opts || {}
  const src = fs.readFileSync(CLIENT, 'utf8')

  let pool = []
  let idx = 0

  const React = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat() }
    },
    useState(init) {
      const i = idx++
      if (pool.length <= i) pool[i] = { v: typeof init === 'function' ? init() : init }
      return [pool[i].v, (x) => { pool[i].v = typeof x === 'function' ? x(pool[i].v) : x }]
    },
    useRef(init) {
      const i = idx++
      if (pool.length <= i) pool[i] = { current: init }
      return pool[i]
    },
    useEffect(fn, deps) {
      const i = idx++
      pool[i] = { deps, fn }
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

  const fetchCalls = []
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url))
    const rows = o.phrases !== undefined ? o.phrases : PHRASES
    if (String(url).indexOf('/__quick-send/list') >= 0) {
      return { ok: true, json: async () => ({ phrases: rows, categories: [] }) }
    }
    return { ok: true, json: async () => ({}) }
  }

  // eslint-disable-next-line no-eval
  ;(0, eval)(src)
  const mod = modules['@wenliang9527/dsh-quick-send']

  /** 记录 registerSource 收到的 source 对象 */
  const sources = []
  const registered = {}
  const services = {}
  if (o.withService !== false) {
    services.inputTriggers = {
      registerSource(s) {
        sources.push(s)
        return () => {}
      },
      sessionOf() { return {} },
    }
  }

  const ctx = {
    slots: {
      inject(_key, cb) { const d = cb(); return typeof d === 'function' ? d : () => {} },
      register(reg, c) { registered[reg.id || 'main:' + reg.key] = c; return () => {} },
    },
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
    get(k) { return services[k] },
    // rc.5 的 ctx 契约：未声明进 inject 的服务，ctx.<name> 访问直接抛错（不是返回 undefined）。
    // 用 Proxy 还原这个行为，否则测不出「探测必须包 try/catch」这条铁律。
    reflect: o.withReflect === false ? undefined : {
      get(name, strict) {
        if (o.reflectThrows) throw new Error('reflect boom')
        const v = services[name]
        // strict=true 只返回「已激活」的实现；桩里没提供就等于未提供
        return strict === false ? v : v === undefined ? undefined : v
      },
    },
  }

  // 未在 inject 里声明的服务，属性访问即抛错（rc.5 真实行为）。
  // 只对「未知的服务名」抛错：slots/effect/get/reflect 这些真属性正常透传，
  // 否则会把插件的正常调用也拦掉，测出来的失败是假的。
  const KNOWN = new Set(['slots', 'effect', 'get', 'reflect', 'locale', 'layout'])
  const ctxProxy = new Proxy(ctx, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (typeof prop === 'symbol') return undefined
      if (KNOWN.has(prop)) return undefined
      if (o.strictAccess === false) return undefined
      throw new Error(`cannot get property "${prop}" without inject`)
    },
  })

  const logs = []
  const origLog = console.log
  const errLogs = []
  const origErr = console.error
  console.log = (...a) => { logs.push(a.join(' ')) }
  console.error = (...a) => { errLogs.push(a.join(' ')) }
  let applyError = null
  try {
    mod.apply(ctxProxy, {})
  } catch (e) {
    applyError = e
  } finally {
    console.log = origLog
    console.error = origErr
  }

  return { mod, sources, registered, logs, errLogs, fetchCalls, applyError }
}

const SESSION = { sessionId: 's1' }

/** 调 candidates，默认无 signal */
async function cand(src, query) {
  return src.candidates(SESSION, { query, position: 'leading', signal: new AbortController().signal })
}

// ---------------------------------------------------------------- 注册

test('斜杠命令：宿主支持 inputTriggers 时会注册一个 "/" 源', () => {
  const { sources, logs } = loadClient()
  assert.equal(sources.length, 1, '应注册且只注册一个 source')
  const s = sources[0]
  assert.equal(s.trigger, '/')
  // 宿主把 source.name 直接当分组标题渲染（MenuView 的 t(group.source) 查不到就原样显示），
  // 所以这个名字是**显示名**，必须是「常用语」而不是插件包名 quick-send。
  assert.equal(s.name, '常用语', '分组标题应显示为「常用语」，不是包名。实际：' + s.name)
  assert.equal(typeof s.candidates, 'function')
  assert.equal(typeof s.onPick, 'function')
  assert.ok(logs.some((l) => l.indexOf('slash: /quick-send') >= 0), '启动日志应标明斜杠命令已启用，实际：' + logs.join(' | '))
})

test('斜杠命令：命令名与分组显示名分离（/qs 靠命令名解析，标题靠 name）', async () => {
  const { sources } = loadClient()
  const s = sources[0]
  assert.equal(s.name, '常用语')
  // 命令名仍是 quick-send / qs —— 显示名换成中文不能影响用户敲什么
  const byName = await cand(s, 'quick-send')
  const byAlias = await cand(s, 'qs')
  assert.equal(byName.length, PHRASES.length, '命令名仍须生效')
  assert.equal(byAlias.length, PHRASES.length, '别名仍须生效')
})

test('斜杠命令：宿主无 inputTriggers 时静默降级，不抛错也不注册', () => {
  const { sources, logs, applyError } = loadClient({ withService: false })
  assert.equal(applyError, null, '缺服务时 apply 必须照常完成')
  assert.equal(sources.length, 0, '没有服务时不应注册')
  // 拿不到服务时走「延迟重试」（见 probeInputTriggers 注释），首次返回 false
  // → 启动日志写 slash: off。关键是 apply 不能因此失败。
  assert.ok(
    logs.some((l) => l.indexOf('slash: off') >= 0),
    '启动日志应标明斜杠命令未启用，实际：' + logs.join(' | '),
  )
})

test('斜杠命令：注册被包在 ctx.effect 里（宿主卸载时能自动摘掉）', () => {
  const src = fs.readFileSync(CLIENT, 'utf8')
  const i = src.indexOf('function registerSlashSource')
  assert.ok(i > 0)
  const body = src.slice(i, i + 2600)
  assert.ok(body.indexOf('ctx.effect') >= 0, 'registerSource 必须包在 ctx.effect 内')
})

// ------------------------------------------------- rc.5 契约：未 inject 的服务属性访问即抛错
//
// 这是 0.4.0 首次上线时**真的把 web boot 炸掉**的那条：
// rc.5 的 cordis 里 `ctx.inputTriggers` 不是返回 undefined，而是直接 throw
// （cannot get property "x" without inject）。探测代码漏了一个 try/catch，
// apply 就整体失败 → entry failed → 界面回到出厂状态。

test('rc.5：未 inject 的服务属性访问会抛错时，apply 仍然成功', () => {
  // strictAccess 默认 true —— ctx.inputTriggers 会抛
  const { applyError, sources } = loadClient()
  assert.equal(applyError, null, 'apply 绝不能因为探测服务而抛错，实际：' + (applyError && applyError.message))
  assert.equal(sources.length, 1, '有 reflect.get 时应正常注册')
})

test('rc.5：ctx.get 抛错也不影响 apply（两道探测都容错）', () => {
  const { applyError, sources } = loadClient()
  assert.equal(applyError, null)
  assert.equal(sources.length, 1)
})

test('rc.5：reflect.get 抛错时退回 ctx.get，仍能注册', () => {
  const { applyError, sources } = loadClient({ reflectThrows: true })
  assert.equal(applyError, null, 'reflect 抛错不该让 apply 失败')
  assert.equal(sources.length, 1, '应退回 ctx.get 成功取到服务')
})

test('rc.5：宿主真没有 inputTriggers 服务时 apply 仍成功且不注册', () => {
  const { applyError, sources, logs } = loadClient({ withService: false })
  assert.equal(applyError, null, '缺服务时 apply 必须照常完成，浮层和管理页不能受影响')
  assert.equal(sources.length, 0)
  assert.ok(logs.some((l) => l.indexOf('slash: off') >= 0), '启动日志应标明未启用，实际：' + logs.join(' | '))
})

test('rc.5：registerSource 抛 already registered 时降级，不冒泡', () => {
  // 复刻「profile 里残留第二份链接 → 插件被激活两次」的场景
  const src = fs.readFileSync(CLIENT, 'utf8')
  const i = src.indexOf('function registerSlashSource')
  const body = src.slice(i, i + 4000)
  assert.ok(body.indexOf('already registered') >= 0, '必须对重复注册做容错')
  assert.ok(
    /catch\s*\(e\)\s*\{[\s\S]{0,500}already registered/.test(body),
    '重复注册要在 try/catch 内识别并降级为「已注册」',
  )
})

test('斜杠命令：语言切换后按新标题重新注册（英文界面显示 Quick phrases）', () => {
  // 直接构造一个可切换语言的 ctx：locale.subscribe 的回调被调用后，
  // 若实现真的重新注册，sources 里会出现第二个 source 且 name 变成英文。
  const src = fs.readFileSync(CLIENT, 'utf8')
  let pool = []
  let idx = 0
  const React = {
    createElement: (t, p, ...c) => ({ type: t, props: p || {}, children: c.flat() }),
    useState: (i) => { const k = idx++; if (pool.length <= k) pool[k] = { v: typeof i === 'function' ? i() : i }; return [pool[k].v, () => {}] },
    useRef: (i) => { const k = idx++; if (pool.length <= k) pool[k] = { current: i }; return pool[k] },
    useEffect: (fn, deps) => { const k = idx++; pool[k] = { fn, deps } },
  }
  const modules = {}
  globalThis.window = { __ModuleLoader__: { load({ id, factory }) { modules[id] = factory(() => React) } } }
  globalThis.document = { createElement: () => ({ set textContent(_v) {}, parentNode: null }), head: { appendChild() {} }, addEventListener() {}, removeEventListener() {} }
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ phrases: [], categories: [] }) })

  let lang = 'zh'
  const DICT = {}
  const listeners = []
  const svc = {
    registerSource(s) { live.push(s); return () => { const k = live.indexOf(s); if (k >= 0) live.splice(k, 1) } },
    sessionOf: () => ({}),
  }
  const live = []
  const locale = {
    register(ns, dicts) { DICT[ns] = dicts; return () => {} },
    bind(ns) {
      return (key) => {
        const d = DICT[ns] || {}
        const table = d[lang] || d.zh || {}
        return table[key] !== undefined ? table[key] : key
      }
    },
    subscribe(fn) { listeners.push(fn); return () => {} },
  }

  // eslint-disable-next-line no-eval
  ;(0, eval)(src)
  const mod = modules['@wenliang9527/dsh-quick-send']

  const ctx = {
    slots: { inject: (_k, cb) => { cb(); return () => {} }, register: () => () => {} },
    effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
    // locale 在 exports.inject 里，所以生产环境 ctx.get('locale') 可用；桩里照样提供
    get: (k) => (k === 'locale' ? locale : undefined),
    reflect: { get: (name) => (name === 'inputTriggers' ? svc : name === 'locale' ? locale : undefined) },
  }
  const origLog = console.log
  console.log = () => {}
  try {
    mod.apply(ctx, {})
  } finally {
    console.log = origLog
  }

  assert.equal(live.length, 1, '初始应注册一个')
  assert.equal(live[0].name, '常用语', '初始为中文标题')

  // 切到英文并通知
  lang = 'en'
  listeners.forEach((fn) => fn())

  assert.equal(live.length, 1, '语言切换应替换而非叠加注册（旧的先摘掉）')
  assert.equal(live[0].name, 'Quick phrases', '切到英文后标题应变成 Quick phrases，实际：' + live[0].name)

  // 切回中文
  lang = 'zh'
  listeners.forEach((fn) => fn())
  assert.equal(live.length, 1)
  assert.equal(live[0].name, '常用语')
})

test('rc.5：探测顺序是 reflect(strict=false) 优先，其次 ctx.get，最后 ctx.inputTriggers', () => {
  const src = fs.readFileSync(CLIENT, 'utf8')
  const i = src.indexOf('function probeInputTriggers')
  assert.ok(i > 0, '探测逻辑应在 probeInputTriggers 里（首次与延迟重试共用）')
  const body = src.slice(i, i + 1800)
  const iReflect = body.indexOf('reflect.get')
  const iGet = body.indexOf("ctx.get('inputTriggers')")
  const iProp = body.indexOf('ctx.inputTriggers')
  assert.ok(iReflect >= 0 && iGet >= 0 && iProp >= 0, '三条探测路径都要在')
  assert.ok(
    iReflect < iGet && iGet < iProp,
    '必须 reflect 优先，实际顺序 ' + [iReflect, iGet, iProp].join(','),
  )
  // 关键：strict 必须是 false。strict=true 要求提供服务的 fiber 已 ACTIVE，
  // 而本插件与 input-trigger 是并列 client 插件、加载顺序不定 —— 用 true 会偶发拿不到。
  assert.ok(/reflect\.get\(\s*['"]inputTriggers['"]\s*,\s*false\s*\)/.test(body), '必须用 strict=false')
})

test('rc.5：拿不到服务时做有限次延迟重试（应对插件加载顺序竞态）', () => {
  const src = fs.readFileSync(CLIENT, 'utf8')
  const i = src.indexOf('function registerSlashSource')
  const body = src.slice(i, i + 2200)
  assert.ok(body.indexOf('setTimeout') >= 0, '必须有延迟重试：一次性放弃会导致斜杠命令时有时无')
  assert.ok(/attempt\s*>=\s*\d+/.test(body), '必须设重试上限，不能无限重试')
})

test('rc.5：reflect.get 是真实首选（只有 reflect 能给出服务时也必须注册成功）', () => {
  // 关键区分：让 ctx.get 与 ctx.inputTriggers 都拿不到服务，只有 reflect 能拿到。
  // 若实现里 reflect 分支被删掉/降级成摆设，这条必红。
  const src = fs.readFileSync(CLIENT, 'utf8')

  let pool = []
  let idx = 0
  const React = {
    createElement: (t, p, ...c) => ({ type: t, props: p || {}, children: c.flat() }),
    useState: (i) => { const k = idx++; if (pool.length <= k) pool[k] = { v: typeof i === 'function' ? i() : i }; return [pool[k].v, () => {}] },
    useRef: (i) => { const k = idx++; if (pool.length <= k) pool[k] = { current: i }; return pool[k] },
    useEffect: (fn, deps) => { const k = idx++; pool[k] = { fn, deps } },
  }
  const modules = {}
  globalThis.window = { __ModuleLoader__: { load({ id, factory }) { modules[id] = factory(() => React) } } }
  globalThis.document = { createElement: () => ({ set textContent(_v) {}, parentNode: null }), head: { appendChild() {} }, addEventListener() {}, removeEventListener() {} }
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ phrases: [], categories: [] }) })
  // eslint-disable-next-line no-eval
  ;(0, eval)(src)
  const mod = modules['@wenliang9527/dsh-quick-send']

  const sources = []
  const svc = { registerSource(s) { sources.push(s); return () => {} }, sessionOf: () => ({}) }
  let reflectCalls = 0
  const ctx = {
    slots: { inject: (_k, cb) => { cb(); return () => {} }, register: () => () => {} },
    effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
    // 故意让这两条老路径都拿不到服务
    get() { return undefined },
    get inputTriggers() { return undefined },
    reflect: { get(name, strict) { reflectCalls++; if (name !== 'inputTriggers') return undefined; return strict ? svc : svc } },
  }
  const origLog = console.log
  console.log = () => {}
  try {
    mod.apply(ctx, {})
  } finally {
    console.log = origLog
  }
  assert.ok(reflectCalls > 0, '必须真的调用 reflect.get')
  assert.equal(sources.length, 1, '只有 reflect 能给服务时也必须注册成功，实际 ' + sources.length)
})

// ---------------------------------------------------------------- query 解析

test('斜杠命令：裸 "/" 不出候选（不抢宿主命令菜单）', async () => {
  const { sources } = loadClient()
  const out = await cand(sources[0], '')
  assert.deepEqual(out, [], '裸斜杠必须返回空，否则命令菜单被常用语挤满')
})

test('斜杠命令：无关词不出候选', async () => {
  const { sources } = loadClient()
  for (const q of ['goal', 'skill', 'help', 'xyz']) {
    const out = await cand(sources[0], q)
    assert.deepEqual(out, [], `query="${q}" 不该被本插件认领`)
  }
})

test('斜杠命令：/quick-send 出全量', async () => {
  const { sources } = loadClient()
  const out = await cand(sources[0], 'quick-send')
  assert.equal(out.length, PHRASES.length)
  assert.equal(out[0].name, '新建笔记')
})

test('斜杠命令：/qs 别名出全量', async () => {
  const { sources } = loadClient()
  const out = await cand(sources[0], 'qs')
  assert.equal(out.length, PHRASES.length, '别名 /qs 应等价于 /quick-send')
})

test('斜杠命令：边打边试的中间态（/q、/qui、/quick）都出全量', async () => {
  const { sources } = loadClient()
  for (const q of ['q', 'qu', 'qui', 'quic', 'quick', 'quick-', 'quick-s']) {
    const out = await cand(sources[0], q)
    assert.equal(out.length, PHRASES.length, `query="${q}" 正在打名字，应出全量`)
  }
})

test('斜杠命令：/quick-send<关键字> 按关键字过滤', async () => {
  const { sources } = loadClient()
  const out = await cand(sources[0], 'quick-send笔记')
  assert.equal(out.length, 1, '应只剩标题含「笔记」的那条')
  assert.equal(out[0].name, '新建笔记')
})

test('斜杠命令：关键字能命中分类与正文，不只是标题', async () => {
  const { sources } = loadClient()
  const byCat = await cand(sources[0], 'quick-sendObsidian')
  assert.equal(byCat.length, 1, '应能按分类命中')
  const byBody = await cand(sources[0], 'quick-send总结')
  assert.equal(byBody.length, 1, '应能按正文命中')
  assert.equal(byBody[0].name, '总结进展')
})

test('斜杠命令：大小写不敏感', async () => {
  const { sources } = loadClient()
  const a = await cand(sources[0], 'QUICK-SEND')
  const b = await cand(sources[0], 'Quick-Send')
  assert.equal(a.length, PHRASES.length)
  assert.equal(b.length, PHRASES.length)
})

// ---------------------------------------------------------------- 候选形状

test('斜杠命令：候选带 phraseId 且描述单行截断', async () => {
  const { sources } = loadClient()
  const out = await cand(sources[0], 'quick-send')
  for (const c of out) {
    assert.ok(typeof c.phraseId === 'string' && c.phraseId !== '', '必须带 phraseId，否则 onPick 无法回查正文')
    assert.ok(typeof c.name === 'string' && c.name !== '')
    assert.ok(c.description.indexOf('\n') < 0, '描述必须是单行')
    assert.ok(c.description.length <= 60, '描述应截断到 60 字符内，实际 ' + c.description.length)
  }
})

test('斜杠命令：有分类时描述带 [分类] 前缀', async () => {
  const { sources } = loadClient()
  const out = await cand(sources[0], 'quick-send')
  const note = out.find((c) => c.phraseId === 'p1')
  assert.ok(note.description.indexOf('[Obsidian]') === 0, '实际描述：' + note.description)
})

test('斜杠命令：候选上限 30 条', async () => {
  const many = Array.from({ length: 80 }, (_, i) => ({
    id: 'm' + i, title: 'T' + i, text: 'x', category: '', pinned: false, order: i,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }))
  const { sources } = loadClient({ phrases: many })
  const out = await cand(sources[0], 'quick-send')
  assert.equal(out.length, 30, '菜单不该一次塞 80 条')
})

// ---------------------------------------------------------------- onPick

test('斜杠命令：onPick 返回字面文本（不是发送、不是 claim）', async () => {
  const { sources } = loadClient()
  const out = await cand(sources[0], 'quick-send')
  const c = out.find((x) => x.phraseId === 'p2')
  const picked = sources[0].onPick({ candidate: c, session: SESSION, position: 'leading', via: 'menu', span: { start: 0, end: 1, draftRev: 1 } })
  assert.deepEqual(picked, { text: '请总结当前进展' }, '必须走 { text } 分支：替换触发词为字面文本')
})

test('斜杠命令：onPick 展开占位符（与浮层/管理页一致）', async () => {
  const { sources } = loadClient()
  const out = await cand(sources[0], 'quick-send')
  const c = out.find((x) => x.phraseId === 'p3')
  const picked = sources[0].onPick({ candidate: c, session: SESSION, position: 'leading', via: 'menu', span: { start: 0, end: 1, draftRev: 1 } })
  assert.ok(!/\{\{date\}\}/.test(picked.text), '{{date}} 应已展开，实际：' + picked.text)
  assert.ok(/今天的日期是 \d{4}-\d{2}-\d{2}/.test(picked.text), '实际：' + picked.text)
})

test('斜杠命令：candidate 无 phraseId 时返回 undefined（交给宿主默认处理）', () => {
  const { sources } = loadClient()
  const picked = sources[0].onPick({ candidate: { name: 'x' }, session: SESSION, position: 'leading', via: 'menu', span: { start: 0, end: 1, draftRev: 1 } })
  assert.equal(picked, undefined)
})

test('斜杠命令：phraseId 指向已删除条目时返回 undefined，不抛错', async () => {
  const { sources } = loadClient()
  await cand(sources[0], 'quick-send')
  const picked = sources[0].onPick({ candidate: { name: 'x', phraseId: 'gone' }, session: SESSION, position: 'leading', via: 'menu', span: { start: 0, end: 1, draftRev: 1 } })
  assert.equal(picked, undefined)
})

// ---------------------------------------------------------------- 请求节流

test('斜杠命令：连续过滤只打一次 HTTP（TTL 缓存）', async () => {
  const { sources, fetchCalls } = loadClient()
  await cand(sources[0], 'quick-send')
  await cand(sources[0], 'q')
  await cand(sources[0], 'qs')
  await cand(sources[0], 'quick-send笔记')
  const listCalls = fetchCalls.filter((u) => u.indexOf('/__quick-send/list') >= 0)
  assert.equal(listCalls.length, 1, '每敲一个字都请求会打爆宿主，实际请求 ' + listCalls.length + ' 次')
})

test('斜杠命令：拉取失败时返回旧缓存而不抛错', async () => {
  const src = fs.readFileSync(CLIENT, 'utf8')
  // 源码层面确认 catch 分支存在且不 rethrow
  const i = src.indexOf('function slashRows')
  const body = src.slice(i, i + 1200)
  assert.ok(body.indexOf('.catch(') >= 0, 'slashRows 必须有 catch，斜杠命令不该成为报错入口')
  assert.ok(body.indexOf('return slashCache.rows') >= 0, '失败时应回退到旧缓存')
})

test('斜杠命令：signal 已 aborted 时直接返回空，不做任何请求', async () => {
  const { sources, fetchCalls } = loadClient()
  const before = fetchCalls.length
  const ac = new AbortController()
  ac.abort()
  const out = await sources[0].candidates(SESSION, { query: 'quick-send', position: 'leading', signal: ac.signal })
  assert.deepEqual(out, [])
  assert.equal(fetchCalls.length, before, '已中止时不该发请求')
})

// ---------------------------------------------------------------- 不破坏原有功能

test('斜杠命令：注册后浮层与管理页槽位照常挂载', () => {
  const { registered } = loadClient()
  assert.ok(registered['quick-send-trigger'], '浮层触发器仍应注册')
  assert.ok(registered['quick-send-panel'], '浮层面板仍应注册')
  assert.ok(registered['main:quick-send'], '管理页仍应注册')
  assert.ok(registered['quick-send'], '侧边栏图标仍应注册')
})

test('斜杠命令：exports.inject 不含 inputTriggers（否则旧宿主整插件不加载）', () => {
  const { mod } = loadClient()
  assert.ok(Array.isArray(mod.inject), 'inject 应是数组')
  assert.ok(
    mod.inject.indexOf('inputTriggers') < 0,
    'inject 里加 inputTriggers 会让缺该服务的宿主整个 Client 半区不加载，必须靠能力探测。实际：' + JSON.stringify(mod.inject),
  )
})
