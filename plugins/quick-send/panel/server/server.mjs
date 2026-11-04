/**
 * Quick-Send 服务器（quick-send 插件的 MCP App 后端）。
 *
 * 工具面（M1，设计文档 §7；全部 visibility ["app"]，不进模型上下文）：
 * - panel          锚点工具：宿主渲染侧栏面板（_meta["openai/ui"] 纪律照 ocdup）
 * - list_snippets  全量列表
 * - save_snippet   新建/更新（返回最新全量）
 * - delete_snippet 删除
 * - reorder_snippet 组内上移/下移
 * - copy_snippet   展开（M1=原文，M2 接占位符）→ 系统剪贴板 → { ok, preview }
 * - render_snippet 供发送路径取展开文本（发送本身由面板 app.sendMessage 直达宿主）
 *
 * 数据经 store.mjs 读写 ${ZCODE_PLUGIN_DATA}/snippets.json；剪贴板经 clipboard.mjs。
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/server";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";
import { listSnippets, saveSnippet, deleteSnippet, reorderSnippet, renameCategory, getSnippet } from "./store.mjs";
import { setClipboard, readClipboard } from "./clipboard.mjs";
import { expandTemplate } from "./expand.mjs";

export const RESOURCE_URI = "ui://quick-send/panel.html";
export const SURFACE_ID = "quick-send"; // 与 plugin.json ui.surfaces[0].id 一致
export const VERSION = "0.3.1";
const MAX_PANEL_BYTES = 4 * 1024 * 1024;
const PREVIEW_CHARS = 80;

const here = dirname(fileURLToPath(import.meta.url));
// 源码态 server.mjs 在 server/ 下，产物态与 dist/ 同级——两处都找（照 ocdup）
const HTML_CANDIDATES = [join(here, "dist", "panel.html"), join(here, "..", "dist", "panel.html")];

async function loadPanelHtml() {
  for (const p of HTML_CANDIDATES) {
    try {
      const html = await readFile(p, "utf8");
      if (Buffer.byteLength(html, "utf8") > MAX_PANEL_BYTES) {
        return `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:16px">面板资源超过 4 MiB 上限（构建产物异常），请重新构建。</body>`;
      }
      return html;
    } catch {
      // 尝试下一个候选路径
    }
  }
  return `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:16px">面板资源缺失：未找到 dist/panel.html，请在 panel/ 下执行 npm run build。</body>`;
}

function json(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function jsonError(code, message) {
  return { content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }], isError: true };
}

export function createQuickSendServer() {
  const server = new McpServer({ name: "quick-send", version: VERSION });

  // ── 面板 HTML 资源 ──
  registerAppResource(server, "快捷发送面板", RESOURCE_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => {
    const html = await loadPanelHtml();
    return { contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }] };
  });

  // ── 打开面板的锚点工具 ──
  registerAppTool(
    server,
    "panel",
    {
      title: "快捷发送面板",
      description: "打开快捷发送面板（侧栏）：常用语管理，一键复制到剪贴板或发送。",
      inputSchema: z.object({}),
      _meta: {
        ui: { resourceUri: RESOURCE_URI, surface: SURFACE_ID },
        "openai/ui": { preferredModelDisplayMode: "fullscreen" },
      },
    },
    async () => ({
      content: [{ type: "text", text: "快捷发送面板已打开（侧栏）。" }],
    }),
  );

  const APP_UI = { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } };

  registerAppTool(
    server,
    "list_snippets",
    {
      title: "list_snippets",
      description: "[面板专用] 常用语全量列表",
      inputSchema: z.object({}),
      _meta: APP_UI,
    },
    async () => json({ snippets: listSnippets() }),
  );

  registerAppTool(
    server,
    "save_snippet",
    {
      title: "save_snippet",
      description: "[面板专用] 新建/更新常用语（有 id 即更新），返回最新全量",
      inputSchema: z.object({
        snippet: z.object({
          id: z.string().optional(),
          title: z.string(),
          body: z.string(),
          category: z.string().optional(),
          pinned: z.boolean().optional(),
        }),
      }),
      _meta: APP_UI,
    },
    async ({ snippet }) => {
      const r = saveSnippet(snippet);
      return r.ok ? json({ snippets: r.snippets }) : jsonError(r.error.code, r.error.message);
    },
  );

  registerAppTool(
    server,
    "delete_snippet",
    {
      title: "delete_snippet",
      description: "[面板专用] 删除常用语，返回最新全量",
      inputSchema: z.object({ id: z.string().min(1) }),
      _meta: APP_UI,
    },
    async ({ id }) => {
      const r = deleteSnippet(id);
      return r.ok ? json({ snippets: r.snippets }) : jsonError(r.error.code, r.error.message);
    },
  );

  registerAppTool(
    server,
    "reorder_snippet",
    {
      title: "reorder_snippet",
      description: "[面板专用] 组内上移/下移，返回最新全量",
      inputSchema: z.object({ id: z.string().min(1), direction: z.enum(["up", "down"]) }),
      _meta: APP_UI,
    },
    async ({ id, direction }) => {
      const r = reorderSnippet(id, direction);
      return r.ok ? json({ snippets: r.snippets }) : jsonError(r.error.code, r.error.message);
    },
  );

  registerAppTool(
    server,
    "rename_category",
    {
      title: "rename_category",
      description: "[面板专用] 批量改分类（to 空串 = 移到未分类）",
      inputSchema: z.object({ from: z.string(), to: z.string().max(20) }),
      _meta: APP_UI,
    },
    async ({ from, to }) => {
      const r = renameCategory(from, to.trim());
      return json({ changed: r.changed, snippets: r.snippets });
    },
  );

  registerAppTool(
    server,
    "copy_snippet",
    {
      title: "copy_snippet",
      description: "[面板专用] 展开常用语占位符并写入系统剪贴板",
      inputSchema: z.object({ id: z.string().min(1) }),
      _meta: APP_UI,
    },
    async ({ id }) => {
      const snip = getSnippet(id);
      if (!snip) return jsonError("not_found", "条目不存在");
      const text = await expandTemplate(snip.body, {}, { getClipboard: readClipboard });
      const r = await setClipboard(text);
      if (!r.ok) return jsonError("clipboard_failed", r.error);
      return json({ ok: true, preview: text.slice(0, PREVIEW_CHARS) });
    },
  );

  registerAppTool(
    server,
    "render_snippet",
    {
      title: "render_snippet",
      description: "[面板专用] 取展开后的文本（供发送路径），不落剪贴板",
      inputSchema: z.object({ id: z.string().min(1) }),
      _meta: APP_UI,
    },
    async ({ id }) => {
      const snip = getSnippet(id);
      if (!snip) return jsonError("not_found", "条目不存在");
      const text = await expandTemplate(snip.body, {}, { getClipboard: readClipboard });
      return json({ title: snip.title, text });
    },
  );

  return server;
}

// ── stdio 入口（被 plugin.json 拉起）──
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { StdioServerTransport } = await import("@modelcontextprotocol/server/stdio");
  const server = createQuickSendServer();
  process.stderr.write(
    `[quick-send] server ready v${VERSION}: panel/list/save/delete/reorder/copy/render -> ${RESOURCE_URI}\n`,
  );
  await server.connect(new StdioServerTransport());
}
