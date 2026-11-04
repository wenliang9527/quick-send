/** 构建后把 Rust exe 复制到插件运行位 server/bin/（plugin.json 指向这里）。 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "server-rs", "target", "release", "quick-send-server.exe");
const dstDir = join(here, "..", "server", "bin");
const dst = join(dstDir, "quick-send-server.exe");
mkdirSync(dstDir, { recursive: true });
copyFileSync(src, dst);
console.log(`[copy-server] ${src} -> ${dst}`);
