"""Ideas sub-app: 点子库 —— 多份点子文档 + 每份点子下的多对话 + distill。

聊天本身复用壳子的 bare conversation 流：每段对话用一个 UUID cid，落到
~/.claude/projects/<encoded-cwd>/<cid>.jsonl（Claude CLI session），通过
壳子的 /api/conversations/<cid>/stream 走流式。第一轮通过 context resolver
注入点子文档 + 素材夹作为 system prompt 前缀（kind=ideas_conv）。
之后的轮次用 --resume 复用同一个 session，所以同一段对话内文档/素材夹是
冻结快照——distill 后想看新文档请开新对话。

数据布局（相对 data/sub_app/ideas/）：
  ideas/index.json              {iid: meta}
  ideas/<iid>.md                当前文档
  ideas/history/<iid>.<ts>.md   distill / 手动改前的快照
  conversations/index.json     {cid(UUID): {idea_id, created_ts, distilled_count}}
  files/<iid>/...               每个点子的素材夹

bind(ctx) 在 register 时被 shell 调用。模块级路径变量在那之前都是 None，
不要在 import 时碰它们。锁 _state_lock 只包 JSON index 的 read-modify-write，
不要包 LLM 调用（见 CLAUDE.md §1.1）。
"""

import json
import mimetypes
import re
import shutil
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import unquote

_state_lock = threading.Lock()

SUB_ROOT: Path = None  # type: ignore
IDEAS_DIR: Path = None  # type: ignore
IDEAS_HISTORY_DIR: Path = None  # type: ignore
IDEAS_INDEX: Path = None  # type: ignore
CONV_DIR: Path = None  # type: ignore
CONV_INDEX: Path = None  # type: ignore
FILES_DIR: Path = None  # type: ignore
_call_claude = None
_set_conv_context = None
_drop_conv_context = None
_claude_session_path = None
_parse_claude_session = None
_get_session_title = None
_user_name = "用户"

DOC_MAX_CHARS = 50_000  # distill 软上限：超了拒写
FILE_MAX_BYTES = 50 * 1024 * 1024  # 单文件上传上限
# 注入 chat prompt 的素材夹文本预算（字符）。超了按 mtime 新 → 旧 贪心装。
FILES_CHAT_BUDGET = 30_000
# 当扩展名落在这里，文件内容直接拼进 prompt；否则只列名+大小（视为附件）。
TEXT_EXTS = {
    ".md", ".markdown", ".txt", ".rst", ".log",
    ".json", ".yaml", ".yml", ".toml", ".ini", ".csv", ".tsv", ".xml",
    ".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".scss",
    ".sh", ".bash", ".zsh", ".sql",
}


def bind(ctx: dict) -> None:
    global SUB_ROOT, IDEAS_DIR, IDEAS_HISTORY_DIR, IDEAS_INDEX
    global CONV_DIR, CONV_INDEX, FILES_DIR
    global _call_claude, _set_conv_context, _drop_conv_context
    global _claude_session_path, _parse_claude_session, _get_session_title
    global _user_name
    _user_name = ctx.get("user_name", "用户")
    SUB_ROOT = ctx["sub_root"]
    d = ctx["data_dirs"]
    IDEAS_DIR = d["ideas"]
    IDEAS_HISTORY_DIR = d["ideas_history"]
    IDEAS_INDEX = IDEAS_DIR / "index.json"
    CONV_DIR = d["conversations"]
    CONV_INDEX = CONV_DIR / "index.json"
    FILES_DIR = d["files"]
    svc = ctx["services"]
    _call_claude = svc["call_claude"]
    _set_conv_context = svc.get("set_conv_context")
    _drop_conv_context = svc.get("drop_conv_context")
    _claude_session_path = svc.get("claude_session_path")
    _parse_claude_session = svc.get("parse_claude_session")
    _get_session_title = svc.get("get_session_title")
    IDEAS_DIR.mkdir(parents=True, exist_ok=True)
    IDEAS_HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    CONV_DIR.mkdir(parents=True, exist_ok=True)
    FILES_DIR.mkdir(parents=True, exist_ok=True)
    for p in (IDEAS_INDEX, CONV_INDEX):
        if not p.exists() or p.stat().st_size == 0:
            p.write_text("{}")
    reg = svc.get("register_context_resolver")
    if reg:
        reg("ideas_conv", _resolve_ideas_conv_context)


def _resolve_ideas_conv_context(context: dict) -> str:
    """壳子在 conv 第一轮调用，用 ideas_conv 注入点子文档 + 素材夹作为 system prompt 前缀。"""
    iid = (context or {}).get("iid")
    if not iid:
        return ""
    idx = load_ideas_index()
    if iid not in idx:
        return ""
    idea_title = idx[iid].get("title", "新点子")
    doc = load_doc(iid)
    doc_block = doc.strip() if doc.strip() else "（文档暂时为空，刚开始聊这个点子）"
    files_block = _build_files_block_for_chat(iid)
    parts = [
        f"你正在帮{_user_name}打磨一个产品点子：《{idea_title}》。",
        "你的回答要简洁、具体、直接，必要时反驳他的想法。默认中文，除非他用英文。",
        "不要客套、不要总结自己刚说过的话，不要堆砌 markdown 标题。",
        "",
        "=== 当前点子文档 ===",
        doc_block,
        "=== 文档结束 ===",
    ]
    if files_block:
        parts += [
            "",
            f"=== 素材夹（{_user_name}自己记录的笔记 / 设计 / 附件，比文档更原始） ===",
            files_block,
            "=== 素材夹结束 ===",
        ]
    return "\n".join(parts)


# === Index I/O ===

def load_ideas_index() -> dict:
    try:
        return json.loads(IDEAS_INDEX.read_text() or "{}")
    except json.JSONDecodeError:
        return {}


def save_ideas_index(idx: dict) -> None:
    IDEAS_INDEX.write_text(json.dumps(idx, ensure_ascii=False, indent=2))


def load_conv_index() -> dict:
    try:
        return json.loads(CONV_INDEX.read_text() or "{}")
    except json.JSONDecodeError:
        return {}


def save_conv_index(idx: dict) -> None:
    CONV_INDEX.write_text(json.dumps(idx, ensure_ascii=False, indent=2))


def load_doc(iid: str) -> str:
    p = IDEAS_DIR / f"{iid}.md"
    return p.read_text() if p.exists() else ""


# === Claude session helpers (壳子托管的对话消息) ===

def _session_text_messages(cid: str) -> list[dict]:
    """从 Claude CLI session jsonl 读这段对话的 user/assistant 文本消息。"""
    if not _claude_session_path or not _parse_claude_session:
        return []
    p = _claude_session_path(cid)
    msgs = _parse_claude_session(p) or []
    return [m for m in msgs if m.get("kind") in ("user_text", "assistant_text")]


def _conv_summary_fields(cid: str) -> dict:
    """从 CLI session 派生 last_role / last_preview / last_ts / count。"""
    msgs = _session_text_messages(cid)
    if not msgs:
        return {"last_role": None, "last_preview": "", "last_ts": 0, "count": 0}
    last = msgs[-1]
    return {
        "last_role": last.get("role"),
        "last_preview": (last.get("content") or "").strip().replace("\n", " ")[:80],
        "last_ts": int(last.get("ts") or 0),
        "count": len(msgs),
    }


def _conv_title(cid: str) -> str:
    """Title sits in shell's conv_titles.json (set on first turn by the streamer)."""
    if _get_session_title:
        t = _get_session_title(cid)
        if t:
            return t
    # Fall back: first user message preview
    msgs = _session_text_messages(cid)
    for m in msgs:
        if m.get("role") == "user":
            return (m.get("content") or "").strip().replace("\n", " ")[:30] or "新对话"
    return "新对话"


def _delete_session_file(cid: str) -> None:
    if not _claude_session_path:
        return
    try:
        p = _claude_session_path(cid)
        if p.exists():
            p.unlink()
    except OSError:
        pass


# === Idea CRUD ===

def list_ideas(req):
    idx = load_ideas_index()
    out = [
        {
            "id": iid,
            "title": meta.get("title", "无题"),
            "doc_chars": meta.get("doc_chars", 0),
            "conv_count": meta.get("conv_count", 0),
            "created_ts": meta.get("created_ts", 0),
            "updated_ts": meta.get("updated_ts", 0),
        }
        for iid, meta in idx.items()
    ]
    out.sort(key=lambda x: x["updated_ts"] or x["created_ts"], reverse=True)
    req._send_json(200, out)


def create_idea(req):
    data = req._read_json_body()
    title = (data.get("title") or "新点子").strip()[:80] or "新点子"
    iid = uuid.uuid4().hex[:12]
    now = int(time.time())
    (IDEAS_DIR / f"{iid}.md").write_text("")
    with _state_lock:
        idx = load_ideas_index()
        idx[iid] = {
            "title": title,
            "doc_chars": 0,
            "conv_count": 0,
            "created_ts": now,
            "updated_ts": now,
        }
        save_ideas_index(idx)
    req._send_json(200, {"id": iid, "title": title})


def get_idea(req, iid):
    iid = unquote(iid)
    idx = load_ideas_index()
    if iid not in idx:
        req._send_json(404, {"error": "idea not found"})
        return
    meta = idx[iid]
    doc = load_doc(iid)
    convs = []
    for cid, cmeta in load_conv_index().items():
        if cmeta.get("idea_id") != iid:
            continue
        sm = _conv_summary_fields(cid)
        convs.append({
            "id": cid,
            "title": _conv_title(cid),
            "last_role": sm["last_role"],
            "last_preview": sm["last_preview"],
            "last_ts": sm["last_ts"],
            "count": sm["count"],
            "created_ts": cmeta.get("created_ts", 0),
            "distilled_count": cmeta.get("distilled_count", 0),
        })
    convs.sort(key=lambda x: x["last_ts"] or x["created_ts"], reverse=True)
    req._send_json(200, {
        "id": iid,
        "title": meta.get("title", "无题"),
        "doc": doc,
        "doc_chars": len(doc),
        "created_ts": meta.get("created_ts", 0),
        "updated_ts": meta.get("updated_ts", 0),
        "conversations": convs,
    })


def update_idea(req, iid):
    """POST /ideas/<iid>/update — body: {title?, doc?}.

    Shell 没有 do_PATCH，所以用 POST + /update 后缀代替。手动改 doc 时旧版
    自动进 history（跟 distill 的快照策略一致）。
    """
    iid = unquote(iid)
    data = req._read_json_body()
    title = data.get("title")
    doc = data.get("doc")
    if title is None and doc is None:
        req._send_json(400, {"error": "nothing to update"})
        return
    now = int(time.time())
    with _state_lock:
        idx = load_ideas_index()
        if iid not in idx:
            req._send_json(404, {"error": "idea not found"})
            return
        if title is not None:
            idx[iid]["title"] = title.strip()[:80] or "无题"
        if doc is not None:
            if len(doc) > DOC_MAX_CHARS:
                req._send_json(400, {"error": f"doc 超过 {DOC_MAX_CHARS} 字软上限"})
                return
            doc_path = IDEAS_DIR / f"{iid}.md"
            if doc_path.exists() and doc_path.stat().st_size > 0:
                shutil.copy(doc_path, IDEAS_HISTORY_DIR / f"{iid}.{now}.md")
            doc_path.write_text(doc)
            idx[iid]["doc_chars"] = len(doc)
        idx[iid]["updated_ts"] = now
        save_ideas_index(idx)
    req._send_json(200, {"ok": True, "updated_ts": now})


def delete_idea(req, iid):
    """Hard delete: doc + history + all conversations (含 CLI session) + files folder."""
    iid = unquote(iid)
    with _state_lock:
        idx = load_ideas_index()
        if iid not in idx:
            req._send_json(404, {"error": "idea not found"})
            return
        doc_path = IDEAS_DIR / f"{iid}.md"
        if doc_path.exists():
            doc_path.unlink()
        for h in IDEAS_HISTORY_DIR.glob(f"{iid}.*.md"):
            try:
                h.unlink()
            except OSError:
                pass
        idx.pop(iid)
        save_ideas_index(idx)
        c_idx = load_conv_index()
        to_del = [c for c, m in c_idx.items() if m.get("idea_id") == iid]
        for cid in to_del:
            c_idx.pop(cid, None)
        save_conv_index(c_idx)
        files_dir = FILES_DIR / iid
        if files_dir.exists():
            shutil.rmtree(files_dir, ignore_errors=True)
        # Log so a backup-restore is feasible if user later regrets.
        print(f"[ideas] deleted idea {iid} + {len(to_del)} conversations + files dir", flush=True)
    # 锁外再清 CLI session + context binding（用了壳子的服务，会自己拿锁）
    for cid in to_del:
        _delete_session_file(cid)
        if _drop_conv_context:
            _drop_conv_context(cid)
    req._send_json(200, {"ok": True})


# === Doc history ===

def list_history(req, iid):
    iid = unquote(iid)
    if iid not in load_ideas_index():
        req._send_json(404, {"error": "idea not found"})
        return
    out = []
    for h in IDEAS_HISTORY_DIR.glob(f"{iid}.*.md"):
        m = re.match(rf"^{re.escape(iid)}\.(\d+)\.md$", h.name)
        if not m:
            continue
        out.append({"ts": int(m.group(1)), "chars": h.stat().st_size})
    out.sort(key=lambda x: x["ts"], reverse=True)
    req._send_json(200, out)


def get_history(req, iid, ts):
    iid = unquote(iid)
    ts = unquote(ts)
    p = IDEAS_HISTORY_DIR / f"{iid}.{ts}.md"
    if not p.exists():
        req._send_json(404, {"error": "history snapshot not found"})
        return
    req._send_json(200, {"ts": int(ts), "doc": p.read_text()})


def restore_history(req, iid, ts):
    """Restore a historical snapshot to current; old current goes to history."""
    iid = unquote(iid)
    ts = unquote(ts)
    src = IDEAS_HISTORY_DIR / f"{iid}.{ts}.md"
    if not src.exists():
        req._send_json(404, {"error": "history snapshot not found"})
        return
    now = int(time.time())
    with _state_lock:
        idx = load_ideas_index()
        if iid not in idx:
            req._send_json(404, {"error": "idea not found"})
            return
        doc_path = IDEAS_DIR / f"{iid}.md"
        if doc_path.exists() and doc_path.stat().st_size > 0:
            shutil.copy(doc_path, IDEAS_HISTORY_DIR / f"{iid}.{now}.md")
        content = src.read_text()
        doc_path.write_text(content)
        idx[iid]["doc_chars"] = len(content)
        idx[iid]["updated_ts"] = now
        save_ideas_index(idx)
    req._send_json(200, {"ok": True, "doc": content, "updated_ts": now})


# === Conversation CRUD ===

def list_conversations(req, iid):
    iid = unquote(iid)
    if iid not in load_ideas_index():
        req._send_json(404, {"error": "idea not found"})
        return
    out = []
    for cid, meta in load_conv_index().items():
        if meta.get("idea_id") != iid:
            continue
        sm = _conv_summary_fields(cid)
        out.append({
            "id": cid,
            "title": _conv_title(cid),
            "last_role": sm["last_role"],
            "last_preview": sm["last_preview"],
            "last_ts": sm["last_ts"],
            "count": sm["count"],
            "created_ts": meta.get("created_ts", 0),
            "distilled_count": meta.get("distilled_count", 0),
        })
    out.sort(key=lambda x: x["last_ts"] or x["created_ts"], reverse=True)
    req._send_json(200, out)


def create_conversation(req, iid):
    """新建一段对话：cid 用 UUID（壳子 stream 要求），并绑定 ideas_conv 上下文。

    第一轮通过 context resolver 注入点子文档 + 素材夹作为 system prompt 前缀。
    之后前端走 POST /api/conversations/<cid>/stream（壳子的 SSE 路径）。
    """
    iid = unquote(iid)
    if iid not in load_ideas_index():
        req._send_json(404, {"error": "idea not found"})
        return
    cid = str(uuid.uuid4())
    now = int(time.time())
    with _state_lock:
        c_idx = load_conv_index()
        c_idx[cid] = {
            "idea_id": iid,
            "created_ts": now,
            "distilled_count": 0,
        }
        save_conv_index(c_idx)
        i_idx = load_ideas_index()
        if iid in i_idx:
            i_idx[iid]["conv_count"] = i_idx[iid].get("conv_count", 0) + 1
            save_ideas_index(i_idx)
    # 锁外绑 context；set_conv_context 自己拿锁
    if _set_conv_context:
        _set_conv_context(cid, {"kind": "ideas_conv", "iid": iid})
    req._send_json(200, {"id": cid, "title": "新对话"})


def delete_conversation(req, iid, cid):
    """删 conv index 记录 + CLI session 文件 + context binding。"""
    iid = unquote(iid)
    cid = unquote(cid)
    with _state_lock:
        c_idx = load_conv_index()
        if cid not in c_idx or c_idx[cid].get("idea_id") != iid:
            req._send_json(404, {"error": "conversation not found"})
            return
        c_idx.pop(cid)
        save_conv_index(c_idx)
        i_idx = load_ideas_index()
        if iid in i_idx and i_idx[iid].get("conv_count", 0) > 0:
            i_idx[iid]["conv_count"] -= 1
            save_ideas_index(i_idx)
    _delete_session_file(cid)
    if _drop_conv_context:
        _drop_conv_context(cid)
    req._send_json(200, {"ok": True})


# === Files (素材夹) ===

def _idea_files_dir(iid: str) -> Path:
    return FILES_DIR / iid


def _safe_resolve(iid: str, rel: str) -> Path:
    """Join `rel` under the idea's files root, ensure result stays inside. Raises ValueError on escape."""
    base = _idea_files_dir(iid).resolve()
    base.mkdir(parents=True, exist_ok=True)
    rel = (rel or "").strip().lstrip("/")
    target = (base / rel).resolve() if rel else base
    try:
        target.relative_to(base)
    except ValueError as e:
        raise ValueError(f"path escapes idea root: {rel!r}") from e
    return target


def _entry_meta(child: Path, rel_prefix: str) -> dict:
    st = child.stat()
    name = child.name
    rel = f"{rel_prefix}/{name}" if rel_prefix else name
    return {
        "name": name,
        "path": rel,
        "type": "dir" if child.is_dir() else "file",
        "size": st.st_size if child.is_file() else 0,
        "mtime": int(st.st_mtime),
    }


def _list_dir(target: Path, rel_prefix: str) -> list:
    if not target.exists() or not target.is_dir():
        return []
    return [
        _entry_meta(c, rel_prefix)
        for c in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    ]


def list_files_root(req, iid):
    iid = unquote(iid)
    if iid not in load_ideas_index():
        req._send_json(404, {"error": "idea not found"})
        return
    try:
        base = _safe_resolve(iid, "")
    except ValueError as e:
        req._send_json(400, {"error": str(e)})
        return
    req._send_json(200, {"path": "", "type": "dir", "entries": _list_dir(base, "")})


def read_path(req, iid, rel):
    iid = unquote(iid)
    rel = unquote(rel).strip("/")
    if iid not in load_ideas_index():
        req._send_json(404, {"error": "idea not found"})
        return
    try:
        target = _safe_resolve(iid, rel)
    except ValueError as e:
        req._send_json(400, {"error": str(e)})
        return
    if not target.exists():
        req._send_json(404, {"error": "not found"})
        return
    if target.is_dir():
        req._send_json(200, {"path": rel, "type": "dir", "entries": _list_dir(target, rel)})
        return
    ctype, _ = mimetypes.guess_type(target.name)
    if not ctype:
        ctype = "application/octet-stream"
    if ctype.startswith("text/") or ctype in ("application/json", "application/javascript", "application/xml"):
        ctype += "; charset=utf-8"
    req._send_file(target, ctype)


def write_file(req, iid, rel):
    iid = unquote(iid)
    rel = unquote(rel).strip("/")
    if not rel:
        req._send_json(400, {"error": "missing file path"})
        return
    if iid not in load_ideas_index():
        req._send_json(404, {"error": "idea not found"})
        return
    try:
        target = _safe_resolve(iid, rel)
    except ValueError as e:
        req._send_json(400, {"error": str(e)})
        return
    if target.exists() and target.is_dir():
        req._send_json(400, {"error": "path is a directory"})
        return
    n = int(req.headers.get("Content-Length", "0") or 0)
    if n > FILE_MAX_BYTES:
        req._send_json(400, {"error": f"file too large (>{FILE_MAX_BYTES} bytes)"})
        return
    body = req.rfile.read(n) if n > 0 else b""
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)
    parent_rel = Path(rel).parent
    prefix = "" if parent_rel == Path(".") else parent_rel.as_posix()
    req._send_json(200, _entry_meta(target, prefix))


def delete_path(req, iid, rel):
    iid = unquote(iid)
    rel = unquote(rel).strip("/")
    if iid not in load_ideas_index():
        req._send_json(404, {"error": "idea not found"})
        return
    try:
        target = _safe_resolve(iid, rel)
    except ValueError as e:
        req._send_json(400, {"error": str(e)})
        return
    base = _idea_files_dir(iid).resolve()
    if not target.exists():
        req._send_json(404, {"error": "not found"})
        return
    if target == base:
        req._send_json(400, {"error": "cannot delete root"})
        return
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    req._send_json(200, {"ok": True})


def _build_files_block_for_chat(iid: str) -> str:
    """渲染素材夹给 chat prompt：文本类内联，二进制类只列名+大小，总字符预算 FILES_CHAT_BUDGET。"""
    base = _idea_files_dir(iid)
    if not base.exists():
        return ""
    text_entries: list[tuple[str, int, str]] = []  # (rel, mtime, content)
    bin_entries: list[tuple[str, int]] = []        # (rel, size)
    for p in base.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(base).as_posix()
        try:
            st = p.stat()
        except OSError:
            continue
        if p.suffix.lower() in TEXT_EXTS and st.st_size <= FILES_CHAT_BUDGET:
            try:
                text_entries.append((rel, int(st.st_mtime), p.read_text("utf-8")))
            except (OSError, UnicodeDecodeError):
                bin_entries.append((rel, st.st_size))
        else:
            bin_entries.append((rel, st.st_size))
    if not text_entries and not bin_entries:
        return ""
    text_entries.sort(key=lambda x: -x[1])  # 新的优先
    bin_entries.sort(key=lambda x: x[0])
    parts: list[str] = []
    used = 0
    dropped: list[str] = []
    for rel, _mt, content in text_entries:
        chunk = f"--- {rel} ---\n{content}\n"
        if used + len(chunk) <= FILES_CHAT_BUDGET:
            parts.append(chunk)
            used += len(chunk)
        else:
            dropped.append(rel)
    if bin_entries:
        parts.append("\n附件（未嵌入正文，仅告知存在）：")
        for rel, size in bin_entries:
            parts.append(f"  - {rel}（{size} 字节）")
    if dropped:
        parts.append(f"\n（以下文本文件因预算超限未注入：{', '.join(dropped)}）")
    return "\n".join(parts).strip()


# === Distill ===

def build_distill_prompt(idea_title: str, doc: str, msgs: list) -> str:
    doc_block = doc.strip() if doc.strip() else "（文档暂时为空）"
    lines = [
        f"你正在帮{_user_name}整理一个产品点子《{idea_title}》的设计文档。",
        "下面是当前文档和最近这场对话。请基于对话内容，输出新版文档（markdown），要求：",
        "",
        "- 保留当前文档的核心结构和已有有效内容",
        "- 把对话里有价值的新想法、新判断、新决定，融进对应章节",
        "- 如果对话推翻了文档里的某个判断，更新它，不要保留矛盾的两份",
        "- 对话里的发散、闲聊、反例可以不收录",
        "- 不要添加\"更新日志\"\"本次修改\"这类元信息",
        "- 不要解释你做了什么，直接输出 markdown 文档全文",
        "- 不要用 ```markdown 代码块包裹",
        "",
        "=== 当前文档 ===",
        doc_block,
        "=== 文档结束 ===",
        "",
        "=== 本场对话 ===",
    ]
    for msg in msgs:
        role = _user_name if msg.get("role") == "user" else "你"
        lines.append(f"{role}：{msg.get('content', '')}")
    lines += [
        "=== 对话结束 ===",
        "",
        "新版文档（直接输出 markdown）：",
    ]
    return "\n".join(lines)


def _line_diff_counts(old: str, new: str) -> dict:
    old_lines = set(old.splitlines())
    new_lines = set(new.splitlines())
    return {"added": len(new_lines - old_lines), "removed": len(old_lines - new_lines)}


def distill_conversation(req, iid, cid):
    iid = unquote(iid)
    cid = unquote(cid)
    c_idx = load_conv_index()
    if cid not in c_idx or c_idx[cid].get("idea_id") != iid:
        req._send_json(404, {"error": "conversation not found"})
        return
    i_idx = load_ideas_index()
    if iid not in i_idx:
        req._send_json(404, {"error": "idea not found"})
        return
    idea_title = i_idx[iid].get("title", "新点子")
    doc = load_doc(iid)
    msgs = _session_text_messages(cid)
    if not msgs:
        req._send_json(400, {"error": "对话还没消息，没东西可整理"})
        return
    prompt = build_distill_prompt(idea_title, doc, msgs)
    response = _call_claude(prompt)
    if not response or response.startswith("[错误：") or response.startswith("[claude 返回错误"):
        req._send_json(500, {"error": f"distill 失败：{response[:200]}"})
        return
    new_doc = response.strip()
    # Strip accidental ```markdown fences
    m = re.match(r"^```[a-zA-Z]*\n([\s\S]*?)\n```\s*$", new_doc)
    if m:
        new_doc = m.group(1).strip()
    if len(new_doc) < 10:
        req._send_json(500, {"error": "distill 返回内容太短，未写入"})
        return
    if len(new_doc) > DOC_MAX_CHARS:
        req._send_json(500, {"error": f"distill 返回 {len(new_doc)} 字，超过软上限 {DOC_MAX_CHARS}，未写入"})
        return
    # Anti-explosion: 老文档非空时，新版别比老版大 10x 以上
    if len(doc) > 200 and len(new_doc) > len(doc) * 10:
        req._send_json(500, {"error": "distill 输出比原文档大 10 倍以上，疑似爆炸，未写入"})
        return
    now = int(time.time())
    with _state_lock:
        doc_path = IDEAS_DIR / f"{iid}.md"
        if doc_path.exists() and doc_path.stat().st_size > 0:
            shutil.copy(doc_path, IDEAS_HISTORY_DIR / f"{iid}.{now}.md")
        doc_path.write_text(new_doc)
        ii = load_ideas_index()
        ii[iid]["doc_chars"] = len(new_doc)
        ii[iid]["updated_ts"] = now
        save_ideas_index(ii)
        ci = load_conv_index()
        if cid in ci:
            ci[cid]["distilled_count"] = ci[cid].get("distilled_count", 0) + 1
            save_conv_index(ci)
    req._send_json(200, {
        "doc": new_doc,
        "doc_chars": len(new_doc),
        "history_ts": now,
        "diff": _line_diff_counts(doc, new_doc),
    })
