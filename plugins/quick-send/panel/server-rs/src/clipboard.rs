//! 系统剪贴板（clipboard.mjs 的 Rust 移植）。
//!
//! 实测纪律（M0 spike）：`powershell -Command -` 会把 stdin 逐行当命令执行；
//! 写 = 临时文件 + EncodedCommand（脚本只带路径，单引号转义）；
//! 读 = Get-Clipboard 输出 base64，规避控制台 GBK 乱码。

use base64::Engine;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn encoded(script: &str) -> String {
    let utf16: Vec<u8> = script
        .encode_utf16()
        .flat_map(|u| u.to_le_bytes())
        .collect();
    base64::engine::general_purpose::STANDARD.encode(utf16)
}

fn psq(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

fn temp_clip_path() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("quick-send-{}-{}.clip", nanos, std::process::id()))
}

pub fn set_clipboard(text: &str) -> Result<(), String> {
    let tmp = temp_clip_path();
    fs::write(&tmp, text).map_err(|e| format!("临时文件写入失败: {e}"))?;
    let script = format!(
        "$t = [System.IO.File]::ReadAllText({}, [System.Text.Encoding]::UTF8); \
         Set-Clipboard -Value $t; \
         $ok = $?; \
         Remove-Item -LiteralPath {} -ErrorAction SilentlyContinue; \
         if ($ok) {{ exit 0 }} else {{ exit 1 }}",
        psq(&tmp.to_string_lossy()),
        psq(&tmp.to_string_lossy())
    );
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &encoded(&script)])
        .output()
        .map_err(|e| format!("powershell 启动失败: {e}"));
    let _ = fs::remove_file(&tmp); // PS 侧也会删,双保险
    match output {
        Ok(o) if o.status.success() => Ok(()),
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            Err(format!("powershell exit {:?}: {}", o.status.code(), stderr.chars().take(300).collect::<String>()))
        }
        Err(e) => Err(e),
    }
}

/// 读剪贴板；任何失败返回空串（与 JS 版一致,{{clipboard}} 展开为空由上层决定语义）
pub fn read_clipboard() -> String {
    let script = "$t = Get-Clipboard -Raw; \
                  [Console]::Out.Write([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($t)))";
    let Ok(output) = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &encoded(script)])
        .output()
    else {
        return String::new();
    };
    if !output.status.success() {
        return String::new();
    }
    let b64 = String::from_utf8_lossy(&output.stdout).trim().to_string();
    base64::engine::general_purpose::STANDARD
        .decode(b64.as_bytes())
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default()
}
