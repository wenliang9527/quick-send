/**
 * i18n 字典一致性（node --test）：zh/en 键集合必须相同，防止漏翻。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { stringsFor } from "../src/i18n.js";

test("zh/en 键集合一致", () => {
  assert.deepEqual(Object.keys(stringsFor("zh-CN")).sort(), Object.keys(stringsFor("en")).sort());
});

test("locale 归类:zh 前缀走中文,其余英文", () => {
  assert.equal(stringsFor("zh-CN").appTitle, "快捷发送");
  assert.equal(stringsFor("zh").appTitle, "快捷发送");
  assert.equal(stringsFor("en-US").appTitle, "Quick Send");
  assert.equal(stringsFor("").appTitle, "Quick Send");
  assert.equal(stringsFor(undefined).appTitle, "Quick Send");
});

test("函数型文案可调用且返回字符串", () => {
  const zh = stringsFor("zh-CN");
  const en = stringsFor("en");
  for (const dict of [zh, en]) {
    assert.equal(typeof dict.copied(123), "string");
    assert.equal(typeof dict.copyFailed("m"), "string");
    assert.equal(typeof dict.failed("m"), "string");
    assert.equal(typeof dict.initFailed("m"), "string");
    assert.equal(typeof dict.sendFailed("m"), "string");
  }
});
