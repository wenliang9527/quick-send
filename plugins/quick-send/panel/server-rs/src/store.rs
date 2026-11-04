//! 数据层 v2（共享架构,shared-phrases/docs/CONTRACT.md）。
//!
//! 分层:内容 = 共享 phrases.json（严格六字段 + schemaVersion,DSH/ZCode 双向写）;
//! 视图 = 本地 view.json（pinned/order,仅本侧）。对外仍暴露 Snippet（body 字段名
//! 不变,工具协议与面板零变化）。旧 snippets.json 启动时一次性**合并**迁移
//! （.migrated 留证不删;共享文件已有同 id 条目时以共享侧为准）。
//!
//! 写入纪律（契约 §写入纪律）:全量读改写 + tmp→rename 原子替换 + 损坏 .bad 自愈;
//! schemaVersion 不认识 → 读空表 + **拒绝写入**。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// 上限口径对齐 DSH 侧（HANDOFF-DSH §5：120/20000/20 **字符**）。DSH 超限截断、本侧超限拒绝——
/// 共同上界一致，任一侧存下的数据另一侧都能原样读/改，不会出现"存得进、改不动"。
/// 条数契约无上限（DSH 无护栏）；2000 = 本侧防失控护栏，超出仅拒新增。
pub const MAX_SNIPPETS: usize = 2000;
pub const MAX_TITLE: usize = 120;
pub const MAX_TEXT: usize = 20000;
pub const MAX_CATEGORY: usize = 20;

/// 共享侧条目:严格六字段,序列化永远全部输出（DSH 侧测试会校验齐全）
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Phrase {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub category: String,
    #[serde(default = "now_iso")]
    pub createdAt: String,
    #[serde(default = "now_iso")]
    pub updatedAt: String,
}

#[derive(Serialize, Deserialize)]
struct SharedFile {
    schemaVersion: u32,
    phrases: Vec<Phrase>,
}

/// 本地视图:{ id: {pinned, order} };共享侧已删的孤儿条目忽略不清理（契约）
#[derive(Clone, Serialize, Deserialize)]
struct ViewEntry {
    #[serde(default)]
    pinned: bool,
    #[serde(default)]
    order: i64,
}
type View = BTreeMap<String, ViewEntry>;

/// 对外形状（工具协议,字段名与 v0.2 起完全一致;body = 共享侧 text）
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
    match std::env::var("QUICK_SEND_DATA") {
        Ok(v) if !v.is_empty() && !v.contains("${") => PathBuf::from(v),
        _ => {
            let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
            PathBuf::from(home).join(".zcode").join("quick-send")
        }
    }
}

/// 共享内容源路径:env QUICK_SEND_PHRASES（plugin.json userConfig 注入,替换失败特征含 "${"）
fn phrases_path() -> PathBuf {
    match std::env::var("QUICK_SEND_PHRASES") {
        Ok(v) if !v.is_empty() && !v.contains("${") => PathBuf::from(v),
        _ => PathBuf::from(r"D:\WORK_VSCODE\Vibe-coding\shared-phrases\phrases.json"),
    }
}

fn view_path() -> PathBuf {
    data_dir().join("view.json")
}

fn legacy_path() -> PathBuf {
    data_dir().join("snippets.json")
}

// ── 共享层 ──

enum SharedLoad {
    Ok(SharedFile),
    /// schemaVersion 不认识:读按空表,写必须拒绝
    Unsupported,
    /// 不存在或损坏自愈后:读空表,写可新建
    Absent,
}

fn load_shared() -> SharedLoad {
    let path = phrases_path();
    let text = match read_text_bom(&path) {
        Ok(t) => t,
        Err(_) => return SharedLoad::Absent,
    };
    // 先按任意 JSON 解：解析失败才是真损坏（隔离留证）；
    // 能解析但 schemaVersion 缺失/不认识 = 格式不认识 → 读空表 + 拒写，文件原样不动（不隔离）。
    let root: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => {
            quarantine(&path);
            return SharedLoad::Absent;
        }
    };
    if root.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return SharedLoad::Unsupported;
    }
    let Some(arr) = root.get("phrases").and_then(Value::as_array) else {
        return SharedLoad::Unsupported; // 形状不对：同样只拒读写,不破坏文件
    };
    // 逐条规范化（对齐 DSH normalizePhrase）:缺 id/text 的跳过、未知字段丢弃、
    // 重复 id 保留首条、时间戳非字符串回退当前时间（防排序错乱）。
    let mut seen = std::collections::HashSet::new();
    let mut phrases = Vec::new();
    for item in arr {
        let Some(obj) = item.as_object() else { continue };
        let id = match obj.get("id").and_then(Value::as_str) {
            Some(s) if !s.is_empty() => s,
            _ => continue,
        };
        let text = match obj.get("text").and_then(Value::as_str) {
            Some(s) => s,
            None => continue, // 缺 text 整条跳过（DSH 同款）
        };
        if !seen.insert(id.to_string()) {
            continue;
        }
        phrases.push(Phrase {
            id: id.to_string(),
            title: obj.get("title").and_then(Value::as_str).unwrap_or("").to_string(),
            text: text.to_string(),
            category: obj.get("category").and_then(Value::as_str).unwrap_or("").to_string(),
            createdAt: str_or_now(obj.get("createdAt")),
            updatedAt: str_or_now(obj.get("updatedAt")),
        });
    }
    SharedLoad::Ok(SharedFile { schemaVersion: 1, phrases })
}

/// 读文本并剥 UTF-8 BOM（DSH 侧容忍 BOM,契约外编辑器也可能写出带 BOM 的文件）
fn read_text_bom(path: &PathBuf) -> std::io::Result<String> {
    let text = fs::read_to_string(path)?;
    Ok(text.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(text))
}

/// 时间戳字段:非字符串或空串 → 当前时间（DSH isStr 校验失败同款回退）
fn str_or_now(v: Option<&Value>) -> String {
    match v.and_then(Value::as_str) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => now_iso(),
    }
}

/// 坏文件隔离留证:<原名>.bad-<时间戳>,多次损坏证据不互相覆盖（对齐 DSH）
fn quarantine(path: &PathBuf) {
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S%3f");
    let _ = fs::rename(path, path.with_extension(format!("json.bad-{ts}")));
}

fn save_shared(file: &SharedFile) -> Result<(), String> {
    let path = phrases_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    fs::write(&tmp, body).map_err(|e| format!("共享文件写入失败: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("共享文件替换失败: {e}"))
}

fn empty_shared() -> SharedFile {
    SharedFile { schemaVersion: 1, phrases: Vec::new() }
}

// ── 视图层 ──

fn load_view() -> View {
    let path = view_path();
    let text = match read_text_bom(&path) {
        Ok(t) => t,
        Err(_) => return View::new(),
    };
    match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => {
            quarantine(&path);
            View::new()
        }
    }
}

fn save_view(view: &View) {
    let path = view_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let tmp = path.with_extension("json.tmp");
    if let Ok(body) = serde_json::to_string_pretty(view) {
        if fs::write(&tmp, body).is_ok() {
            let _ = fs::rename(&tmp, &path);
        }
    }
}

// ── 合成（内容 + 视图 → 对外 Snippet）──

/// 无 view 条目的确定性虚拟序:全局最大已落盘 order 之后,按 (createdAt, id) 依次 +1。
/// 纯展示层分配不落盘;该条一旦被本侧 save/reorder 触碰即在 view 中固化。
fn synth(phrases: &[Phrase], view: &View) -> Vec<Snippet> {
    let max_concrete = view.values().map(|v| v.order).max().unwrap_or(0);
    let mut missing: Vec<&Phrase> = phrases.iter().filter(|p| !view.contains_key(&p.id)).collect();
    missing.sort_by(|a, b| a.createdAt.cmp(&b.createdAt).then_with(|| a.id.cmp(&b.id)));
    let mut virtual_orders: BTreeMap<&str, i64> = BTreeMap::new();
    for (rank, p) in missing.iter().enumerate() {
        virtual_orders.insert(p.id.as_str(), max_concrete + 1 + rank as i64);
    }

    let mut out: Vec<Snippet> = phrases
        .iter()
        .map(|p| {
            let (pinned, order) = match view.get(&p.id) {
                Some(v) => (v.pinned, v.order),
                None => (false, virtual_orders.get(p.id.as_str()).copied().unwrap_or(0)),
            };
            Snippet {
                id: p.id.clone(),
                title: p.title.clone(),
                body: p.text.clone(),
                category: p.category.clone(),
                pinned,
                order,
                createdAt: p.createdAt.clone(),
                updatedAt: p.updatedAt.clone(),
            }
        })
        .collect();
    sorted(&mut out);
    out
}

fn sorted(list: &mut [Snippet]) {
    list.sort_by(|a, b| {
        if a.pinned != b.pinned {
            return if a.pinned { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater };
        }
        a.order.cmp(&b.order).then_with(|| a.createdAt.cmp(&b.createdAt))
    });
}

// ── 对外操作 ──

pub type StoreError = (&'static str, String);

fn shared_or_err() -> Result<SharedFile, StoreError> {
    match load_shared() {
        SharedLoad::Ok(f) => Ok(f),
        SharedLoad::Unsupported => Err(("validation", "共享文件 schemaVersion 不受支持，拒绝写入".into())),
        SharedLoad::Absent => Ok(empty_shared()),
    }
}

pub fn list_snippets() -> Vec<Snippet> {
    match load_shared() {
        SharedLoad::Ok(f) => synth(&f.phrases, &load_view()),
        _ => Vec::new(),
    }
}

pub fn get_snippet(id: &str) -> Option<Snippet> {
    list_snippets().into_iter().find(|s| s.id == id)
}

pub fn save_snippet(input: &Value) -> Result<Vec<Snippet>, StoreError> {
    let mut shared = shared_or_err()?;
    let obj = input.as_object().ok_or(("validation", "参数必须是对象".into()))?;

    let title = obj.get("title").and_then(Value::as_str).unwrap_or("").trim().to_string();
    let text = obj.get("body").and_then(Value::as_str).unwrap_or("").to_string();
    let category = obj.get("category").and_then(Value::as_str).unwrap_or("").trim().to_string();
    let pinned = obj.get("pinned").and_then(Value::as_bool).unwrap_or(false);
    let id = obj.get("id").and_then(Value::as_str).unwrap_or("");

    if title.is_empty() {
        return Err(("validation", "标题不能为空".into()));
    }
    if text.trim().is_empty() {
        return Err(("validation", "内容不能为空".into()));
    }
    if title.chars().count() > MAX_TITLE {
        return Err(("validation", format!("标题超限（{}/{} 字）", title.chars().count(), MAX_TITLE)));
    }
    if text.chars().count() > MAX_TEXT {
        return Err(("validation", format!("内容超限（{}/{} 字）", text.chars().count(), MAX_TEXT)));
    }
    if category.chars().count() > MAX_CATEGORY {
        return Err(("validation", format!("分类超限（{}/{} 字）", category.chars().count(), MAX_CATEGORY)));
    }

    let now = now_iso();
    let mut view = load_view();
    let target_id: String;

    if let Some(existing) = shared.phrases.iter_mut().find(|p| !id.is_empty() && p.id == id) {
        existing.title = title;
        existing.text = text;
        existing.category = category;
        existing.updatedAt = now;
        target_id = existing.id.clone();
    } else {
        if shared.phrases.len() >= MAX_SNIPPETS {
            return Err(("validation", format!("已达上限（{} 条）", MAX_SNIPPETS)));
        }
        target_id = if id.is_empty() { new_id() } else { id.to_string() };
        shared.phrases.push(Phrase {
            id: target_id.clone(),
            title,
            text,
            category,
            createdAt: now.clone(),
            updatedAt: now,
        });
    }

    // 视图侧:固化/更新 pinned;order 已落盘则保持,否则沿用当前合成序（位置不动）
    let current = synth(&shared.phrases, &view)
        .into_iter()
        .find(|s| s.id == target_id)
        .map(|s| s.order);
    if let Some(order) = current {
        view.insert(target_id.clone(), ViewEntry { pinned, order });
    }
    save_shared(&shared).map_err(|e| ("validation", e))?;
    save_view(&view);
    Ok(synth(&shared.phrases, &view))
}

pub fn delete_snippet(id: &str) -> Result<Vec<Snippet>, StoreError> {
    let mut shared = shared_or_err()?;
    let before = shared.phrases.len();
    shared.phrases.retain(|p| p.id != id);
    if shared.phrases.len() == before {
        return Err(("not_found", "条目不存在".into()));
    }
    let mut view = load_view();
    view.remove(id); // 孤儿条目"读时忽略";自己删的顺手清掉
    save_shared(&shared).map_err(|e| ("validation", e))?;
    save_view(&view);
    Ok(synth(&shared.phrases, &view))
}

fn segment_key(s: &Snippet) -> String {
    if s.pinned {
        "\u{0}pinned".to_string()
    } else {
        format!("cat:{}", s.category)
    }
}

/// 段内相邻交换;只动本地 view（order 互换,虚拟序在此固化）,共享文件不动
pub fn reorder_snippet(id: &str, direction: &str) -> Result<Vec<Snippet>, StoreError> {
    let shared = shared_or_err()?;
    let mut view = load_view();
    let mut seq = synth(&shared.phrases, &view);
    let idx = match seq.iter().position(|s| s.id == id) {
        Some(i) => i,
        None => return Err(("not_found", "条目不存在".into())),
    };
    let step = if direction == "up" { -1i64 } else { 1i64 };
    let mut i = idx as i64 + step;
    let key = segment_key(&seq[idx]);
    while i >= 0 && (i as usize) < seq.len() && segment_key(&seq[i as usize]) != key {
        i += step;
    }
    if !(i >= 0 && (i as usize) < seq.len()) {
        return Ok(seq); // 段边界
    }
    let (cur_order, other_order) = (seq[idx].order, seq[i as usize].order);
    let other_id = seq[i as usize].id.clone();
    // 两条都落盘（虚拟序固化）,order 互换
    view.insert(id.to_string(), ViewEntry { pinned: seq[idx].pinned, order: other_order });
    view.insert(other_id, ViewEntry { pinned: seq[i as usize].pinned, order: cur_order });
    save_view(&view);
    Ok(synth(&shared.phrases, &view))
}

pub fn rename_category(from: &str, to: &str) -> Result<(usize, Vec<Snippet>), StoreError> {
    let mut shared = shared_or_err()?;
    let mut changed = 0usize;
    let now = now_iso();
    for p in shared.phrases.iter_mut() {
        if p.category == from {
            p.category = to.to_string();
            p.updatedAt = now.clone();
            changed += 1;
        }
    }
    if changed > 0 {
        save_shared(&shared).map_err(|e| ("validation", e))?;
    }
    Ok((changed, synth(&shared.phrases, &load_view())))
}

// ── 一次性迁移（v0.4 及更早 → 共享架构）──

/// 旧 snippets.json **合并**进共享文件（同 id 以共享侧为准）,视图落本地 view.json,
/// 旧文件改名 .migrated 留证。best-effort:任何失败只记日志不阻塞启动。
pub fn migrate_once() {
    let legacy = legacy_path();
    let Ok(text) = read_text_bom(&legacy) else {
        return; // 无旧文件（全新安装）
    };
    #[derive(Deserialize)]
    struct LegacyData {
        #[serde(default)]
        snippets: Vec<Snippet>,
    }
    let Ok(old) = serde_json::from_str::<LegacyData>(&text) else {
        eprintln!("[quick-send] 迁移跳过：旧 {} 解析失败（保留原文件不动）", legacy.display());
        return;
    };
    let mut shared = match load_shared() {
        SharedLoad::Ok(f) => f,
        SharedLoad::Unsupported => {
            eprintln!("[quick-send] 迁移跳过：共享文件 schemaVersion 不受支持");
            return;
        }
        SharedLoad::Absent => empty_shared(),
    };
    let mut view = load_view();
    let mut merged = 0usize;
    for s in old.snippets {
        if shared.phrases.iter().any(|p| p.id == s.id) {
            continue; // 共享侧已有同 id,以共享侧为准
        }
        shared.phrases.push(Phrase {
            id: s.id.clone(),
            title: s.title,
            text: s.body,
            category: s.category,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
        });
        view.insert(s.id, ViewEntry { pinned: s.pinned, order: s.order });
        merged += 1;
    }
    if let Err(e) = save_shared(&shared) {
        eprintln!("[quick-send] 迁移失败：{e}（旧文件保留,下次启动重试）");
        return;
    }
    save_view(&view);
    let migrated = legacy.with_extension("json.migrated");
    let _ = fs::remove_file(&migrated);
    if fs::rename(&legacy, &migrated).is_ok() {
        eprintln!(
            "[quick-send] 迁移完成：合并 {merged} 条 → 共享文件;旧文件留证 {}",
            migrated.display()
        );
    }
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

    /// 隔离环境:数据目录与共享文件都指向独立临时位置
    fn isolated() -> (Guard, PathBuf) {
        let guard = Guard(TEST_LOCK.lock().unwrap());
        let dir = std::env::temp_dir().join(format!("qs-rs-test-{}", new_id()));
        fs::create_dir_all(dir.join("shared")).unwrap();
        std::env::set_var("QUICK_SEND_DATA", &dir);
        std::env::set_var("QUICK_SEND_PHRASES", dir.join("shared").join("phrases.json"));
        (guard, dir)
    }

    fn shared_path(_dir: &PathBuf) -> PathBuf {
        std::env::var("QUICK_SEND_PHRASES").unwrap().into()
    }

    #[test]
    fn crud_roundtrip_and_atomic_write() {
        let (_g, dir) = isolated();
        let r = save_snippet(&json!({"title":"T1","body":"B1"})).unwrap();
        assert_eq!(r.len(), 1);
        let id = r[0].id.clone();
        assert_eq!(r[0].body, "B1"); // 对外仍叫 body
        assert!(get_snippet(&id).is_some());
        assert!(delete_snippet(&id).is_ok());
        assert_eq!(list_snippets().len(), 0);
        assert!(!shared_path(&dir).with_extension("json.tmp").exists()); // 无 .tmp 残留
    }

    #[test]
    fn shared_file_strict_shape() {
        let (_g, dir) = isolated();
        save_snippet(&json!({"title":"T","body":"B","category":"C"})).unwrap();
        let raw: Value =
            serde_json::from_str(&fs::read_to_string(shared_path(&dir)).unwrap()).unwrap();
        assert_eq!(raw["schemaVersion"], 1);
        let p = &raw["phrases"][0];
        for key in ["id", "title", "text", "category", "createdAt", "updatedAt"] {
            assert!(p.get(key).is_some(), "缺字段 {key}"); // DSH 侧测试会校验齐全
        }
        assert_eq!(p["text"], "B"); // 共享侧字段名是 text
    }

    #[test]
    fn external_shared_file_read_and_write_back() {
        // 模拟 DSH 建条目 → ZCode 读到;ZCode 改 → 共享文件更新且守卫不丢
        let (_g, dir) = isolated();
        let path = shared_path(&dir);
        let dsh = json!({
            "schemaVersion": 1,
            "phrases": [{ "id": "dsh-x1", "title": "DSH条目", "text": "来自 DSH", "category": "", "createdAt": "2026-11-04T00:00:00.000Z", "updatedAt": "2026-11-04T00:00:00.000Z" }]
        });
        fs::write(&path, serde_json::to_string_pretty(&dsh).unwrap()).unwrap();

        let list = list_snippets();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].body, "来自 DSH");

        save_snippet(&json!({"id":"dsh-x1","title":"DSH条目改","body":"改后","category":"","pinned":false})).unwrap();
        let raw: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(raw["phrases"][0]["title"], "DSH条目改");
        assert_eq!(raw["schemaVersion"], 1);
    }

    #[test]
    fn unsupported_schema_version_blocks_writes() {
        let (_g, dir) = isolated();
        let path = shared_path(&dir);
        fs::write(&path, r#"{"schemaVersion": 99, "phrases": []}"#).unwrap();
        assert_eq!(list_snippets().len(), 0); // 读按空表
        let err = save_snippet(&json!({"title":"t","body":"b"})).unwrap_err();
        assert_eq!(err.0, "validation"); // 写被拒
        assert!(fs::read_to_string(&path).unwrap().contains("99")); // 文件原样未动
    }

    #[test]
    fn corruption_self_heals_with_bad_backup() {
        let (_g, dir) = isolated();
        save_snippet(&json!({"title":"T","body":"B"})).unwrap();
        let path = shared_path(&dir);
        drop(fs::write(&path, "{broken"));
        assert_eq!(list_snippets().len(), 0);
        assert!(!path.exists()); // 原文件已被隔离
        // 留证名带时间戳(.bad-<ts>),多次损坏证据不互相覆盖
        let left: Vec<String> = fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with("phrases.json.bad-"))
            .collect();
        assert_eq!(left.len(), 1);
    }

    #[test]
    fn missing_schema_version_refuses_without_quarantine() {
        // 合法 JSON 但缺 schemaVersion = 格式不认识:读空表 + 拒写,文件必须原样保留(不隔离)
        let (_g, dir) = isolated();
        let path = shared_path(&dir);
        fs::write(&path, r#"{"phrases":[]}"#).unwrap();
        assert_eq!(list_snippets().len(), 0);
        assert!(save_snippet(&json!({"title":"t","body":"b"})).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), r#"{"phrases":[]}"#);
    }

    #[test]
    fn bom_prefixed_shared_file_parses() {
        // DSH/外部编辑器可能写出带 BOM 的文件:与 DSH 一致地容忍,而不是当损坏隔离
        let (_g, dir) = isolated();
        let path = shared_path(&dir);
        let body = r#"{"schemaVersion":1,"phrases":[{"id":"dsh-bom","title":"BOM条","text":"t","category":"","createdAt":"2026-11-04T00:00:00.000Z","updatedAt":"2026-11-04T00:00:00.000Z"}]}"#;
        fs::write(&path, "\u{feff}".to_string() + body).unwrap();
        let list = list_snippets();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "dsh-bom");
        assert!(path.exists()); // 未被误隔离
    }

    #[test]
    fn duplicate_ids_keep_first_and_skip_invalid_entries() {
        // 逐条规范化(对齐 DSH normalizePhrase):重复 id 保留首条、缺 id/text 跳过、
        // 未知字段丢弃、数字时间戳回退当前时间
        let (_g, dir) = isolated();
        let path = shared_path(&dir);
        let dsh = json!({
            "schemaVersion": 1,
            "phrases": [
                { "id": "dup", "title": "首条", "text": "first", "category": "", "createdAt": "2026-11-04T00:00:00.000Z", "updatedAt": "2026-11-04T00:00:00.000Z" },
                { "id": "dup", "title": "后来者", "text": "second", "category": "", "createdAt": "2026-11-04T00:00:01.000Z", "updatedAt": "2026-11-04T00:00:01.000Z" },
                { "title": "无id", "text": "x", "category": "" },
                { "id": "no-text", "title": "缺正文" },
                { "id": "extra", "text": "带未知字段", "extra": 1, "createdAt": 12345, "category": "" }
            ]
        });
        fs::write(&path, serde_json::to_string_pretty(&dsh).unwrap()).unwrap();
        let list = list_snippets();
        assert_eq!(list.len(), 2); // dup 首条 + extra
        assert_eq!(list.iter().find(|s| s.id == "dup").unwrap().body, "first");
        let extra = list.iter().find(|s| s.id == "extra").unwrap();
        assert!(extra.createdAt.contains('T')); // 数字时间戳已回退 ISO
    }

    #[test]
    fn dsh_long_entry_fully_editable() {
        // 上限对齐的意义:DSH 存得下的长条目(标题 100 字/正文 15000 字),本侧读全量、改存不报错
        let (_g, dir) = isolated();
        let path = shared_path(&dir);
        let dsh = json!({
            "schemaVersion": 1,
            "phrases": [{ "id": "dsh-long", "title": "长".repeat(100), "text": "正".repeat(15000), "category": "写作", "createdAt": "2026-11-04T00:00:00.000Z", "updatedAt": "2026-11-04T00:00:00.000Z" }]
        });
        fs::write(&path, serde_json::to_string_pretty(&dsh).unwrap()).unwrap();
        let list = list_snippets();
        assert_eq!(list[0].body.chars().count(), 15000); // 读不截断
        let r = save_snippet(&json!({"id":"dsh-long","title":"长".repeat(100),"body":"改".repeat(15000),"category":"写作","pinned":false})).unwrap();
        assert_eq!(r[0].body.chars().count(), 15000); // 改存不报错不截断
    }

    #[test]
    fn validation_limits() {
        let (_g, _dir) = isolated();
        assert!(save_snippet(&json!({"title":"  ","body":"b"})).is_err());
        assert!(save_snippet(&json!({"title":"t","body":"  "})).is_err());
        // 上限对齐 DSH(120/20000/20 字符):边界值可存,超 1 拒绝
        assert!(save_snippet(&json!({"title":"x".repeat(120),"body":"b"})).is_ok());
        assert!(save_snippet(&json!({"title":"x".repeat(121),"body":"b"})).is_err());
        assert!(save_snippet(&json!({"title":"t","body":"字".repeat(20000)})).is_ok());
        assert!(save_snippet(&json!({"title":"t","body":"字".repeat(20001)})).is_err());
        assert!(save_snippet(&json!({"title":"t","body":"b","category":"x".repeat(21)})).is_err());
    }

    #[test]
    fn reorder_isolated_within_category_segment() {
        let (_g, _dir) = isolated();
        let a = save_snippet(&json!({"title":"a","body":"b","category":"X"})).unwrap();
        let a2 = save_snippet(&json!({"title":"a2","body":"b","category":"X"})).unwrap();
        save_snippet(&json!({"title":"y","body":"b","category":"Y"})).unwrap();
        let a2_id = a2[1].id.clone();
        let r = reorder_snippet(&a2_id, "up").unwrap();
        let seg: Vec<&str> = r.iter().filter(|s| s.category == "X").map(|s| s.title.as_str()).collect();
        assert_eq!(seg, vec!["a2", "a"]);
    }

    #[test]
    fn reorder_virtual_order_materializes() {
        // DSH 建的条目(无 view)按 createdAt 稳定排序;reorder 后虚拟序固化
        let (_g, dir) = isolated();
        let path = shared_path(&dir);
        let dsh = json!({
            "schemaVersion": 1,
            "phrases": [
                { "id": "dsh-1", "title": "一", "text": "t", "category": "X", "createdAt": "2026-11-04T00:00:01.000Z", "updatedAt": "2026-11-04T00:00:01.000Z" },
                { "id": "dsh-2", "title": "二", "text": "t", "category": "X", "createdAt": "2026-11-04T00:00:02.000Z", "updatedAt": "2026-11-04T00:00:02.000Z" }
            ]
        });
        fs::write(&path, serde_json::to_string_pretty(&dsh).unwrap()).unwrap();
        let list = list_snippets();
        assert_eq!(
            list.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            vec!["dsh-1", "dsh-2"]
        );

        let r = reorder_snippet("dsh-2", "up").unwrap();
        assert_eq!(r[0].id, "dsh-2");
        // 固化验证:重新读取(模拟另一次启动)顺序保持
        assert_eq!(list_snippets()[0].id, "dsh-2");
    }

    #[test]
    fn rename_category_batch() {
        let (_g, _dir) = isolated();
        save_snippet(&json!({"title":"a","body":"b","category":"旧"}));
        save_snippet(&json!({"title":"c","body":"d","category":"旧"}));
        save_snippet(&json!({"title":"e","body":"f","category":"新"}));
        let (changed, list) = rename_category("旧", "改").unwrap();
        assert_eq!(changed, 2);
        assert_eq!(list.iter().filter(|s| s.category == "改").count(), 2);
    }

    #[test]
    fn migration_merges_into_existing_shared() {
        // 旧 snippets.json 2 条(1 条与共享同 id 冲突) + 共享已有 DSH 2 条 → 合并 3 条
        let (_g, dir) = isolated();
        let legacy = r#"{
            "version": 1, "updatedAt": "2026-11-01T00:00:00.000Z",
            "snippets": [
                { "id": "old-1", "title": "旧条目", "body": "旧正文", "category": "嵌入式", "pinned": true, "order": 5, "createdAt": "2026-11-01T00:00:00.000Z", "updatedAt": "2026-11-01T00:00:00.000Z" },
                { "id": "dsh-x1", "title": "旧名(冲突)", "body": "ignored", "category": "", "pinned": false, "order": 1, "createdAt": "2026-11-01T00:00:00.000Z", "updatedAt": "2026-11-01T00:00:00.000Z" }
            ]
        }"#;
        fs::write(dir.join("snippets.json"), legacy).unwrap();
        let path = shared_path(&dir);
        let dsh = json!({
            "schemaVersion": 1,
            "phrases": [
                { "id": "dsh-x1", "title": "共享侧为准", "text": "shared", "category": "", "createdAt": "2026-11-04T00:00:00.000Z", "updatedAt": "2026-11-04T00:00:00.000Z" },
                { "id": "dsh-x2", "title": "二", "text": "t", "category": "", "createdAt": "2026-11-04T00:00:01.000Z", "updatedAt": "2026-11-04T00:00:01.000Z" }
            ]
        });
        fs::write(&path, serde_json::to_string_pretty(&dsh).unwrap()).unwrap();

        migrate_once();

        let raw: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(raw["phrases"].as_array().unwrap().len(), 3); // 2 DSH + 1 合并
        let merged = raw["phrases"].as_array().unwrap().iter().find(|p| p["id"] == "old-1").unwrap();
        assert_eq!(merged["text"], "旧正文"); // body → text
        let conflict = raw["phrases"].as_array().unwrap().iter().find(|p| p["id"] == "dsh-x1").unwrap();
        assert_eq!(conflict["title"], "共享侧为准"); // 冲突以共享侧为准
        assert!(dir.join("snippets.json.migrated").exists()); // 留证不删
        assert!(!dir.join("snippets.json").exists());

        // 视图随迁:置顶与 order 生效
        let view: Value = serde_json::from_str(&fs::read_to_string(dir.join("view.json")).unwrap()).unwrap();
        assert_eq!(view["old-1"]["pinned"], true);
        assert_eq!(view["old-1"]["order"], 5);
        assert_eq!(list_snippets()[0].id, "old-1");
    }
}
