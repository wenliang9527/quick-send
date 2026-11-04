// dsh-quick-send · Agent 工具（Host 半区）
//
// 让模型能直接读写常用语。四个工具：
//   quick_send_list    列出（可按分类/关键词过滤），返回 id 供后续定位
//   quick_send_add     新增一条
//   quick_send_update  修改一条，**仅按 id 定位**
//   quick_send_delete  删除一条，**仅按 id + 必须 confirm:true**
//
// 设计纪律（见 shared-phrases/docs/CONTRACT.md）：
//   1. update/delete 只认 id，不认标题 —— 标题可能重复，按标题定位会误改/误删
//   2. 与面板共用同一套 store 逻辑，遵守「全量读改写 + 原子替换」
//   3. 不写 source 字段，保持六字段契约；agent 新建的用 dsh-agent- 前缀 id 便于识别
//   4. 建议（非强制）agent 整理的条目写进 agent 开头的分类，便于人工筛选

import { readPhrases, writePhrases, genId, nowIso } from './store.js'

const MAX_TITLE = 120
const MAX_TEXT = 20000
const MAX_CATEGORY = 20

// 本侧支持的占位符（未知占位符原样保留）
const PLACEHOLDER_HINT = '正文支持 {{date}} {{time}} {{datetime}} 占位符，插入时按本地时区展开。'

function clampStr(v, max) {
  if (typeof v !== 'string') return ''
  return v.length > max ? v.slice(0, max) : v
}

/** 六个字段的模型可见投影（供 list 返回，避免刷屏）。 */
function project(p, withText) {
  const row = { id: p.id, title: p.title, category: p.category }
  if (withText) row.text = p.text
  return row
}

/**
 * 注册四个 agent 工具。
 * @param {object} deps 依赖注入：{ phrasesFile, ctx, tools? }
 *   ctx   —— 用于取 tools 服务（可选，若直接给 tools 则不需要）
 *   tools —— 直接传入 tools 服务实例（ctx.inject 回调里拿到的子作用域对象
 *            不一定有 get()，所以优先用注入进来服务本身）
 * @returns {() => void} 统一 disposer
 */
export function registerAgentTools(deps) {
  const { phrasesFile } = deps
  let tools = deps.tools

  // 没直接给 tools 时才走 ctx.get，并且要防 ctx 没有 get 的情况
  if (tools === undefined && deps.ctx && typeof deps.ctx.get === 'function') {
    tools = deps.ctx.get('tools')
  }

  if (tools === undefined || typeof tools.register !== 'function') {
    console.warn('[quick-send] tools service 不可用，跳过 agent 工具注册')
    return () => {}
  }

  const disposers = []

  // ---------------------------------------------------------------- list

  disposers.push(
    tools.register({
      name: 'quick_send_list',
      description:
        '列出用户的常用语（快捷短语）。用户提到「常用语」「快捷短语」「snippet」，或让你复用以前存过的话时使用。\n' +
        '**总结归纳/整理常用语之前，先调用本工具查看现有条目，避免存出重复短语。**\n' +
        '返回每条 id、标题、分类；includeText=true 时一并返回正文。\n' +
        '**修改或删除前必须先调用本工具拿到 id** —— update/delete 只接受 id，不接受标题。',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: '只列出该分类的条目。省略则返回全部。',
          },
          query: {
            type: 'string',
            description: '按标题/正文/分类做不区分大小写的子串过滤。省略则不过滤。',
          },
          includeText: {
            type: 'boolean',
            description: '是否在结果中包含正文。默认 false（只给标题预览，省 token）。',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            total: { type: 'number', description: '过滤后的条目数' },
            categories: {
              type: 'array',
              items: { type: 'string' },
              description: '当前所有分类',
            },
            phrases: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  category: { type: 'string' },
                  text: { type: 'string' },
                },
              },
            },
          },
        },
        render(args, value) {
          const v = value || {}
          const rows = Array.isArray(v.phrases) ? v.phrases : []
          if (rows.length === 0) {
            return [{ type: 'text', text: '没有匹配的常用语。' }]
          }
          const lines = rows.map((p) => {
            const cat = p.category ? ` [${p.category}]` : ''
            const head = `- ${p.title || '(无标题)'}${cat}  id=${p.id}`
            return p.text ? `${head}\n  ${String(p.text).replace(/\n/g, '\n  ')}` : head
          })
          const catLine =
            Array.isArray(v.categories) && v.categories.length > 0
              ? `\n分类：${v.categories.join('、')}`
              : ''
          return [
            {
              type: 'text',
              text: `共 ${v.total != null ? v.total : rows.length} 条常用语：\n${lines.join('\n')}${catLine}`,
            },
          ]
        },
      },
      async execute(args) {
        const a = args && typeof args === 'object' ? args : {}
        const doc = await readPhrases(phrasesFile)
        let rows = doc.phrases.slice()

        if (typeof a.category === 'string' && a.category !== '') {
          rows = rows.filter((p) => p.category === a.category)
        }
        if (typeof a.query === 'string' && a.query.trim() !== '') {
          const q = a.query.trim().toLowerCase()
          rows = rows.filter(
            (p) =>
              String(p.title || '').toLowerCase().includes(q) ||
              String(p.text || '').toLowerCase().includes(q) ||
              String(p.category || '').toLowerCase().includes(q),
          )
        }

        const categories = []
        for (const p of doc.phrases) {
          if (p.category && !categories.includes(p.category)) categories.push(p.category)
        }
        categories.sort()

        return {
          total: rows.length,
          categories,
          phrases: rows.map((p) => project(p, a.includeText === true)),
        }
      },
      // 只读，可并发
      isConcurrencySafe() {
        return true
      },
      presentCall(args) {
        const a = args || {}
        const bits = []
        if (a.category) bits.push(`分类=${a.category}`)
        if (a.query) bits.push(`搜索=${a.query}`)
        return { card: 'generic', title: '列出常用语' + (bits.length ? `（${bits.join('，')}）` : '') }
      },
    }),
  )

  // ---------------------------------------------------------------- add

  disposers.push(
    tools.register({
      name: 'quick_send_add',
      description:
        '新增一条常用语。用户说「把这个存成常用语」「以后都这么说」「整理成常用语」时使用。\n' +
        '归纳纪律：一条只讲一件事（不要把多个意图塞进同一条）；标题简短便于识别；' +
        '正文写成能直接插入发送的完整句子，不要写成指令性备注。\n' +
        `长度上限：标题 ≤${MAX_TITLE} 字符、正文 ≤${MAX_TEXT} 字符、分类 ≤${MAX_CATEGORY} 字符，` +
        '超长会被静默截断（不报错），请自行控制长度。\n' +
        PLACEHOLDER_HINT +
        '\n建议（非强制）把整理出来的条目写进 agent 开头的分类（如 agent/整理），便于用户筛选。',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: `简短名称，便于用户识别。≤${MAX_TITLE} 字符，可为空（面板会回退显示正文首行）。`,
          },
          text: {
            type: 'string',
            description: `正文内容。≤${MAX_TEXT} 字符，不能为空。${PLACEHOLDER_HINT}`,
          },
          category: {
            type: 'string',
            description: `可选分类，自由文本。≤${MAX_CATEGORY} 字符。`,
          },
        },
        required: ['text'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '新建条目的 id' },
            title: { type: 'string' },
            category: { type: 'string' },
            total: { type: 'number', description: '写入后的总条数' },
          },
        },
        render(args, value) {
          const v = value || {}
          return [
            {
              type: 'text',
              text: `已新增常用语「${v.title || '(无标题)'}」${v.category ? ` [${v.category}]` : ''}，id=${v.id}。当前共 ${v.total} 条。`,
            },
          ]
        },
      },
      async execute(args) {
        const a = args && typeof args === 'object' ? args : {}
        const text = clampStr(a.text, MAX_TEXT)
        if (text.trim() === '') {
          throw new Error('正文不能为空')
        }
        const title = clampStr(a.title, MAX_TITLE)
        const category = clampStr(a.category, MAX_CATEGORY)

        const doc = await readPhrases(phrasesFile)
        const t = nowIso()
        const entry = {
          // dsh-agent- 前缀仅用于新建，让用户能一眼看出是模型加的；契约只要求 id 唯一
          id: 'dsh-agent-' + genId().replace(/^dsh-/, ''),
          title,
          text,
          category,
          createdAt: t,
          updatedAt: t,
        }
        doc.phrases.push(entry)
        await writePhrases(phrasesFile, doc.phrases)

        return { id: entry.id, title: entry.title, category: entry.category, total: doc.phrases.length }
      },
      // 写文件，不可并发
      isConcurrencySafe() {
        return false
      },
      presentCall(args) {
        const a = args || {}
        return { card: 'generic', title: `新增常用语「${a.title || '(无标题)'}」` }
      },
    }),
  )

  // ---------------------------------------------------------------- update

  disposers.push(
    tools.register({
      name: 'quick_send_update',
      description:
        '修改一条已有常用语。**必须先调用 quick_send_list 拿到 id**，本工具只接受 id，不接受标题（标题可能重复，按标题定位会改错条目）。\n' +
        '只传需要改的字段，未传的字段保持不变。\n' +
        `长度上限：标题 ≤${MAX_TITLE}、正文 ≤${MAX_TEXT}、分类 ≤${MAX_CATEGORY}，超长静默截断。`,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '要修改的条目 id（从 quick_send_list 获得）。',
          },
          title: { type: 'string', description: `新标题。≤${MAX_TITLE} 字符。` },
          text: { type: 'string', description: `新正文。≤${MAX_TEXT} 字符，不能为空。` },
          category: { type: 'string', description: `新分类。≤${MAX_CATEGORY} 字符。传空串可清空分类。` },
        },
        required: ['id'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            category: { type: 'string' },
            changed: {
              type: 'array',
              items: { type: 'string' },
              description: '实际被修改的字段名',
            },
          },
        },
        render(args, value) {
          const v = value || {}
          const changed = Array.isArray(v.changed) ? v.changed : []
          if (changed.length === 0) {
            return [{ type: 'text', text: `条目 ${v.id} 未改动（没有提供任何可修改的字段）。` }]
          }
          return [
            {
              type: 'text',
              text: `已更新「${v.title || '(无标题)'}」（id=${v.id}），修改了：${changed.join('、')}。`,
            },
          ]
        },
      },
      async execute(args) {
        const a = args && typeof args === 'object' ? args : {}
        const id = typeof a.id === 'string' ? a.id : ''
        if (id === '') {
          throw new Error('缺少 id；请先调用 quick_send_list 获取')
        }

        const doc = await readPhrases(phrasesFile)
        const idx = doc.phrases.findIndex((p) => p.id === id)
        if (idx < 0) {
          throw new Error(`未找到 id=${id} 的条目；请先调用 quick_send_list 确认`)
        }

        const cur = doc.phrases[idx]
        const next = { ...cur }
        const changed = []

        if (a.title !== undefined) {
          const v = clampStr(a.title, MAX_TITLE)
          if (v !== cur.title) {
            next.title = v
            changed.push('title')
          }
        }
        if (a.text !== undefined) {
          const v = clampStr(a.text, MAX_TEXT)
          if (v.trim() === '') throw new Error('正文不能为空')
          if (v !== cur.text) {
            next.text = v
            changed.push('text')
          }
        }
        if (a.category !== undefined) {
          const v = clampStr(a.category, MAX_CATEGORY)
          if (v !== cur.category) {
            next.category = v
            changed.push('category')
          }
        }

        if (changed.length > 0) {
          // id 与 createdAt 保持不变，避免另一侧的 view.json 里 pinned/order 失效
          next.updatedAt = nowIso()
          doc.phrases[idx] = next
          await writePhrases(phrasesFile, doc.phrases)
        }

        return { id, title: next.title, category: next.category, changed }
      },
      isConcurrencySafe() {
        return false
      },
      presentCall(args) {
        const a = args || {}
        return { card: 'generic', title: `修改常用语 id=${a.id || '?'}` }
      },
    }),
  )

  // ---------------------------------------------------------------- delete

  disposers.push(
    tools.register({
      name: 'quick_send_delete',
      description:
        '删除一条常用语。**必须先调用 quick_send_list 拿到 id**，且必须显式传 confirm:true。\n' +
        '这是不可撤销操作。只有在用户明确要求删除时才使用；不确定时应先向用户确认要删哪一条。',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '要删除的条目 id（从 quick_send_list 获得）。',
          },
          confirm: {
            type: 'boolean',
            description: '必须显式为 true 才会执行删除，用于避免误调用。',
          },
        },
        required: ['id', 'confirm'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            deleted: { type: 'string', description: '被删除条目的 id' },
            title: { type: 'string' },
            total: { type: 'number', description: '删除后的总条数' },
          },
        },
        render(args, value) {
          const v = value || {}
          return [
            {
              type: 'text',
              text: `已删除常用语「${v.title || '(无标题)'}」（id=${v.deleted}）。当前共 ${v.total} 条。`,
            },
          ]
        },
      },
      async execute(args) {
        const a = args && typeof args === 'object' ? args : {}
        const id = typeof a.id === 'string' ? a.id : ''
        if (id === '') throw new Error('缺少 id；请先调用 quick_send_list 获取')
        if (a.confirm !== true) {
          throw new Error('删除需要显式传 confirm:true；请先向用户确认要删除哪一条')
        }

        const doc = await readPhrases(phrasesFile)
        const target = doc.phrases.find((p) => p.id === id)
        if (!target) throw new Error(`未找到 id=${id} 的条目`)

        doc.phrases = doc.phrases.filter((p) => p.id !== id)
        await writePhrases(phrasesFile, doc.phrases)

        return { deleted: id, title: target.title, total: doc.phrases.length }
      },
      isConcurrencySafe() {
        return false
      },
      presentCall(args) {
        const a = args || {}
        return { card: 'generic', title: `删除常用语 id=${a.id || '?'}` }
      },
    }),
  )

  console.log(`[quick-send] 已注册 ${disposers.length} 个 agent 工具`)

  return () => {
    for (let i = disposers.length - 1; i >= 0; i--) {
      try {
        disposers[i]()
      } catch (_) {
        /* ignore */
      }
    }
  }
}
