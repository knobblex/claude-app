// 点子库 · 素材夹：列文件 / 上传 / 删除 / 在线编辑文本。桌面 & 移动共用。
//
// 落点：后端 data/sub_app/ideas/files/<iid>/...；前端通过 ideasApi.*File 跑通。
// 文本类（白名单后缀）点开行内 textarea 编辑；其他文件点开走 blob 下载。
// 与 build_chat_prompt 的素材夹注入对齐 —— 写在这里的东西，下条 chat 时 AI 能看到。

import { useCallback, useEffect, useRef, useState } from "react";
import { ideasApi, type FileEntry } from "./api";
import { serverNowMs } from "@/lib/api";
import { IcoFolder, IcoPlus, IcoTrash } from "@/components/icons";

// 必须和后端 core.py TEXT_EXTS 对齐 —— 那边决定哪些会被读入 chat prompt；
// 这边决定哪些点开是编辑器、哪些是下载。
const TEXT_EXTS = new Set([
  ".md", ".markdown", ".txt", ".rst", ".log",
  ".json", ".yaml", ".yml", ".toml", ".ini", ".csv", ".tsv", ".xml",
  ".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".scss",
  ".sh", ".bash", ".zsh", ".sql",
]);

function isTextFile(name: string): boolean {
  const i = name.lastIndexOf(".");
  return i >= 0 && TEXT_EXTS.has(name.slice(i).toLowerCase());
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

function relTime(ts: number): string {
  if (!ts) return "";
  const diff = serverNowMs() / 1000 - ts;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(ts * 1000).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export function FilesPanel({ iid }: { iid: string }) {
  const [path, setPath] = useState(""); // 当前浏览的子目录，"" = 根
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ path: string; text: string; saving: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await ideasApi.listFiles(iid, path);
      setEntries(r.entries);
      setErr(null);
    } catch (e) {
      setErr(String((e as Error).message || e));
    }
  }, [iid, path]);

  useEffect(() => {
    setEditing(null);
    load();
  }, [load]);

  async function onUpload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true);
    try {
      for (const f of list) {
        const target = path ? `${path}/${f.name}` : f.name;
        await ideasApi.writeFile(iid, target, f);
      }
      await load();
    } catch (e) {
      alert("上传失败：" + String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  async function onCreateNote() {
    const raw = prompt("新笔记文件名（不带后缀默认 .md）：");
    if (!raw) return;
    const name = raw.includes(".") ? raw : `${raw}.md`;
    const target = path ? `${path}/${name}` : name;
    setBusy(true);
    try {
      await ideasApi.writeFile(iid, target, "");
      await load();
      setEditing({ path: target, text: "", saving: false });
    } catch (e) {
      alert("创建失败：" + String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  async function openTextEditor(rel: string) {
    setBusy(true);
    try {
      const text = await ideasApi.readFileText(iid, rel);
      setEditing({ path: rel, text, saving: false });
    } catch (e) {
      alert("打开失败：" + String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setEditing({ ...editing, saving: true });
    try {
      await ideasApi.writeFile(iid, editing.path, editing.text);
      await load();
      setEditing(null);
    } catch (e) {
      alert("保存失败：" + String((e as Error).message || e));
      setEditing({ ...editing, saving: false });
    }
  }

  // 浏览器原生 <a download> 拿不到 Basic Auth header，只能 fetch 成 blob 再走 createObjectURL。
  async function downloadFile(entry: FileEntry) {
    try {
      const blob = await ideasApi.readFileBlob(iid, entry.path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = entry.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("下载失败：" + String((e as Error).message || e));
    }
  }

  async function del(entry: FileEntry) {
    const tag = entry.type === "dir" ? "（含其下全部内容）" : "";
    if (!confirm(`删除 ${entry.path}${tag}？`)) return;
    try {
      await ideasApi.deleteFile(iid, entry.path);
      if (editing?.path === entry.path || (entry.type === "dir" && editing?.path.startsWith(`${entry.path}/`))) {
        setEditing(null);
      }
      await load();
    } catch (e) {
      alert("删除失败：" + String((e as Error).message || e));
    }
  }

  function onClickEntry(e: FileEntry) {
    if (e.type === "dir") {
      setPath(e.path);
      return;
    }
    if (isTextFile(e.name)) {
      openTextEditor(e.path);
      return;
    }
    downloadFile(e);
  }

  return (
    <div
      className="relative"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) onUpload(e.dataTransfer.files);
      }}
    >
      {/* Header */}
      <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="text-[11px] uppercase font-semibold text-notion-text3 shrink-0"
            style={{ letterSpacing: "0.08em" }}
          >
            素材{entries.length > 0 ? ` · ${entries.length}` : ""}
          </span>
          {path && (
            <>
              <span className="text-notion-text3 shrink-0">/</span>
              <button
                onClick={() => setPath("")}
                className="text-[11.5px] text-notion-blue active:opacity-70 shrink-0"
              >
                根
              </button>
              <span className="text-notion-text3 shrink-0">/</span>
              <span className="text-[11.5px] text-notion-text2 truncate">{path}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={onCreateNote}
            disabled={busy}
            className={`flex items-center gap-1 text-[12px] font-medium text-notion-blue ${
              busy ? "opacity-50" : "hover:opacity-80 active:opacity-70"
            }`}
          >
            <IcoPlus size={12} /> 新建笔记
          </button>
          <button
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className={`text-[12px] font-medium text-notion-blue ${
              busy ? "opacity-50" : "hover:opacity-80 active:opacity-70"
            }`}
          >
            上传
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) onUpload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {err && <div className="px-4 pb-2 text-[12px] text-red-600">{err}</div>}

      <div className="px-2 pb-3">
        {entries.length === 0 && (
          <div className="px-3 py-4 text-[12.5px] text-notion-text3 leading-relaxed">
            素材夹空空的。
            <br />
            上传任意文件 或 「新建笔记」记点想法。聊天时 AI 会自动看到这里的文本文件。
          </div>
        )}
        {entries.map((e) => (
          <FileRow key={e.path} entry={e} onOpen={() => onClickEntry(e)} onDelete={() => del(e)} />
        ))}
      </div>

      {editing && (
        <div className="px-4 pb-4 border-t border-notion-divider pt-3 bg-notion-soft">
          <div className="flex items-center justify-between mb-2 gap-2">
            <span
              className="text-[11px] uppercase font-semibold text-notion-text3 truncate min-w-0"
              style={{ letterSpacing: "0.08em" }}
              title={editing.path}
            >
              编辑 · {editing.path}
            </span>
            <div className="flex gap-3 shrink-0">
              <button
                onClick={() => setEditing(null)}
                className="text-[12.5px] text-notion-text3 hover:text-notion-text"
              >
                取消
              </button>
              <button
                onClick={saveEdit}
                disabled={editing.saving}
                className={`text-[12.5px] font-medium text-notion-blue ${
                  editing.saving ? "opacity-50" : "hover:opacity-80"
                }`}
              >
                {editing.saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
          <textarea
            value={editing.text}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            className="w-full min-h-[200px] max-h-[50vh] p-2 leading-relaxed border border-notion-border rounded-md focus:outline-none focus:border-notion-blue bg-notion-bg"
            // 16px 以上 iOS 不会自动放大输入框
            style={{ fontSize: "16px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
            placeholder="写点什么…"
          />
        </div>
      )}

      {dragOver && (
        <div className="pointer-events-none absolute inset-0 border-2 border-dashed border-notion-blue rounded-md bg-notion-blue/5 grid place-items-center">
          <span className="text-[13px] font-medium text-notion-blue">松开上传到 {path || "根目录"}</span>
        </div>
      )}
    </div>
  );
}

function FileRow({
  entry,
  onOpen,
  onDelete,
}: {
  entry: FileEntry;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex items-center rounded-md hover:bg-notion-hover">
      <button
        onClick={onOpen}
        className="flex-1 min-w-0 text-left px-2.5 py-1.5 flex items-center gap-2"
      >
        {entry.type === "dir" ? (
          <IcoFolder size={14} className="text-notion-text3 shrink-0" />
        ) : (
          <span className="text-[12px] text-notion-text3 shrink-0 w-3.5">·</span>
        )}
        <span className="flex-1 truncate text-[13.5px] text-notion-text">{entry.name}</span>
        <span className="text-[11px] text-notion-text3 shrink-0">
          {entry.type === "file" ? fmtSize(entry.size) : ""}
        </span>
        <span className="text-[11px] text-notion-text3 shrink-0 w-14 text-right">
          {relTime(entry.mtime)}
        </span>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label="删除"
        className="opacity-0 group-hover:opacity-100 px-2 py-1.5 text-notion-text3 hover:text-red-500 rounded-md"
      >
        <IcoTrash size={13} />
      </button>
    </div>
  );
}
