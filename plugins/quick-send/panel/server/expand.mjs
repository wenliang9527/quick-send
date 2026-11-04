/**
 * 占位符展开（M2，设计文档 §7.1）。
 *
 * 语法：{{name}}（允许两侧空白）。解析顺序：vars 传入 > 内建；未知占位符原样保留。
 * 内建：date / time / datetime / workspace / clipboard。
 * clipboard 读取慢（~300ms），调用方按需传入 getClipboard（仅当文本含 {{clipboard}} 时）。
 */
import { basename } from "node:path";
import { readClipboard } from "./clipboard.mjs";

const pad = (n) => String(n).padStart(2, "0");

function localNow() {
  const d = new Date();
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export function workspaceName() {
  try {
    return basename(process.cwd());
  } catch {
    return "";
  }
}

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * @param {string} text
 * @param {Record<string, string>} vars 自定义变量（优先于内建）
 * @param {{getClipboard?: () => Promise<string>}} hooks
 */
export async function expandTemplate(text, vars = {}, hooks = {}) {
  const { date, time } = localNow();
  const builtins = {
    date,
    time,
    datetime: `${date} ${time}`,
    workspace: workspaceName(),
  };
  let clipboardPromise; // 缓存 Promise 而非值：多占位符并发 resolve 时也只读一次剪贴板
  const resolve = async (name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return String(vars[name]);
    if (name === "clipboard") {
      clipboardPromise ??= Promise.resolve(hooks.getClipboard ? hooks.getClipboard() : readClipboard());
      return clipboardPromise;
    }
    if (Object.prototype.hasOwnProperty.call(builtins, name)) return builtins[name];
    return null; // 未知 → 原样保留
  };

  const matches = [...text.matchAll(PLACEHOLDER)];
  if (matches.length === 0) return text;
  const resolved = await Promise.all(
    matches.map(async (m) => [m, (await resolve(m[1])) ?? m[0]]),
  );
  let out = text;
  for (const [m, value] of resolved) {
    out = out.replace(m[0], () => value); // 函数式 replace：value 含 $ 序列不被解释
  }
  return out;
}
