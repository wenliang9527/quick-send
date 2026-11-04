/**
 * Quick-Send 数据层：snippets.json 读写（M1，无分类字段，M2 追加）。
 *
 * 纪律（设计文档 §6）：
 * - 原子写：snippets.json.tmp → rename 覆盖；写路径毫秒级，last-write-wins
 * - 损坏自愈：parse 失败 → 原文件改名 .bad 留证，空数据启动（NFR-6）
 * - 数据目录：env QUICK_SEND_DATA（plugin.json 注入 ${ZCODE_PLUGIN_DATA}）；
 *   未注入/未替换时回退 ~/.zcode/quick-send（替换失败的特征是含 "${"）
 * - order 为组内相对序（M1 组 = 置顶/非置顶两段）；reorder 只交换相邻两项
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

export const LIMITS = {
  maxSnippets: 200,
  maxTitle: 50,
  maxBody: 10 * 1024, // NFR-2：单条正文 10KB
  maxCategory: 20,
};

function dataDir() {
  const env = process.env.QUICK_SEND_DATA;
  if (env && !env.includes("${")) return env;
  return join(homedir(), ".zcode", "quick-send");
}

export function dataFilePath() {
  return join(dataDir(), "snippets.json");
}

function emptyData() {
  return { version: 1, updatedAt: new Date().toISOString(), snippets: [] };
}

function normalizeSnippet(raw) {
  const now = new Date().toISOString();
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : randomUUID(),
    title: typeof raw.title === "string" ? raw.title : "",
    body: typeof raw.body === "string" ? raw.body : "",
    category: typeof raw.category === "string" ? raw.category : "", // M2：空 = 未分类
    pinned: Boolean(raw.pinned),
    order: Number.isFinite(raw.order) ? raw.order : 0,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
  };
}

function loadData() {
  const file = dataFilePath();
  if (!existsSync(file)) return emptyData();
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return emptyData();
  }
  try {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.snippets)) throw new Error("shape");
    return { version: 1, updatedAt: data.updatedAt ?? new Date().toISOString(), snippets: data.snippets.map(normalizeSnippet) };
  } catch {
    // NFR-6：损坏留证，空数据启动
    try {
      const bad = join(dataDir(), `snippets.json.bad`);
      if (existsSync(bad)) unlinkSync(bad);
      renameSync(file, bad);
    } catch {
      /* 留证失败不阻塞启动 */
    }
    return emptyData();
  }
}

function persist(data) {
  const file = dataFilePath();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  data.updatedAt = new Date().toISOString();
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, file);
}

/** 全量列表（置顶优先，组内按 order 升序） */
export function listSnippets() {
  return sorted(loadData().snippets);
}

function sorted(snippets) {
  const byOrder = (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt);
  return [...snippets].sort((a, b) => (a.pinned === b.pinned ? byOrder(a, b) : a.pinned ? -1 : 1));
}

/**
 * 校验并保存（有 id 即更新，无 id 新建）。
 * 返回 { ok: true, snippets } 或 { ok: false, error: { code, message } }。
 */
export function saveSnippet(input) {
  const data = loadData();
  const raw = input && typeof input === "object" ? input : {};
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const body = typeof raw.body === "string" ? raw.body : "";
  if (!title) return { ok: false, error: { code: "validation", message: "标题不能为空" } };
  if (!body.trim()) return { ok: false, error: { code: "validation", message: "内容不能为空" } };
  if (title.length > LIMITS.maxTitle)
    return { ok: false, error: { code: "validation", message: `标题超限（${title.length}/${LIMITS.maxTitle} 字）` } };
  if (Buffer.byteLength(body, "utf8") > LIMITS.maxBody)
    return { ok: false, error: { code: "validation", message: `内容超限（${Buffer.byteLength(body, "utf8")}/${LIMITS.maxBody} 字节）` } };

  const now = new Date().toISOString();
  const rawCategory = typeof raw.category === "string" ? raw.category.trim() : "";
  if (rawCategory.length > LIMITS.maxCategory)
    return { ok: false, error: { code: "validation", message: `分类超限（${rawCategory.length}/${LIMITS.maxCategory} 字）` } };
  const existing = raw.id ? data.snippets.find((s) => s.id === raw.id) : undefined;
  if (existing) {
    existing.title = title;
    existing.body = body;
    existing.category = rawCategory;
    existing.pinned = Boolean(raw.pinned);
    existing.updatedAt = now;
  } else {
    if (data.snippets.length >= LIMITS.maxSnippets)
      return { ok: false, error: { code: "validation", message: `已达上限（${LIMITS.maxSnippets} 条）` } };
    const maxOrder = data.snippets.reduce((m, s) => Math.max(m, s.order), 0);
    data.snippets.push(
      normalizeSnippet({ id: randomUUID(), title, body, category: rawCategory, pinned: Boolean(raw.pinned), order: maxOrder + 1, createdAt: now, updatedAt: now }),
    );
  }
  persist(data);
  return { ok: true, snippets: sorted(data.snippets) };
}

export function deleteSnippet(id) {
  const data = loadData();
  const idx = data.snippets.findIndex((s) => s.id === id);
  if (idx < 0) return { ok: false, error: { code: "not_found", message: "条目不存在" } };
  data.snippets.splice(idx, 1);
  persist(data);
  return { ok: true, snippets: sorted(data.snippets) };
}

/** 分段键：置顶一段（全局），未置顶按分类分段（M2） */
function segmentKey(s) {
  return s.pinned ? "\u0000pinned" : `cat:${s.category ?? ""}`;
}

/** 组内（置顶段 / 所属分类段）相邻交换；跨段边界 = 无操作 */
export function reorderSnippet(id, direction) {
  const data = loadData();
  const byOrder = (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt);
  const seq = [...data.snippets].sort(byOrder);
  const idx = seq.findIndex((s) => s.id === id);
  if (idx < 0) return { ok: false, error: { code: "not_found", message: "条目不存在" } };
  const cur = seq[idx];
  const step = direction === "up" ? -1 : 1;
  let i = idx + step;
  while (i >= 0 && i < seq.length && segmentKey(seq[i]) !== segmentKey(cur)) i += step;
  const neighbor = seq[i];
  if (!neighbor) {
    return { ok: true, snippets: sorted(data.snippets) }; // 段边界，视为无操作
  }
  const other = data.snippets.find((s) => s.id === neighbor.id);
  [cur.order, other.order] = [other.order, cur.order];
  cur.updatedAt = other.updatedAt = new Date().toISOString();
  persist(data);
  return { ok: true, snippets: sorted(data.snippets) };
}

/** 批量改分类（M2）：from → to（to 空串 = 移到未分类） */
export function renameCategory(from, to) {
  const data = loadData();
  let changed = 0;
  for (const s of data.snippets) {
    if ((s.category ?? "") === from) {
      s.category = to;
      s.updatedAt = new Date().toISOString();
      changed++;
    }
  }
  if (changed > 0) persist(data);
  return { ok: true, changed, snippets: sorted(data.snippets) };
}

export function getSnippet(id) {
  return loadData().snippets.find((s) => s.id === id) ?? null;
}
