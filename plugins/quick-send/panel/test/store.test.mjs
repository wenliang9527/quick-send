/**
 * store.mjs 单元测试（node --test）。每个用例独立临时数据目录
 * （store 每次操作都读 process.env.QUICK_SEND_DATA，进程内切换安全）。
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSnippets, saveSnippet, deleteSnippet, reorderSnippet, renameCategory, getSnippet } from "../server/store.mjs";

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "qs-store-"));
  process.env.QUICK_SEND_DATA = dir;
});

afterEach(() => {
  for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true });
  rmSync(dir, { recursive: true, force: true });
});

test("空存储返回空列表", () => {
  assert.deepEqual(listSnippets(), []);
});

test("新建→查询→删除闭环", () => {
  const r = saveSnippet({ title: "T1", body: "B1" });
  assert.equal(r.ok, true);
  assert.equal(listSnippets().length, 1);
  const id = listSnippets()[0].id;
  assert.ok(getSnippet(id));
  const d = deleteSnippet(id);
  assert.equal(d.ok, true);
  assert.deepEqual(listSnippets(), []);
});

test("原子写无 .tmp 残留", () => {
  saveSnippet({ title: "T", body: "B" });
  assert.equal(readdirSync(dir).some((f) => f.endsWith(".tmp")), false);
});

test("损坏自愈:.bad 留证 + 空启动", () => {
  saveSnippet({ title: "T", body: "B" });
  const file = join(dir, "snippets.json");
  renameSync(file, join(dir, "snippets.json.ok")); // 保留好数据做对照
  writeFileSync(file, "{broken", "utf8");
  assert.deepEqual(listSnippets(), []);
  assert.ok(existsSync(join(dir, "snippets.json.bad")));
  rmSync(join(dir, "snippets.json.ok"), { force: true });
});

test("校验:空标题/空正文/超长标题/超长分类", () => {
  assert.equal(saveSnippet({ title: "  ", body: "b" }).ok, false);
  assert.equal(saveSnippet({ title: "t", body: "  " }).ok, false);
  assert.equal(saveSnippet({ title: "x".repeat(51), body: "b" }).ok, false);
  assert.equal(saveSnippet({ title: "t", body: "b", category: "x".repeat(21) }).ok, false);
});

test("分类:批量改名", () => {
  saveSnippet({ title: "a", body: "b", category: "旧" });
  saveSnippet({ title: "c", body: "d", category: "旧" });
  saveSnippet({ title: "e", body: "f", category: "新" });
  const r = renameCategory("旧", "改");
  assert.equal(r.changed, 2);
  assert.equal(listSnippets().filter((s) => s.category === "改").length, 2);
  assert.equal(listSnippets().filter((s) => s.category === "新").length, 1);
});

test("排序:同分类段内交换,跨分类隔离", () => {
  const a = saveSnippet({ title: "a", body: "b", category: "X" }).snippets.find((s) => s.title === "a");
  const a2 = saveSnippet({ title: "a2", body: "b", category: "X" }).snippets.find((s) => s.title === "a2");
  saveSnippet({ title: "y", body: "b", category: "Y" });
  const r = reorderSnippet(a2.id, "up");
  assert.equal(r.ok, true);
  const seg = r.snippets.filter((s) => s.category === "X").map((s) => s.title);
  assert.deepEqual(seg, ["a2", "a"]);
  assert.equal(getSnippet(a.id).category, "X");
});

test("排序:置顶段与分类段互不干扰", () => {
  const p = saveSnippet({ title: "p", body: "b", pinned: true }).snippets[0];
  const u = saveSnippet({ title: "u", body: "b" }).snippets.find((s) => s.title === "u");
  // 置顶段只有一项:上移=边界无操作;非置顶段同理
  assert.equal(reorderSnippet(p.id, "up").snippets[0].title, "p");
  assert.equal(reorderSnippet(u.id, "up").snippets.some((s) => s.title === "u"), true);
});

test("上限:200 条后拒绝", () => {
  for (let i = 0; i < 200; i++) saveSnippet({ title: `t${i}`, body: "b" });
  assert.equal(saveSnippet({ title: "over", body: "b" }).ok, false);
});
