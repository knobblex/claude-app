(() => {
  const state = {
    apps: [],
    selected: null,
    filter: 'all',
    search: '',
  };

  // ---------- API ----------
  const api = {
    apps: () => fetch('/api/apps').then(r => r.json()),
    app: slug => fetch(`/api/apps/${encodeURIComponent(slug)}`).then(r => r.json()),
    setFavorite: (slug, payload) => fetch(`/api/favorites/${encodeURIComponent(slug)}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    }).then(r => r.json()),
    chatHistory: slug => fetch(`/api/chat/${encodeURIComponent(slug)}`).then(r => r.json()),
    sendChat: (slug, message) => fetch(`/api/chat/${encodeURIComponent(slug)}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message}),
    }).then(r => r.json()),
    notes: slug => fetch(`/api/notes/${encodeURIComponent(slug)}`).then(r => r.json()),
    distill: slug => fetch(`/api/notes/${encodeURIComponent(slug)}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: '{}',
    }).then(r => r.json()),
    suggestNotes: slug => fetch(`/api/note-suggestions/${encodeURIComponent(slug)}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: '{}',
    }).then(r => r.json()),
  };

  // ---------- Markdown rendering (minimal) ----------
  function renderMarkdown(md) {
    const lines = md.split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^### /.test(line)) {
        out.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
        i++;
      } else if (/^## /.test(line)) {
        out.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
        i++;
      } else if (/^# /.test(line)) {
        out.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
        i++;
      } else if (/^> /.test(line)) {
        let buf = [];
        while (i < lines.length && lines[i].startsWith('>')) {
          buf.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        out.push(`<blockquote>${inlineFmt(buf.join('<br>'))}</blockquote>`);
      } else if (/^[\-\*] /.test(line)) {
        const items = [];
        while (i < lines.length && /^[\-\*] /.test(lines[i])) {
          items.push(lines[i].slice(2));
          i++;
        }
        out.push(`<ul>${items.map(t => `<li>${inlineFmt(t)}</li>`).join('')}</ul>`);
      } else if (/^\d+\.\s/.test(line)) {
        const items = [];
        while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
          items.push(lines[i].replace(/^\d+\.\s/, ''));
          i++;
        }
        out.push(`<ol>${items.map(t => `<li>${inlineFmt(t)}</li>`).join('')}</ol>`);
      } else if (line.trim() === '') {
        i++;
      } else {
        const buf = [];
        while (i < lines.length && lines[i].trim() !== '' && !/^(#|>|[\-\*] |\d+\.\s)/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        out.push(`<p>${inlineFmt(buf.join(' '))}</p>`);
      }
    }
    return out.join('\n');
  }
  function inlineFmt(s) {
    return escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---------- Sidebar ----------
  function scoreClass(n) {
    n = Number(n) || 0;
    if (n >= 4) return 'hi';
    if (n >= 3) return 'mid';
    return 'lo';
  }
  function getVisibleApps() {
    const q = state.search.trim().toLowerCase();
    return state.apps.filter(a => {
      if (state.filter === 'fav' && !a.is_favorite) return false;
      if (!q) return true;
      const fm = a.frontmatter || {};
      const bag = [
        fm.name || '',
        ...(Array.isArray(fm.tags) ? fm.tags : []),
        ...(Array.isArray(a.tags_user) ? a.tags_user : []),
        a.note_user || '',
        fm.source || '',
      ].join(' ').toLowerCase();
      return bag.includes(q);
    });
  }

  function renderSidebar() {
    const sb = document.getElementById('sidebar');
    const list = getVisibleApps();
    if (list.length === 0) {
      sb.innerHTML = '<div class="sidebar-empty">没有匹配的 App</div>';
      return;
    }
    sb.innerHTML = list.map(a => {
      const fm = a.frontmatter || {};
      const tags = [
        ...(a.tags_user || []).map(t => `<span class="tag-chip user">${escapeHtml(t)}</span>`),
        ...((Array.isArray(fm.tags) ? fm.tags : []).slice(0, 3).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`)),
      ].join('');
      const avg = Number(fm.score_avg) || 0;
      return `
        <div class="card ${a.slug === state.selected ? 'active' : ''}" data-slug="${a.slug}">
          <div class="card-row1">
            <div class="card-name">${escapeHtml(fm.name || a.slug)}</div>
            <button class="card-star ${a.is_favorite ? 'on' : ''}" data-star="${a.slug}" title="收藏">
              ${a.is_favorite ? '★' : '☆'}
            </button>
          </div>
          <div class="card-row2">
            <span class="score-pill ${scoreClass(avg)}">${avg.toFixed(2)}</span>
            <span class="card-source">${escapeHtml(fm.source || '')}</span>
            <span class="card-source">·</span>
            <span class="card-source">新${fm.score_novelty || '?'}/迁${fm.score_portability || '?'}/付${fm.score_revenue || '?'}</span>
          </div>
          ${tags ? `<div class="card-tags">${tags}</div>` : ''}
        </div>
      `;
    }).join('');

    sb.querySelectorAll('.card').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('[data-star]')) return;
        selectApp(el.dataset.slug);
      });
    });
    sb.querySelectorAll('[data-star]').forEach(b => {
      b.addEventListener('click', async e => {
        e.stopPropagation();
        const slug = b.dataset.star;
        const app = state.apps.find(x => x.slug === slug);
        if (!app) return;
        await api.setFavorite(slug, {favorited: !app.is_favorite});
        await reloadApps();
      });
    });
  }

  function updateCounts() {
    document.getElementById('count-all').textContent = state.apps.length;
    document.getElementById('count-fav').textContent = state.apps.filter(a => a.is_favorite).length;
  }

  // ---------- Detail panel ----------
  async function selectApp(slug) {
    state.selected = slug;
    renderSidebar();
    const empty = document.getElementById('detail-empty');
    const detail = document.getElementById('detail-content');
    empty.hidden = true;
    detail.hidden = false;
    detail.innerHTML = '<div class="sidebar-empty" style="padding:24px">加载中…</div>';
    const [app, history, notes] = await Promise.all([
      api.app(slug),
      api.chatHistory(slug),
      api.notes(slug),
    ]);
    renderDetail(app, history, notes.markdown || '');
  }

  function renderDetail(app, history, notesMd) {
    const fm = app.frontmatter || {};
    const meta = app.fav_meta || {};
    const detail = document.getElementById('detail-content');
    const isFav = app.is_favorite;
    detail.innerHTML = `
      <div class="detail-header">
        <div class="detail-title">
          <h2>${escapeHtml(fm.name || app.slug)}</h2>
          <button class="detail-fav-btn ${isFav ? 'on' : ''}" id="fav-toggle">
            ${isFav ? '⭐ 已收藏' : '☆ 加入收藏'}
          </button>
        </div>
        <div class="detail-meta">
          <span class="detail-scores">
            <span class="score-block"><span class="label">新颖</span>${fm.score_novelty || '?'}</span>
            <span class="score-block"><span class="label">可迁移</span>${fm.score_portability || '?'}</span>
            <span class="score-block"><span class="label">付费</span>${fm.score_revenue || '?'}</span>
            <span class="score-block"><span class="label">平均</span>${fm.score_avg || '?'}</span>
          </span>
          <span>${escapeHtml(fm.source || '')}</span>
          ${fm.url ? `<a href="${escapeHtml(fm.url)}" target="_blank" rel="noreferrer">原始链接 ↗</a>` : ''}
          <span>首次发现 ${escapeHtml(fm.first_seen || '')}</span>
        </div>
        <div class="fav-controls" ${isFav ? '' : 'hidden'} id="fav-controls">
          <div class="note-row">
            <h4>个人备注</h4>
            <button id="suggest-notes-btn" class="suggest-btn" title="让 Claude 从卷宗生成 3 条候选备注，点选后可继续编辑">💡 建议</button>
          </div>
          <div class="note-suggestions" id="note-suggestions" hidden></div>
          <textarea id="fav-note" placeholder="为什么记下它？打算什么时候回看？">${escapeHtml(meta.note || '')}</textarea>
          <h4>个人标签</h4>
          <input id="fav-tags" placeholder="逗号分隔，如：下个项目, 灵感库, 周末研究" value="${escapeHtml((meta.tags || []).join(', '))}">
          <button id="fav-save" style="justify-self:start">保存备注 / 标签</button>
        </div>
      </div>

      <div class="detail-body" id="detail-body">
        ${renderMarkdown(app.body)}
        <div class="notes-section" id="notes-section" ${notesMd ? '' : 'hidden'}>
          <h2>💡 我的点子（自动提炼）</h2>
          <div class="notes-content" id="notes-content">${notesMd ? renderMarkdown(notesMd) : ''}</div>
        </div>
      </div>

      <div class="chat">
        <div class="chat-header">
          <h3>💬 跟 Claude 聊这个 App</h3>
          <button id="distill-btn" title="把当前对话里用户自己提的点子提炼成 bullet 存到笔记">💡 提炼点子</button>
        </div>
        <div class="chat-thread" id="chat-thread"></div>
        <div class="chat-input-row">
          <textarea id="chat-input" placeholder="比如：这个机制能套到法律合同审核吗？" rows="1"></textarea>
          <button id="chat-send">发送</button>
        </div>
      </div>
    `;
    renderChat(history);
    bindDetail(app);
  }

  function renderChat(history) {
    const t = document.getElementById('chat-thread');
    if (!t) return;
    if (!history || history.length === 0) {
      t.innerHTML = '<div class="chat-empty">还没聊过。问点什么吧 ↓</div>';
      return;
    }
    t.innerHTML = history.map(m => `
      <div class="msg ${m.role === 'user' ? 'user' : 'assistant'}">${escapeHtml(m.content)}</div>
    `).join('');
    t.scrollTop = t.scrollHeight;
  }

  function bindDetail(app) {
    document.getElementById('fav-toggle').addEventListener('click', async () => {
      const newState = !app.is_favorite;
      await api.setFavorite(app.slug, {favorited: newState});
      await reloadApps();
      await selectApp(app.slug);
    });
    const sugBtn = document.getElementById('suggest-notes-btn');
    if (sugBtn) {
      sugBtn.addEventListener('click', async () => {
        const orig = sugBtn.textContent;
        sugBtn.disabled = true;
        sugBtn.textContent = '生成中…';
        const sugBox = document.getElementById('note-suggestions');
        const noteTa = document.getElementById('fav-note');
        try {
          const res = await api.suggestNotes(app.slug);
          const list = res.suggestions || [];
          if (list.length === 0) {
            sugBox.innerHTML = `<div class="suggestion-empty">没解析到候选。原文：<br>${escapeHtml(res.raw || '(空)').replace(/\n/g, '<br>')}</div>`;
          } else {
            sugBox.innerHTML = list.map(s =>
              `<button type="button" class="suggestion-chip" data-text="${escapeHtml(s)}">${escapeHtml(s)}</button>`
            ).join('');
            sugBox.querySelectorAll('.suggestion-chip').forEach(b => {
              b.addEventListener('click', () => {
                noteTa.value = b.dataset.text;
                sugBox.hidden = true;
                noteTa.focus();
              });
            });
          }
          sugBox.hidden = false;
        } catch (e) {
          sugBox.innerHTML = `<div class="suggestion-empty">请求失败：${escapeHtml(String(e))}</div>`;
          sugBox.hidden = false;
        } finally {
          sugBtn.disabled = false;
          sugBtn.textContent = orig;
        }
      });
    }

    const saveBtn = document.getElementById('fav-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const note = document.getElementById('fav-note').value;
        const tagsStr = document.getElementById('fav-tags').value;
        const tags = tagsStr.split(',').map(s => s.trim()).filter(Boolean);
        await api.setFavorite(app.slug, {favorited: true, note, tags});
        await reloadApps();
        saveBtn.textContent = '已保存 ✓';
        setTimeout(() => (saveBtn.textContent = '保存备注 / 标签'), 1200);
      });
    }
    const sendBtn = document.getElementById('chat-send');
    const input = document.getElementById('chat-input');
    const thread = document.getElementById('chat-thread');
    async function send() {
      const msg = input.value.trim();
      if (!msg) return;
      input.value = '';
      sendBtn.disabled = true;
      const cur = await api.chatHistory(app.slug);
      cur.push({role: 'user', content: msg});
      cur.push({role: 'assistant', content: '思考中...', _pending: true});
      renderChat(cur);
      try {
        const res = await api.sendChat(app.slug, msg);
        const fresh = await api.chatHistory(app.slug);
        renderChat(fresh);
      } catch (e) {
        thread.insertAdjacentHTML('beforeend', `<div class="msg assistant">[发送失败：${escapeHtml(String(e))}]</div>`);
      } finally {
        sendBtn.disabled = false;
        input.focus();
      }
    }
    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        send();
      }
    });

    const distillBtn = document.getElementById('distill-btn');
    distillBtn.addEventListener('click', async () => {
      const orig = distillBtn.textContent;
      distillBtn.disabled = true;
      distillBtn.textContent = '提炼中…';
      try {
        const res = await api.distill(app.slug);
        if (res.error) {
          distillBtn.textContent = res.error;
          setTimeout(() => (distillBtn.textContent = orig), 1800);
          return;
        }
        const sec = document.getElementById('notes-section');
        const con = document.getElementById('notes-content');
        if (sec && con) {
          con.innerHTML = renderMarkdown(res.markdown || '');
          sec.hidden = false;
          sec.scrollIntoView({behavior: 'smooth', block: 'start'});
        }
        distillBtn.textContent = '✓ 已加入笔记';
        setTimeout(() => (distillBtn.textContent = orig), 1500);
      } catch (e) {
        distillBtn.textContent = '失败';
        setTimeout(() => (distillBtn.textContent = orig), 1500);
      } finally {
        distillBtn.disabled = false;
      }
    });
  }

  // Override renderChat for pending markers
  const _origRenderChat = renderChat;
  // (no-op, kept inline above)

  // ---------- Boot ----------
  async function reloadApps() {
    state.apps = await api.apps();
    updateCounts();
    renderSidebar();
  }

  document.querySelectorAll('.btn-filter').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.btn-filter').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.filter = b.dataset.filter;
      renderSidebar();
    });
  });
  document.getElementById('search').addEventListener('input', e => {
    state.search = e.target.value;
    renderSidebar();
  });

  reloadApps();
})();
