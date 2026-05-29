#!/usr/bin/env python3
"""Multi-app shell: auth + bare conversations + voice + sub-app loader.

Sub-apps live in <hot_app>/<sub>/ with a manifest.json declaring backend
module and URL prefix. The shell discovers them at startup, imports each
sub-app's api module, and dispatches matching URLs to its handlers.
"""
# Defer evaluation of all annotations so PEP 604 `X | None` syntax works on
# the macOS-shipped Python 3.9, which otherwise can't parse it.
from __future__ import annotations

import base64
import calendar
import hmac
import importlib
import json
import mimetypes
import os
import queue
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
DATA_DIR = ROOT / "data"
CONVERSATIONS_DIR = DATA_DIR / "conversations"
INTERRUPTS_DIR = DATA_DIR / "interrupts"
DIST_DIR = ROOT / "web-app" / "dist"

CONVERSATIONS_DIR.mkdir(parents=True, exist_ok=True)
INTERRUPTS_DIR.mkdir(parents=True, exist_ok=True)

# Guards read-modify-write of shell-owned JSON state (titles, mobile-origin set,
# per-conversation meta). Hold for the JSON r-m-w only — never around `claude
# -p` subprocess calls, or we'd re-serialize what threading was meant to fix.
_state_lock = threading.Lock()

# Sub-apps live as siblings of web/; let them be imported as Python packages.
sys.path.insert(0, str(ROOT))

# Minimal .env loader (no python-dotenv dependency)
ENV_PATH = ROOT / ".env"
if ENV_PATH.exists():
    for raw in ENV_PATH.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

BASIC_AUTH_USER = os.environ.get("BASIC_AUTH_USER", "")
BASIC_AUTH_PASS = os.environ.get("BASIC_AUTH_PASS", "")
# 用户在 prompt / UI 里的显示名。优先 USER_NAME，回落到登录名，再回落到"用户"。
USER_NAME = os.environ.get("USER_NAME") or BASIC_AUTH_USER or "用户"
# Volcengine 录音文件识别大模型 - two auth modes:
#   (a) X-Api-App-Key + X-Api-Access-Key (current path: console gives you both)
#   (b) X-Api-Key alone (newest console variant)
VOLC_APP_ID = os.environ.get("VOLC_APP_ID", "")
VOLC_ACCESS_TOKEN = os.environ.get("VOLC_ACCESS_TOKEN", "")
ARK_API_KEY = os.environ.get("ARK_API_KEY", "")
ARK_ASR_MODEL = os.environ.get("ARK_ASR_MODEL", "doubao-seed-asr-2-0")
ARK_BASE_URL = os.environ.get("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")
# Legacy 一句话识别 vars kept for fallback / migration safety; unused unless you wire them back.
DOUBAO_APPID = os.environ.get("DOUBAO_APPID", "")
DOUBAO_TOKEN = os.environ.get("DOUBAO_ACCESS_TOKEN", "")
DOUBAO_CLUSTER = os.environ.get("DOUBAO_CLUSTER", "")
AFCONVERT = "/usr/bin/afconvert"
AUTH_ENABLED = bool(BASIC_AUTH_USER and BASIC_AUTH_PASS)
EXPECTED_AUTH = (
    "Basic " + base64.b64encode(f"{BASIC_AUTH_USER}:{BASIC_AUTH_PASS}".encode()).decode()
    if AUTH_ENABLED else ""
)

PORT = 5051
# Total-call timeout for *non-streaming* paths (`call_claude`,
# `call_claude_in_session`) — used by title generation, polish, etc. Those
# return one shot, so a hard timeout makes sense.
CLAUDE_TIMEOUT = 180
# Streaming path uses two separate ceilings (see stream_claude_in_session):
#   - STREAM_IDLE_TIMEOUT: kill if no new stdout chunk for this long. Robust
#     to slow API first-byte (we've seen Anthropic take 30-50s) — as long as
#     claude is talking, we wait. Only kills genuinely stuck calls.
#   - STREAM_MAX_TIMEOUT: hard ceiling on total turn duration. Complex turns
#     with many tool round-trips can legitimately run minutes; this is just
#     a runaway guard.
STREAM_IDLE_TIMEOUT = 120
STREAM_MAX_TIMEOUT = 1800




def call_claude(prompt: str) -> str:
    try:
        result = subprocess.run(
            # bypassPermissions = "open all permissions" — required for headless
            # use because there's no human to approve permission prompts.
            ["claude", "-p", "--permission-mode", "bypassPermissions"],
            input=prompt,
            capture_output=True,
            text=True,
            timeout=CLAUDE_TIMEOUT,
            cwd=str(ROOT),
        )
    except FileNotFoundError:
        return "[错误：找不到 claude CLI。确认 Claude Code 已安装。]"
    except subprocess.TimeoutExpired:
        return f"[错误：claude 调用超过 {CLAUDE_TIMEOUT}s 超时]"
    if result.returncode != 0:
        msg = (result.stderr or result.stdout or "non-zero exit").strip()
        return f"[claude 返回错误：{msg[:400]}]"
    return result.stdout.strip() or "[空响应]"




# --- Bare conversations (not tied to any app) ---

CONV_ID_RE = re.compile(r"^[a-f0-9]{12}$")


def conv_path(cid: str) -> Path:
    return CONVERSATIONS_DIR / f"{cid}.jsonl"


def conv_meta_path(cid: str) -> Path:
    return CONVERSATIONS_DIR / f"{cid}.meta.json"


def conv_history(cid: str):
    p = conv_path(cid)
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


def conv_load_meta(cid: str):
    p = conv_meta_path(cid)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text())
    except json.JSONDecodeError:
        return {}


def conv_save_meta(cid: str, meta: dict) -> None:
    conv_meta_path(cid).write_text(json.dumps(meta, ensure_ascii=False, indent=2))


def conv_append(cid: str, role: str, content: str) -> None:
    entry = {"role": role, "content": content, "ts": int(time.time())}
    with conv_path(cid).open("a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def list_conversations():
    out = []
    for f in CONVERSATIONS_DIR.glob("*.jsonl"):
        cid = f.stem
        hist = conv_history(cid)
        if not hist:
            continue
        meta = conv_load_meta(cid)
        last = hist[-1]
        preview = (last.get("content") or "").strip().replace("\n", " ")[:80]
        out.append({
            "id": cid,
            "source": "legacy",
            "title": meta.get("title") or "新对话",
            "last_role": last.get("role"),
            "last_preview": preview,
            "last_ts": last.get("ts", 0),
            "count": len(hist),
            "context": None,
            "live": False,
            "last_interrupt_ts": 0,
        })
    return out


# === Claude Code session integration ====================================
# Mobile-created bare conversations and CLI-created sessions share storage:
# both go through `claude -p ... --session-id <uuid>`, which writes to
# ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl, where Claude Code encodes
# the cwd by replacing `/` and `_` with `-`. That way the same conversation
# is resumable from BOTH the mobile app and `claude --resume`.

CLAUDE_PROJECT_DIR = Path.home() / ".claude" / "projects" / (
    str(ROOT).replace("/", "-").replace("_", "-")
)
CONV_TITLES_PATH = DATA_DIR / "conv_titles.json"
MOBILE_ORIGIN_PATH = DATA_DIR / "mobile_origin_convs.json"  # set of UUIDs created via mobile
# Set of UUIDs the user has explicitly pinned to the main conversation list.
# Distinct from MOBILE_ORIGIN_PATH because sub-app convs are created server-side
# (so they shouldn't be "mobile origin") but the user may still want them
# surfaced in the main list. list_claude_sessions treats either set as
# "include in main list".
PINNED_CONVS_PATH = DATA_DIR / "pinned_convs.json"
# Per-conversation context binding. A conversation can be created with an
# optional `context` (e.g. {"kind": "radar_app", "slug": "..."}) which
# lets a sub-app inject a system-prompt prefix on the first turn. Sub-apps
# register a resolver via SERVICES["register_context_resolver"]. The mapping
# `cid -> context` is persisted here so the binding survives server restarts.
CONV_CONTEXTS_PATH = DATA_DIR / "conv_contexts.json"
# kind -> callable(context_dict) -> system_prompt_prefix str
CONTEXT_RESOLVERS: dict = {}
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
BARE_SYSTEM_PROMPT = (
    f"你是{USER_NAME}的对话助手。回答简洁（默认 200 字内），具体、直接，必要时反驳他的想法。"
    "默认中文，除非他用英文。"
)


def _is_uuid(s: str) -> bool:
    return bool(UUID_RE.match(s.lower()))


def claude_session_path(uuid_str: str) -> Path:
    return CLAUDE_PROJECT_DIR / f"{uuid_str}.jsonl"


def _interrupts_path(cid: str) -> Path:
    return INTERRUPTS_DIR / f"{cid}.jsonl"


def last_interrupt_ts(cid: str) -> int:
    """Wall-clock ts of the most recent interrupt record for cid, or 0."""
    p = _interrupts_path(cid)
    if not p.exists():
        return 0
    try:
        # File is append-only; mtime tracks the latest record cheaply without
        # parsing the body. Good enough for "show a ⚠ on the list row".
        return int(p.stat().st_mtime)
    except OSError:
        return 0


def is_cid_live(cid: str) -> bool:
    with _live_streams_lock:
        return cid in LIVE_STREAMS


def record_interrupt(cid: str, user_msg: str, reason: str, partial: str) -> None:
    """Append a stream-interruption marker for `cid`. Lets the frontend show
    a 'this turn died' breadcrumb on next load, since the CLI's own jsonl
    only gets flushed at end-of-turn (so killed turns leave no trace there)."""
    rec = {
        "ts": int(time.time()),
        "user_msg": (user_msg or "")[:500],
        "reason": (reason or "unknown")[:400],
        "partial": (partial or "")[:8000],
    }
    try:
        with _interrupts_path(cid).open("a") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except OSError:
        pass


def load_interrupts(cid: str) -> list:
    """Return list of {ts, user_msg, reason, partial} for a conversation."""
    p = _interrupts_path(cid)
    if not p.exists():
        return []
    out = []
    try:
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    except OSError:
        return []
    return out


def parse_claude_session(path: Path) -> list:
    """Extract just the user/assistant text turns from a Claude session jsonl,
    stripping all tool_use, attachments, file snapshots, system noise."""
    if not path.exists():
        return []
    out = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        t = e.get("type")
        if t not in ("user", "assistant"):
            continue
        ts_iso = e.get("timestamp", "")
        try:
            # Claude CLI writes UTC ISO strings (e.g. "2026-05-19T15:44:27.000Z").
            # timegm interprets the parsed struct_time as UTC; mktime would have
            # treated it as local time and shifted everything by the TZ offset.
            ts_unix = int(calendar.timegm(time.strptime(ts_iso[:19], "%Y-%m-%dT%H:%M:%S")))
        except Exception:
            ts_unix = 0
        msg = e.get("message") or {}
        content_raw = msg.get("content")
        # Plain string content (rare on assistant, common on legacy user input)
        if isinstance(content_raw, str):
            txt = content_raw.strip()
            if txt:
                out.append({
                    "role": t,
                    "kind": "user_text" if t == "user" else "assistant_text",
                    "content": txt,
                    "ts": ts_unix,
                })
            continue
        if not isinstance(content_raw, list):
            continue
        # Walk the content array. Each item may be text / tool_use / tool_result.
        for part in content_raw:
            if not isinstance(part, dict):
                continue
            pt = part.get("type")
            if pt == "text":
                txt = (part.get("text") or "").strip()
                if not txt:
                    continue
                out.append({
                    "role": t,
                    "kind": "user_text" if t == "user" else "assistant_text",
                    "content": txt,
                    "ts": ts_unix,
                })
            elif pt == "tool_use" and t == "assistant":
                # Truncate input if huge (e.g. Write with full file body)
                input_obj = part.get("input") or {}
                try:
                    input_serialized = json.dumps(input_obj, ensure_ascii=False)
                except Exception:
                    input_serialized = str(input_obj)
                if len(input_serialized) > 4000:
                    input_obj = {"__truncated__": True, "preview": input_serialized[:2000]}
                out.append({
                    "role": t,
                    "kind": "tool_use",
                    "content": "",
                    "ts": ts_unix,
                    "tool": part.get("name") or "",
                    "input": input_obj,
                    "tool_use_id": part.get("id") or "",
                })
            elif pt == "tool_result" and t == "user":
                # Real result lives in the top-level e["toolUseResult"];
                # part.content is sometimes a stub like {tool_reference}.
                tur = e.get("toolUseResult")
                result_text = ""
                if isinstance(tur, str):
                    result_text = tur
                elif isinstance(tur, dict):
                    try:
                        result_text = json.dumps(tur, ensure_ascii=False)
                    except Exception:
                        result_text = str(tur)
                else:
                    pc = part.get("content")
                    if isinstance(pc, str):
                        result_text = pc
                    elif isinstance(pc, list):
                        # extract text-ish chunks
                        chunks = []
                        for ic in pc:
                            if isinstance(ic, dict):
                                if ic.get("type") == "text":
                                    chunks.append(ic.get("text", ""))
                                elif ic.get("type") == "tool_reference":
                                    chunks.append(f"[ref: {ic.get('tool_name','')}]")
                        result_text = "\n".join(chunks)
                if len(result_text) > 4000:
                    result_text = result_text[:4000] + "\n…(truncated)"
                out.append({
                    "role": t,
                    "kind": "tool_result",
                    "content": "",
                    "ts": ts_unix,
                    "tool_use_id": part.get("tool_use_id") or "",
                    "result": result_text,
                    "is_error": bool(part.get("is_error")),
                })
    return out


def _load_titles() -> dict:
    if not CONV_TITLES_PATH.exists():
        return {}
    try:
        return json.loads(CONV_TITLES_PATH.read_text())
    except json.JSONDecodeError:
        return {}


def _save_titles(titles: dict) -> None:
    CONV_TITLES_PATH.write_text(json.dumps(titles, ensure_ascii=False, indent=2))


def _load_mobile_origins() -> set:
    if not MOBILE_ORIGIN_PATH.exists():
        return set()
    try:
        return set(json.loads(MOBILE_ORIGIN_PATH.read_text()))
    except (json.JSONDecodeError, TypeError):
        return set()


def _mark_mobile_origin(uuid_str: str) -> None:
    with _state_lock:
        s = _load_mobile_origins()
        if uuid_str in s:
            return
        s.add(uuid_str)
        MOBILE_ORIGIN_PATH.write_text(json.dumps(sorted(s), ensure_ascii=False, indent=2))


def _load_pinned_convs() -> set:
    if not PINNED_CONVS_PATH.exists():
        return set()
    try:
        return set(json.loads(PINNED_CONVS_PATH.read_text()))
    except (json.JSONDecodeError, TypeError):
        return set()


def _set_pinned_conv(uuid_str: str, pinned: bool) -> None:
    with _state_lock:
        s = _load_pinned_convs()
        if pinned and uuid_str not in s:
            s.add(uuid_str)
        elif not pinned and uuid_str in s:
            s.discard(uuid_str)
        else:
            return
        PINNED_CONVS_PATH.write_text(json.dumps(sorted(s), ensure_ascii=False, indent=2))


def _load_conv_contexts() -> dict:
    if not CONV_CONTEXTS_PATH.exists():
        return {}
    try:
        return json.loads(CONV_CONTEXTS_PATH.read_text())
    except json.JSONDecodeError:
        return {}


def conv_context(cid: str) -> dict | None:
    """Return the context dict bound at conversation creation, or None."""
    return _load_conv_contexts().get(cid)


def _set_conv_context(cid: str, context: dict) -> None:
    with _state_lock:
        m = _load_conv_contexts()
        m[cid] = context
        CONV_CONTEXTS_PATH.write_text(json.dumps(m, ensure_ascii=False, indent=2))


def _drop_conv_context(cid: str) -> None:
    with _state_lock:
        m = _load_conv_contexts()
        if cid in m:
            del m[cid]
            CONV_CONTEXTS_PATH.write_text(json.dumps(m, ensure_ascii=False, indent=2))


def register_context_resolver(kind: str, resolver) -> None:
    """Sub-apps call this in `bind(ctx)` to teach the shell how to render a
    system-prompt prefix for conversations bound to their data. Resolver gets
    the context dict (e.g. {"kind": "radar_app", "slug": "foo"}) and returns
    a string to prepend before BARE_SYSTEM_PROMPT.
    """
    CONTEXT_RESOLVERS[kind] = resolver


def resolve_context_prefix(context: dict | None) -> str:
    if not context:
        return ""
    kind = context.get("kind")
    fn = CONTEXT_RESOLVERS.get(kind) if kind else None
    if not fn:
        return ""
    try:
        return (fn(context) or "").strip()
    except Exception as e:
        print(f"[context-resolver] {kind} failed: {e}", flush=True)
        return ""


def get_claude_session_title(uuid_str: str) -> str:
    return _load_titles().get(uuid_str, "")


def set_claude_session_title(uuid_str: str, title: str) -> None:
    with _state_lock:
        titles = _load_titles()
        titles[uuid_str] = title
        _save_titles(titles)


def list_claude_sessions(mobile_only: bool = False) -> list:
    """List all UUID-keyed Claude sessions in this project's storage.
    If mobile_only=True, only sessions created via the mobile app (tracked
    in MOBILE_ORIGIN_PATH) are returned — keeps the user's bare-conversation
    list clean instead of drowning it in dozens of CLI/dev sessions."""
    if not CLAUDE_PROJECT_DIR.exists():
        return []
    titles = _load_titles()
    mobile_set = _load_mobile_origins() if mobile_only else None
    # User-pinned cids also surface in the main list, regardless of origin.
    # Sub-app convs land here when the user explicitly pins from the drawer.
    pinned_set = _load_pinned_convs() if mobile_only else None
    out = []
    for f in CLAUDE_PROJECT_DIR.glob("*.jsonl"):
        uuid_str = f.stem
        if not _is_uuid(uuid_str):
            continue
        if mobile_only and uuid_str not in mobile_set and uuid_str not in pinned_set:
            continue
        msgs = parse_claude_session(f)
        if not msgs:
            continue
        # For list view, only count/preview from real text turns — tool calls
        # shouldn't make the list look full of "result" rows.
        text_msgs = [m for m in msgs if m.get("kind") in ("user_text", "assistant_text")]
        if not text_msgs:
            continue
        last = text_msgs[-1]
        first_user = next((m for m in text_msgs if m["role"] == "user"), None)
        title = titles.get(uuid_str, "")
        if not title and first_user:
            title = (first_user["content"] or "").strip().replace("\n", " ")[:30]
        if not title:
            title = "未命名对话"
        preview = (last.get("content") or "").strip().replace("\n", " ")[:80]
        last_ts = last.get("ts") or int(f.stat().st_mtime)
        out.append({
            "id": uuid_str,
            "source": "claude",
            "origin": "mobile" if uuid_str in (mobile_set or _load_mobile_origins()) else "cli",
            "title": title,
            "last_role": last["role"],
            "last_preview": preview,
            "last_ts": last_ts,
            "count": len(text_msgs),
            "context": conv_context(uuid_str),
            "live": is_cid_live(uuid_str),
            "last_interrupt_ts": last_interrupt_ts(uuid_str),
        })

    # Augment with first-turn conversations that have a live stream running
    # but no jsonl yet — claude CLI only flushes the file at end-of-turn,
    # so newly-created chats wouldn't otherwise show in the list until they
    # finish. Derive preview/title from the in-memory event buffer.
    seen = {item["id"] for item in out}
    with _live_streams_lock:
        live_cids = list(LIVE_STREAMS.keys())
    for cid in live_cids:
        if cid in seen:
            continue
        if mobile_only and cid not in (mobile_set or set()) and cid not in (pinned_set or set()):
            continue
        with _live_streams_lock:
            stream = LIVE_STREAMS.get(cid)
        if stream is None:
            continue
        with stream.lock:
            events_snapshot = list(stream.events)
        user_text = ""
        user_ts = 0
        assistant_text = ""
        for ev in events_snapshot:
            t = ev.get("type")
            if t == "user_message":
                user_text = ev.get("text", "")
                user_ts = int(ev.get("ts") or 0)
            elif t == "text":
                assistant_text += ev.get("text", "")
        if not user_text:
            continue  # nothing yet to show
        title = titles.get(cid) or user_text.strip().replace("\n", " ")[:30] or "新对话"
        last_role = "assistant" if assistant_text else "user"
        last_preview = (assistant_text or user_text).strip().replace("\n", " ")[:80]
        out.append({
            "id": cid,
            "source": "claude",
            "origin": "mobile",
            "title": title,
            "last_role": last_role,
            "last_preview": last_preview,
            "last_ts": user_ts or int(time.time()),
            "count": 2 if assistant_text else 1,
            "context": conv_context(cid),
            "live": True,  # synthesized from LIVE_STREAMS itself
            "last_interrupt_ts": last_interrupt_ts(cid),
        })
    return out


def call_claude_in_session(message: str, session_id: str, is_first: bool) -> str:
    """Run claude -p with --session-id (first call) or --resume (subsequent).
    The session file gets created at CLAUDE_PROJECT_DIR/<session_id>.jsonl,
    visible to both `claude --resume` in the terminal AND our mobile app."""
    # bypassPermissions = "open all permissions" — headless server, no human to
    # approve prompts. Same as call_claude().
    cmd = ["claude", "-p", message, "--permission-mode", "bypassPermissions"]
    if is_first:
        ctx_prefix = resolve_context_prefix(conv_context(session_id))
        system_prompt = (
            ctx_prefix + "\n\n" + BARE_SYSTEM_PROMPT if ctx_prefix else BARE_SYSTEM_PROMPT
        )
        cmd += ["--session-id", session_id, "--system-prompt", system_prompt]
    else:
        cmd += ["--resume", session_id]
    try:
        result = subprocess.run(
            cmd,
            input="",  # explicit empty stdin to silence "no stdin" warning
            capture_output=True,
            text=True,
            timeout=CLAUDE_TIMEOUT,
            cwd=str(ROOT),
        )
    except FileNotFoundError:
        return "[错误：找不到 claude CLI]"
    except subprocess.TimeoutExpired:
        return f"[错误：claude 超过 {CLAUDE_TIMEOUT}s 超时]"
    if result.returncode != 0:
        msg = (result.stderr or result.stdout or "non-zero exit").strip()
        return f"[claude 返回错误：{msg[:400]}]"
    return result.stdout.strip() or "[空响应]"


# =====================================================================
# Live-stream hub: lets multiple clients share one running claude turn,
# and lets a client that left mid-turn rejoin from where it dropped.
#
# One LiveStream per active POST /stream. The originator's POST handler
# appends events as they come from claude; any GET /live subscriber gets a
# full replay of past events + future events until the turn ends.
# Cleared from LIVE_STREAMS on completion so a new turn can start.
# =====================================================================
_live_streams_lock = threading.Lock()
LIVE_STREAMS: dict = {}  # cid -> LiveStream


class LiveStream:
    def __init__(self, cid: str):
        self.cid = cid
        self.lock = threading.Lock()
        self.events: list[dict] = []
        # Subscribers' queues. Each get() yields the next event for that
        # subscriber. Terminal-marker `{_terminal: True}` is enqueued on finish.
        self.subscribers: list = []  # list[queue.Queue]
        self.done = False

    def append(self, ev: dict) -> None:
        with self.lock:
            self.events.append(ev)
            subs = list(self.subscribers)
        for q in subs:
            try:
                q.put_nowait(ev)
            except Exception:
                pass

    def subscribe(self):
        """Returns (replay_events, live_queue). live_queue is None if already done."""
        with self.lock:
            replay = list(self.events)
            if self.done:
                return replay, None
            q: "queue.Queue[dict]" = queue.Queue()
            self.subscribers.append(q)
            return replay, q

    def unsubscribe(self, q) -> None:
        with self.lock:
            try:
                self.subscribers.remove(q)
            except ValueError:
                pass

    def finish(self) -> None:
        with self.lock:
            self.done = True
            subs = list(self.subscribers)
            self.subscribers = []
        for q in subs:
            try:
                q.put_nowait({"_terminal": True})
            except Exception:
                pass


def stream_claude_in_session(message: str, session_id: str, is_first: bool):
    """Generator yielding normalized event dicts from claude CLI's stream-json
    output. Event shapes (caller wraps into SSE):
      {type:"text", text:"..."}
      {type:"tool_use", tool, input, tool_use_id}
      {type:"tool_result", tool_use_id, result, is_error}
      {type:"keepalive"}   – no new event for KEEPALIVE_S; caller emits comment
      {type:"error", error:"..."}
      {type:"done"}        – always last
    """
    # One debug log per turn so concurrent turns don't clobber each other
    # and old logs are easy to find by mtime. Keep the file even on success
    # so we have a paper trail when a turn silently stops mid-stream.
    debug_dir = DATA_DIR / "claude-debug"
    debug_dir.mkdir(parents=True, exist_ok=True)
    # Rotate: keep newest 49, claude is about to add the 50th. Skip the
    # `latest` symlink that claude maintains.
    try:
        existing = sorted(
            (p for p in debug_dir.glob("*.log") if not p.is_symlink()),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for old in existing[49:]:
            try:
                old.unlink()
            except OSError:
                pass
    except OSError:
        pass
    debug_file = debug_dir / f"{session_id}-{int(time.time())}.log"

    cmd = [
        "claude", "-p", message,
        "--permission-mode", "bypassPermissions",
        "--output-format", "stream-json", "--verbose",
        # Without this, claude CLI buffers each assistant message until the
        # whole turn finishes, so the user sees "wait 10s, then 300 chars
        # appear at once". With it, we get content_block_delta events ~every
        # 500ms — true token-level streaming.
        "--include-partial-messages",
        # Captures API requests/retries/errors so we can diagnose mid-turn
        # disconnects after the fact. File path is unique per turn.
        "--debug-file", str(debug_file),
    ]
    if is_first:
        # Compose system prompt: sub-app context prefix (if any) + the default
        # bare-chat persona. The prefix typically embeds a dossier / design doc
        # so the model has the relevant material from turn one. Subsequent
        # turns use --resume; the prompt is recovered from the saved session.
        ctx_prefix = resolve_context_prefix(conv_context(session_id))
        system_prompt = (
            ctx_prefix + "\n\n" + BARE_SYSTEM_PROMPT if ctx_prefix else BARE_SYSTEM_PROMPT
        )
        cmd += ["--session-id", session_id, "--system-prompt", system_prompt]
    else:
        cmd += ["--resume", session_id]

    try:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(ROOT),
            # Binary + unbuffered. Earlier we used text=True/bufsize=1, but
            # Python's TextIOWrapper buffers reads, so each 500ms delta from
            # claude CLI sat in the buffer until the *whole* response finished
            # — defeating partial-message streaming. Read raw bytes and decode
            # per line.
            bufsize=0,
        )
    except FileNotFoundError:
        yield {"type": "error", "error": "找不到 claude CLI"}
        yield {"type": "done"}
        return

    q: "queue.Queue[tuple[str, str | None]]" = queue.Queue()

    def _reader():
        try:
            assert proc.stdout is not None
            for raw in iter(proc.stdout.readline, b""):
                q.put(("line", raw.decode("utf-8", "replace")))
        finally:
            q.put(("eof", None))

    threading.Thread(target=_reader, daemon=True).start()

    KEEPALIVE_S = 15
    deadline = time.time() + STREAM_MAX_TIMEOUT
    last_chunk_time = time.time()

    while True:
        now = time.time()
        idle_for = now - last_chunk_time
        if idle_for >= STREAM_IDLE_TIMEOUT:
            try:
                proc.kill()
            except Exception:
                pass
            yield {"type": "error", "error": f"claude 卡住 ({int(idle_for)}s 无新输出)"}
            break
        if now >= deadline:
            try:
                proc.kill()
            except Exception:
                pass
            yield {"type": "error", "error": f"claude 超过 {STREAM_MAX_TIMEOUT}s 总时长"}
            break
        # Block on the queue until either KEEPALIVE_S, idle timeout, or hard
        # deadline fires — whichever is closer. (idle - idle_for) is the time
        # left before we'd kill on idle.
        wait = min(KEEPALIVE_S, STREAM_IDLE_TIMEOUT - idle_for, deadline - now)
        wait = max(1.0, wait)
        try:
            kind, payload = q.get(timeout=wait)
        except queue.Empty:
            # No new chunk this interval; emit SSE keepalive (so the proxy
            # doesn't 504) and re-check idle/deadline on next iteration.
            yield {"type": "keepalive"}
            continue
        last_chunk_time = time.time()
        if kind == "eof":
            break
        line = (payload or "").strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        t = ev.get("type")
        if t == "stream_event":
            # Token-level delta from --include-partial-messages. We only care
            # about text_delta here; the final assistant message still arrives
            # as a `type: assistant` event below, but we skip its text part to
            # avoid double-emitting.
            inner = ev.get("event") or {}
            if inner.get("type") == "content_block_delta":
                d = inner.get("delta") or {}
                if d.get("type") == "text_delta":
                    chunk = d.get("text") or ""
                    if chunk:
                        yield {"type": "text", "text": chunk}
            continue
        if t == "assistant":
            msg = ev.get("message") or {}
            for part in (msg.get("content") or []):
                if not isinstance(part, dict):
                    continue
                pt = part.get("type")
                if pt == "text":
                    # Skip — already streamed via partial stream_event deltas.
                    continue
                elif pt == "tool_use":
                    input_obj = part.get("input") or {}
                    try:
                        input_serialized = json.dumps(input_obj, ensure_ascii=False)
                    except Exception:
                        input_serialized = str(input_obj)
                    if len(input_serialized) > 4000:
                        input_obj = {"__truncated__": True, "preview": input_serialized[:2000]}
                    yield {
                        "type": "tool_use",
                        "tool": part.get("name") or "",
                        "input": input_obj,
                        "tool_use_id": part.get("id") or "",
                    }
        elif t == "user":
            msg = ev.get("message") or {}
            for part in (msg.get("content") or []):
                if not isinstance(part, dict) or part.get("type") != "tool_result":
                    continue
                tur = ev.get("toolUseResult")
                result_text = ""
                if isinstance(tur, str):
                    result_text = tur
                elif isinstance(tur, dict):
                    try:
                        result_text = json.dumps(tur, ensure_ascii=False)
                    except Exception:
                        result_text = str(tur)
                else:
                    pc = part.get("content")
                    if isinstance(pc, str):
                        result_text = pc
                    elif isinstance(pc, list):
                        chunks = []
                        for ic in pc:
                            if isinstance(ic, dict) and ic.get("type") == "text":
                                chunks.append(ic.get("text", ""))
                        result_text = "\n".join(chunks)
                if len(result_text) > 4000:
                    result_text = result_text[:4000] + "\n…(truncated)"
                yield {
                    "type": "tool_result",
                    "tool_use_id": part.get("tool_use_id") or "",
                    "result": result_text,
                    "is_error": bool(part.get("is_error")),
                }
        elif t == "result" and ev.get("is_error"):
            err = ev.get("result") or "claude returned error"
            yield {"type": "error", "error": str(err)[:400]}

    try:
        proc.wait(timeout=5)
    except Exception:
        pass
    yield {"type": "done"}


def build_bare_chat_prompt(history, message):
    parts = [
        f"你是{USER_NAME}的对话助手。回答简洁（默认 200 字内），具体、直接，必要时反驳他的想法。",
        "默认中文，除非他用英文。不要用工具，只输出文本回复。",
        "",
    ]
    if history:
        parts.append("此前对话（最近 10 轮）：")
        for msg in history[-10:]:
            role = USER_NAME if msg.get("role") == "user" else "你"
            parts.append(f"{role}：{msg.get('content', '')}")
        parts.append("")
    parts.append(f"{USER_NAME}：{message}")
    parts.append("你：")
    return "\n".join(parts)


def build_title_prompt(first_user: str, first_assistant: str) -> str:
    return "\n".join([
        "为下面的对话起一个 5-10 字的简短中文标题，描述主题。",
        "只输出标题本身，不要引号、不要标点、不要解释、不要 markdown。",
        "",
        f"用户：{first_user[:300]}",
        f"AI：{first_assistant[:400]}",
        "",
        "标题：",
    ])


def generate_conv_title_async(cid: str, first_user: str, first_assistant: str) -> None:
    def _work():
        try:
            prompt = build_title_prompt(first_user, first_assistant)
            raw = call_claude(prompt)
            title = raw.strip().splitlines()[0] if raw.strip() else ""
            # Strip surrounding quotes / brackets / asterisks Claude sometimes adds
            title = re.sub(r'^[\s"“”\'`*【\[]+|[\s"“”\'`*】\]]+$', "", title)[:30]
            if not title:
                title = "新对话"
            with _state_lock:
                meta = conv_load_meta(cid)
                meta["title"] = title
                conv_save_meta(cid, meta)
        except Exception:
            pass
    threading.Thread(target=_work, daemon=True).start()


# --- Voice: audio conversion + Volcengine ASR + Claude polish ---


def convert_to_wav_16k_mono(audio_bytes: bytes, src_ext: str) -> bytes:
    """Use macOS built-in afconvert to transcode any input → WAV PCM s16 16kHz mono."""
    tmp_in = tempfile.NamedTemporaryFile(suffix="." + src_ext, delete=False)
    tmp_out = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    try:
        tmp_in.write(audio_bytes)
        tmp_in.close()
        tmp_out.close()
        result = subprocess.run(
            [AFCONVERT, "-f", "WAVE", "-d", "LEI16@16000", "-c", "1",
             tmp_in.name, tmp_out.name],
            capture_output=True, timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(f"afconvert failed: {result.stderr.decode('utf-8', 'replace')[:300]}")
        return Path(tmp_out.name).read_bytes()
    finally:
        for p in (tmp_in.name, tmp_out.name):
            try:
                os.unlink(p)
            except OSError:
                pass


# Note: official sample uses openspeech-direct.zijieapi.com host; the bytedance.com
# alias works too in some regions but the official sample prefers this one.
VOLC_AUC_FLASH_URL = "https://openspeech-direct.zijieapi.com/api/v3/auc/bigmodel/recognize/flash"
VOLC_AUC_SUBMIT_URL = "https://openspeech-direct.zijieapi.com/api/v3/auc/bigmodel/submit"
VOLC_AUC_QUERY_URL = "https://openspeech-direct.zijieapi.com/api/v3/auc/bigmodel/query"
VOLC_AUC_RESOURCE_ID = "volc.bigasr.auc"  # 录音文件识别大模型 resource id


def _volc_auth_headers(request_id: str, x_tt_logid: str = "") -> dict:
    """Build auth headers. Picks mode based on env vars:
      - VOLC_APP_ID + VOLC_ACCESS_TOKEN  → X-Api-App-Key + X-Api-Access-Key (current console)
      - ARK_API_KEY                       → X-Api-Key alone (newest console)
    """
    h: dict[str, str] = {
        "Content-Type": "application/json",
        "X-Api-Resource-Id": VOLC_AUC_RESOURCE_ID,
        "X-Api-Request-Id": request_id,
    }
    if x_tt_logid:
        h["X-Tt-Logid"] = x_tt_logid
    if VOLC_APP_ID and VOLC_ACCESS_TOKEN:
        h["X-Api-App-Key"] = VOLC_APP_ID
        h["X-Api-Access-Key"] = VOLC_ACCESS_TOKEN
    elif ARK_API_KEY:
        h["X-Api-Key"] = ARK_API_KEY
    else:
        raise RuntimeError(
            "Volcengine credentials missing — set VOLC_APP_ID + VOLC_ACCESS_TOKEN "
            "(or ARK_API_KEY) in .env"
        )
    return h


def _volc_post_raw(url: str, payload: dict, headers: dict) -> tuple[int, dict, bytes]:
    """POST JSON. Returns (http_status, response_headers_lower_keys, body_bytes).
    Volcengine surfaces ASR status in response *headers* (X-Api-Status-Code), not body."""
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        # Volcengine returns 200 even for errors most of the time, but on auth failures
        # it returns 401. Fold both paths through the same status-code-from-headers check.
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()
    except urllib.error.URLError as e:
        raise RuntimeError(f"Volc ASR network error: {e}")


def call_ark_asr(audio_bytes: bytes, audio_format: str = "wav", audio_url: str = "") -> dict:
    """Call Volcengine 录音文件识别大模型 极速版 (sync flash endpoint).

    Single round-trip: POST /recognize/flash → returns the transcript directly.
    Two audio modes:
      1. audio_url provided → reference a public URL
      2. else → send inline base64 in audio.data
    Returns {'text': str, 'raw': dict, 'polls': 1, 'submit_ms': N}.
    """
    request_id = str(uuid.uuid4())
    audio_field: dict[str, str] = {"format": audio_format}
    if audio_url:
        audio_field["url"] = audio_url
    else:
        audio_field["data"] = base64.b64encode(audio_bytes).decode("ascii")

    body_payload = {
        "user": {"uid": "user"},
        "audio": audio_field,
        "request": {
            "model_name": "bigmodel",
            "enable_itn": True,
            "enable_punc": True,
            "enable_ddc": True,
        },
    }

    headers = _volc_auth_headers(request_id)
    headers["X-Api-Sequence"] = "-1"
    t0 = time.time()
    status, hdrs, body = _volc_post_raw(VOLC_AUC_FLASH_URL, body_payload, headers)
    elapsed_ms = int((time.time() - t0) * 1000)
    api_code = hdrs.get("x-api-status-code", "")
    api_msg = hdrs.get("x-api-message", "")
    if api_code != "20000000":
        try:
            err_body = json.loads(body)
        except Exception:
            err_body = body.decode("utf-8", "replace")[:400]
        raise RuntimeError(f"Volc ASR flash failed: code={api_code} msg={api_msg} body={err_body}")
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        raise RuntimeError(f"Volc ASR flash returned non-JSON body: {body[:200]!r}")
    result = data.get("result")
    text = ""
    if isinstance(result, dict):
        text = result.get("text") or ""
        utterances = result.get("utterances") or []
        if not text and utterances:
            text = " ".join(u.get("text", "") for u in utterances if isinstance(u, dict))
    print(f"[asr-flash] {elapsed_ms}ms text_len={len(text)}", flush=True)
    return {"text": text.strip(), "raw": data, "polls": 1, "submit_ms": elapsed_ms}


def call_volcengine_asr(wav_bytes: bytes) -> dict:
    """Legacy: Volcengine 一句话识别. Returns {'text': str, 'raw': dict}.
    Kept for fallback. Not called by /api/transcribe right now."""
    if not (DOUBAO_APPID and DOUBAO_TOKEN and DOUBAO_CLUSTER):
        raise RuntimeError("Doubao credentials missing — set DOUBAO_APPID/ACCESS_TOKEN/CLUSTER in .env")
    payload = {
        "app": {
            "appid": DOUBAO_APPID,
            "token": DOUBAO_TOKEN,
            "cluster": DOUBAO_CLUSTER,
        },
        "user": {"uid": "user"},
        "audio": {
            "format": "wav",
            "rate": 16000,
            "channel": 1,
            "bits": 16,
            "data": base64.b64encode(wav_bytes).decode("ascii"),
        },
        "request": {
            "reqid": str(uuid.uuid4()),
            "nbest": 1,
            "result_type": "single",
            "language": "zh-CN",
        },
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        "https://openspeech.bytedance.com/api/v1/asr",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer; {DOUBAO_TOKEN}",  # NB: literal semicolon
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = json.loads(r.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", "replace")[:400]
        raise RuntimeError(f"ASR HTTP {e.code}: {body_text}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"ASR network error: {e}")
    code = raw.get("code", -1)
    if code != 1000 and code != 0:  # Volcengine uses 1000 for success in some variants, 0 in others
        raise RuntimeError(f"ASR returned code={code}: {raw.get('message', '')}")
    text = ""
    result = raw.get("result")
    if isinstance(result, list) and result:
        text = result[0].get("text", "")
    elif isinstance(result, dict):
        text = result.get("text", "")
    return {"text": text, "raw": raw}


def build_polish_prompt(text: str) -> str:
    return (
        f"下面是{USER_NAME}的口语转写文本，请整理成通顺、有条理的中文。"
        "保持原意；不要添加事实；不要解释；只输出整理后的文本，不要前言或后记。\n\n"
        "原稿：\n" + text.strip() + "\n\n"
        "整理后："
    )


def parse_multipart(body: bytes, content_type: str) -> dict:
    """Minimal multipart/form-data parser. Returns {field_name: bytes_or_str}.
    Files are returned as bytes; text fields as str."""
    m = re.search(r'boundary=(?:"([^"]+)"|([^;\s]+))', content_type)
    if not m:
        raise ValueError("missing boundary")
    boundary = ("--" + (m.group(1) or m.group(2))).encode()
    parts = body.split(boundary)
    out = {}
    for part in parts:
        part = part.strip(b"\r\n")
        if not part or part == b"--":
            continue
        if b"\r\n\r\n" not in part:
            continue
        head, _, payload = part.partition(b"\r\n\r\n")
        payload = payload.rstrip(b"\r\n")
        head_str = head.decode("utf-8", "replace")
        name_m = re.search(r'name="([^"]+)"', head_str)
        if not name_m:
            continue
        name = name_m.group(1)
        if "filename=" in head_str:
            out[name] = payload  # bytes
        else:
            out[name] = payload.decode("utf-8", "replace")
    return out


CORS_ORIGINS = {"http://localhost:5174", "http://127.0.0.1:5174"}


# === Sub-app discovery ===
# Scan <ROOT>/*/manifest.json. Each sub-app's api module exports register(router, ctx).

# (method, compiled_regex, handler, sub_id)
SUB_ROUTES: list = []
SUB_APPS: list[dict] = []


class Router:
    def __init__(self, sub_id: str, prefix: str):
        self.sub_id = sub_id
        self.prefix = prefix

    def add(self, method: str, pattern: str, handler):
        assert pattern.startswith(self.prefix), (
            f"{self.sub_id}: route {pattern!r} must start with prefix {self.prefix!r}"
        )
        # Single-pass replace so we don't accidentally re-match inside (?P<name>...) we just emitted:
        # <path:name> matches any remainder (may be empty, may include `/`).
        # <name>      matches one URL segment.
        def _sub(m: "re.Match[str]") -> str:
            kind, name = m.group(1), m.group(2)
            return f"(?P<{name}>.*)" if kind == "path:" else f"(?P<{name}>[^/]+)"
        rx_src = re.sub(r"<(path:)?(\w+)>", _sub, pattern)
        rx = re.compile("^" + rx_src + "$")
        SUB_ROUTES.append((method.upper(), rx, handler, self.sub_id))


SERVICES = {
    "call_claude": call_claude,
    "register_context_resolver": register_context_resolver,
    "set_conv_context": _set_conv_context,
    "drop_conv_context": _drop_conv_context,
    # Let sub-apps read messages from a shell-managed conversation (those
    # backed by ~/.claude/projects/<encoded>/<cid>.jsonl), so features like
    # distillation can operate on chats that flow through the streaming pipe.
    "claude_session_path": claude_session_path,
    "parse_claude_session": parse_claude_session,
    "get_session_title": get_claude_session_title,
}


def load_sub_apps() -> None:
    # Sub-apps live as hot_app/app/<sub>/ ; the "app/" container keeps the
    # repo root clean (web/ + web-app/ + data/ + the sub-app folder).
    for mf_path in sorted(ROOT.glob("app/*/manifest.json")):
        try:
            mf = json.loads(mf_path.read_text())
        except Exception as e:
            print(f"[sub-app] skip {mf_path}: {e}", flush=True)
            continue
        sub_dir = mf_path.parent
        # 所有 sub-app 的运行时数据统一落在 <ROOT>/data/sub_app/<id>/ 下。
        # manifest 里 data_dirs 的 value 是相对该目录的子路径（"." = 根本身）。
        sub_data_root = ROOT / "data" / "sub_app" / mf["id"]
        sub_data_root.mkdir(parents=True, exist_ok=True)
        ctx = {
            "sub_id": mf["id"],
            "sub_root": sub_dir,
            "data_dirs": {k: sub_data_root / v for k, v in mf["backend"].get("data_dirs", {}).items()},
            "prefix": mf["backend"]["prefix"],
            "services": SERVICES,
            "user_name": USER_NAME,
        }
        mod_name = mf["backend"]["module"]
        try:
            mod = importlib.import_module(mod_name)
            router = Router(mf["id"], mf["backend"]["prefix"])
            mod.register(router, ctx)
        except Exception as e:
            print(f"[sub-app] {mf['id']} register failed: {e}", flush=True)
            continue
        SUB_APPS.append({"id": mf["id"], "manifest": mf, "root": sub_dir})
        n = sum(1 for r in SUB_ROUTES if r[3] == mf["id"])
        print(f"[sub-app] {mf['id']}: {n} routes under {mf['backend']['prefix']}", flush=True)


def dispatch_sub(req: "Handler", method: str, path: str) -> bool:
    for m, rx, fn, _sid in SUB_ROUTES:
        if m != method:
            continue
        mt = rx.match(path)
        if mt:
            fn(req, **mt.groupdict())
            return True
    return False


class Handler(BaseHTTPRequestHandler):
    def _cors_headers(self):
        origin = self.headers.get("Origin", "")
        if origin in CORS_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Vary", "Origin")

    def _check_auth(self) -> bool:
        """Return True if request is authorized (or auth disabled). Otherwise send 401 and return False."""
        if not AUTH_ENABLED:
            return True
        got = self.headers.get("Authorization", "")
        if got and hmac.compare_digest(got, EXPECTED_AUTH):
            return True
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Hot App Radar", charset="UTF-8"')
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self._cors_headers()
        self.end_headers()
        self.wfile.write(b"401 Unauthorized\n")
        return False

    def do_OPTIONS(self):
        # CORS preflight never carries credentials; let it through.
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path, ctype: str):
        if not path.exists():
            self.send_error(404)
            return
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        n = int(self.headers.get("Content-Length", "0") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n))
        except json.JSONDecodeError:
            return {}

    def _serve_dist(self, rel: str):
        """Serve a file from web-app/dist/. rel is the URL path (no leading slash)."""
        # Prevent path traversal: resolve and check it's still inside DIST_DIR.
        target = (DIST_DIR / rel).resolve()
        try:
            target.relative_to(DIST_DIR.resolve())
        except ValueError:
            self.send_error(403)
            return
        if not target.exists() or not target.is_file():
            self.send_error(404)
            return
        ctype, _ = mimetypes.guess_type(str(target))
        if not ctype:
            ctype = "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        # Long cache for hashed assets (vite emits content-hashed filenames in /assets/)
        if rel.startswith("assets/"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        p = u.path
        # Static assets (HTML / JS / CSS / icons) are public so the browser
        # never prompts for Basic Auth at navigation time. The React app
        # handles login itself via an in-app modal and stores credentials
        # in localStorage, which survives PWA close/reopen.
        try:
            # Built React app (production / tunnel mode)
            if p == "/" or p == "/index.html":
                if (DIST_DIR / "index.html").exists():
                    self._serve_dist("index.html")
                else:
                    self._send_file(WEB_DIR / "index.html", "text/html; charset=utf-8")
                return
            if p.startswith("/assets/") or p in ("/vite.svg", "/favicon.ico", "/favicon.svg", "/icons.svg", "/manifest.json", "/manifest.webmanifest"):
                self._serve_dist(p.lstrip("/"))
                return
            # Legacy vanilla viewer files
            if p == "/app.js":
                self._send_file(WEB_DIR / "app.js", "application/javascript; charset=utf-8")
                return
            if p == "/style.css":
                self._send_file(WEB_DIR / "style.css", "text/css; charset=utf-8")
                return
            # Everything below this point is API — require auth.
            if not self._check_auth():
                return
            if p == "/api/conversations":
                # Merge legacy convs + mobile-created Claude sessions.
                # Default: only mobile-origin Claude sessions (filters out
                # the dev/CLI noise sessions). Pass ?include_cli=1 to see
                # ALL Claude sessions in the project (handy occasionally).
                include_cli = "include_cli=1" in (u.query or "")
                items = list_conversations() + list_claude_sessions(mobile_only=not include_cli)
                items.sort(key=lambda x: x["last_ts"], reverse=True)
                self._send_json(200, items)
            elif p.startswith("/api/conversations/") and p.endswith("/live"):
                # SSE subscribe to an in-flight turn on this cid. If nothing is
                # running, returns one `done` event and closes — frontend can
                # then fall back to the persisted jsonl via GET /api/conversations/<id>.
                cid = p[len("/api/conversations/"):-len("/live")]
                if not _is_uuid(cid):
                    self._send_json(400, {"error": "live 仅支持 UUID 对话"})
                    return
                with _live_streams_lock:
                    live = LIVE_STREAMS.get(cid)

                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Connection", "close")
                self.send_header("X-Accel-Buffering", "no")
                self._cors_headers()
                self.end_headers()

                def _write_event(obj: dict) -> bool:
                    try:
                        chunk = "data: " + json.dumps(obj, ensure_ascii=False) + "\n\n"
                        self.wfile.write(chunk.encode("utf-8"))
                        self.wfile.flush()
                        return True
                    except (BrokenPipeError, ConnectionResetError, OSError):
                        return False

                if live is None:
                    _write_event({"type": "done"})
                    return

                replay, q = live.subscribe()
                try:
                    for ev in replay:
                        if not _write_event(ev):
                            return
                    if q is None:
                        _write_event({"type": "done"})
                        return
                    while True:
                        try:
                            ev = q.get(timeout=15)
                        except queue.Empty:
                            try:
                                self.wfile.write(b": ka\n\n")
                                self.wfile.flush()
                            except (BrokenPipeError, ConnectionResetError, OSError):
                                return
                            continue
                        if ev.get("_terminal"):
                            _write_event({"type": "done"})
                            return
                        if not _write_event(ev):
                            return
                finally:
                    live.unsubscribe(q)
                return
            elif p.startswith("/api/conversations/"):
                cid = p[len("/api/conversations/"):]
                if _is_uuid(cid):
                    # Claude session backed
                    titles = _load_titles()
                    msgs = parse_claude_session(claude_session_path(cid))
                    # Merge interruption breadcrumbs (turns that died mid-stream
                    # and never made it into the CLI's jsonl).
                    for rec in load_interrupts(cid):
                        msgs.append({
                            "role": "assistant",
                            "kind": "interrupted",
                            "content": rec.get("partial") or "",
                            "reason": rec.get("reason") or "",
                            "ts": rec.get("ts") or 0,
                        })
                    msgs.sort(key=lambda m: m.get("ts") or 0)
                    first_user = next((m for m in msgs if m["role"] == "user"), None)
                    title = (
                        titles.get(cid)
                        or (first_user and (first_user["content"] or "").strip().replace("\n", " ")[:30])
                        or "新对话"
                    )
                    self._send_json(200, {
                        "id": cid,
                        "title": title,
                        "messages": msgs,
                        "context": conv_context(cid),
                        "live": is_cid_live(cid),
                        "last_interrupt_ts": last_interrupt_ts(cid),
                        "pinned": cid in _load_pinned_convs(),
                    })
                elif CONV_ID_RE.match(cid):
                    # Legacy hex-id conv
                    meta = conv_load_meta(cid)
                    self._send_json(200, {
                        "id": cid,
                        "title": meta.get("title") or "新对话",
                        "messages": conv_history(cid),
                        "context": None,
                    })
                else:
                    self._send_json(400, {"error": "bad id"})
            elif p == "/api/config":
                self._send_json(200, {"user_name": USER_NAME})
            elif p == "/api/sub-apps":
                self._send_json(200, [s["manifest"] for s in SUB_APPS])
            elif dispatch_sub(self, "GET", p):
                pass
            else:
                self.send_error(404)
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def do_POST(self):
        if not self._check_auth():
            return
        u = urlparse(self.path)
        p = u.path
        try:
            if p == "/api/conversations":
                # Create a new bare conversation. Returns a UUID so the
                # session ends up in ~/.claude/projects/ and is visible in
                # `claude --resume`. The session file is created lazily on
                # the first POST /api/conversations/<uuid>/stream.
                #
                # Optional body field `context` (e.g. {"kind": "radar_app",
                # "slug": "..."}) binds the conversation to a sub-app data
                # source; the bound resolver feeds a system-prompt prefix
                # on turn one.
                cid = str(uuid.uuid4())
                _mark_mobile_origin(cid)
                body_data = self._read_json_body()
                ctx_data = body_data.get("context") if isinstance(body_data, dict) else None
                if isinstance(ctx_data, dict) and ctx_data.get("kind"):
                    _set_conv_context(cid, ctx_data)
                self._send_json(200, {"id": cid, "title": "新对话", "context": ctx_data})
            elif p.startswith("/api/conversations/") and p.endswith("/pin"):
                # Toggle whether this UUID conv shows up in the main list.
                # The user-pinned set is unioned with mobile_origin in
                # list_claude_sessions, so this is the canonical way to
                # surface a sub-app conversation in the main list.
                cid = p[len("/api/conversations/"):-len("/pin")]
                if not _is_uuid(cid):
                    self._send_json(400, {"error": "pin 仅支持 UUID 对话"})
                    return
                data = self._read_json_body()
                pinned = bool(data.get("pinned"))
                _set_pinned_conv(cid, pinned)
                self._send_json(200, {"id": cid, "pinned": pinned})
            elif p.startswith("/api/conversations/") and p.endswith("/stream"):
                # SSE streaming variant of POST /api/conversations/<uuid>.
                # Solves 504s on reverse proxies: keepalive comments + per-event
                # writes keep bytes flowing so `proxy_read_timeout` never fires.
                cid = p[len("/api/conversations/"):-len("/stream")]
                if not _is_uuid(cid):
                    self._send_json(400, {"error": "stream 仅支持 UUID 对话"})
                    return
                data = self._read_json_body()
                msg = (data.get("message") or "").strip()
                if not msg:
                    self._send_json(400, {"error": "empty message"})
                    return
                is_first = not claude_session_path(cid).exists()

                # Reject if another turn is already running on this cid — claude
                # CLI can't handle two concurrent `--resume` on the same session
                # anyway. Tells the second caller to attach via GET /live instead.
                with _live_streams_lock:
                    if cid in LIVE_STREAMS:
                        self._send_json(409, {"error": "另一个回合正在进行中，请通过 /live 订阅"})
                        return
                    live = LiveStream(cid)
                    LIVE_STREAMS[cid] = live
                # Seed the live stream with the user message so late joiners
                # (and post-refresh clients) see what was just sent — claude
                # CLI's jsonl is only flushed at end-of-turn, so without this
                # the user msg would briefly vanish on rejoin.
                live.append({
                    "type": "user_message",
                    "text": msg,
                    "ts": int(time.time()),
                })

                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Connection", "close")
                # Tell nginx (and similar) to NOT buffer — otherwise streaming
                # collapses back to a single late response and we 504 again.
                self.send_header("X-Accel-Buffering", "no")
                self._cors_headers()
                self.end_headers()

                accumulated_text = ""
                error_reason: str | None = None
                saw_done = False
                client_gone = False
                try:
                    for ev in stream_claude_in_session(msg, cid, is_first):
                        # Broadcast every event (except keepalive — that's a
                        # per-connection idle filler) to all GET /live subscribers.
                        if ev.get("type") != "keepalive":
                            live.append(ev)
                        if not client_gone:
                            try:
                                if ev.get("type") == "keepalive":
                                    self.wfile.write(b": ka\n\n")
                                else:
                                    chunk = "data: " + json.dumps(ev, ensure_ascii=False) + "\n\n"
                                    self.wfile.write(chunk.encode("utf-8"))
                                self.wfile.flush()
                            except (BrokenPipeError, ConnectionResetError, OSError):
                                client_gone = True
                        t = ev.get("type")
                        if t == "text":
                            accumulated_text += ev.get("text", "")
                        elif t == "error":
                            error_reason = ev.get("error") or "unknown"
                        elif t == "done":
                            saw_done = True
                finally:
                    # Persist a breadcrumb if the turn ended unhappily so the
                    # frontend can show "this turn was interrupted" on reload —
                    # the CLI's own jsonl never gets these (it only flushes
                    # at end-of-turn, and a killed turn never reaches that).
                    if error_reason or not saw_done:
                        interrupt_ev = {
                            "type": "interrupted",
                            "reason": error_reason or "流意外结束（无 done 事件）",
                            "partial": accumulated_text,
                            "ts": int(time.time()),
                        }
                        live.append(interrupt_ev)
                        record_interrupt(cid, msg, interrupt_ev["reason"], accumulated_text)
                        # Send interrupted + a synthetic done so the SSE consumer
                        # exits its read loop (stream_claude_in_session won't emit
                        # `done` after an idle-kill).
                        if not client_gone:
                            for payload in (interrupt_ev, {"type": "done"}):
                                try:
                                    self.wfile.write(("data: " + json.dumps(payload, ensure_ascii=False) + "\n\n").encode("utf-8"))
                                    self.wfile.flush()
                                except (BrokenPipeError, ConnectionResetError, OSError):
                                    client_gone = True
                                    break
                        live.append({"type": "done"})
                    live.finish()
                    with _live_streams_lock:
                        if LIVE_STREAMS.get(cid) is live:
                            del LIVE_STREAMS[cid]

                if is_first and accumulated_text:
                    def _title_then_save(_cid: str, _msg: str, _resp: str) -> None:
                        try:
                            raw = call_claude(build_title_prompt(_msg, _resp))
                            title = raw.strip().splitlines()[0] if raw.strip() else ""
                            title = re.sub(r'^[\s"\'“”`*【\[]+|[\s"\'“”`*】\]]+$', "", title)[:30]
                            if title:
                                set_claude_session_title(_cid, title)
                        except Exception:
                            pass
                    threading.Thread(
                        target=_title_then_save,
                        args=(cid, msg, accumulated_text),
                        daemon=True,
                    ).start()
                return
            elif p.startswith("/api/conversations/"):
                cid = p[len("/api/conversations/"):]
                data = self._read_json_body()
                msg = (data.get("message") or "").strip()
                if not msg:
                    self._send_json(400, {"error": "empty message"})
                    return
                if _is_uuid(cid):
                    # New path: persist via Claude session storage so CLI can resume
                    is_first = not claude_session_path(cid).exists()
                    response = call_claude_in_session(msg, cid, is_first=is_first)
                    if is_first:
                        # Async generate a short Chinese title; sidecar file
                        def _title_then_save(_cid: str, _msg: str, _resp: str) -> None:
                            try:
                                raw = call_claude(build_title_prompt(_msg, _resp))
                                title = raw.strip().splitlines()[0] if raw.strip() else ""
                                title = re.sub(r'^[\s"\'“”`*【\[]+|[\s"\'“”`*】\]]+$', "", title)[:30]
                                if title:
                                    set_claude_session_title(_cid, title)
                            except Exception:
                                pass
                        threading.Thread(
                            target=_title_then_save,
                            args=(cid, msg, response),
                            daemon=True,
                        ).start()
                    self._send_json(200, {"response": response})
                elif CONV_ID_RE.match(cid):
                    # Legacy path for old hex-id convs
                    hist = conv_history(cid)
                    is_first = len(hist) == 0
                    prompt = build_bare_chat_prompt(hist, msg)
                    response = call_claude(prompt)
                    conv_append(cid, "user", msg)
                    conv_append(cid, "assistant", response)
                    if is_first:
                        generate_conv_title_async(cid, msg, response)
                    self._send_json(200, {"response": response})
                else:
                    self._send_json(400, {"error": "bad id"})
            elif p == "/api/transcribe":
                ctype = self.headers.get("Content-Type", "")
                if "multipart/form-data" not in ctype:
                    self._send_json(400, {"error": "expected multipart/form-data"})
                    return
                n = int(self.headers.get("Content-Length", "0") or 0)
                if n <= 0 or n > 30 * 1024 * 1024:  # 30MB hard cap
                    self._send_json(400, {"error": "missing or oversized body"})
                    return
                t_start = time.time()
                body = self.rfile.read(n)
                t_recv = time.time()
                try:
                    fields = parse_multipart(body, ctype)
                except Exception as e:
                    self._send_json(400, {"error": f"multipart parse failed: {e}"})
                    return
                t_parse = time.time()
                audio = fields.get("audio")
                if not isinstance(audio, (bytes, bytearray)) or len(audio) < 100:
                    self._send_json(400, {"error": "missing or empty 'audio' field"})
                    return
                ext = (fields.get("ext") or "m4a").strip().lstrip(".").lower() or "m4a"
                # Map browser-recorded extensions to formats Volcengine ASR accepts directly.
                # No transcoding needed — server tested mp4/m4a inputs go through fine.
                ext_to_volc_format = {
                    "m4a": "m4a", "mp4": "mp4", "aac": "m4a", "caf": "m4a",
                    "wav": "wav", "mp3": "mp3", "webm": "ogg", "ogg": "ogg",
                }
                volc_fmt = ext_to_volc_format.get(ext, "m4a")
                t_conv = time.time()  # zero conversion now
                try:
                    out = call_ark_asr(bytes(audio), audio_format=volc_fmt)
                    t_asr = time.time()
                except Exception as e:
                    self._send_json(500, {"error": str(e)})
                    return
                timings = {
                    "upload_kb": round(n / 1024, 1),
                    "audio_kb": round(len(audio) / 1024, 1),
                    "ext": ext,
                    "volc_fmt": volc_fmt,
                    "recv_ms": int((t_recv - t_start) * 1000),
                    "parse_ms": int((t_parse - t_recv) * 1000),
                    "asr_ms": int((t_asr - t_conv) * 1000),
                    "total_ms": int((t_asr - t_start) * 1000),
                }
                print(f"[transcribe] {timings}", flush=True)
                self._send_json(200, {"text": out["text"], "raw": out["raw"], "timings": timings})
            elif p == "/api/polish":
                data = self._read_json_body()
                text = (data.get("text") or "").strip()
                if not text:
                    self._send_json(400, {"error": "empty text"})
                    return
                polished = call_claude(build_polish_prompt(text)).strip()
                # Strip markdown wrappers Claude sometimes adds
                polished = re.sub(r"^[`\"'\s]+|[`\"'\s]+$", "", polished)
                self._send_json(200, {"polished": polished})
            elif dispatch_sub(self, "POST", p):
                pass
            else:
                self.send_error(404)
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def do_DELETE(self):
        if not self._check_auth():
            return
        u = urlparse(self.path)
        p = u.path
        try:
            if p.startswith("/api/conversations/"):
                cid = p[len("/api/conversations/"):]
                if _is_uuid(cid):
                    # UUID-backed Claude session: drop the jsonl, plus our
                    # title + mobile-origin sidecar entries. `claude --resume`
                    # will no longer see it.
                    sp = claude_session_path(cid)
                    if sp.exists():
                        try:
                            sp.unlink()
                        except OSError:
                            pass
                    ip = _interrupts_path(cid)
                    if ip.exists():
                        try:
                            ip.unlink()
                        except OSError:
                            pass
                    with _state_lock:
                        titles = _load_titles()
                        if cid in titles:
                            del titles[cid]
                            _save_titles(titles)
                        origins = _load_mobile_origins()
                        if cid in origins:
                            origins.discard(cid)
                            MOBILE_ORIGIN_PATH.write_text(
                                json.dumps(sorted(origins), ensure_ascii=False, indent=2)
                            )
                        pinned = _load_pinned_convs()
                        if cid in pinned:
                            pinned.discard(cid)
                            PINNED_CONVS_PATH.write_text(
                                json.dumps(sorted(pinned), ensure_ascii=False, indent=2)
                            )
                    _drop_conv_context(cid)
                    self._send_json(200, {"ok": True})
                elif CONV_ID_RE.match(cid):
                    # Legacy hex-id conv: jsonl + meta sidecar
                    for pth in (conv_path(cid), conv_meta_path(cid)):
                        if pth.exists():
                            try:
                                pth.unlink()
                            except OSError:
                                pass
                    self._send_json(200, {"ok": True})
                else:
                    self._send_json(400, {"error": "bad id"})
            elif dispatch_sub(self, "DELETE", p):
                pass
            else:
                self.send_error(404)
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def log_message(self, fmt, *args):
        pass


def main():
    load_sub_apps()
    print(f"Shell → http://localhost:{PORT}/")
    print(f"  data     : {DATA_DIR}")
    print(f"  sub-apps : {len(SUB_APPS)} loaded ({', '.join(s['id'] for s in SUB_APPS) or 'none'})")
    print("  Ctrl-C 停止")
    server = ThreadingHTTPServer(("localhost", PORT), Handler)
    server.daemon_threads = True  # don't block Ctrl-C on in-flight claude calls
    server.serve_forever()


if __name__ == "__main__":
    main()
