/**
 * expand.mjs 单元测试（node --test）。剪贴板用注入的 hook，不碰真实 PowerShell。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { expandTemplate } from "../server/expand.mjs";

test("纯文本原样返回", async () => {
  assert.equal(await expandTemplate("普通文本,无占位符"), "普通文本,无占位符");
});

test("{{date}} 格式 YYYY-MM-DD", async () => {
  assert.match(await expandTemplate("d={{date}}"), /^d=\d{4}-\d{2}-\d{2}$/);
});

test("{{time}} 格式 HH:mm", async () => {
  assert.match(await expandTemplate("t={{time}}"), /^t=\d{2}:\d{2}$/);
});

test("{{datetime}} 组合格式", async () => {
  assert.match(await expandTemplate("{{datetime}}"), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test("占位符两侧空白容忍:{{ date }}", async () => {
  assert.match(await expandTemplate("{{ date }}"), /^\d{4}-\d{2}-\d{2}$/);
});

test("未知占位符原样保留", async () => {
  assert.equal(await expandTemplate("u={{nope}} v={{ver_1}}"), "u={{nope}} v={{ver_1}}");
});

test("vars 自定义变量优先于内建", async () => {
  assert.equal(await expandTemplate("{{date}}", { date: "自定义日" }), "自定义日");
});

test("同名占位符全部替换", async () => {
  const out = await expandTemplate("{{x}}-{{x}}", { x: "A" });
  assert.equal(out, "A-A");
});

test("替换值含 $ 序列不被解释（函数式 replace）", async () => {
  const out = await expandTemplate("cost={{v}}", { v: "$&$`$'" });
  assert.equal(out, "cost=$&$`$'");
});

test("{{clipboard}} 走注入 hook 且同次展开只读一次", async () => {
  let calls = 0;
  const out = await expandTemplate("a={{clipboard}} b={{clipboard}}", {}, {
    getClipboard: () => {
      calls++;
      return "CLIP";
    },
  });
  assert.equal(out, "a=CLIP b=CLIP");
  assert.equal(calls, 1);
});

test("混合已知/未知占位符", async () => {
  const out = await expandTemplate("{{date}}|{{mystery}}");
  assert.match(out, /^\d{4}-\d{2}-\d{2}\|\{\{mystery\}\}$/);
});
