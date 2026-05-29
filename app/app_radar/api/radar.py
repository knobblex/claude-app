"""Hot App Radar backend logic — dossiers, favorites, per-app chats, ideas, notes.

Path-dependent state is set by bind() at startup. Don't touch module-level
state at import time — bind() hasn't run yet.
"""

import json
import re
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import unquote

# Guards read-modify-write of Radar JSON state (favorites, notes). Hold for
# the JSON r-m-w only — NEVER around _call_claude (would re-serialize the
# request queue and undo the threading server fix).
_state_lock = threading.Lock()

# === Module-level state, set by bind() at startup ===

APPS_DIR: Path = None  # type: ignore
GAMES_DIR: Path = None  # type: ignore
DATA_DIR: Path = None  # type: ignore
CHATS_DIR: Path = None  # type: ignore
NOTES_DIR: Path = None  # type: ignore
FAVS_PATH: Path = None  # type: ignore
# Maps radar slug -> bare-conversation UUID. Lets us route the radar chat UI
# through the shell's stream pipeline (which requires a UUID cid) while still
# keeping a stable per-app conversation across sessions / devices.
CONV_INDEX_PATH: Path = None  # type: ignore
_call_claude = None
_set_conv_context = None
_user_name = "用户"


def bind(ctx: dict) -> None:
    """Wire ctx-injected paths and services into module-level globals."""
    global APPS_DIR, GAMES_DIR, DATA_DIR, CHATS_DIR, NOTES_DIR, FAVS_PATH
    global CONV_INDEX_PATH, _call_claude, _set_conv_context, _user_name
    _user_name = ctx.get("user_name", "用户")
    d = ctx["data_dirs"]
    APPS_DIR = d["apps"]
    GAMES_DIR = d["games"]
    DATA_DIR = d["root"]
    CHATS_DIR = DATA_DIR / "chats"
    NOTES_DIR = DATA_DIR / "notes"
    FAVS_PATH = DATA_DIR / "favorites.json"
    CONV_INDEX_PATH = DATA_DIR / "conv_index.json"
    CHATS_DIR.mkdir(parents=True, exist_ok=True)
    NOTES_DIR.mkdir(parents=True, exist_ok=True)
    if not FAVS_PATH.exists() or FAVS_PATH.stat().st_size == 0:
        FAVS_PATH.write_text("{}")
    if not CONV_INDEX_PATH.exists() or CONV_INDEX_PATH.stat().st_size == 0:
        CONV_INDEX_PATH.write_text("{}")
    _call_claude = ctx["services"]["call_claude"]
    _set_conv_context = ctx["services"].get("set_conv_context")
    # Register a system-prompt prefix builder for `context = {kind: "radar_app",
    # slug: "..."}`. Shells uses this on the FIRST turn so the model sees the
    # dossier as background. Replaces the old per-app-chat endpoint's
    # build_chat_prompt; that endpoint can stay around (legacy) but the
    # canonical entry point is now a bare conversation with this context.
    reg = ctx["services"].get("register_context_resolver")
    if reg:
        reg("radar_app", _resolve_radar_app_context)


def _resolve_radar_app_context(context: dict) -> str:
    slug = (context or {}).get("slug")
    if not slug:
        return ""
    path, _ = _find_dossier(slug)
    if not path:
        return ""
    d = parse_dossier(path)
    if not d:
        return ""
    name = d["frontmatter"].get("name", slug)
    body = d["body"].strip()
    return (
        f"你正在帮{_user_name}评估一个市场扫描里发现的产品。后续提问围绕这份卷宗展开。\n"
        f"=== 当前讨论：{name} ===\n"
        f"{body}\n"
        "=== 卷宗结束 ==="
    )


# === Helpers ===

def _find_dossier(slug: str):
    """Locate a dossier `.md` across apps + games dirs. Returns (path, kind) or (None, None)."""
    for kind, base in (("app", APPS_DIR), ("game", GAMES_DIR)):
        if base is None:
            continue
        p = base / f"{slug}.md"
        if p.exists():
            return p, kind
    return None, None


def parse_dossier(path: Path):
    text = path.read_text()
    m = re.match(r"^---\n(.*?)\n---\n(.*)", text, re.DOTALL)
    if not m:
        return None
    fm_text, body = m.group(1), m.group(2)
    fm = {}
    for line in fm_text.split("\n"):
        if ":" not in line:
            continue
        k, _, v = line.partition(":")
        v = v.strip()
        if v.startswith("[") and v.endswith("]"):
            v = [x.strip() for x in v[1:-1].split(",") if x.strip()]
        fm[k.strip()] = v
    return {"slug": path.stem, "frontmatter": fm, "body": body}


def extract_ideas(body: str):
    """Pull '## 可迁移点子' section and split into '### N. <title>' subitems."""
    m = re.search(r"^## 可迁移点子\s*\n(.*?)(?=^## |\Z)", body, re.DOTALL | re.MULTILINE)
    if not m:
        return []
    section = m.group(1).strip()
    parts = re.split(r"^### +(\d+)\.\s*(.+?)\s*$", section, flags=re.MULTILINE)
    out = []
    for i in range(1, len(parts), 3):
        out.append({
            "index": int(parts[i]),
            "title": parts[i + 1].strip(),
            "body": parts[i + 2].strip(),
        })
    if not out and section:
        out.append({"index": 1, "title": "", "body": section})
    return out


def list_ideas():
    out = []
    for kind, base in (("app", APPS_DIR), ("game", GAMES_DIR)):
        for p in sorted(base.glob("*.md")):
            d = parse_dossier(p)
            if not d:
                continue
            ideas = extract_ideas(d["body"])
            if not ideas:
                continue
            fm = d["frontmatter"]
            for it in ideas:
                out.append({
                    "slug": d["slug"],
                    "kind": kind,
                    "name": fm.get("name", d["slug"]),
                    "source": fm.get("source", ""),
                    "tags": fm.get("tags", []) if isinstance(fm.get("tags"), list) else [],
                    "first_seen": fm.get("first_seen", ""),
                    "score_avg": fm.get("score_avg", ""),
                    "index": it["index"],
                    "title": it["title"],
                    "body": it["body"],
                })
    return out


def list_apps():
    apps = []
    for kind, base in (("app", APPS_DIR), ("game", GAMES_DIR)):
        if base is None:
            continue
        for p in sorted(base.glob("*.md")):
            d = parse_dossier(p)
            if d:
                d["kind"] = kind
                apps.append(d)

    def score(d):
        try:
            return float(d["frontmatter"].get("score_avg", 0))
        except (TypeError, ValueError):
            return 0.0

    apps.sort(key=score, reverse=True)
    return apps


def load_favorites():
    return json.loads(FAVS_PATH.read_text() or "{}")


def save_favorites(favs):
    FAVS_PATH.write_text(json.dumps(favs, ensure_ascii=False, indent=2))


def chat_history(slug):
    p = CHATS_DIR / f"{slug}.jsonl"
    if not p.exists():
        return []
    out = []
    for line in p.read_text().splitlines():
        if line.strip():
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def append_chat(slug, role, content):
    p = CHATS_DIR / f"{slug}.jsonl"
    entry = {"role": role, "content": content, "ts": int(time.time())}
    with p.open("a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def load_notes(slug: str) -> str:
    p = NOTES_DIR / f"{slug}.md"
    return p.read_text() if p.exists() else ""


def append_notes(slug: str, summary: str, app_name: str) -> None:
    p = NOTES_DIR / f"{slug}.md"
    stamp = time.strftime("%Y-%m-%d %H:%M")
    section = f"\n## {stamp}\n\n{summary.strip()}\n"
    if p.exists():
        p.write_text(p.read_text() + section)
    else:
        header = f"# 我对《{app_name}》的点子和笔记\n"
        p.write_text(header + section)


def build_note_suggestions_prompt(app) -> str:
    name = app["frontmatter"].get("name", app["slug"])
    body = app["body"].strip()
    return "\n".join([
        f'{_user_name}在给 App"{name}"的卷宗写"我为什么要收藏这个"的个人备注。',
        "从 3 个不同角度各写一条候选备注，每条 25-45 字、中文、第一人称口吻：",
        "1. 实用：我打算怎么用 / 套到什么场景",
        "2. 洞见：这个产品最值得带走的关键 insight",
        "3. 触发：什么时候我会想起它再回看",
        "",
        '格式：只输出三行，分别以"1. ""2. ""3. "开头。',
        "不要前言、不要解释、不要标题、不要 markdown 加粗。",
        "",
        f"=== 卷宗：{name} ===",
        body[:1500],
    ])


def parse_suggestions(text: str):
    out = []
    for line in text.splitlines():
        line = line.strip()
        m = re.match(r"^\d+[\.\、]\s*(.+)", line)
        if not m:
            continue
        content = m.group(1).strip()
        content = re.sub(r"^\*\*(.+?)\*\*[:：]\s*", "", content)
        content = re.sub(r"^(实用|洞见|触发)[:：]\s*", "", content)
        if content:
            out.append(content)
    return out[:3]


def build_summary_prompt(app, history) -> str:
    name = app["frontmatter"].get("name", app["slug"])
    body = app["body"].strip()
    parts = [
        f'下面是{_user_name}跟 Claude 讨论 App"{name}"卷宗时的对话。',
        f"请提炼 **{_user_name}自己**提出的点子、判断、疑问、洞见——",
        f"不是你的分析，是{_user_name}在对话里产出的东西。",
        "",
        "格式要求：",
        "- 3-5 条 bullet（每条不超过 30 字）",
        "- 中文",
        "- 直接列 bullet，不要前言、不要后记、不要解释",
        f'- 如果{_user_name}没提出明确点子，只回复："（本轮无明确点子）"',
        "",
        f"=== 卷宗节选：{name} ===",
        body[:1500],
        "=== 对话历史 ===",
    ]
    for msg in history:
        role = _user_name if msg.get("role") == "user" else "Claude"
        parts.append(f"{role}：{msg.get('content', '')}")
    parts.append("")
    parts.append("提炼的点子（只输出 bullet）：")
    return "\n".join(parts)


def build_chat_prompt(app, history, message):
    name = app["frontmatter"].get("name", app["slug"])
    body = app["body"].strip()
    parts = [
        f"你正在帮{_user_name}评估一个市场扫描里发现的 App 创意。",
        "回答简洁（默认 200 字内），具体、直接，必要时反驳他的想法。",
        "默认中文，除非他用英文。不要用工具，只输出文本回复。",
        "",
        f"=== 当前讨论的 App：{name} ===",
        body,
        "=== 卷宗结束 ===",
        "",
    ]
    if history:
        parts.append("此前对话（最近 10 轮）：")
        for msg in history[-10:]:
            role = _user_name if msg.get("role") == "user" else "你"
            parts.append(f"{role}：{msg.get('content', '')}")
        parts.append("")
    parts.append(f"{_user_name}：{message}")
    parts.append("你：")
    return "\n".join(parts)


# === HTTP handlers ===
# Each takes `req` (the shell's BaseHTTPRequestHandler instance) + path params.

def list_apps_handler(req):
    apps = list_apps()
    favs = load_favorites()
    slim = []
    for a in apps:
        fav = favs.get(a["slug"], {})
        slim.append({
            "slug": a["slug"],
            "kind": a.get("kind", "app"),
            "frontmatter": a["frontmatter"],
            "is_favorite": a["slug"] in favs,
            "tags_user": fav.get("tags", []),
            "note_user": fav.get("note", ""),
            "favorited_at": fav.get("favorited_at"),
        })
    req._send_json(200, slim)


def get_app_handler(req, slug):
    slug = unquote(slug)
    md, kind = _find_dossier(slug)
    d = parse_dossier(md) if md else None
    if not d:
        req._send_json(404, {"error": "not found"})
        return
    d["kind"] = kind
    favs = load_favorites()
    d["is_favorite"] = slug in favs
    d["fav_meta"] = favs.get(slug, {})
    req._send_json(200, d)


def list_favorites_handler(req):
    req._send_json(200, load_favorites())


def toggle_favorite_handler(req, slug):
    slug = unquote(slug)
    data = req._read_json_body()
    with _state_lock:
        favs = load_favorites()
        if data.get("favorited") is False:
            favs.pop(slug, None)
        else:
            cur = favs.get(slug, {})
            cur.setdefault("favorited_at", time.strftime("%Y-%m-%dT%H:%M:%S"))
            if "note" in data:
                cur["note"] = data["note"]
            if "tags" in data:
                cur["tags"] = [t for t in data["tags"] if t]
            favs[slug] = cur
        save_favorites(favs)
    req._send_json(200, {"ok": True, "favorites": favs})


def _load_conv_index() -> dict:
    try:
        return json.loads(CONV_INDEX_PATH.read_text() or "{}")
    except Exception:
        return {}


def conversation_for_slug_handler(req, slug):
    """Resolve (or lazily create) the bare-conversation UUID bound to a radar
    slug. Idempotent: repeated calls return the same cid. The cid is what the
    frontend hands to <ChatDrawer/> so it can stream through the shell's
    /api/conversations/<uuid>/stream pipeline."""
    slug = unquote(slug)
    md, _ = _find_dossier(slug)
    if not md:
        req._send_json(404, {"error": "app not found"})
        return
    with _state_lock:
        idx = _load_conv_index()
        cid = idx.get(slug)
        if not cid:
            cid = str(uuid.uuid4())
            idx[slug] = cid
            CONV_INDEX_PATH.write_text(json.dumps(idx, ensure_ascii=False, indent=2))
            created = True
        else:
            created = False
    if created and _set_conv_context:
        # Bind the context so the first turn gets the dossier as system-prompt
        # prefix. Done outside the lock — set_conv_context takes its own lock.
        _set_conv_context(cid, {"kind": "radar_app", "slug": slug})
    req._send_json(200, {"id": cid, "created": created})


def list_chats_handler(req):
    apps_by_slug = {}
    for base in (APPS_DIR, GAMES_DIR):
        if base is None:
            continue
        for ap_path in base.glob("*.md"):
            d = parse_dossier(ap_path)
            if d:
                apps_by_slug[d["slug"]] = d
    out = []
    for f in CHATS_DIR.glob("*.jsonl"):
        slug = f.stem
        hist = chat_history(slug)
        if not hist:
            continue
        last = hist[-1]
        fm = apps_by_slug.get(slug, {}).get("frontmatter", {})
        preview = (last.get("content") or "").strip().replace("\n", " ")[:80]
        out.append({
            "slug": slug,
            "name": fm.get("name", slug),
            "source": fm.get("source", ""),
            "tags": fm.get("tags", []) if isinstance(fm.get("tags"), list) else [],
            "last_role": last.get("role"),
            "last_preview": preview,
            "last_ts": last.get("ts", 0),
            "count": len(hist),
        })
    out.sort(key=lambda x: x["last_ts"], reverse=True)
    req._send_json(200, out)


def get_chat_handler(req, slug):
    slug = unquote(slug)
    req._send_json(200, chat_history(slug))


def send_chat_handler(req, slug):
    slug = unquote(slug)
    data = req._read_json_body()
    msg = (data.get("message") or "").strip()
    if not msg:
        req._send_json(400, {"error": "empty message"})
        return
    md, _ = _find_dossier(slug)
    ap = parse_dossier(md) if md else None
    if not ap:
        req._send_json(404, {"error": "app not found"})
        return
    hist = chat_history(slug)
    prompt = build_chat_prompt(ap, hist, msg)
    response = _call_claude(prompt)
    append_chat(slug, "user", msg)
    append_chat(slug, "assistant", response)
    req._send_json(200, {"response": response})


def list_ideas_handler(req):
    req._send_json(200, list_ideas())


def get_note_handler(req, slug):
    slug = unquote(slug)
    req._send_json(200, {"markdown": load_notes(slug)})


def distill_note_handler(req, slug):
    slug = unquote(slug)
    md, _ = _find_dossier(slug)
    ap = parse_dossier(md) if md else None
    if not ap:
        req._send_json(404, {"error": "app not found"})
        return
    hist = chat_history(slug)
    if not hist:
        req._send_json(400, {"error": "尚无对话可提炼"})
        return
    prompt = build_summary_prompt(ap, hist)
    summary = _call_claude(prompt)
    with _state_lock:
        append_notes(slug, summary, ap["frontmatter"].get("name", slug))
        md = load_notes(slug)
    req._send_json(200, {"summary": summary, "markdown": md})


def suggest_notes_handler(req, slug):
    slug = unquote(slug)
    md, _ = _find_dossier(slug)
    ap = parse_dossier(md) if md else None
    if not ap:
        req._send_json(404, {"error": "app not found"})
        return
    prompt = build_note_suggestions_prompt(ap)
    text = _call_claude(prompt)
    suggestions = parse_suggestions(text)
    req._send_json(200, {"suggestions": suggestions, "raw": text})
