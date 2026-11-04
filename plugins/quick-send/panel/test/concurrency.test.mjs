/**
 * 双会话并发写实测（验收清单第 5 项自动化，design.md §11）：
 * 两个 server 进程同数据目录，交错+真并发写。
 * 契约（design.md R2）：原子替换 + last-write-wins —— 文件始终合法、两进程最终视图一致；
 * 真并发窗口内后写覆盖先写（允许丢条目），不损坏、不崩溃。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = join(here, "..", "server", "bin", "quick-send-server.exe");

function startServer(dataDir) {
  const child = spawn(SERVER, [], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, QUICK_SEND_DATA: dataDir },
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
      } catch { /* 忽略 */ }
    }
  });
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); }
      }, 20_000);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  return { child, rpc };
}

async function handshake(rpc) {
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "conc", version: "0" } });
  rpc("notifications/initialized", {}).catch(() => {});
}

test("双 server 同数据目录并发写:文件合法、视图一致、无崩溃", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "qs-conc-"));
  const a = startServer(dir);
  const b = startServer(dir);
  try {
    await handshake(a.rpc);
    await handshake(b.rpc);

    const call = (srv, name, args) => srv.rpc("tools/call", { name, arguments: args ?? {} });
    const parse = (res) => {
      const text = (res.result?.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join("");
      try { return JSON.parse(text); } catch { return null; }
    };

    // 顺序交错:各建一条
    await call(a, "save_snippet", { snippet: { title: "A1", body: "a" } });
    await call(b, "save_snippet", { snippet: { title: "B1", body: "b" } });

    // 真并发:各发 5 条 save（契约允许 last-write-wins 丢条目,但文件必须始终合法）
    const burst = await Promise.allSettled([
      ...Array.from({ length: 5 }, (_, i) => call(a, "save_snippet", { snippet: { title: `A-${i}`, body: "x" } })),
      ...Array.from({ length: 5 }, (_, i) => call(b, "save_snippet", { snippet: { title: `B-${i}`, body: "x" } })),
    ]);
    assert.equal(burst.every((r) => r.status === "fulfilled"), true, "并发 RPC 不应挂起/超时");

    // 两进程最终视图一致（各自重新读文件）
    const la = parse(await call(a, "list_snippets"));
    const lb = parse(await call(b, "list_snippets"));
    assert.ok(la && lb, "list_snippets 应返回可解析 JSON");
    assert.deepEqual(la, lb, "两进程最终视图一致");

    // 文件始终合法 JSON
    const parsed = JSON.parse(readFileSync(join(dir, "snippets.json"), "utf8"));
    assert.ok(Array.isArray(parsed.snippets));
    assert.equal(parsed.snippets.length, la.snippets.length);

    // 两进程仍存活（无崩溃）
    assert.equal(a.child.exitCode, null);
    assert.equal(b.child.exitCode, null);
  } finally {
    a.child.kill();
    b.child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
