// dsh-quick-send · Client 半区（ModuleLoader bundle）
//
//  - conversation.input.left  -> 📚 触发按钮（输入框工具行）
//  - conversation.input.dock  -> 展开面板（输入框上方整行，关闭时渲染 null）
//  - 数据走 Host 半 HTTP 端点：/__quick-send/*
//  - 填入输入框用 props.inputActions.setDraft（已有草稿时追加不覆盖）
//
// 占位符在「填入时」展开（{{date}}/{{time}}/{{datetime}}），
// {{workspace}}/{{clipboard}}/未知占位符原样保留，与 ZCode 侧一致。

window.__ModuleLoader__.load({
  id: 'dsh-quick-send',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement

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
      })
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
      '.qs-dock{width:100%;}',
      '.qs-panel{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:10px 12px;margin-bottom:8px;max-height:46vh;display:flex;flex-direction:column;gap:8px;font-size:13px;color:var(--dsw-alias-label-primary);}',
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
      '.qs-list{display:flex;flex-direction:column;gap:6px;overflow-y:auto;min-height:0;}',
      '.qs-item{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:7px 9px;cursor:pointer;background:var(--dsw-alias-bg-layer-2);}',
      '.qs-item:hover{border-color:var(--dsw-alias-brand-primary);}',
      '.qs-row{display:flex;align-items:baseline;gap:6px;}',
      '.qs-name{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.qs-pin{font-size:10px;color:var(--dsw-alias-brand-primary);}',
      '.qs-cat{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:0 6px;flex:0 0 auto;}',
      '.qs-prev{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:3px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;}',
      '.qs-acts{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;}',
      '.qs-btn{border:1px solid var(--dsw-alias-border-l2);background:transparent;border-radius:7px;padding:2px 9px;font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit;}',
      '.qs-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);}',
      '.qs-btn.danger:hover{color:#e5484d;border-color:#e5484d;}',
      '.qs-btn.primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff;}',
      '.qs-empty{color:var(--dsw-alias-label-secondary);font-size:12px;text-align:center;padding:14px 0;}',
      '.qs-toast{font-size:11px;border-radius:7px;padding:4px 9px;}',
      '.qs-toast.ok{background:rgba(46,160,67,.12);color:#2ea043;}',
      '.qs-toast.err{background:rgba(229,72,77,.12);color:#e5484d;}',
      '.qs-form{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px;}',
      '.qs-form-row{display:flex;gap:6px;}',
      '.qs-textarea{box-sizing:border-box;width:100%;min-height:64px;resize:vertical;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 9px;font-size:12px;color:var(--dsw-alias-label-primary);font-family:inherit;line-height:1.5;}',
      '.qs-textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary);}',
      '.qs-hint{font-size:10px;color:var(--dsw-alias-label-secondary);}',
      '.qs-trigger{border:1px solid transparent;background:transparent;border-radius:7px;padding:2px 7px;font-size:12px;cursor:pointer;color:var(--dsw-alias-label-secondary);font-family:inherit;}',
      '.qs-trigger:hover{color:var(--dsw-alias-label-primary);}',
      '.qs-trigger.on{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);}',
    ].join('')

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
      return h(
        'button',
        {
          type: 'button',
          className: 'qs-trigger' + (open ? ' on' : ''),
          title: '常用语',
          onClick: function () {
            setOpen(!isOpen())
          },
        },
        '📚',
      )
    }

    // ---- 面板 ---------------------------------------------------------------

    function Panel(props) {
      var open = useOpen()
      var state = React.useState({ loading: true, error: '', phrases: [], categories: [] })
      var snap = state[0]
      var setSnap = state[1]

      var queryState = React.useState('')
      var query = queryState[0]
      var setQuery = queryState[1]

      var catState = React.useState('') // '' = 全部
      var activeCat = catState[0]
      var setActiveCat = catState[1]

      var toastState = React.useState(null) // {kind, text}
      var toast = toastState[0]
      var setToast = toastState[1]

      var editState = React.useState(null) // { id, title, text, category } | 'new'
      var editing = editState[0]
      var setEditing = editState[1]

      var inputActions = props && props.inputActions

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

      React.useEffect(
        function () {
          if (!open) return
          refresh()
        },
        [open],
      )

      function say(kind, text) {
        setToast({ kind: kind, text: text })
        setTimeout(function () {
          setToast(null)
        }, 2400)
      }

      /** 填入草稿：有内容则追加，不覆盖。 */
      function insert(text) {
        var expanded = expandText(text)
        if (!inputActions || typeof inputActions.setDraft !== 'function') {
          say('err', '输入框未就绪，无法填入')
          return
        }
        var cur = props && props.input && typeof props.input.draft === 'string' ? props.input.draft : ''
        try {
          inputActions.setDraft(cur ? cur + '\n\n' + expanded : expanded)
          say('ok', '已填入输入框')
        } catch (e) {
          say('err', '填入失败：' + String(e && e.message ? e.message : e))
        }
      }

      function togglePin(item) {
        apiPost('view', { id: item.id, pinned: !item.pinned }).then(applySnap).catch(fail)
      }

      function move(item, direction) {
        apiPost('reorder', { id: item.id, direction: direction }).then(applySnap).catch(fail)
      }

      function removeItem(item) {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
          if (!window.confirm('删除「' + (item.title || firstLine(item.text)) + '」？')) return
        }
        apiPost('delete', { id: item.id })
          .then(function (next) {
            applySnap(next)
            say('ok', '已删除')
          })
          .catch(fail)
      }

      function submitForm() {
        var form = editing
        if (!form || form === 'new') return
        if (!form.text || form.text.trim() === '') {
          say('err', '正文不能为空')
          return
        }
        apiPost('save', { id: form.id || undefined, title: form.title, text: form.text, category: form.category })
          .then(function (next) {
            applySnap(next)
            setEditing(null)
            say('ok', form.id ? '已保存' : '已新建')
          })
          .catch(fail)
      }

      if (!open) return null

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

      // ---- 渲染 ----
      var head = h(
        'div',
        { className: 'qs-head' },
        h('span', { className: 'qs-title' }, '常用语'),
        h('span', { className: 'qs-count' }, snap.loading ? '加载中…' : list.length + '/' + snap.phrases.length),
        h('span', { className: 'qs-spacer' }),
        h(
          'button',
          {
            type: 'button',
            className: 'qs-btn primary',
            onClick: function () {
              setEditing({ id: '', title: '', text: '', category: activeCat || '' })
            },
          },
          '＋ 新建',
        ),
        h(
          'button',
          { type: 'button', className: 'qs-btn', title: '关闭', onClick: function () { setOpen(false) } },
          '✕',
        ),
      )

      var searchRow = h(
        'div',
        { className: 'qs-form-row' },
        h('input', {
          className: 'qs-input qs-search',
          placeholder: '搜索标题 / 正文 / 分类…',
          value: query,
          onChange: function (e) {
            setQuery(e.target.value)
          },
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
            '全部',
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
        bodyNodes = [h('div', { className: 'qs-empty' }, '加载中…')]
      } else if (snap.error) {
        bodyNodes = [h('div', { className: 'qs-toast err' }, snap.error)]
      } else if (list.length === 0) {
        bodyNodes = [
          h(
            'div',
            { className: 'qs-empty' },
            snap.phrases.length === 0 ? '还没有常用语，点「＋ 新建」添加' : '没有匹配的条目',
          ),
        ]
      } else {
        bodyNodes = list.map(function (item) {
          var label = item.title && item.title !== '' ? item.title : firstLine(item.text)
          return h(
            'div',
            { key: item.id, className: 'qs-item' },
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
                '填入',
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
                '编辑',
              ),
              h(
                'button',
                { type: 'button', className: 'qs-btn', title: '置顶', onClick: function () { togglePin(item) } },
                item.pinned ? '取消置顶' : '置顶',
              ),
              h('button', { type: 'button', className: 'qs-btn', title: '上移', onClick: function () { move(item, 'up') } }, '↑'),
              h('button', { type: 'button', className: 'qs-btn', title: '下移', onClick: function () { move(item, 'down') } }, '↓'),
              h(
                'button',
                { type: 'button', className: 'qs-btn danger', onClick: function () { removeItem(item) } },
                '删除',
              ),
            ),
          )
        })
      }

      var form = null
      if (editing) {
        var isNew = !editing.id
        form = h(
          'div',
          { className: 'qs-form' },
          h(
            'div',
            { className: 'qs-form-row' },
            h('input', {
              className: 'qs-input',
              style: { flex: '1' },
              placeholder: '标题（可空）',
              value: editing.title,
              onChange: function (e) {
                setEditing(Object.assign({}, editing, { title: e.target.value }))
              },
            }),
            h('input', {
              className: 'qs-input',
              style: { flex: '1' },
              placeholder: '分类（可空）',
              value: editing.category,
              onChange: function (e) {
                setEditing(Object.assign({}, editing, { category: e.target.value }))
              },
            }),
          ),
          h('textarea', {
            className: 'qs-textarea',
            placeholder: '正文…',
            value: editing.text,
            onChange: function (e) {
              setEditing(Object.assign({}, editing, { text: e.target.value }))
            },
          }),
          h('div', { className: 'qs-hint' }, '可用占位符：{{date}} {{time}} {{datetime}}（填入时展开）'),
          h(
            'div',
            { className: 'qs-form-row' },
            h('button', { type: 'button', className: 'qs-btn primary', onClick: submitForm }, isNew ? '创建' : '保存'),
            h('button', { type: 'button', className: 'qs-btn', onClick: function () { setEditing(null) } }, '取消'),
          ),
        )
      }

      var toastNode = toast ? h('div', { className: 'qs-toast ' + toast.kind }, toast.text) : null

      return h(
        'div',
        { className: 'qs-dock' },
        h('div', { className: 'qs-panel' }, [head, searchRow, chips, toastNode, h('div', { className: 'qs-list' }, bodyNodes), form]),
      )
    }

    function firstLine(text) {
      var s = String(text || '').split('\n')[0].trim()
      if (s === '') return '（无标题）'
      return s.length > 40 ? s.slice(0, 40) + '…' : s
    }

    // ---- apply --------------------------------------------------------------

    function apply(ctx) {
      var slots = ctx.slots
      if (slots === undefined) return

      var styleEl = document.createElement('style')
      styleEl.textContent = CSS
      document.head.appendChild(styleEl)
      ctx.effect(function () {
        return function () {
          if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl)
        }
      })

      slots.inject('conversation.input.left', function () {
        return slots.register(
          { name: 'conversation.input.left', id: 'quick-send-trigger', order: 11, label: '常用语' },
          Trigger,
        )
      })
      slots.inject('conversation.input.dock', function () {
        return slots.register(
          { name: 'conversation.input.dock', id: 'quick-send-panel', order: 101, label: '常用语面板' },
          Panel,
        )
      })

      console.log('[quick-send] client ready')
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
