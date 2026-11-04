//! 工具协议层：tools/list 清单（形状与 SDK 版捕获输出逐字段一致）+ tools/call 分发。

use crate::clipboard::set_clipboard;
use crate::expand::{expand, preview};
use crate::store;
use serde_json::{json, Map, Value};

pub const RESOURCE_URI: &str = "ui://quick-send/panel.html";
pub const SURFACE_ID: &str = "quick-send";
pub const VERSION: &str = "0.5.6";
const PREVIEW_CHARS: usize = 80;

fn schema_empty() -> Value {
    json!({
        "type": "object",
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "properties": {}
    })
}

fn meta_app() -> Value {
    json!({
        "ui": { "resourceUri": RESOURCE_URI, "visibility": ["app"] },
        "ui/resourceUri": RESOURCE_URI
    })
}

pub fn tools_list() -> Value {
    let tools = vec![
        json!({
            "name": "panel",
            "title": "快捷发送面板",
            "description": "打开快捷发送面板（侧栏）：常用语管理，一键复制到剪贴板或发送。",
            "inputSchema": schema_empty(),
            "_meta": {
                "ui": { "resourceUri": RESOURCE_URI, "surface": SURFACE_ID },
                "openai/ui": { "preferredModelDisplayMode": "fullscreen" },
                "ui/resourceUri": RESOURCE_URI
            }
        }),
        json!({
            "name": "list_snippets",
            "title": "list_snippets",
            "description": "常用语全量列表（查重/检索用；流程纪律：bulk_add_snippets 前先调本工具查重）",
            "inputSchema": schema_empty()
        }),
        json!({
            "name": "save_snippet",
            "title": "save_snippet",
            "description": "[面板专用] 新建/更新常用语（有 id 即更新），返回最新全量",
            "inputSchema": {
                "type": "object",
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "properties": {
                    "snippet": {
                        "type": "object",
                        "properties": {
                            "id": { "type": "string" },
                            "title": { "type": "string" },
                            "body": { "type": "string" },
                            "category": { "type": "string" },
                            "pinned": { "type": "boolean" }
                        },
                        "required": ["title", "body"]
                    }
                },
                "required": ["snippet"]
            },
            "_meta": meta_app()
        }),
        json!({
            "name": "delete_snippet",
            "title": "delete_snippet",
            "description": "[面板专用] 删除常用语，返回最新全量",
            "inputSchema": {
                "type": "object",
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "properties": { "id": { "type": "string", "minLength": 1 } },
                "required": ["id"]
            },
            "_meta": meta_app()
        }),
        json!({
            "name": "reorder_snippet",
            "title": "reorder_snippet",
            "description": "[面板专用] 组内上移/下移，返回最新全量",
            "inputSchema": {
                "type": "object",
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "properties": {
                    "id": { "type": "string", "minLength": 1 },
                    "direction": { "type": "string", "enum": ["up", "down"] }
                },
                "required": ["id", "direction"]
            },
            "_meta": meta_app()
        }),
        json!({
            "name": "rename_category",
            "title": "rename_category",
            "description": "[面板专用] 批量改分类（to 空串 = 移到未分类）",
            "inputSchema": {
                "type": "object",
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "properties": {
                    "from": { "type": "string" },
                    "to": { "type": "string", "maxLength": 20 }
                },
                "required": ["from", "to"]
            },
            "_meta": meta_app()
        }),
        json!({
            "name": "bulk_add_snippets",
            "title": "批量新增常用语",
            "description": "批量新增常用语（agent 整理场景，一次调用写多条）。流程纪律：先 list_snippets 查重 → 拟草稿并经用户确认 → 再调用本工具。phrases 每项 {title(必填), body(必填,可直接整句发送), category(可选)}；逐条校验（非空、上限 120/20000/20 字符、总量护栏 2000），与现有条目完全重复的自动跳过；整批一次原子写入，返回 added/skippedDuplicates/failed 与更新后全量列表。",
            "inputSchema": {
                "type": "object",
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "properties": {
                    "phrases": {
                        "type": "array",
                        "description": "待新增的常用语数组",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": { "type": "string", "description": "标题（动宾短语，≤120 字）" },
                                "body": { "type": "string", "description": "正文（可直接发送的完整指令；可用 {{date}}/{{time}}/{{datetime}}/{{workspace}} 占位符，{{clipboard}} 仅 ZCode 侧展开）" },
                                "category": { "type": "string", "description": "分类（可选，≤20 字，优先归入现有分类）" }
                            },
                            "required": ["title", "body"]
                        }
                    }
                },
                "required": ["phrases"]
            }
        }),
        json!({
            "name": "copy_snippet",
            "title": "copy_snippet",
            "description": "[面板专用] 展开常用语占位符并写入系统剪贴板",
            "inputSchema": {
                "type": "object",
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "properties": { "id": { "type": "string", "minLength": 1 } },
                "required": ["id"]
            },
            "_meta": meta_app()
        }),
        json!({
            "name": "render_snippet",
            "title": "render_snippet",
            "description": "按 id 取展开占位符后的文本（发送路径/agent 直取均可；面板发送按钮也走这里）",
            "inputSchema": {
                "type": "object",
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "properties": { "id": { "type": "string", "minLength": 1 } },
                "required": ["id"]
            }
        }),
    ];
    json!({ "tools": tools })
}

fn snippets_value(list: &[store::Snippet]) -> Value {
    serde_json::to_value(list).unwrap_or(Value::Null)
}

/// tools/call 的结果：(text 载荷, isError)
fn call_impl(name: &str, params: &Value) -> Result<(String, bool), (String, String)> {
    let obj = params.as_object().cloned().unwrap_or_else(Map::new);
    match name {
        "panel" => Ok((
            "快捷发送面板已打开（侧栏）。".to_string(),
            false,
        )),
        "list_snippets" => Ok((
            serde_json::to_string(&json!({ "snippets": snippets_value(&store::list_snippets()) })).unwrap(),
            false,
        )),
        "save_snippet" => {
            let snippet = obj.get("snippet").cloned().unwrap_or(Value::Null);
            store::save_snippet(&snippet)
                .map(|list| (serde_json::to_string(&json!({ "snippets": snippets_value(&list) })).unwrap(), false))
                .map_err(|(code, msg)| (code.to_string(), msg))
        }
        "bulk_add_snippets" => {
            store::bulk_add_snippets(&Value::Object(obj))
                .map(|report| (serde_json::to_string(&report).unwrap(), false))
                .map_err(|(code, msg)| (code.to_string(), msg))
        }
        "delete_snippet" => {
            let id = obj.get("id").and_then(Value::as_str).unwrap_or("");
            store::delete_snippet(id)
                .map(|list| (serde_json::to_string(&json!({ "snippets": snippets_value(&list) })).unwrap(), false))
                .map_err(|(code, msg)| (code.to_string(), msg))
        }
        "reorder_snippet" => {
            let id = obj.get("id").and_then(Value::as_str).unwrap_or("");
            let dir = obj.get("direction").and_then(Value::as_str).unwrap_or("");
            store::reorder_snippet(id, dir)
                .map(|list| (serde_json::to_string(&json!({ "snippets": snippets_value(&list) })).unwrap(), false))
                .map_err(|(code, msg)| (code.to_string(), msg))
        }
        "rename_category" => {
            let from = obj.get("from").and_then(Value::as_str).unwrap_or("").trim().to_string();
            let to = obj.get("to").and_then(Value::as_str).unwrap_or("").trim().to_string();
            store::rename_category(&from, &to)
                .map(|(changed, list)| {
                    (
                        serde_json::to_string(&json!({ "changed": changed, "snippets": snippets_value(&list) })).unwrap(),
                        false,
                    )
                })
                .map_err(|(code, msg)| (code.to_string(), msg))
        }
        "copy_snippet" => {
            let id = obj.get("id").and_then(Value::as_str).unwrap_or("");
            let snip = store::get_snippet(id).ok_or(("not_found".to_string(), "条目不存在".to_string()))?;
            let text = expand(&snip.body, &Map::new()).map_err(|e| ("clipboard_failed".to_string(), e))?;
            set_clipboard(&text).map_err(|e| ("clipboard_failed".to_string(), e))?;
            Ok((
                serde_json::to_string(&json!({ "ok": true, "preview": preview(&text, PREVIEW_CHARS) })).unwrap(),
                false,
            ))
        }
        "render_snippet" => {
            let id = obj.get("id").and_then(Value::as_str).unwrap_or("");
            let snip = store::get_snippet(id).ok_or(("not_found".to_string(), "条目不存在".to_string()))?;
            let text = expand(&snip.body, &Map::new()).map_err(|e| ("clipboard_failed".to_string(), e))?;
            Ok((
                serde_json::to_string(&json!({ "title": snip.title, "text": text })).unwrap(),
                false,
            ))
        }
        _ => Err(("unknown_tool".to_string(), format!("没有工具 {name}"))),
    }
}

/// 面向 JSON-RPC 的封装：成功 → result；工具级错误 → isError:true + error JSON 载荷
pub fn call(name: &str, params: &Value) -> Value {
    match call_impl(name, params) {
        Ok((text, is_error)) => json!({
            "content": [{ "type": "text", "text": text }],
            "isError": is_error
        }),
        Err((code, message)) => json!({
            "content": [{ "type": "text", "text": serde_json::to_string(&json!({"error": {"code": code, "message": message}})).unwrap_or_default() }],
            "isError": true
        }),
    }
}
