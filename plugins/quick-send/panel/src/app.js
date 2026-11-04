/**
 * Quick-Send 面板逻辑（M2）。
 *
 * 数据流：所有读写走 app.callServerTool → 插件 server（store.mjs 落盘）；
 * 写操作返回最新全量，整表重渲染。注意：save_snippet 会覆盖 category，
 * 所有保存调用必须显式带 category（否则会被清空）。
 * 发送：render_snippet（占位符已展开）→ app.sendMessage（宿主自带确认框，M0 实测）。
 * 复制：copy_snippet（服务端剪贴板是唯一路径，S4 实测面板侧被权限策略拦截）。
 *
 * M2 新增：分类 chips 过滤、{{占位符}}（server 端展开）、i18n（zh/en）、
 * widgetState 记忆（query/category，会话内重开恢复）。
 * 纪律：事件处理器在 connect 之前注册；只依赖官方 ext-apps SDK，不碰 window.zcode。
 */
import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import { stringsFor } from "./i18n.js";

const app = new App({ name: "quick-send", version: "0.5.3" }, {});

const els = {
  search: document.getElementById("search"),
  btnNew: document.getElementById("btn-new"),
  chips: document.getElementById("chips"),
  list: document.getElementById("list"),
  empty: document.getElementById("empty"),
  status: document.getElementById("status"),
  overlay: document.getElementById("overlay"),
  drawerTitle: document.getElementById("drawer-title"),
  fTitle: document.getElementById("f-title"),
  fCategory: document.getElementById("f-category"),
  catList: document.getElementById("cat-list"),
  fBody: document.getElementById("f-body"),
  fErr: document.getElementById("f-err"),
  phHint: document.getElementById("ph-hint"),
  btnCancel: document.getElementById("btn-cancel"),
  btnSave: document.getElementById("btn-save"),
};

const state = {
  snippets: [],
  query: "",
  category: "all", // "all" | "pinned" | "__none" | 分类名
  openMenuId: null,
  pendingDeleteId: null,
  editing: null, // null | { id?, pinned }
  statusTimer: null,
  saveStateTimer: null,
};

let t = stringsFor("zh-CN");

// ── 小工具 ──
function setStatus(msg, cls) {
  els.status.textContent = msg;
  els.status.className = `show ${cls || ""}`;
  clearTimeout(state.statusTimer);
  if (cls !== "pending") {
    state.statusTimer = setTimeout(() => {
      els.status.className = "";
    }, 3000);
  }
}

function tool(name, args) {
  return app.callServerTool({ name, arguments: args ?? {} });
}

function toolJson(res) {
  const text = (res.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join("");
  try {
    return JSON.parse(text);
  } catch {
    return { error: { code: "bad_response", message: text || "服务器返回异常" } };
  }
}

async function call(name, args) {
  const res = await tool(name, args);
  const data = toolJson(res);
  if (res.isError || data.error) throw new Error(data.error?.message ?? "操作失败");
  return data;
}

function applySnippets(snippets) {
  state.snippets = Array.isArray(snippets) ? snippets : [];
  state.openMenuId = null;
  render();
}

// ── widgetState（FR-12：query/category 会话内记忆）──
function currentWidgetState() {
  return { query: state.query, category: state.category };
}

function scheduleSaveWidgetState() {
  clearTimeout(state.saveStateTimer);
  state.saveStateTimer = setTimeout(() => {
    app.setWidgetState?.(currentWidgetState()).catch(() => {});
  }, 300);
}

function restoreWidgetState() {
  const ws = app.getHostContext?.()?.["zcode/widgetState"];
  if (!ws || typeof ws !== "object") return;
  if (typeof ws.query === "string") {
    state.query = ws.query;
    els.search.value = ws.query;
  }
  if (typeof ws.category === "string" && ws.category) state.category = ws.category;
}

// ── 分类派生与过滤 ──
function categories() {
  return [...new Set(state.snippets.map((s) => (s.category ?? "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "zh-Hans-CN"),
  );
}

function hasUncategorized() {
  return state.snippets.some((s) => !(s.category ?? "").trim());
}

function matchesQuery(s) {
  const q = state.query.trim().toLowerCase();
  return !q || s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q);
}

function matchesCategory(s) {
  const cat = (s.category ?? "").trim();
  if (state.category === "all") return true;
  if (state.category === "pinned") return s.pinned;
  if (state.category === "__none") return !cat;
  return cat === state.category;
}

function visible() {
  return state.snippets.filter((s) => matchesQuery(s) && matchesCategory(s));
}

// ── 渲染 ──
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconBtn(label, title, onclick) {
  const b = el("button", "icon-btn", label);
  b.title = title;
  b.onclick = onclick;
  return b;
}

function renderChips() {
  els.chips.textContent = "";
  const chips = [{ key: "all", label: t.chipAll }, { key: "pinned", label: t.chipPinned }];
  for (const c of categories()) chips.push({ key: c, label: c });
  if (hasUncategorized()) chips.push({ key: "__none", label: t.groupUncategorized });
  for (const c of chips) {
    const b = el("button", `chip${state.category === c.key ? " active" : ""}`, c.label);
    b.onclick = () => {
      state.category = c.key;
      scheduleSaveWidgetState();
      render();
    };
    els.chips.appendChild(b);
  }
}

function makeCard(s) {
  const card = el("div", "card");
  const head = el("div", "card-head");
  if (s.pinned) head.appendChild(el("span", "pin-flag", "📌"));
  head.appendChild(el("div", "card-title", s.title));
  head.appendChild(iconBtn("✏", t.edit, () => openEditor(s)));
  head.appendChild(iconBtn(state.openMenuId === s.id ? "✕" : "⋯", t.more, () => {
    state.openMenuId = state.openMenuId === s.id ? null : s.id;
    render();
  }));
  card.appendChild(head);

  card.appendChild(el("div", "card-body", s.body));

  const actions = el("div", "card-actions");
  const btnCopy = el("button", null, t.copy);
  btnCopy.onclick = () => void doCopy(s, btnCopy);
  const btnSend = el("button", null, t.send);
  btnSend.onclick = () => void doSend(s, btnSend);
  actions.appendChild(btnCopy);
  actions.appendChild(btnSend);
  card.appendChild(actions);

  if (state.openMenuId === s.id) {
    const menu = el("div", "more-menu");
    const pinBtn = el("button", null, s.pinned ? t.unpin : t.pin);
    pinBtn.onclick = () =>
      void mutate("save_snippet", {
        snippet: { id: s.id, title: s.title, body: s.body, category: s.category ?? "", pinned: !s.pinned },
      });
    const up = el("button", null, t.moveUp);
    up.onclick = () => void mutate("reorder_snippet", { id: s.id, direction: "up" });
    const down = el("button", null, t.moveDown);
    down.onclick = () => void mutate("reorder_snippet", { id: s.id, direction: "down" });
    menu.appendChild(pinBtn);
    menu.appendChild(up);
    menu.appendChild(down);
    const del = el("button", state.pendingDeleteId === s.id ? "danger" : null, state.pendingDeleteId === s.id ? t.delConfirm : t.del);
    del.onclick = () => {
      if (state.pendingDeleteId !== s.id) {
        state.pendingDeleteId = s.id;
        render();
        setTimeout(() => {
          if (state.pendingDeleteId === s.id) {
            state.pendingDeleteId = null;
            render();
          }
        }, 3000);
      } else {
        state.pendingDeleteId = null;
        void mutate("delete_snippet", { id: s.id });
      }
    };
    menu.appendChild(del);
    card.appendChild(menu);
  }
  return card;
}

/** 分组：置顶段（全局）→ 分类段（名称序，未分类殿后） */
function sectionsOf(items) {
  const sections = [];
  const pinned = items.filter((s) => s.pinned);
  if (pinned.length) sections.push({ label: t.groupPinned, items: pinned });
  const groups = new Map();
  for (const s of items) {
    if (s.pinned) continue;
    const cat = (s.category ?? "").trim();
    const key = cat || "__none";
    if (!groups.has(key)) groups.set(key, { label: cat || t.groupUncategorized, items: [] });
    groups.get(key).items.push(s);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === "__none") return 1;
    if (b === "__none") return -1;
    return a.localeCompare(b, "zh-Hans-CN");
  });
  for (const k of keys) sections.push(groups.get(k));
  return sections;
}

function render() {
  renderChips();
  els.list.textContent = "";
  const items = visible();
  const total = state.snippets.filter(matchesQuery).length;

  els.empty.style.display = total === 0 ? "block" : "none";
  if (total === 0) {
    els.empty.textContent = "";
    if (state.query) {
      els.empty.appendChild(document.createTextNode(t.emptyNoMatch));
    } else {
      els.empty.appendChild(el("div", null, t.emptyNoData));
      els.empty.appendChild(el("div", null, t.emptyNoDataHint));
      const b = el("button", "primary", t.emptyFirst);
      b.onclick = () => openEditor(null);
      els.empty.appendChild(document.createElement("br"));
      els.empty.appendChild(b);
    }
  }

  for (const sec of sectionsOf(items)) {
    els.list.appendChild(el("div", "group-label", sec.label));
    sec.items.forEach((s) => els.list.appendChild(makeCard(s)));
  }
}

// ── 动作 ──
async function mutate(toolName, args) {
  try {
    const data = await call(toolName, args);
    applySnippets(data.snippets);
    return true;
  } catch (e) {
    setStatus(t.failed(e.message), "err");
    return false;
  }
}

async function doCopy(s, btn) {
  btn.disabled = true;
  setStatus(t.copyPending, "pending");
  const t0 = Date.now();
  try {
    const data = await call("copy_snippet", { id: s.id });
    setStatus(`${t.copied(Date.now() - t0)}${data.preview ? " ✓ " + data.preview : ""}`.slice(0, 140), "ok");
  } catch (e) {
    setStatus(t.copyFailed(e.message), "err");
  } finally {
    btn.disabled = false;
  }
}

async function doSend(s, btn) {
  btn.disabled = true;
  setStatus(t.sending, "pending");
  try {
    const data = await call("render_snippet", { id: s.id });
    const res = await app.sendMessage({ role: "user", content: [{ type: "text", text: data.text }] });
    setStatus(res?.isError ? t.sentRejected : t.sentOk, res?.isError ? "err" : "ok");
  } catch (e) {
    setStatus(t.sendFailed(e.message), "err");
  } finally {
    btn.disabled = false;
  }
}

// ── 编辑抽屉 ──
function openEditor(snippet) {
  state.editing = snippet ? { id: snippet.id, pinned: snippet.pinned } : { pinned: false };
  els.drawerTitle.textContent = snippet ? t.drawerEdit : t.drawerNew;
  els.fTitle.value = snippet?.title ?? "";
  els.fCategory.value = snippet?.category ?? "";
  els.fBody.value = snippet?.body ?? "";
  els.fErr.style.display = "none";
  // 分类建议：已有分类 + （编辑中的）当前值
  els.catList.textContent = "";
  for (const c of categories()) {
    const opt = document.createElement("option");
    opt.value = c;
    els.catList.appendChild(opt);
  }
  els.overlay.classList.add("show");
  els.fTitle.focus();
}

function closeEditor() {
  state.editing = null;
  els.overlay.classList.remove("show");
}

async function saveEditor() {
  if (!state.editing) return;
  els.btnSave.disabled = true;
  try {
    const data = await call("save_snippet", {
      snippet: {
        id: state.editing.id,
        title: els.fTitle.value,
        body: els.fBody.value,
        category: els.fCategory.value, // 显式带：store 会覆盖 category
        pinned: state.editing.pinned,
      },
    });
    closeEditor();
    applySnippets(data.snippets);
    setStatus(t.saved, "ok");
  } catch (e) {
    els.fErr.textContent = e.message;
    els.fErr.style.display = "block";
  } finally {
    els.btnSave.disabled = false;
  }
}

// ── i18n 应用到静态文案 ──
function applyI18n() {
  document.title = t.appTitle;
  document.querySelector("h1").textContent = t.appTitle;
  els.search.placeholder = t.searchPlaceholder;
  els.btnNew.textContent = t.new;
  els.drawerTitle.textContent = state.editing?.id ? t.drawerEdit : t.drawerNew;
  document.querySelector("label[for=f-title]").textContent = t.fieldTitle;
  document.querySelector("label[for=f-body]").textContent = t.fieldBody;
  document.querySelector("label[for=f-category]").textContent = t.fieldCategory;
  els.fTitle.placeholder = t.titlePlaceholder;
  els.fBody.placeholder = t.bodyPlaceholder;
  els.fCategory.placeholder = t.categoryPlaceholder;
  els.btnCancel.textContent = t.cancel;
  els.btnSave.textContent = t.save;
  els.phHint.textContent = t.placeholderHint;
}

// ── 主题 ──
function applyTheme() {
  const theme = app.getHostContext?.()?.theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  applyDocumentTheme(theme);
}

// 事件处理器必须在 connect 之前注册（ocdup 纪律）
app.addEventListener("hostcontextchanged", () => {
  applyTheme();
  const prev = t === stringsFor("en") ? "en" : "zh";
  const next = String(app.getHostContext?.()?.locale || "").toLowerCase().startsWith("zh") ? "zh" : "en";
  if (prev !== next) {
    t = stringsFor(app.getHostContext?.()?.locale);
    applyI18n();
  }
  render();
});

els.search.addEventListener("input", () => {
  state.query = els.search.value;
  scheduleSaveWidgetState();
  render();
});
els.btnNew.onclick = () => openEditor(null);
els.btnCancel.onclick = closeEditor;
els.btnSave.onclick = () => void saveEditor();
els.overlay.addEventListener("click", (e) => {
  if (e.target === els.overlay) closeEditor();
});

void main();
async function main() {
  try {
    await app.connect();
    t = stringsFor(app.getHostContext?.()?.locale);
    applyTheme();
    applyI18n();
    restoreWidgetState();
    const data = await call("list_snippets");
    state.snippets = data.snippets ?? [];
    render();
  } catch (e) {
    setStatus(t.initFailed(e.message), "err");
    render();
  }
}
