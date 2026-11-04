/**
 * 系统剪贴板写入（Windows PowerShell）。
 * 实测纪律（M0 spike）：`powershell -Command -` 会把 stdin 逐行当命令执行，不能走 stdin；
 * 采用临时文件 + EncodedCommand：文本写 UTF-8 临时文件，脚本只带路径（单引号转义），
 * 无命令行长度限制、中文零转义问题。实测延迟约 330-420ms。
 */
import { spawn } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLIP_TIMEOUT_MS = 15_000;

export function setClipboard(text) {
  return new Promise((resolve) => {
    const tmp = join(tmpdir(), `quick-send-${Date.now()}-${Math.random().toString(36).slice(2)}.clip`);
    const psq = (s) => `'${s.replace(/'/g, "''")}'`;
    let script;
    try {
      writeFileSync(tmp, text, "utf8");
      script =
        `$t = [System.IO.File]::ReadAllText(${psq(tmp)}, [System.Text.Encoding]::UTF8); ` +
        `Set-Clipboard -Value $t; ` +
        `$ok = $?; ` +
        `Remove-Item -LiteralPath ${psq(tmp)} -ErrorAction SilentlyContinue; ` +
        `if ($ok) { exit 0 } else { exit 1 }`;
    } catch (e) {
      resolve({ ok: false, error: `临时文件写入失败: ${e?.message ?? e}` });
      return;
    }
    const enc = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", enc], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      child.kill();
      rmSync(tmp, { force: true });
      resolve({ ok: false, error: "剪贴板写入超时（15s）" });
    }, CLIP_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      rmSync(tmp, { force: true });
      if (code === 0) resolve({ ok: true, bytes: Buffer.byteLength(text, "utf8") });
      else resolve({ ok: false, error: `powershell exit ${code}: ${stderr.slice(0, 300)}` });
    });
  });
}

/** 读系统剪贴板（{{clipboard}} 占位符用）。base64 回传规避控制台 GBK 乱码；失败返回空串。 */
export function readClipboard() {
  return new Promise((resolve) => {
    const script =
      "$t = Get-Clipboard -Raw; " +
      "[Console]::Out.Write([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($t)))";
    const enc = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", enc], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    const timer = setTimeout(() => {
      child.kill();
      resolve("");
    }, CLIP_TIMEOUT_MS);
    child.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(Buffer.from(out.trim(), "base64").toString("utf8"));
      } catch {
        resolve("");
      }
    });
  });
}
