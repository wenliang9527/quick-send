/**
 * M2 冒烟测试（不依赖宿主）：spawn server 子进程（隔离数据目录），
 * 走真实 stdio JSON-RPC 全链路。
 * 顺序：CRUD → 损坏自愈 → 分类/排序/改名 → 占位符 → 上限（占满放最后）。
 * 剪贴板会被写入测试文本（无害）。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "quick-send-smoke-"));
let failed = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + detail}`);
  if (!cond) failed++;
};

const child = spawn("server/bin/quick-send-server.exe", [], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, QUICK_SEND_DATA: dataDir, QUICK_SEND_PHRASES: join(dataDir, "phrases.json") },
});
let buf = "";
const pending = new Map();
let nextId = 1;
child.stdout.on("data", (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch { /* 忽略非 JSON 行 */ }
  }
});
child.stderr.on("data", (d) => process.stderr.write("[server] " + d.toString()));

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); }
    }, 20_000);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function parseTool(res) {
  const text = (res.result?.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join("");
  let data = null;
  try { data = JSON.parse(text); } catch { /* keep null */ }
  return { isError: Boolean(res.result?.isError), data, text };
}

async function call(name, args) {
  return parseTool(await rpc("tools/call", { name, arguments: args ?? {} }));
}

try {
  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.0.0" },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const toolsRes = await rpc("tools/list", {});
  const tools = (toolsRes.result?.tools ?? []).map((t) => t.name);
  for (const name of ["panel", "list_snippets", "save_snippet", "delete_snippet", "reorder_snippet", "rename_category", "copy_snippet", "render_snippet"]) {
    check(`tools/list 含 ${name}`, tools.includes(name), tools.join(","));
  }

  // ── M1 基础链路 ──
  let r = await call("list_snippets");
  check("初始空列表", !r.isError && r.data.snippets.length === 0);

  r = await call("save_snippet", { snippet: { title: "第一条", body: "内容 A" } });
  const idA = r.data.snippets[0]?.id;
  check("新建", !r.isError && r.data.snippets.length === 1 && !!idA);

  r = await call("save_snippet", { snippet: { title: "  ", body: "x" } });
  check("空标题被拒", r.isError && r.data.error?.code === "validation", r.text);

  r = await call("save_snippet", { snippet: { id: idA, title: "第一条改", body: "内容 A2", pinned: true } });
  check("更新+置顶", !r.isError && r.data.snippets[0].pinned === true && r.data.snippets[0].title === "第一条改");

  r = await call("save_snippet", { snippet: { title: "第二条", body: "内容 B {{date}}" } });
  const idB = r.data.snippets.find((s) => s.title === "第二条")?.id;
  check("第二条", !!idB);
  r = await call("reorder_snippet", { id: idA, direction: "up" });
  check("置顶段上移到边界=无操作", !r.isError && r.data.snippets.length === 2);
  r = await call("save_snippet", { snippet: { id: idB, title: "第二条", body: "内容 B {{date}}", pinned: true } });
  check("B 置顶（A 仍在前）", !r.isError && r.data.snippets[0].title === "第一条改");
  r = await call("reorder_snippet", { id: idB, direction: "up" });
  check("同段上移交换", !r.isError && r.data.snippets[0].id === idB, JSON.stringify(r.data.snippets?.map((s) => s.title)));

  r = await call("render_snippet", { id: idB });
  check("render_snippet(占位符已展开)", !r.isError && r.data.title === "第二条" && /^内容 B \d{4}-\d{2}-\d{2}$/.test(r.data.text), r.data?.text);
  r = await call("copy_snippet", { id: idB });
  check("copy_snippet", !r.isError && r.data.ok === true, r.text);
  r = await call("delete_snippet", { id: idA });
  check("删除", !r.isError && r.data.snippets.length === 1);
  r = await call("delete_snippet", { id: "nonexistent" });
  check("删除不存在→not_found", r.isError && r.data.error?.code === "not_found");

  // ── 损坏自愈 ──
  rmSync(join(dataDir, "phrases.json"));
  writeFileSync(join(dataDir, "phrases.json"), "{broken json!", "utf8");
  r = await call("list_snippets");
  check("损坏→空数据启动", !r.isError && r.data.snippets.length === 0);
  check("损坏留证 .bad-<ts>", readdirSync(dataDir).some((f) => f.startsWith("phrases.json.bad-")));

  // ── M2 分类 ──
  r = await call("save_snippet", { snippet: { title: "catA", body: "bA", category: "嵌入式" } });
  const idCatA = r.data.snippets.find((s) => s.title === "catA")?.id;
  r = await call("save_snippet", { snippet: { title: "catB", body: "bB", category: "写作" } });
  const idCatB = r.data.snippets.find((s) => s.title === "catB")?.id;
  r = await call("save_snippet", { snippet: { title: "catA2", body: "bA2", category: "嵌入式" } });
  const idCatA2 = r.data.snippets.find((s) => s.title === "catA2")?.id;
  check("带分类新建", !!idCatA && !!idCatA2);
  r = await call("save_snippet", { snippet: { title: "catlong", body: "b", category: "x".repeat(21) } });
  check("分类超 20 字被拒", r.isError && r.data.error?.code === "validation");

  r = await call("reorder_snippet", { id: idCatA2, direction: "up" });
  const catTitles = r.data.snippets.filter((s) => s.category === "嵌入式").map((s) => s.title);
  check("同分类段内上移交换", !r.isError && catTitles[0] === "catA2", JSON.stringify(catTitles));
  const writeTitles = r.data.snippets.filter((s) => s.category === "写作").map((s) => s.title);
  check("其它分类段不受影响", writeTitles.length === 1 && writeTitles[0] === "catB", JSON.stringify(writeTitles));

  r = await call("rename_category", { from: "嵌入式", to: "嵌入" });
  check("rename_category 批量改", !r.isError && r.data.changed === 2, JSON.stringify(r.data.changed));

  r = await call("save_snippet", { snippet: { id: idCatA, title: "catA", body: "bA2", category: "嵌入", pinned: false } });
  check("更新保留分类", !r.isError && r.data.snippets.find((s) => s.id === idCatA)?.category === "嵌入");

  // ── M2 占位符 ──
  r = await call("save_snippet", { snippet: { title: "ph", body: "d={{date}} t={{time}} w={{workspace}} u={{unknown}}" } });
  const idPh = r.data.snippets.find((s) => s.title === "ph")?.id;
  r = await call("render_snippet", { id: idPh });
  check("{{date}} 展开", /\d{4}-\d{2}-\d{2}/.test(r.data.text), r.data.text);
  check("{{time}} 展开", /\d{2}:\d{2}/.test(r.data.text), r.data.text);
  check("{{workspace}} 展开", r.data.text.includes("w=panel"), r.data.text); // smoke spawn cwd = panel/
  check("未知占位符原样保留", r.data.text.includes("u={{unknown}}"), r.data.text);

  // 剪贴板准备改用插件自身的 copy_snippet(真实闭环,且不再依赖已删除的 JS 模块)
  r = await call("save_snippet", { snippet: { title: "clipset", body: "CLIPXYZ-内容" } });
  const idClipSet = r.data.snippets.find((s) => s.title === "clipset")?.id;
  r = await call("copy_snippet", { id: idClipSet });
  if (r.isError) { check("剪贴板准备(copy_snippet)", false, r.text); }
  r = await call("save_snippet", { snippet: { title: "phclip", body: "剪贴板=({{clipboard}})" } });
  const idPhClip = r.data.snippets.find((s) => s.title === "phclip")?.id;
  r = await call("render_snippet", { id: idPhClip });
  check("{{clipboard}} 展开", r.data.text === "剪贴板=(CLIPXYZ-内容)", r.data.text);
  r = await call("copy_snippet", { id: idPhClip });
  check("copy_snippet 含展开", !r.isError && r.data.preview.startsWith("剪贴板=("), r.text);

  // 清理 M2 残留（上限测试要在干净存储上跑；idB 在损坏自愈时已随数据清掉，删它会报 not_found，忽略）
  for (const id of [idB, idCatA, idCatB, idCatA2, idPh, idPhClip, idClipSet].filter(Boolean)) {
    await call("delete_snippet", { id });
  }
  r = await call("list_snippets");
  check("清理后为空", r.data.snippets.length === 0);

  // ── 批量新增（agent 整理路径,v0.5.5） ──
  await call("save_snippet", { snippet: { title: "dupT", body: "dupB", category: "X" } });
  r = await call("bulk_add_snippets", { phrases: [
    { title: "dupT", body: "dupB", category: "X" }, // 完全重复 → 跳过
    { title: "b1", body: "内容一" },                 // 成功
    { title: "", body: "x" },                        // 校验失败
    { title: "b2", body: "内容二", category: "Y" },  // 成功
  ] });
  check("bulk 混合:added=2/skip=1/fail=1", !r.isError && r.data.added === 2 && r.data.skippedDuplicates === 1 && r.data.failed.length === 1);
  check("bulk 整批入库(列表含 b1/b2)", r.data.snippets.some((s) => s.title === "b1") && r.data.snippets.some((s) => s.title === "b2"));
  for (const t of ["dupT", "b1", "b2"]) {
    const id = r.data.snippets.find((s) => s.title === t)?.id;
    if (id) await call("delete_snippet", { id });
  }

  // ── 条数护栏（放最后：占满存储;v0.5.1 起 2000,直接预置文件避免逐条慢存） ──
  const bulk = {
    schemaVersion: 1,
    phrases: Array.from({ length: 2000 }, (_, i) => ({
      id: `bulk-${i}`, title: `t${i}`, text: `b${i}`, category: "",
      createdAt: "2026-11-04T00:00:00.000Z", updatedAt: "2026-11-04T00:00:00.000Z",
    })),
  };
  writeFileSync(join(dataDir, "phrases.json"), JSON.stringify(bulk, null, 2), "utf8");
  r = await call("list_snippets");
  check("2000 条外部文件可读", !r.isError && r.data.snippets.length === 2000);
  r = await call("save_snippet", { snippet: { title: "超限", body: "x" } });
  check("第 2001 条被拒", r.isError && r.data.error?.code === "validation");
  r = await call("save_snippet", { snippet: { id: "bulk-0", title: "改", body: "改", category: "", pinned: false } });
  check("满额时仍可改已有条目", !r.isError && r.data.snippets.length === 2000);
} catch (e) {
  console.log("FAIL 异常:", e.message);
  failed++;
} finally {
  child.kill();
  try {
    for (const f of readdirSync(dataDir)) rmSync(join(dataDir, f), { force: true });
    rmSync(dataDir, { recursive: true, force: true });
  } catch { /* 清理失败不影响结果 */ }
}
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
