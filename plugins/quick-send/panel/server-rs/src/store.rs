//! 数据层：snippets.json 读写（store.mjs 的 Rust 移植，语义逐条对齐）。
//!
//! 纪律（design.md §6）：原子写（tmp → rename，Windows 上 std::fs::rename 带
//! MOVEFILE_REPLACE_EXISTING，保持替换原子）；损坏自愈（.bad 留证 + 空表启动）；
//! order 为段内相对序（置顶段全局一段，未置顶按分类分段）；上限 200/50/10KB/20。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_SNIPPETS: usize = 200;
pub const MAX_TITLE: usize = 50;
pub const MAX_BODY: usize = 10 * 1024;
pub const MAX_CATEGORY: usize = 20;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Snippet {
    #[serde(default = "gen_id")]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub order: i64,
    #[serde(default = "now_iso")]
    pub createdAt: String,
    #[serde(default = "now_iso")]
    pub updatedAt: String,
}

#[derive(Serialize, Deserialize)]
struct Data {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default = "now_iso")]
    updatedAt: String,
    #[serde(default)]
    snippets: Vec<Snippet>,
}

fn default_version() -> u32 {
    1
}

pub fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

fn gen_id() -> String {
    new_id()
}

pub fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!(
        "{}-{}-{:x}",
        now,
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn data_dir() -> PathBuf {
    // 与 JS 版一致：注入失败的特征是含 "${"，回退 ~/.zcode/quick-send
    match std::env::var("QUICK_SEND_DATA") {
        Ok(v) if !v.is_empty() && !v.contains("${") => PathBuf::from(v),
        _ => {
            let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
            PathBuf::from(home).join(".zcode").join("quick-send")
        }
    }
}

pub fn data_file() -> PathBuf {
    data_dir().join("snippets.json")
}

fn empty_data() -> Data {
    Data { version: 1, updatedAt: now_iso(), snippets: Vec::new() }
}

fn load() -> Data {
    let path = data_file();
    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => return empty_data(),
    };
    match serde_json::from_str::<Data>(&text) {
        Ok(d) => d,
        Err(_) => {
            // 损坏留证（覆盖旧 .bad），空表启动
            let bad = data_dir().join("snippets.json.bad");
            let _ = fs::remove_file(&bad);
            let _ = fs::rename(&path, &bad);
            empty_data()
        }
    }
}

fn persist(d: &Data) {
    let path = data_file();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_string_pretty(d).unwrap_or_default();
    if fs::write(&tmp, body).is_ok() {
        let _ = fs::rename(&tmp, &path); // Windows 下 rename 自带替换语义
    }
}

/// 展示序：置顶段在前，段内 order 升序、createdAt 字典序平手
pub fn sorted(mut snippets: Vec<Snippet>) -> Vec<Snippet> {
    snippets.sort_by(|a, b| {
        if a.pinned != b.pinned {
            return if a.pinned { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater };
        }
        a.order
            .cmp(&b.order)
            .then_with(|| a.createdAt.cmp(&b.createdAt))
    });
    snippets
}

pub fn list_snippets() -> Vec<Snippet> {
    sorted(load().snippets)
}

pub fn get_snippet(id: &str) -> Option<Snippet> {
    load().snippets.into_iter().find(|s| s.id == id)
}

/// 工具层错误： (code, message)，与 JS 版错误码一致
pub type StoreError = (&'static str, String);

pub fn save_snippet(input: &Value) -> Result<Vec<Snippet>, StoreError> {
    let mut data = load();
    let obj = input.as_object().ok_or(("validation", "参数必须是对象".into()))?;

    let title = obj.get("title").and_then(Value::as_str).unwrap_or("").trim().to_string();
    let body = obj.get("body").and_then(Value::as_str).unwrap_or("").to_string();
    let category = obj.get("category").and_then(Value::as_str).unwrap_or("").trim().to_string();
    let pinned = obj.get("pinned").and_then(Value::as_bool).unwrap_or(false);
    let id = obj.get("id").and_then(Value::as_str).unwrap_or("");

    if title.is_empty() {
        return Err(("validation", "标题不能为空".into()));
    }
    if body.trim().is_empty() {
        return Err(("validation", "内容不能为空".into()));
    }
    if title.chars().count() > MAX_TITLE {
        return Err(("validation", format!("标题超限（{}/{} 字）", title.chars().count(), MAX_TITLE)));
    }
    if body.len() > MAX_BODY {
        return Err(("validation", format!("内容超限（{}/{} 字节）", body.len(), MAX_BODY)));
    }
    if category.chars().count() > MAX_CATEGORY {
        return Err(("validation", format!("分类超限（{}/{} 字）", category.chars().count(), MAX_CATEGORY)));
    }

    let now = now_iso();
    if let Some(existing) = data.snippets.iter_mut().find(|s| !id.is_empty() && s.id == id) {
        existing.title = title;
        existing.body = body;
        existing.category = category;
        existing.pinned = pinned;
        existing.updatedAt = now;
    } else {
        if data.snippets.len() >= MAX_SNIPPETS {
            return Err(("validation", format!("已达上限（{} 条）", MAX_SNIPPETS)));
        }
        let max_order = data.snippets.iter().map(|s| s.order).max().unwrap_or(0);
        data.snippets.push(Snippet {
            id: new_id(),
            title,
            body,
            category,
            pinned,
            order: max_order + 1,
            createdAt: now.clone(),
            updatedAt: now,
        });
    }
    persist(&data);
    Ok(sorted(data.snippets))
}

pub fn delete_snippet(id: &str) -> Result<Vec<Snippet>, StoreError> {
    let mut data = load();
    let before = data.snippets.len();
    data.snippets.retain(|s| s.id != id);
    if data.snippets.len() == before {
        return Err(("not_found", "条目不存在".into()));
    }
    persist(&data);
    Ok(sorted(data.snippets))
}

fn segment_key(s: &Snippet) -> String {
    if s.pinned {
        "\u{0}pinned".to_string()
    } else {
        format!("cat:{}", s.category)
    }
}

pub fn reorder_snippet(id: &str, direction: &str) -> Result<Vec<Snippet>, StoreError> {
    let mut data = load();
    let seq = sorted(data.snippets.clone());
    let idx = match seq.iter().position(|s| s.id == id) {
        Some(i) => i,
        None => return Err(("not_found", "条目不存在".into())),
    };
    let step = if direction == "up" { -1i64 } else { 1i64 };
    let mut i = idx as i64 + step;
    // 跳过其它段，寻找同段邻居（与 JS 版语义一致：跨段边界 = 无操作）
    let key = segment_key(&seq[idx]);
    while i >= 0 && (i as usize) < seq.len() && segment_key(&seq[i as usize]) != key {
        i += step;
    }
    if !(i >= 0 && (i as usize) < seq.len()) {
        return Ok(sorted(data.snippets)); // 段边界
    }
    let neighbor_id = seq[i as usize].id.clone();
    let (cur_order, other_order) = {
        let cur = data.snippets.iter().find(|s| s.id == id).unwrap();
        let other = data.snippets.iter().find(|s| s.id == neighbor_id).unwrap();
        (cur.order, other.order)
    };
    let now = now_iso();
    for s in data.snippets.iter_mut() {
        if s.id == id {
            s.order = other_order;
            s.updatedAt = now.clone();
        } else if s.id == neighbor_id {
            s.order = cur_order;
            s.updatedAt = now.clone();
        }
    }
    persist(&data);
    Ok(sorted(data.snippets))
}

pub fn rename_category(from: &str, to: &str) -> Result<(usize, Vec<Snippet>), StoreError> {
    let mut data = load();
    let mut changed = 0usize;
    let now = now_iso();
    for s in data.snippets.iter_mut() {
        if s.category == from {
            s.category = to.to_string();
            s.updatedAt = now.clone();
            changed += 1;
        }
    }
    if changed > 0 {
        persist(&data);
    }
    Ok((changed, sorted(data.snippets)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    struct Guard(std::sync::MutexGuard<'static, ()>);
    impl Drop for Guard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(std::env::var("QUICK_SEND_DATA").unwrap_or_default());
        }
    }

    fn isolated() -> (Guard, PathBuf) {
        let guard = Guard(TEST_LOCK.lock().unwrap());
        let dir = std::env::temp_dir().join(format!("qs-rs-test-{}", new_id()));
        fs::create_dir_all(&dir).unwrap();
        std::env::set_var("QUICK_SEND_DATA", &dir);
        (guard, dir)
    }

    #[test]
    fn crud_roundtrip_and_atomic_write() {
        let (_g, dir) = isolated();
        let r = save_snippet(&json!({"title":"T1","body":"B1"})).unwrap();
        assert_eq!(r.len(), 1);
        let id = r[0].id.clone();
        assert!(get_snippet(&id).is_some());
        assert!(delete_snippet(&id).is_ok());
        assert_eq!(list_snippets().len(), 0);
        assert!(!dir.join("snippets.json.tmp").exists()); // 无 .tmp 残留
    }

    #[test]
    fn corruption_self_heals_with_bad_backup() {
        let (_g, dir) = isolated();
        save_snippet(&json!({"title":"T","body":"B"})).unwrap();
        drop(fs::write(dir.join("snippets.json"), "{broken"));
        assert_eq!(list_snippets().len(), 0);
        assert!(dir.join("snippets.json.bad").exists());
    }

    #[test]
    fn validation_limits() {
        let (_g, dir) = isolated();
        assert!(save_snippet(&json!({"title":"  ","body":"b"})).is_err());
        assert!(save_snippet(&json!({"title":"t","body":"  "})).is_err());
        assert!(save_snippet(&json!({"title":"x".repeat(51),"body":"b"})).is_err());
        assert!(save_snippet(&json!({"title":"t","body":"b","category":"x".repeat(21)})).is_err());
    }

    #[test]
    fn reorder_isolated_within_category_segment() {
        let (_g, dir) = isolated();
        let a = save_snippet(&json!({"title":"a","body":"b","category":"X"})).unwrap();
        let a2 = save_snippet(&json!({"title":"a2","body":"b","category":"X"})).unwrap();
        save_snippet(&json!({"title":"y","body":"b","category":"Y"})).unwrap();
        let a2_id = a2[1].id.clone();
        let a_id = a[0].id.clone();
        let r = reorder_snippet(&a2_id, "up").unwrap();
        let seg: Vec<&str> = r.iter().filter(|s| s.category == "X").map(|s| s.title.as_str()).collect();
        assert_eq!(seg, vec!["a2", "a"]);
        assert!(r.iter().any(|s| s.id == a_id));
    }

    #[test]
    fn rename_category_batch() {
        let (_g, dir) = isolated();
        save_snippet(&json!({"title":"a","body":"b","category":"旧"}));
        save_snippet(&json!({"title":"c","body":"d","category":"旧"}));
        save_snippet(&json!({"title":"e","body":"f","category":"新"}));
        let (changed, list) = rename_category("旧", "改").unwrap();
        assert_eq!(changed, 2);
        assert_eq!(list.iter().filter(|s| s.category == "改").count(), 2);
    }
}
