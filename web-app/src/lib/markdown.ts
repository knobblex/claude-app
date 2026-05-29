function escape(s: string) {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// --- GFM tables -------------------------------------------------------------
// Shared by both renderers; differs only in inline formatter + class names so
// chat (compact) and magazine (large) get the right typography.

type TableAlign = "left" | "center" | "right";
type TableOpts = {
  inline: (s: string) => string;
  wrapperClass: string;
  tableClass: string;
  thClass: string;
  tdClass: string;
};

function splitTableRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((s) => s.trim());
}

const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
// Separator row: each cell is dashes with optional leading/trailing colon.
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?(\s*\|\s*:?-{3,}:?)+\s*\|?\s*$/;

function parseTableBlock(
  lines: string[],
  start: number,
  opts: TableOpts,
): { html: string; consumed: number } | null {
  if (start + 1 >= lines.length) return null;
  if (!TABLE_ROW_RE.test(lines[start])) return null;
  if (!TABLE_SEP_RE.test(lines[start + 1])) return null;

  const headers = splitTableRow(lines[start]);
  const aligns: TableAlign[] = splitTableRow(lines[start + 1]).map((s) => {
    const l = s.startsWith(":");
    const r = s.endsWith(":");
    if (l && r) return "center";
    if (r) return "right";
    return "left";
  });
  if (headers.length !== aligns.length) return null;

  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
    const cells = splitTableRow(lines[i]);
    while (cells.length < headers.length) cells.push("");
    rows.push(cells.slice(0, headers.length));
    i++;
  }

  const alignStyle = (a: TableAlign) => (a === "left" ? "" : ` style="text-align:${a}"`);
  const thHtml = headers
    .map((h, idx) => `<th class="${opts.thClass}"${alignStyle(aligns[idx])}>${opts.inline(h)}</th>`)
    .join("");
  const rowsHtml = rows
    .map(
      (r) =>
        `<tr>${r
          .map((c, idx) => `<td class="${opts.tdClass}"${alignStyle(aligns[idx])}>${opts.inline(c)}</td>`)
          .join("")}</tr>`,
    )
    .join("");

  const html =
    `<div class="${opts.wrapperClass}"><table class="${opts.tableClass}"><thead><tr>${thHtml}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
  return { html, consumed: i - start };
}

function inlineFmt(s: string) {
  return escape(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-notion-text">$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded font-mono text-[14px]" style="background:rgba(135,131,120,0.15);color:#eb5757">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="text-notion-blue hover:underline">$1</a>');
}

// === Compact markdown for chat messages =========================================
// Lighter typography, smaller headers, supports fenced code blocks. No "grip"
// hover handles. Used by ChatDrawer to render assistant replies.

function inlineFmtChat(s: string) {
  return escape(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
    .replace(/(?<![*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '<em class="italic">$1</em>')
    .replace(/`([^`\n]+)`/g, '<code class="px-1 py-px rounded font-mono text-[13px]" style="background:rgba(135,131,120,0.16);color:#c2410c">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="text-notion-blue underline decoration-notion-blue/40 underline-offset-2">$1</a>');
}

export function renderChatMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // GFM table — check before fenced code / paragraph so the leading `|`
    // line isn't swallowed into a paragraph.
    const chatTable = parseTableBlock(lines, i, {
      inline: inlineFmtChat,
      wrapperClass: "my-2 overflow-x-auto",
      tableClass: "min-w-full border-collapse text-[14px]",
      thClass:
        "border border-notion-border px-2 py-1 font-semibold text-notion-text bg-notion-soft",
      tdClass: "border border-notion-border px-2 py-1 text-notion-text2 align-top",
    });
    if (chatTable) {
      out.push(chatTable.html);
      i += chatTable.consumed;
      continue;
    }
    // fenced code block ```lang ... ```
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] || "";
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      out.push(
        `<pre class="my-2 p-3 rounded-md bg-notion-soft border border-notion-border overflow-x-auto text-[13px] leading-[1.55] font-mono whitespace-pre">` +
        (lang ? `<div class="text-[10.5px] uppercase tracking-wider text-notion-text3 mb-1.5 font-sans not-italic">${escape(lang)}</div>` : "") +
        `<code>${escape(buf.join("\n"))}</code></pre>`
      );
      continue;
    }
    if (/^### /.test(line)) {
      out.push(`<h3 class="font-semibold text-notion-text mt-3 mb-1 text-[15px]">${inlineFmtChat(line.slice(4))}</h3>`);
      i++;
    } else if (/^## /.test(line)) {
      out.push(`<h2 class="font-semibold text-notion-text mt-3.5 mb-1.5 text-[16px]">${inlineFmtChat(line.slice(3))}</h2>`);
      i++;
    } else if (/^# /.test(line)) {
      out.push(`<h1 class="font-semibold text-notion-text mt-4 mb-2 text-[17px]">${inlineFmtChat(line.slice(2))}</h1>`);
      i++;
    } else if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote class="my-2 pl-3 border-l-2 border-notion-border2 text-notion-text2 italic">${inlineFmtChat(buf.join(" "))}</blockquote>`);
    } else if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].slice(2));
        i++;
      }
      out.push(`<ul class="my-2 space-y-1 pl-1">${items
        .map((t) => `<li class="flex gap-2"><span class="text-notion-text3 mt-[6px] text-[8px] shrink-0">●</span><span class="flex-1 leading-[1.6]">${inlineFmtChat(t)}</span></li>`)
        .join("")}</ul>`);
    } else if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      out.push(`<ol class="my-2 ml-5 space-y-1 list-decimal">${items
        .map((t) => `<li class="leading-[1.6] pl-1">${inlineFmtChat(t)}</li>`)
        .join("")}</ol>`);
    } else if (/^---+\s*$/.test(line) || /^___+\s*$/.test(line)) {
      out.push(`<hr class="my-3 border-0 border-t border-notion-divider" />`);
      i++;
    } else if (line.trim() === "") {
      i++;
    } else {
      const buf: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !/^(```|#|>\s?|[-*] |\d+\.\s|---|___|\|)/.test(lines[i])
      ) {
        buf.push(lines[i]);
        i++;
      }
      // Preserve in-paragraph newlines (Claude often uses single newlines for soft wraps)
      out.push(`<p class="my-1.5 leading-[1.6]">${inlineFmtChat(buf.join("\n")).replace(/\n/g, "<br />")}</p>`);
    }
  }
  return out.join("");
}

export function renderMarkdown(md: string, magazine = true): string {
  const lines = md.split("\n");
  const out: string[] = [];
  const grip = '<span class="grip"></span>';
  const headFont = magazine ? "font-serif" : "font-sans";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // GFM table — check first so a `|` row isn't swallowed into a paragraph.
    const magazineTable = parseTableBlock(lines, i, {
      inline: inlineFmt,
      wrapperClass: "notion-block my-5 overflow-x-auto",
      tableClass:
        "min-w-full border-collapse text-[15px] text-notion-text",
      thClass:
        "border border-notion-border px-3 py-2 font-semibold text-notion-text bg-notion-soft text-left",
      tdClass:
        "border border-notion-border px-3 py-2 text-notion-text leading-[1.65] align-top",
    });
    if (magazineTable) {
      out.push(magazineTable.html);
      i += magazineTable.consumed;
      continue;
    }
    if (/^# /.test(line)) {
      // skip the H1 (the title), already rendered separately
      i++;
    } else if (/^### /.test(line)) {
      out.push(`<h3 class="notion-block ${headFont} text-[20px] font-semibold text-notion-text mt-8 mb-2 tracking-tight">${grip}${inlineFmt(line.slice(4))}</h3>`);
      i++;
    } else if (/^## /.test(line)) {
      out.push(`<h2 class="notion-block ${headFont} text-[28px] font-bold text-notion-text mt-12 mb-3 tracking-tight">${grip}${inlineFmt(line.slice(3))}</h2>`);
      i++;
    } else if (/^> /.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote class="notion-block my-5 pl-4 border-l-[3px] border-notion-text text-[18px] italic text-notion-text font-serif leading-[1.6]">${grip}${inlineFmt(buf.join(" "))}</blockquote>`);
    } else if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].slice(2));
        i++;
      }
      out.push(`<ul class="my-3 ml-1.5 space-y-2 text-notion-text">${items
        .map((t) => `<li class="notion-block flex gap-2.5 leading-[1.75] text-[16px]"><span class="grip"></span><span class="text-notion-text3 mt-2 shrink-0">•</span><span class="flex-1">${inlineFmt(t)}</span></li>`)
        .join("")}</ul>`);
    } else if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      out.push(`<ol class="my-3 ml-5 space-y-2 list-decimal text-notion-text">${items
        .map((t) => `<li class="notion-block leading-[1.75] text-[16px]"><span class="grip"></span>${inlineFmt(t)}</li>`)
        .join("")}</ol>`);
    } else if (line.trim() === "") {
      i++;
    } else {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim() !== "" && !/^(#|>|[-*] |\d+\.\s|\|)/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      out.push(`<p class="notion-block my-3 text-notion-text leading-[1.75] text-[16.5px]">${grip}${inlineFmt(buf.join(" "))}</p>`);
    }
  }
  return out.join("\n");
}
