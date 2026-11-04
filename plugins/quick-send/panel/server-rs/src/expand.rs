//! 占位符展开（expand.mjs 的 Rust 移植）。
//!
//! 语法：{{name}}（允许两侧空白）。解析顺序：vars > 内建；未知原样保留。
//! 内建：date / time / datetime / workspace / clipboard；
//! clipboard 慢（~300ms），同一次展开内只读一次。

use crate::clipboard::read_clipboard;
use serde_json::{Map, Value};
use std::path::Path;

pub fn workspace_name() -> String {
    std::env::current_dir()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_default()
}

fn is_ident(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// 剪贴板读取失败返回 Err（由工具层转 clipboard_failed 错误）
pub fn expand(text: &str, vars: &Map<String, Value>) -> Result<String, String> {
    let now = chrono::Local::now();
    let date = now.format("%Y-%m-%d").to_string();
    let time = now.format("%H:%M").to_string();

    let mut clip_cache: Option<String> = None;
    let mut resolve = |name: &str| -> Result<String, String> {
        if let Some(v) = vars.get(name) {
            return Ok(match v {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            });
        }
        match name {
            "date" => Ok(date.clone()),
            "time" => Ok(time.clone()),
            "datetime" => Ok(format!("{} {}", date, time)),
            "workspace" => Ok(workspace_name()),
            "clipboard" => {
                // 与 JS 版一致：空剪贴板/读取失败都展开为空串,不报错
                if clip_cache.is_none() {
                    clip_cache = Some(read_clipboard());
                }
                Ok(clip_cache.as_ref().unwrap().clone())
            }
            _ => Err(String::new()), // 未知：空标记 → 原样保留
        }
    };

    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find("}}") {
            None => {
                // 没有配对的 }},剩余部分原样
                out.push_str(&rest[start..]);
                rest = "";
                break;
            }
            Some(end) => {
                let name_raw = &after[..end];
                let name = name_raw.trim();
                let token_len = 2 + end + 2;
                if is_ident(name) {
                    match resolve(name) {
                        Ok(v) => out.push_str(&v),
                        Err(e) if e.is_empty() => out.push_str(&rest[start..start + token_len]), // 未知保留
                        Err(e) => return Err(e),
                    }
                } else {
                    out.push_str(&rest[start..start + token_len]); // 非标识符形态保留
                }
                rest = &rest[start + token_len..];
            }
        }
    }
    out.push_str(rest);
    Ok(out)
}

/// 供单元测试使用的纯文本截断（对齐 JS slice 的展示语义,按字符取）
pub fn preview(text: &str, chars: usize) -> String {
    text.chars().take(chars).collect()
}

#[allow(dead_code)]
pub fn _path_hint(p: &Path) -> String {
    p.display().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn vars(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn plain_text_unchanged() {
        assert_eq!(expand("普通文本,无占位符", &Map::new()).unwrap(), "普通文本,无占位符");
    }

    #[test]
    fn date_time_formats() {
        assert!(expand("{{date}}", &Map::new()).unwrap().chars().all(|c| c.is_ascii_digit() || c == '-'));
        let d = expand("{{date}}", &Map::new()).unwrap();
        assert_eq!(d.len(), 10); // YYYY-MM-DD
        let t = expand("{{time}}", &Map::new()).unwrap();
        assert_eq!(t.len(), 5); // HH:MM
        assert!(expand("{{datetime}}", &Map::new()).unwrap().contains(' '));
    }

    #[test]
    fn spaces_tolerated() {
        assert_eq!(expand("{{ date }}", &Map::new()).unwrap().len(), 10);
    }

    #[test]
    fn unknown_kept_verbatim() {
        assert_eq!(expand("u={{nope}} v={{ver_1}}", &Map::new()).unwrap(), "u={{nope}} v={{ver_1}}");
    }

    #[test]
    fn vars_override_builtins() {
        assert_eq!(expand("{{date}}", &vars(json!({"date": "自定义日"}))).unwrap(), "自定义日");
    }

    #[test]
    fn same_placeholder_all_replaced() {
        assert_eq!(expand("{{x}}-{{x}}", &vars(json!({"x": "A"}))).unwrap(), "A-A");
    }

    #[test]
    fn dollar_sequences_safe() {
        // Rust 版按扫描构建输出,替换值中的 $ 无特殊含义
        assert_eq!(expand("c={{v}}", &vars(json!({"v": "$&$`$'"}))).unwrap(), "c=$&$`$'");
    }

    #[test]
    fn non_ident_braces_kept() {
        assert_eq!(expand("a{{ x y }}b", &Map::new()).unwrap(), "a{{ x y }}b");
        assert_eq!(expand("a{{1d}}b", &Map::new()).unwrap(), "a{{1d}}b");
    }

    #[test]
    fn unbalanced_brace_kept() {
        assert_eq!(expand("a {{ never", &Map::new()).unwrap(), "a {{ never");
    }
}
