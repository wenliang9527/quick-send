// dsh-quick-send · Client 半区（ModuleLoader bundle）
//
// 两个界面，各管一件事（v0.3.0 起）：
//   conversation.input.left     -> 📚 触发按钮（输入框工具行）
//   conversation.input.overlay  -> 浮层：只负责插入（序号+标题一行，1-9 直插）
//   sidebar.panellist           -> 📚 侧边栏图标（id 必须等于下面的 main key）
//   main (keyed, key=quick-send)-> 管理页：只负责维护（CRUD/搜索/分类/置顶/排序/导入导出）
//
// 浮层与管理页复用同一组件，靠 props.__mode 切换；Hook 数量必须完全一致
// （client.test.mjs 有守门用例，改动顶部 Hook 结构会让它先炸）。
//
//  - 数据走 Host 半 HTTP 端点：/__quick-send/*
//  - 插入草稿用 props.inputActions.insertText（插到光标处，一次可撤销编辑）
//    配合 captureInsertion + 两档重试，失败时给出四种明确原因
//  - 返回对话用 ctx.get('layout').selectPanel(null)（契约里 null 即显示 Conversation）
//
// 占位符在「插入时」展开（{{date}}/{{time}}/{{datetime}}），
// {{workspace}}/{{clipboard}}/未知占位符原样保留，与 ZCode 侧一致。

window.__ModuleLoader__.load({
  id: '@wenliang9527/dsh-quick-send',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement

    // ---- i18n ----------------------------------------------------------------
    // 通过 DSH 的 locale 服务注册中英双语，跟随「设置 → 通用 → 语言」。

    var NS = 'quick-send'

    var DICT = {
      zh: {
        trigger: '常用语',
        panelTitle: '常用语',
        searchPlaceholder: '搜索…（↑↓ 选择，Enter 插入）',
        newBtn: '＋ 新建',
        close: '关闭',
        allCat: '全部',
        loading: '加载中…',
        empty: '还没有常用语，点「＋ 新建」添加',
        noMatch: '没有匹配的条目',
        insert: '填入',
        edit: '编辑',
        pin: '置顶',
        unpin: '取消置顶',
        moveUp: '上移',
        moveDown: '下移',
        del: '删除',
        delConfirm: '确认删除',
        titlePlaceholder: '标题（可空）',
        categoryPlaceholder: '分类（可空）',
        textPlaceholder: '正文…',
        placeholderHint: '可用占位符：{{date}} {{time}} {{datetime}}（插入时展开）',
        create: '创建',
        save: '保存',
        cancel: '取消',
        inserted: '已插入输入框',
        deleted: '已删除',
        created: '已新建',
        saved: '已保存',
        confirmDelete: '再点一次「删除」确认删除「{name}」',
        errBusy: '正在发送，等这轮结束再点',
        errInert: '当前输入框不可编辑',
        errNoInput: '输入框没接上，无法填入',
        errConflict: '草稿刚变过，再点一次',
        errInsert: '填入失败：{msg}',
        errEmptyText: '正文不能为空',
        confirmDiscard: '编辑器里有内容，关闭会丢失。确定关闭？',
        noTitle: '（无标题）',
        clickToInsert: '点击整条即插入到光标处',
        exportBtn: '导出',
        importBtn: '导入',
        exportDone: '已导出 {n} 条',
        importDone: '已导入 {n} 条',
        importEmpty: '文件里没有可导入的条目',
        importFail: '导入失败：{msg}',
        previewLabel: '插入后：',
        dataFileLabel: '数据文件',
        dataFileTip: '点击复制完整路径',
        copied: '路径已复制',
        quickHint: '点整条插入，或按 1-9',
        manageBtn: '管理',
        manageTitle: '常用语管理',
        manageTip: '点侧边栏图标可随时打开此页',
        sidebarLabel: '常用语',
        sidebarTip: '常用语管理',
        manageEmpty: '还没有常用语',
        backBtn: '← 返回对话',
        backTip: '返回对话界面',
        backFail: '返回失败：{msg}',
        refreshTip: '刷新列表（AI 改过常用语后点这里）',
      },
      en: {
        trigger: 'Phrases',
        panelTitle: 'Phrases',
        searchPlaceholder: 'Search… (↑↓ select, Enter insert)',
        newBtn: '＋ New',
        close: 'Close',
        allCat: 'All',
        loading: 'Loading…',
        empty: 'No phrases yet — click "＋ New" to add one',
        noMatch: 'No matching entries',
        insert: 'Insert',
        edit: 'Edit',
        pin: 'Pin',
        unpin: 'Unpin',
        moveUp: 'Move up',
        moveDown: 'Move down',
        del: 'Delete',
        delConfirm: 'Confirm',
        titlePlaceholder: 'Title (optional)',
        categoryPlaceholder: 'Category (optional)',
        textPlaceholder: 'Text…',
        placeholderHint: 'Placeholders: {{date}} {{time}} {{datetime}} (expanded on insert)',
        create: 'Create',
        save: 'Save',
        cancel: 'Cancel',
        inserted: 'Inserted into composer',
        deleted: 'Deleted',
        created: 'Created',
        saved: 'Saved',
        confirmDelete: 'Click "Delete" again to remove "{name}"',
        errBusy: 'Sending — try again when this turn finishes',
        errInert: 'The composer is not editable right now',
        errNoInput: 'Cannot insert: the composer is not connected',
        errConflict: 'The draft just changed — click again',
        errInsert: 'Insert failed: {msg}',
        errEmptyText: 'Text cannot be empty',
        confirmDiscard: 'The editor has content; closing will lose it. Close anyway?',
        noTitle: '(untitled)',
        clickToInsert: 'Click the row to insert at the caret',
        exportBtn: 'Export',
        importBtn: 'Import',
        exportDone: 'Exported {n} entries',
        importDone: 'Imported {n} entries',
        importEmpty: 'No entries found in that file',
        importFail: 'Import failed: {msg}',
        previewLabel: 'Result:',
        dataFileLabel: 'Data file',
        dataFileTip: 'Click to copy the full path',
        copied: 'Path copied',
        quickHint: 'Click a row to insert, or press 1-9',
        manageBtn: 'Manage',
        manageTitle: 'Phrases manager',
        manageTip: 'Open this page from the sidebar icon anytime',
        sidebarLabel: 'Phrases',
        sidebarTip: 'Phrases manager',
        manageEmpty: 'No phrases yet',
        backBtn: '← Back to chat',
        backTip: 'Return to the conversation',
        backFail: 'Cannot go back: {msg}',
        refreshTip: 'Refresh the list (click after the AI edits phrases)',
      },
    }

    /** 模块级兜底翻译（未接入 locale 服务时用中文）。 */
    var boundT = null

    /** 侧边栏面板 id：sidebar.panellist 与 main(keyed) 必须严格同值。 */
    var PANEL_ID = 'quick-send'

    /** 应用根 ctx，供组件内兜底取 layout 服务（不放进 Hook，避免数量抖动）。 */
    var ctxGet = null

    function format(tpl, params) {
      if (!params) return tpl
      return String(tpl).replace(/\{(\w+)\}/g, function (m, k) {
        return params[k] !== undefined ? String(params[k]) : m
      })
    }

    function zhT(key, params) {
      return format(DICT.zh[key] !== undefined ? DICT.zh[key] : key, params)
    }

    function tr(key, params) {
      return boundT !== null ? boundT(key, params) : zhT(key, params)
    }

    /** 组件取词：优先用槽位注入的 t（跟随 DSH 语言设置），拿不到才退回模块级。 */
    function translator(props) {
      return props && typeof props.t === 'function' ? props.t : tr
    }

    // ---- HTTP ---------------------------------------------------------------

    function requestJson(url, options) {
      return fetch(url, options).then(function (r) {
        if (!r.ok) {
          return r.text().then(function (body) {
            var snippet = body ? body.slice(0, 300) : ''
            throw new Error('HTTP ' + r.status + (snippet ? ': ' + snippet : ''))
          })
        }
        return r.json()
      })
    }

    function apiList() {
      return requestJson('/__quick-send/list')
    }

    function apiPost(method, args) {
      return requestJson('/__quick-send/' + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args || {}),
      }).then(function (out) {
        // 写操作后让斜杠命令的候选缓存失效，避免「刚存的条目 /q 里看不到」
        slashCache.at = 0
        return out
      })
    }

    // ---- 斜杠命令 /quick-send（别名 /qs）--------------------------------------
    //
    // 契约来源：@deepseek-ai/dsh-client-ui-input-trigger 的 InputTriggerSource。
    //   candidates(session, req) → 候选列表；onPick(pick) → { text } 用字面文本
    //   替换「触发词 span」。这正是我们要的语义：插入，不发送。
    //
    // 刻意**不**把 'inputTriggers' 写进 exports.inject：
    //   inject 里的服务缺失会让整个 Client 半区不加载——那会连带毁掉浮层与管理页。
    //   这里改为能力探测，拿不到就静默跳过，旧版 DSH 上的原有功能完全不受影响。

    var SLASH_SOURCE = 'quick-send' // 同时是菜单分组名（宿主按 name 分组）
    var SLASH_ALIAS = 'qs'
    var SLASH_TTL_MS = 8000
    var SLASH_MAX = 30

    // at=0 表示「还没读过」，首次必然拉取
    var slashCache = { at: 0, rows: [] }
    var slashPending = null

    /** 候选检索串：标题 + 分类 + 正文，全部小写。 */
    function slashHaystack(p) {
      return ((p.title || '') + ' ' + (p.category || '') + ' ' + (p.text || '')).toLowerCase()
    }

    /** 正文压成单行预览（候选描述只放得下一行）。 */
    function slashOneLine(text) {
      return String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
    }

    /**
     * 从 query 里剥出关键字。
     *   null  → 不归我们管（不出候选，别抢菜单）
     *   ''    → 全量
     *   其它   → 关键字
     *
     * 裸 `/` 与 `/` + 无关字一律 null：否则一敲斜杠就被常用语列表挤满菜单。
     * 边打边试的中间态（`/q`、`/quick`）按「正在打名字」处理，返回全量——
     * 否则用户必须一字不差打完才看得到东西。
     */
    function slashKeyword(query) {
      var q = String(query || '').trim()
      if (q === '') return null
      var lower = q.toLowerCase()
      if (lower === SLASH_SOURCE || lower === SLASH_ALIAS) return ''
      if (SLASH_SOURCE.indexOf(lower) === 0 || SLASH_ALIAS.indexOf(lower) === 0) return ''
      if (lower.indexOf(SLASH_SOURCE) === 0) return q.slice(SLASH_SOURCE.length).trim()
      if (lower.indexOf(SLASH_ALIAS) === 0) return q.slice(SLASH_ALIAS.length).trim()
      return null
    }

    /** 拉全量（带 TTL 与单飞，避免每敲一个字都打一次 HTTP）。 */
    function slashRows() {
      if (Date.now() - slashCache.at < SLASH_TTL_MS) return Promise.resolve(slashCache.rows)
      if (slashPending !== null) return slashPending
      slashPending = apiList()
        .then(function (snap) {
          var rows = snap && Array.isArray(snap.phrases) ? snap.phrases : []
          slashCache = { at: Date.now(), rows: rows }
          slashPending = null
          return rows
        })
        .catch(function () {
          // 拉取失败：沿用旧缓存，不弹错（斜杠命令不该成为报错入口）
          slashPending = null
          return slashCache.rows
        })
      return slashPending
    }

    function slashCandidates(query, signal) {
      if (signal && signal.aborted) return Promise.resolve([])
      var kw = slashKeyword(query)
      if (kw === null) return Promise.resolve([])
      return slashRows().then(function (rows) {
        if (signal && signal.aborted) return []
        var needle = kw.toLowerCase()
        var list = needle === ''
          ? rows
          : rows.filter(function (p) {
              return slashHaystack(p).indexOf(needle) >= 0
            })
        return list.slice(0, SLASH_MAX).map(function (p) {
          var desc = slashOneLine(p.text)
          if (p.category) desc = '[' + p.category + '] ' + desc
          return {
            name: p.title || slashOneLine(p.text).slice(0, 18) || p.id,
            description: desc.slice(0, 60),
            // 附带 id：onPick 靠它回查正文。宿主把 candidate 原对象透传给 onPick
            // （dsh-prompt 用同样的手段带 templateId），name 可能重名故不能用 name 定位。
            phraseId: p.id,
          }
        })
      })
    }

    function slashPick(pick) {
      var id = pick && pick.candidate ? pick.candidate.phraseId : null
      if (!id) return undefined
      var rows = slashCache.rows
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].id === id) {
          // 与浮层/管理页一致：占位符在**插入时**展开
          return { text: expandText(rows[i].text || '') }
        }
      }
      return undefined
    }

    /**
     * 注册 /quick-send 斜杠命令。
     * @returns {boolean} 是否注册成功（供日志与测试断言）
     */
    function registerSlashSource(ctx) {
      var svc
      // rc.5 契约：未声明进 inject 的服务，ctx.get(name) 与 ctx.<name> 都直接抛错
      // （cordis reflect: cannot get property "x" without inject），不会返回 undefined；
      // 而 inject 全为必需语义，声明了宿主没有的服务会让 entry 永远 pending（boot 直接失败）。
      // 所以：首选 ctx.reflect.get()（rc.5 提供的免 inject 读取口，未提供返回 undefined），
      // 旧宿主再退回两处包了 try/catch 的探测，全部失败 → 能力探测降级（slash: off）。
      try {
        if (ctx.reflect && typeof ctx.reflect.get === 'function') {
          svc = ctx.reflect.get('inputTriggers', true)
        }
      } catch (e) {
        svc = undefined
      }
      if (svc === undefined || svc === null) {
        try {
          svc = typeof ctx.get === 'function' ? ctx.get('inputTriggers') : undefined
        } catch (e) {
          svc = undefined
        }
      }
      if (svc === undefined || svc === null) {
        try {
          svc = ctx.inputTriggers
        } catch (e) {
          svc = undefined
        }
      }
      if (!svc || typeof svc.registerSource !== 'function') {
        console.log(
          '[quick-send] 宿主无 inputTriggers 服务，/quick-send 斜杠命令未注册（浮层与管理页不受影响）',
        )
        return false
      }
      ctx.effect(function () {
        try {
          return svc.registerSource({
            trigger: '/',
            name: SLASH_SOURCE,
            order: 6, // 排在宿主内置 /goal 等之后，不与 command/skill 组抢首位
            candidates: function (_session, req) {
              return slashCandidates(req && req.query, req && req.signal)
            },
            onPick: slashPick,
          })
        } catch (e) {
          // 宿主契约：registerSource 遇 (trigger, name) 重复直接 throw（dsh-client-ui-input-trigger
          // lib/client.js）。若 profile 里残留第二份链接导致本插件被激活两次，第二个实例走到这里——
          // 降级为「已注册」，不让整个 Client 半区激活失败拖垮 web boot（浮层与管理页不受影响）。
          if (e && /already registered/.test(String(e && e.message))) return function () {}
          throw e
        }
      })
      return true
    }

    // ---- 占位符展开（与 Host 侧 expand.js 同一语义） ---------------------------

    function pad(n) {
      return n < 10 ? '0' + n : String(n)
    }

    function expandText(text) {
      if (typeof text !== 'string' || text === '') return ''
      var d = new Date()
      var date = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      var time = pad(d.getHours()) + ':' + pad(d.getMinutes())
      var datetime = date + ' ' + time + ':' + pad(d.getSeconds())
      return text.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, function (whole, nm) {
        if (nm === 'date') return date
        if (nm === 'time') return time
        if (nm === 'datetime') return datetime
        return whole
      })
    }

    // ---- 样式 ---------------------------------------------------------------

    var CSS = [
      '.qs-dock{position:absolute;left:0;bottom:0;margin-bottom:8px;width:100%;z-index:30;display:flex;justify-content:center;pointer-events:none;}',
      '.qs-panel{pointer-events:auto;width:100%;max-width:720px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:10px 12px 8px;max-height:min(38vh,300px);display:flex;flex-direction:column;gap:8px;font-size:13px;color:var(--dsw-alias-label-primary);box-shadow:0 8px 28px rgba(0,0,0,.16);}',
      '.qs-head{display:flex;align-items:center;gap:8px;}',
      '.qs-title{font-weight:600;font-size:13px;}',
      '.qs-count{color:var(--dsw-alias-label-secondary);font-size:11px;}',
      '.qs-spacer{flex:1;}',
      '.qs-input{box-sizing:border-box;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 9px;font-size:12px;color:var(--dsw-alias-label-primary);font-family:inherit;}',
      '.qs-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary);}',
      '.qs-search{flex:1;min-width:80px;}',
      '.qs-chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;flex-shrink:0;}',
      '.qs-chip{flex:0 0 auto;border:1px solid var(--dsw-alias-border-l2);background:transparent;border-radius:999px;padding:2px 10px;font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit;}',
      '.qs-chip.on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff;}',
      '.qs-list{display:flex;flex-direction:column;gap:6px;overflow-y:auto;min-height:0;flex:1 1 auto;}',
      // 紧凑行（浮层用）：一行一条，序号 + 标题，点整行插入
      '.qs-line{display:flex;align-items:center;gap:7px;border:1px solid transparent;border-radius:7px;padding:3px 7px;cursor:pointer;background:transparent;}',
      '.qs-line:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);}',
      '.qs-line.hi{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.08));}',
      '.qs-line-title{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;min-width:0;}',
      '.qs-idx{flex:0 0 auto;min-width:15px;text-align:right;font-size:10px;font-family:ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-secondary);opacity:.8;}',
      '.qs-line.hi .qs-idx{color:var(--dsw-alias-brand-primary);opacity:1;}',
      // 浮层紧凑模式：行距收到 2px，9 条一屏不用滚（.qs-compact 由渲染时挂到 .qs-panel 上）
      '.qs-panel.qs-compact .qs-list{gap:2px;}',
      '.qs-panel.qs-compact{max-height:min(52vh,420px);}',
      '.qs-quick-hint{color:var(--dsw-alias-label-secondary);font-size:10px;opacity:.8;}',
      '.qs-item{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:6px 9px;cursor:pointer;background:var(--dsw-alias-bg-layer-2);}',
      '.qs-item:hover{border-color:var(--dsw-alias-brand-primary);}',
      '.qs-item.hi{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.08));}',
      '.qs-item.sel{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px;}',
      '.qs-row{display:flex;align-items:baseline;gap:6px;}',
      '.qs-name{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.qs-pin{font-size:10px;color:var(--dsw-alias-brand-primary);}',
      '.qs-cat{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:0 6px;flex:0 0 auto;}',
      '.qs-prev{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;}',
      '.qs-acts{display:flex;gap:5px;margin-top:5px;flex-wrap:wrap;align-items:center;}',
      '.qs-btn{border:1px solid var(--dsw-alias-border-l2);background:transparent;border-radius:7px;padding:2px 9px;font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit;}',
      '.qs-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);}',
      '.qs-btn.danger:hover{color:#e5484d;border-color:#e5484d;}',
      '.qs-btn.danger.armed{background:#e5484d;border-color:#e5484d;color:#fff;}',
      '.qs-btn.primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff;}',
      '.qs-empty{color:var(--dsw-alias-label-secondary);font-size:12px;text-align:center;padding:14px 0;}',
      '.qs-toast{font-size:11px;border-radius:7px;padding:4px 9px;}',
      '.qs-toast.ok{background:rgba(46,160,67,.12);color:#2ea043;}',
      '.qs-toast.err{background:rgba(229,72,77,.12);color:#e5484d;}',
      '.qs-toast.warn{background:rgba(234,179,8,.14);color:#b45309;}',
      '.qs-form{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px;}',
      '.qs-form-row{display:flex;gap:6px;}',
      '.qs-textarea{box-sizing:border-box;width:100%;min-height:64px;resize:vertical;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 9px;font-size:12px;color:var(--dsw-alias-label-primary);font-family:inherit;line-height:1.5;}',
      '.qs-textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary);}',
      '.qs-hint{font-size:10px;color:var(--dsw-alias-label-secondary);}',
      '.qs-preview{display:flex;gap:6px;font-size:10px;line-height:1.5;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:5px 8px;max-height:64px;overflow:auto;}',
      '.qs-preview-tag{color:var(--dsw-alias-brand-primary);flex:0 0 auto;}',
      '.qs-preview-body{color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;}',
      '.qs-trigger{border:1px solid transparent;background:transparent;border-radius:7px;padding:2px 7px;font-size:12px;cursor:pointer;color:var(--dsw-alias-label-secondary);font-family:inherit;}',
      '.qs-trigger:hover{color:var(--dsw-alias-label-primary);}',
      '.qs-trigger.on{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);}',
      '.qs-trigger-badge{font-size:9px;opacity:.7;margin-left:2px;}',
      '.qs-foot{display:flex;align-items:center;gap:5px;font-size:9px;color:var(--dsw-alias-label-secondary);opacity:.75;border-top:1px solid var(--dsw-alias-border-l2);padding-top:4px;flex:0 0 auto;}',
      '.qs-foot-tag{flex:0 0 auto;}',
      '.qs-foot-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;font-family:ui-monospace,Consolas,monospace;cursor:pointer;}',
      '.qs-foot-path:hover{color:var(--dsw-alias-label-primary);opacity:1;}',
      // 管理页（中央面板）：整块可用，不受浮层高度限制
      '.qs-page{display:flex;flex-direction:column;gap:10px;padding:16px 18px;width:100%;max-width:100%;min-width:0;overflow:hidden;height:100%;box-sizing:border-box;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);}',
      '.qs-page-head{display:flex;align-items:center;gap:10px;flex:0 0 auto;}',
      '.qs-page-title{font-weight:600;font-size:15px;}',
      '.qs-page .qs-list{flex:1 1 auto;min-height:0;}',
      '.qs-page .qs-panel{max-height:none;}',
      // 返回按钮：放在头部最左、做成「次要但显眼」，不要跟新建抢视觉重心
      '.qs-back{margin-right:2px;}',
      '.qs-back:hover{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);}',
    ].join('')

    // dock 模式覆盖：取消浮层定位，改为整行占位（不遮挡输入框，但会顶高输入区）
    var DOCK_CSS = [
      '.qs-dock{position:static;left:auto;bottom:auto;margin:0 0 6px;z-index:auto;pointer-events:auto;}',
      '.qs-panel{pointer-events:auto;max-width:100%;box-shadow:none;border-radius:12px;}',
    ].join('')

    // ---- 会话内记忆（搜索词 / 分类筛选）-------------------------------------
    //
    // 每次打开面板都把搜索词和分类重置，用户每天要重复输入几十次。
    // 存 localStorage：同一浏览器跨会话保留，换浏览器互不影响。
    // 隐私模式 / 禁用存储时 getItem/setItem 会抛错，全部吞掉降级——
    // 记忆是纯便利功能，绝不能因为它挂掉让整个面板打不开。

    var REMEMBER_KEY = 'quick-send:remember:v1'

    function readRemember() {
      try {
        if (typeof localStorage === 'undefined' || !localStorage) return {}
        var raw = localStorage.getItem(REMEMBER_KEY)
        if (!raw) return {}
        var v = JSON.parse(raw)
        if (!v || typeof v !== 'object') return {}
        return {
          query: typeof v.query === 'string' ? v.query : '',
          category: typeof v.category === 'string' ? v.category : '',
        }
      } catch (e) {
        return {}
      }
    }

    function writeRemember(query, category) {
      try {
        if (typeof localStorage === 'undefined' || !localStorage) return
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({ query: query, category: category }))
      } catch (e) {
        /* 隐私模式等：静默降级 */
      }
    }

    // ---- 共享状态 -----------------------------------------------------------

    // 面板开关由触发按钮与面板组件共享（两者是不同槽位里的独立组件树）。
    var openState = { value: false }
    var openListeners = []

    function isOpen() {
      return openState.value
    }

    function setOpen(next) {
      openState.value = next === true
      for (var i = 0; i < openListeners.length; i++) {
        try {
          openListeners[i]()
        } catch (e) {
          /* ignore */
        }
      }
    }

    function useOpen() {
      var pair = React.useState(isOpen())
      var setLocal = pair[1]
      React.useEffect(function () {
        var fn = function () {
          setLocal(isOpen())
        }
        openListeners.push(fn)
        return function () {
          var i = openListeners.indexOf(fn)
          if (i >= 0) openListeners.splice(i, 1)
        }
      }, [])
      return pair[0]
    }

    // ---- 触发按钮 -----------------------------------------------------------

    function Trigger(props) {
      var open = useOpen()
      var t = translator(props)
      return h(
        'button',
        {
          type: 'button',
          className: 'qs-trigger' + (open ? ' on' : ''),
          title: t('trigger'),
          onClick: function () {
            setOpen(!isOpen())
          },
        },
        '📚',
      )
    }

    // ---- 面板 ---------------------------------------------------------------
    //
    // 同一个组件服务两种形态（Hook 数量必须完全一致，否则 React 会崩）：
    //   mode='quick'  —— 输入框浮层：只显序号+标题，点一下插入；编辑管理去「管理」页
    //   mode='manage' —— 侧边栏中央面板：完整 CRUD / 搜索 / 分类 / 置顶 / 排序 / 导入导出
    // 靠 props.__mode 切换，因此两种形态共用同一份 Hook 与状态，不重复实现。

    function Panel(props) {
      var mode = props && props.__mode === 'manage' ? 'manage' : 'quick'
      var open = useOpen()
      // 管理页常驻，不跟浮层开关走
      var show = mode === 'manage' ? true : open
      // 取词函数：跟随 DSH 语言设置（放在 Hook 区之前，它本身不是 Hook）
      var t = translator(props)

      var state = React.useState({ loading: true, error: '', phrases: [], categories: [] })
      var snap = state[0]
      var setSnap = state[1]

      // 初始值取自会话内记忆，避免每次打开都要重新输搜索词 / 重选分类
      var remembered = readRemember()

      var queryState = React.useState(remembered.query || '')
      var query = queryState[0]
      var setQuery = queryState[1]

      var catState = React.useState(remembered.category || '') // '' = 全部
      var activeCat = catState[0]
      var setActiveCat = catState[1]

      var toastState = React.useState(null) // {kind, text}
      var toast = toastState[0]
      var setToast = toastState[1]

      // 键盘导航选中的条目 id
      var hiState = React.useState(null)
      var highlighted = hiState[0]
      var setHighlighted = hiState[1]

      var editState = React.useState(null) // { id, title, text, category } | 'new'
      var editing = editState[0]
      var setEditing = editState[1]

      // 删除二次确认：第一次点标记，3 秒内再点才真正删
      var delState = React.useState(null)
      var deletingId = delState[0]
      var setDeletingId = delState[1]

      // 定时器与 DOM 引用必须无条件、在顶部调用，保持 hooks 顺序稳定
      var toastTimer = React.useRef(null)
      var listRef = React.useRef(null)
      var deleteTimer = React.useRef(null)

      var inputActions = props && props.inputActions

      // 数据文件路径（面板底部小字显示，让用户随时知道数据存哪）
      var pathState = React.useState(null) // { phrasesFile, viewFile }
      var dataPaths = pathState[0]
      var setDataPaths = pathState[1]

      // 只取 phase 原始值，避免每次敲键都重渲染整个面板
      function selectPhase(state) {
        return state && typeof state.phase === 'string' ? state.phase : undefined
      }
      var phase = typeof props.useInput === 'function' ? props.useInput(selectPhase) : undefined

      function applySnap(next) {
        if (!next || !Array.isArray(next.phrases)) return
        setSnap({ loading: false, error: '', phrases: next.phrases, categories: next.categories || [] })
      }

      function fail(e) {
        setSnap(function (prev) {
          return { loading: false, error: String(e && e.message ? e.message : e), phrases: prev.phrases, categories: prev.categories }
        })
      }

      function refresh() {
        apiList().then(applySnap).catch(fail)
      }

      /**
       * 静默刷新：失败时不覆盖 error 状态、不弹 toast。
       * 用于「窗口重新获得关注」这类自动触发——网络抖一下不该把界面变成错误页。
       */
      function refreshQuiet() {
        apiList()
          .then(applySnap)
          .catch(function () {
            /* 保留现有数据，不打扰用户 */
          })
      }

      React.useEffect(
        function () {
          if (!show) return
          refresh()
        },
        [show],
      )

      // 记住搜索词与分类筛选（值变化即写，量极小）
      React.useEffect(
        function () {
          writeRemember(query, activeCat)
        },
        [query, activeCat],
      )

      // 管理页常驻时 show 恒为 true，上面那个 effect 只会在挂载时跑一次；
      // 而 agent 调 quick_send_add 等工具直接改文件、没有 server→UI 推送通道，
      // 于是「打开着管理页，让 AI 加一条」看不到变化。
      //
      // 不轮询（浪费），只在「用户可能重新关注面板」的时刻拉一次：
      //   窗口重新可见（切回标签页/从最小化恢复）、窗口重新获得焦点。
      // 刷新失败静默——旧数据还在，不打断正在操作的用户。
      React.useEffect(
        function () {
          if (!show) return
          function onVisible() {
            if (typeof document !== 'undefined' && document && document.visibilityState === 'hidden') return
            refreshQuiet()
          }
          function onFocus() {
            refreshQuiet()
          }
          document.addEventListener('visibilitychange', onVisible)
          if (typeof window !== 'undefined' && window && window.addEventListener) {
            window.addEventListener('focus', onFocus)
          }
          return function () {
            document.removeEventListener('visibilitychange', onVisible)
            if (typeof window !== 'undefined' && window && window.removeEventListener) {
              window.removeEventListener('focus', onFocus)
            }
          }
        },
        [show],
      )

      // 面板底部显示当前数据文件位置：只取一次，失败就静默隐藏（纯提示，不影响主流程）
      React.useEffect(
        function () {
          if (!show || dataPaths) return
          requestJson('/__quick-send/paths')
            .then(function (info) {
              if (info && typeof info.phrasesFile === 'string') setDataPaths(info)
            })
            .catch(function () {
              /* ignore */
            })
        },
        [show, dataPaths],
      )

      // Esc 收起面板：编辑表单打开时不响应，避免误关正在编的内容
      // 管理页常驻，不绑 Esc（那是整块主面板，关掉会让人以为插件坏了）
      React.useEffect(
        function () {
          if (!open || mode === 'manage') return
          function onKey(e) {
            if (e.key !== 'Escape') return
            if (editing) return
            setOpen(false)
          }
          document.addEventListener('keydown', onKey)
          return function () {
            document.removeEventListener('keydown', onKey)
          }
        },
        [open, editing, mode],
      )

      /** 关闭面板：正编着内容且有实际改动时先确认，避免误关丢改动。 */
      function closePanel() {
        var dirty =
          editing &&
          editing !== 'new' &&
          (String(editing.text || '').trim() !== '' ||
            String(editing.title || '').trim() !== '' ||
            String(editing.category || '').trim() !== '')
        if (dirty) {
          if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
            if (!window.confirm(t('confirmDiscard'))) return
          }
        }
        setEditing(null)
        setOpen(false)
      }

      function say(kind, text) {
        setToast({ kind: kind, text: text })
        if (toastTimer.current) clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(function () {
          setToast(null)
        }, kind === 'warn' ? 3000 : 2400)
      }

      // 卸载时清掉所有定时器
      React.useEffect(function () {
        return function () {
          if (toastTimer.current) clearTimeout(toastTimer.current)
          if (deleteTimer.current) clearTimeout(deleteTimer.current)
        }
      }, [])

      // 高亮项滚入视野（键盘上下移动时，避免选中项跑到可视区外）
      // 必须放在 if (!open) return null 之前，否则 Hook 数量随开关变化会崩。
      React.useEffect(
        function () {
          if (!highlighted) return
          var box = listRef.current
          if (!box || typeof box.querySelector !== 'function') return
          var el = box.querySelector('[data-id="' + highlighted + '"]')
          if (!el || typeof el.scrollIntoView !== 'function') return
          try {
            el.scrollIntoView({ block: 'nearest' })
          } catch (_) {
            /* ignore */
          }
        },
        [highlighted],
      )

      /**
       * 插入到草稿光标处（一次可撤销的编辑，不覆盖已有内容）。
       *
       * 用 insertText 而非 setDraft：能精确插到光标，且返回 false 时能区分失败原因。
       * 四种失败必须分开说，否则用户只看到"点了没反应"：
       *   1. adjudicating / submitting —— 正在发送，等这一轮结束
       *   2. inert                      —— 输入框不可编辑
       *   3. 没有 insertText            —— 输入框没接上
       *   4. 返回 false                 —— 草稿版本变了（面板开着时用户改过字）
       */
      function insert(rawText) {
        var text = expandText(rawText)

        if (phase === 'adjudicating' || phase === 'submitting') {
          say('err', t('errBusy'))
          return
        }
        if (phase === 'inert') {
          say('err', t('errInert'))
          return
        }
        if (!inputActions || typeof inputActions.insertText !== 'function') {
          say('err', t('errNoInput'))
          return
        }
        try {
          // 抓一次光标；若草稿在此期间变了，insertText 返回 false，重抓再试一次
          for (var attempt = 0; attempt < 2; attempt++) {
            var span = typeof inputActions.captureInsertion === 'function' ? inputActions.captureInsertion() : undefined
            if (inputActions.insertText(text, span) === true) {
              // 只有浮层才需要收起；管理页常驻，插完继续留着方便连插
              if (mode !== 'manage') setOpen(false)
              return
            }
          }
          say('err', t('errConflict'))
        } catch (e) {
          say('err', t('errInsert', { msg: String(e && e.message ? e.message : e) }))
        }
      }

      function togglePin(item) {
        apiPost('view', { id: item.id, pinned: !item.pinned }).then(applySnap).catch(fail)
      }

      /**
       * 返回对话：selectPanel(null) 即「显示 Conversation」（见 layout 服务契约）。
       * 编辑器有未保存内容时先确认，避免切走丢改动。
       */
      function backToChat() {
        var dirty =
          editing &&
          editing !== 'new' &&
          (String(editing.text || '').trim() !== '' ||
            String(editing.title || '').trim() !== '' ||
            String(editing.category || '').trim() !== '')
        if (dirty) {
          if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
            if (!window.confirm(t('confirmDiscard'))) return
          }
        }
        setEditing(null)
        var layout = typeof ctxGet === 'function' ? ctxGet('layout') : undefined
        if (layout && typeof layout.selectPanel === 'function') {
          try {
            layout.selectPanel(null)
          } catch (e) {
            say('err', t('backFail', { msg: String(e && e.message ? e.message : e) }))
          }
        } else {
          say('err', t('backFail', { msg: 'layout 服务不可用' }))
        }
      }

      function move(item, direction) {
        apiPost('reorder', { id: item.id, direction: direction }).then(applySnap).catch(fail)
      }

      function removeItem(item) {
        var name = item.title || firstLine(item.text)
        // 面板内二次确认，不用 window.confirm（Electron 原生弹窗会打断流、也难样式化）
        if (!(deletingId === item.id)) {
          setDeletingId(item.id)
          say('warn', t('confirmDelete', { name: name }))
          if (deleteTimer.current) clearTimeout(deleteTimer.current)
          deleteTimer.current = setTimeout(function () {
            setDeletingId(null)
            setToast(null)
          }, 3000)
          return
        }
        if (deleteTimer.current) {
          clearTimeout(deleteTimer.current)
          deleteTimer.current = null
        }
        setDeletingId(null)
        apiPost('delete', { id: item.id })
          .then(function (next) {
            applySnap(next)
            say('ok', t('deleted'))
          })
          .catch(fail)
      }

      /** 导出全部常用语为 JSON 文件（纯客户端，走 Blob 下载）。 */
      function exportAll() {
        try {
          var payload = {
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            phrases: snap.phrases.map(function (p) {
              return {
                id: p.id,
                title: p.title,
                text: p.text,
                category: p.category,
                createdAt: p.createdAt,
                updatedAt: p.updatedAt,
              }
            }),
          }
          var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
          var url = URL.createObjectURL(blob)
          var a = document.createElement('a')
          a.href = url
          a.download = 'quick-send-' + new Date().toISOString().slice(0, 10) + '.json'
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          setTimeout(function () {
            URL.revokeObjectURL(url)
          }, 1000)
          say('ok', t('exportDone', { n: snap.phrases.length }))
        } catch (e) {
          say('err', t('importFail', { msg: String(e && e.message ? e.message : e) }))
        }
      }

      /** 从文件导入：逐条 save，最后刷新。 */
      function importFrom(text) {
        var doc
        try {
          doc = JSON.parse(text)
        } catch (e) {
          say('err', t('importFail', { msg: 'JSON 解析失败' }))
          return
        }
        var list = doc && Array.isArray(doc.phrases) ? doc.phrases : Array.isArray(doc) ? doc : []
        var valid = list.filter(function (p) {
          return p && typeof p === 'object' && typeof p.text === 'string' && p.text.trim() !== ''
        })
        if (valid.length === 0) {
          say('err', t('importEmpty'))
          return
        }
        var done = 0
        var failed = 0
        function next(k) {
          if (k >= valid.length) {
            refresh()
            if (failed > 0) say('err', t('importFail', { msg: failed + ' 条失败' }))
            else say('ok', t('importDone', { n: done }))
            return
          }
          var p = valid[k]
          apiPost('save', {
            title: typeof p.title === 'string' ? p.title : '',
            text: p.text,
            category: typeof p.category === 'string' ? p.category : '',
          })
            .then(function () {
              done++
              next(k + 1)
            })
            .catch(function () {
              failed++
              next(k + 1)
            })
        }
        next(0)
      }

      function submitForm() {
        var form = editing
        if (!form || form === 'new') return
        if (!form.text || form.text.trim() === '') {
          say('err', t('errEmptyText'))
          return
        }
        apiPost('save', { id: form.id || undefined, title: form.title, text: form.text, category: form.category })
          .then(function (next) {
            applySnap(next)
            setEditing(null)
            say('ok', form.id ? t('saved') : t('created'))
          })
          .catch(fail)
      }

      if (!show) return null

      // ---- 过滤 ----
      var list = snap.phrases
      if (activeCat) list = list.filter(function (p) { return p.category === activeCat })
      if (query.trim() !== '') {
        var q = query.trim().toLowerCase()
        list = list.filter(function (p) {
          return (
            String(p.title || '').toLowerCase().indexOf(q) >= 0 ||
            String(p.text || '').toLowerCase().indexOf(q) >= 0 ||
            String(p.category || '').toLowerCase().indexOf(q) >= 0
          )
        })
      }

      // ---- 键盘导航 ----
      // 在搜索框里 ↑↓ 移动选中，Enter 插入选中项，Esc 退出（有选中时先清选中）
      function onSearchKeyDown(e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          if (list.length === 0) return
          e.preventDefault()
          var idx = -1
          for (var k = 0; k < list.length; k++) {
            if (list[k].id === highlighted) {
              idx = k
              break
            }
          }
          var next
          if (idx < 0) {
            next = e.key === 'ArrowDown' ? 0 : list.length - 1
          } else {
            next = e.key === 'ArrowDown' ? (idx + 1) % list.length : (idx - 1 + list.length) % list.length
          }
          setHighlighted(list[next].id)
          return
        }
        if (e.key === 'Enter') {
          if (highlighted) {
            e.preventDefault()
            var target = null
            for (var j = 0; j < list.length; j++) {
              if (list[j].id === highlighted) {
                target = list[j]
                break
              }
            }
            if (target) insert(target.text)
          }
          return
        }
        if (e.key === 'Escape' && highlighted) {
          e.preventDefault()
          e.stopPropagation()
          setHighlighted(null)
          return
        }
        // 数字键 1-9 直接插入第 N 条：仅在搜索框为空时生效，
        // 否则用户想搜「123」会被抢走按键。第 10 条起不绑（两位数歧义且记不住）。
        if (/^[1-9]$/.test(e.key || '')) {
          if (query.trim() !== '') return
          if (e.altKey || e.ctrlKey || e.metaKey) return
          var n = Number(e.key)
          if (n > list.length) return
          e.preventDefault()
          insert(list[n - 1].text)
        }
      }

      // ---- 渲染 ----
      // 隐藏的文件选择器，供「导入」按钮触发
      var fileInput = h('input', {
        type: 'file',
        accept: '.json,application/json',
        style: { display: 'none' },
        onChange: function (e) {
          var file = e && e.target && e.target.files && e.target.files[0]
          if (!file) return
          var reader = new FileReader()
          reader.onload = function () {
            importFrom(String(reader.result || ''))
            if (e.target) e.target.value = ''
          }
          reader.onerror = function () {
            say('err', t('importFail', { msg: '读取文件失败' }))
          }
          reader.readAsText(file, 'utf-8')
        },
      })

      // 头部按钮：浮层只留「管理」入口（编辑搬到管理页，浮层要轻）；
      // 管理页给完整操作（导出/导入/新建），不需要「管理」和「关闭」。
      var headButtons =
        mode === 'quick'
          ? [
              h(
                'button',
                {
                  type: 'button',
                  className: 'qs-btn',
                  title: t('manageTip'),
                  onClick: function () {
                    setOpen(false)
                    var layout = typeof ctxGet === 'function' ? ctxGet('layout') : undefined
                    if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID)
                  },
                },
                t('manageBtn'),
              ),
              h(
                'button',
                { type: 'button', className: 'qs-btn', title: t('close'), onClick: closePanel },
                '✕',
              ),
            ]
          : [
              h(
                'button',
                { type: 'button', className: 'qs-btn qs-back', title: t('backTip'), onClick: backToChat },
                t('backBtn'),
              ),
              h('button', { type: 'button', className: 'qs-btn', title: t('refreshTip'), onClick: refresh }, '⟳'),
              h('button', { type: 'button', className: 'qs-btn', title: t('exportBtn'), onClick: exportAll }, '↑'),
              h('button', { type: 'button', className: 'qs-btn', title: t('importBtn'), onClick: function () { fileInput.click() } }, '↓'),
              h(
                'button',
                {
                  type: 'button',
                  className: 'qs-btn primary',
                  onClick: function () {
                    setEditing({ id: '', title: '', text: '', category: activeCat || '' })
                  },
                },
                t('newBtn'),
              ),
            ]

      var headChildren = [
        h('span', { className: mode === 'manage' ? 'qs-page-title' : 'qs-title' }, mode === 'manage' ? t('manageTitle') : t('panelTitle')),
        h('span', { className: 'qs-count' }, snap.loading ? t('loading') : list.length + '/' + snap.phrases.length),
      ]
      if (mode === 'quick' && !snap.loading && list.length > 0) {
        headChildren.push(h('span', { className: 'qs-quick-hint' }, t('quickHint')))
      }
      headChildren.push(h('span', { className: 'qs-spacer' }))
      var head = h('div', { className: 'qs-head' + (mode === 'manage' ? ' qs-page-head' : '') }, headChildren.concat(headButtons))

      var searchRow = h(
        'div',
        { className: 'qs-form-row' },
        h('input', {
          className: 'qs-input qs-search',
          placeholder: t('searchPlaceholder'),
          value: query,
          onChange: function (e) {
            setQuery(e.target.value)
            setHighlighted(null)
          },
          onKeyDown: onSearchKeyDown,
        }),
      )

      var chips = null
      if (snap.categories.length > 0) {
        var chipNodes = [
          h(
            'button',
            {
              type: 'button',
              className: 'qs-chip' + (activeCat === '' ? ' on' : ''),
              onClick: function () { setActiveCat('') },
            },
            t('allCat'),
          ),
        ].concat(
          snap.categories.map(function (c) {
            return h(
              'button',
              {
                type: 'button',
                className: 'qs-chip' + (activeCat === c ? ' on' : ''),
                onClick: function () { setActiveCat(activeCat === c ? '' : c) },
              },
              c,
            )
          }),
        )
        chips = h('div', { className: 'qs-chips' }, chipNodes)
      }

      var bodyNodes
      if (snap.loading) {
        bodyNodes = [h('div', { className: 'qs-empty' }, t('loading'))]
      } else if (snap.error) {
        bodyNodes = [h('div', { className: 'qs-toast err' }, snap.error)]
      } else if (list.length === 0) {
        bodyNodes = [
          h(
            'div',
            { className: 'qs-empty' },
            snap.phrases.length === 0 ? t('empty') : t('noMatch'),
          ),
        ]
      } else {
        bodyNodes = list.map(function (item) {
          var label = item.title && item.title !== '' ? item.title : firstLine(item.text)
          var isHi = highlighted === item.id

          // 紧凑行：浮层只显「序号 + 标题（+置顶📌）」，一行一条，9 条一屏全见。
          // 正文预览与 6 个按钮都移到「管理」页，避免为了插入而占掉半屏。
          if (mode === 'quick') {
            return h(
              'div',
              {
                key: item.id,
                'data-id': item.id,
                className: isHi ? 'qs-line hi' : 'qs-line',
                title: item.text,
                onClick: function () { insert(item.text) },
                onMouseEnter: function () { setHighlighted(item.id) },
              },
              h('span', { className: 'qs-idx' }, String(list.indexOf(item) + 1)),
              item.pinned ? h('span', { className: 'qs-pin' }, '📌') : null,
              h('span', { className: 'qs-line-title' }, label),
              item.category ? h('span', { className: 'qs-cat' }, item.category) : null,
            )
          }

          return h(
            'div',
            {
              key: item.id,
              'data-id': item.id,
              className: isHi ? 'qs-item hi' : 'qs-item',
              title: t('clickToInsert'),
              onClick: function (e) {
                // 点按钮时不重复触发
                if (e && e.target && e.target.tagName === 'BUTTON') return
                insert(item.text)
              },
              onMouseEnter: function () {
                setHighlighted(item.id)
              },
            },
            h(
              'div',
              { className: 'qs-row' },
              item.pinned ? h('span', { className: 'qs-pin' }, '📌') : null,
              h('span', { className: 'qs-name' }, label),
              item.category ? h('span', { className: 'qs-cat' }, item.category) : null,
            ),
            h('div', { className: 'qs-prev' }, item.text),
            h(
              'div',
              { className: 'qs-acts' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'qs-btn primary',
                  onClick: function () { insert(item.text) },
                },
                t('insert'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'qs-btn',
                  onClick: function () {
                    setEditing({ id: item.id, title: item.title || '', text: item.text, category: item.category || '' })
                  },
                },
                t('edit'),
              ),
              h(
                'button',
                { type: 'button', className: 'qs-btn', title: item.pinned ? t('unpin') : t('pin'), onClick: function () { togglePin(item) } },
                item.pinned ? t('unpin') : t('pin'),
              ),
              h('button', { type: 'button', className: 'qs-btn', title: t('moveUp'), onClick: function () { move(item, 'up') } }, '↑'),
              h('button', { type: 'button', className: 'qs-btn', title: t('moveDown'), onClick: function () { move(item, 'down') } }, '↓'),
              h(
                'button',
                {
                  type: 'button',
                  className: deletingId === item.id ? 'qs-btn danger armed' : 'qs-btn danger',
                  title: deletingId === item.id ? t('delConfirm') : t('del'),
                  onClick: function () { removeItem(item) },
                },
                deletingId === item.id ? t('delConfirm') : t('del'),
              ),
            ),
          )
        })
      }

      var form = null
      if (editing) {
        var isNew = !editing.id

        // 占位符实时预览：只在正文含本侧支持的占位符时出现，
        // 让用户点「插入」之前就看到 {{date}} 会展开成什么。
        var previewNode = null
        if (hasSupportedPlaceholder(editing.text)) {
          previewNode = h(
            'div',
            { className: 'qs-preview' },
            h('span', { className: 'qs-preview-tag' }, t('previewLabel')),
            h('span', { className: 'qs-preview-body' }, expandText(editing.text)),
          )
        }
        form = h(
          'div',
          { className: 'qs-form' },
          h(
            'div',
            { className: 'qs-form-row' },
            h('input', {
              className: 'qs-input',
              style: { flex: '1' },
              placeholder: t('titlePlaceholder'),
              value: editing.title,
              onChange: function (e) {
                setEditing(Object.assign({}, editing, { title: e.target.value }))
              },
            }),
            h('input', {
              className: 'qs-input',
              style: { flex: '1' },
              placeholder: t('categoryPlaceholder'),
              value: editing.category,
              onChange: function (e) {
                setEditing(Object.assign({}, editing, { category: e.target.value }))
              },
            }),
          ),
          h('textarea', {
            className: 'qs-textarea',
            placeholder: t('textPlaceholder'),
            value: editing.text,
            onChange: function (e) {
              setEditing(Object.assign({}, editing, { text: e.target.value }))
            },
          }),
          h('div', { className: 'qs-hint' }, t('placeholderHint')),
          previewNode,
          h(
            'div',
            { className: 'qs-form-row' },
            h('button', { type: 'button', className: 'qs-btn primary', onClick: submitForm }, isNew ? t('create') : t('save')),
            h('button', { type: 'button', className: 'qs-btn', onClick: function () { setEditing(null) } }, t('cancel')),
          ),
        )
      }

      var toastNode = toast ? h('div', { className: 'qs-toast ' + toast.kind }, toast.text) : null

      // 底部数据文件位置：纯提示，拿不到 paths 就不渲染（不影响主流程）
      function copyPath() {
        var p = dataPaths && dataPaths.phrasesFile
        if (!p) return
        function fallback() {
          say('warn', p)
        }
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(p).then(function () {
            say('ok', t('copied'))
          }).catch(fallback)
        } else {
          fallback()
        }
      }
      var footNode = dataPaths
        ? h(
            'div',
            { className: 'qs-foot' },
            h('span', { className: 'qs-foot-tag' }, t('dataFileLabel')),
            h('span', { className: 'qs-foot-path', title: t('dataFileTip') + '\n' + dataPaths.phrasesFile, onClick: copyPath }, dataPaths.phrasesFile),
          )
        : null

      // 两种形态的外层容器不同：浮层定位在输入框上方；管理页占满中央面板。
      if (mode === 'manage') {
        return h('div', { className: 'qs-page' }, [head, searchRow, chips, toastNode, h('div', { className: 'qs-list', ref: listRef }, bodyNodes), form, fileInput, footNode])
      }

      return h(
        'div',
        { className: 'qs-dock' },
        h('div', { className: 'qs-panel qs-compact' }, [
          head,
          searchRow,
          chips,
          toastNode,
          h('div', { className: 'qs-list', ref: listRef }, bodyNodes),
          form,
          fileInput,
          footNode,
        ]),
      )
    }

    /** 管理页包装：常驻渲染，靠 props.__mode 切到完整编辑形态。 */
    function ManagePage(props) {
      return Panel(Object.assign({}, props, { __mode: 'manage' }))
    }

    /** 侧边栏图标：宿主已包 onClick → layout.selectPanel(id)，这里补 logo 与兜底。 */
    function SidebarIcon(props) {
      var t = translator(props)
      var onClick = function (e) {
        if (props && typeof props.onOpen === 'function') {
          props.onOpen(e)
          return
        }
        if (props && typeof props.onClick === 'function') {
          props.onClick(e)
          return
        }
        try {
          var layout = typeof ctxGet === 'function' ? ctxGet('layout') : undefined
          if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID)
        } catch (_) {
          /* layout 服务缺席时静默 */
        }
      }
      return h(
        'span',
        {
          title: t('sidebarTip'),
          onClick: onClick,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            lineHeight: 1,
            fontSize: '15px',
          },
        },
        '📚',
      )
    }

    /** 该文本里是否含本侧支持的占位符（决定是否显示预览）。 */
    function hasSupportedPlaceholder(text) {
      if (typeof text !== 'string' || text === '') return false
      var re = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g
      var m
      while ((m = re.exec(text)) !== null) {
        var n = m[1]
        if (n === 'date' || n === 'time' || n === 'datetime') return true
      }
      return false
    }

    function firstLine(text) {
      var s = String(text || '').split('\n')[0].trim()
      if (s === '') return tr('noTitle')
      return s.length > 40 ? s.slice(0, 40) + '…' : s
    }

    // ---- apply --------------------------------------------------------------

    function apply(ctx, config) {
      try {
        return applyInner(ctx, config)
      } catch (e) {
        // apply 抛错会被宿主框架吞成「entry failed」且不进 crash log；这里补一条
        // error 级 console（crash log 会原样收录），保留异常细节再原样抛出。
        console.error('[quick-send] apply failed: ' + (e && e.stack ? e.stack : String(e)))
        throw e
      }
    }

    function applyInner(ctx, config) {
      var slots = ctx.slots
      if (slots === undefined) return

      // 记下根 ctx，供组件内兜底取 layout（侧栏图标点击、浮层「管理」按钮）
      ctxGet = typeof ctx.get === 'function' ? function (k) { return ctx.get(k) } : null

      // i18n：向 locale 服务注册中英双语，并绑定翻译函数。
      // label 传 thunk，语言切换时会被重新投影。
      var locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
      if (locale === undefined) locale = ctx.locale
      if (locale && typeof locale.register === 'function') {
        ctx.effect(function () {
          return locale.register(NS, DICT)
        })
        if (typeof locale.bind === 'function') boundT = locale.bind(NS)
      }
      function label(key) {
        return function () {
          return tr(key)
        }
      }

      // 面板容器：默认 overlay（浮层，不挤压输入框）。
      // Client 半区拿不到可靠的 config 传递路径（三个参考实现也都不读 config），
      // 因此由 Host 半区通过 /__quick-send/paths 告知，客户端启动时读一次。
      // 注意：槽位决定必须在 apply 内同步完成，不能等异步结果（否则首次挂载会落空）。
      var cfg = config && typeof config === 'object' ? config : {}
      var useDock = cfg.panelSlot === 'dock'
      var panelSlot = useDock ? 'conversation.input.dock' : 'conversation.input.overlay'

      var styleEl = document.createElement('style')
      styleEl.textContent = CSS + (useDock ? DOCK_CSS : '')
      document.head.appendChild(styleEl)
      ctx.effect(function () {
        return function () {
          if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl)
        }
      })

      slots.inject('conversation.input.left', function () {
        return slots.register(
          { name: 'conversation.input.left', id: 'quick-send-trigger', order: 11, label: label('trigger') },
          Trigger,
        )
      })
      slots.inject(panelSlot, function () {
        return slots.register(
          { name: panelSlot, id: 'quick-send-panel', order: useDock ? 101 : 50, label: label('panelTitle') },
          Panel,
        )
      })

      // 侧边栏中央管理页（与 dsh-serial-panel 同一机制）：
      //   宿主侧栏 PanelRow 自己绑 onClick → ctx.layout.selectPanel(id)，
      //   而 selectPanel 只认「main keyed slot 里同一个 key」的注册项，缺 key 直接抛错。
      //   所以下面两处 id/key 必须严格同值（都是 PANEL_ID），否则点图标毫无反应。
      slots.inject('sidebar.panellist', function () {
        return slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: 62, label: label('sidebarLabel') },
          SidebarIcon,
        )
      })
      slots.inject('main', function () {
        return slots.register({ name: 'main', key: PANEL_ID }, ManagePage)
      })

      // 斜杠命令 /quick-send（能力探测，宿主不支持时静默跳过）
      var slashOk = registerSlashSource(ctx)

      console.log(
        '[quick-send] client ready (panel slot: ' + panelSlot + ', slash: ' + (slashOk ? '/quick-send' : 'off') + ')',
      )

      // 仅作提示：配置文件里要求 dock 但落到了 overlay 时（config 未传进 client），
      // 提示用户去 panelSlot 生效路径检查。不触发重挂，避免破坏已注册的槽位。
      if (!useDock) {
        fetch('/__quick-send/paths')
          .then(function (r) {
            return r.ok ? r.json() : null
          })
          .then(function (info) {
            if (info && info.panelSlot === 'dock') {
              console.log(
                '[quick-send] 配置要求 panelSlot=dock，但 client 未收到该配置；当前使用 overlay。' +
                  '如确需 dock，请核对 cordis.patch.yml 的 config 是否传入。',
              )
            }
          })
          .catch(function () {
            /* ignore */
          })
      }
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})
