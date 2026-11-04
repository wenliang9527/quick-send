//! Quick-Send MCP App 后端（Rust 原生版）。
//!
//! stdio 上的换行分隔 JSON-RPC（与 MCP SDK 线格式一致,冒烟测试即按此驱动）。
//! 单线程阻塞循环：本插件的工具都是毫秒级,顺序处理足够。
//! 协议应答形状照抄 Node SDK 版的实测捕获（tools.rs 注释）。

mod clipboard;
mod expand;
mod store;
mod tools;

use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::PathBuf;

const MAX_PANEL_BYTES: usize = 4 * 1024 * 1024;

fn eprint_log(msg: &str) {
    let _ = writeln!(std::io::stderr(), "[quick-send] {msg}");
}

/// dist/panel.html 候选：exe 在 server/bin/（安装布局）或 server-rs/target/release/（开发布局）
fn panel_html_candidates() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.to_path_buf());
            if let Some(parent) = dir.parent() {
                dirs.push(parent.to_path_buf());
                if let Some(grand) = parent.parent() {
                    dirs.push(grand.to_path_buf());
                }
            }
        }
    }
    let mut out = Vec::new();
    for d in dirs {
        out.push(d.join("dist").join("panel.html"));
    }
    out
}

fn load_panel_html() -> String {
    for p in panel_html_candidates() {
        if let Ok(html) = std::fs::read_to_string(&p) {
            if html.len() > MAX_PANEL_BYTES {
                return "<!doctype html><meta charset=\"utf-8\"><body style=\"font-family:sans-serif;padding:16px\">面板资源超过 4 MiB 上限（构建产物异常），请重新构建。</body>".into();
            }
            return html;
        }
    }
    "<!doctype html><meta charset=\"utf-8\"><body style=\"font-family:sans-serif;padding:16px\">面板资源缺失：未找到 dist/panel.html，请先构建。</body>".into()
}

fn initialize_result(params: &Value) -> Value {
    let protocol = params
        .get("protocolVersion")
        .and_then(Value::as_str)
        .unwrap_or("2025-06-18")
        .to_string();
    json!({
        "protocolVersion": protocol,
        "capabilities": {
            "resources": { "listChanged": true },
            "tools": { "listChanged": true }
        },
        "serverInfo": { "name": "quick-send", "version": tools::VERSION }
    })
}

fn resources_list() -> Value {
    json!({
        "resources": [{
            "uri": tools::RESOURCE_URI,
            "name": "快捷发送面板",
            "mimeType": "text/html"
        }]
    })
}

fn resources_read(params: &Value) -> Value {
    let uri = params.get("uri").and_then(Value::as_str).unwrap_or("");
    if uri != tools::RESOURCE_URI {
        return json!({
            "content": [],
            "isError": true
        });
    }
    json!({
        "contents": [{
            "uri": tools::RESOURCE_URI,
            "mimeType": "text/html",
            "text": load_panel_html()
        }]
    })
}

/// 返回 Err(code,message) 表示 JSON-RPC 协议级错误（-32601 等）
fn dispatch(method: &str, params: &Value) -> Result<Value, (i64, String)> {
    match method {
        "initialize" => Ok(initialize_result(params)),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(tools::tools_list()),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            Ok(tools::call(name, &args))
        }
        "resources/list" => Ok(resources_list()),
        "resources/read" => Ok(resources_read(params)),
        "resources/templates/list" => Ok(json!({ "resourceTemplates": [] })),
        "resources/subscribe" | "resources/unsubscribe" => Ok(json!({})),
        "completion/complete" => Err((-32601, format!("Method not found: {method}"))),
        "logging/setLevel" => Ok(json!({})),
        _ => Err((-32601, format!("Method not found: {method}"))),
    }
}

fn main() {
    let stdin = std::io::stdin();
    let mut reader = stdin.lock();
    let mut stdout = std::io::stdout();
    let mut line = String::new();

    eprint_log(&format!(
        "rust server ready v{}: panel/list/save/delete/reorder/rename/copy/render -> {}",
        tools::VERSION,
        tools::RESOURCE_URI
    ));

    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break, // EOF：宿主关闭
            Ok(_) => {}
            Err(_) => break,
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let msg: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue, // 非 JSON 行忽略
        };
        let Some(id) = msg.get("id").cloned() else {
            continue; // 通知：initialized/cancelled 等一律静默
        };
        let method = msg.get("method").and_then(Value::as_str).unwrap_or("").to_string();
        let params = msg.get("params").cloned().unwrap_or(Value::Null);

        let response = match dispatch(&method, &params) {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err((code, message)) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }),
        };
        if writeln!(stdout, "{response}").is_err() {
            break;
        }
        let _ = stdout.flush();
    }
}
