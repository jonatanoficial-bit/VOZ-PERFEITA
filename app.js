/* =========================================================
   IMVpedia Voice — app.js (COMPLETO FINAL)
   - Navegação por hash
   - Trilhas -> Lições -> Lição (Markdown)
   - Biblioteca -> Artigo (Markdown)
   - Missões reais (missions.js) + XP/nível/streak
   - Perfil
   - Admin: login + gerador + import/export + merge sem apagar
========================================================= */

(() => {
  "use strict";

  /* =========================
     DOM
  ========================= */
  const view = document.getElementById("view");
  const toastEl = document.getElementById("toast");
  const adminBtn = document.getElementById("adminBtn");

  /* =========================
     LocalStorage Keys
  ========================= */
  const LS = {
    USER: "imv_user_v1",
    CUSTOM: "imv_custom_content_v1",
    ADMIN: "imv_admin_enabled_v1",
    MISSIONS_DONE: "imv_missions_done_v1",
    LAST_ACTIVE: "imv_last_active_v1",
    STREAK: "imv_streak_v1",
  };

  /* =========================
     Utils
  ========================= */
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  const todayISO = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
  };

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toast.__t);
    toast.__t = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  function safeJsonParse(raw, fallback) {
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  function uid() {
    return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
  }

  function slugify(str = "") {
    return String(str)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "item";
  }

  function setHash(path, query = {}) {
    const base = path.startsWith("#/") ? path : `#/${path}`;
    const qs = new URLSearchParams(query).toString();
    location.hash = qs ? `${base}?${qs}` : base;
  }

  function getRoute() {
    const h = (location.hash || "#/home").trim();
    if (!h.startsWith("#/")) return { route: "home", query: {} };
    const [p, qs] = h.slice(2).split("?");
    return { route: p || "home", query: Object.fromEntries(new URLSearchParams(qs || "")) };
  }

  function setActiveNav(hash) {
    document.querySelectorAll(".navbtn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.nav === hash);
    });
  }

  function page(html) {
    if (!view) return;
    view.innerHTML = `<div class="page">${html}</div>`;
  }

  function btn(text, action, data = {}, cls = "btn") {
    const attrs = Object.entries(data).map(([k, v]) => `data-${k}="${escapeHtml(String(v))}"`).join(" ");
    return `<button class="${cls}" type="button" data-action="${escapeHtml(action)}" ${attrs}>${escapeHtml(text)}</button>`;
  }

  function sectionTitle(title, rightHtml = "") {
    return `
      <div class="h2row">
        <div>
          <div class="h2">${escapeHtml(title)}</div>
        </div>
        <div>${rightHtml}</div>
      </div>
    `;
  }

  /* =========================
     Markdown (simples e seguro)
  ========================= */
  function mdToHtml(md) {
    const text = String(md ?? "");
    const lines = text.split("\n");
    const out = [];
    let inUl = false;

    const flushUl = () => { if (inUl) { out.push("</ul>"); inUl = false; } };

    const inline = (s) => {
      let x = escapeHtml(s);
      x = x.replace(/`([^`]+)`/g, "<code>$1</code>");
      x = x.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
      x = x.replace(/\*([^*]+)\*/g, "<i>$1</i>");
      return x;
    };

    for (const raw of lines) {
      const line = raw.replace(/\r/g, "");
      if (!line.trim()) { flushUl(); out.push("<div style='height:10px'></div>"); continue; }

      if (line.startsWith("### ")) { flushUl(); out.push(`<div style="font-weight:900;font-size:16px;margin-top:6px;">${inline(line.slice(4))}</div>`); continue; }
      if (line.startsWith("## "))  { flushUl(); out.push(`<div style="font-weight:900;font-size:18px;margin-top:8px;">${inline(line.slice(3))}</div>`); continue; }
      if (line.startsWith("# "))   { flushUl(); out.push(`<div style="font-weight:950;font-size:22px;margin-top:4px;">${inline(line.slice(2))}</div>`); continue; }

      if (/^\s*-\s+/.test(line)) {
        if (!inUl) { out.push("<ul style='margin:6px 0 6px 18px; padding:0;'>"); inUl = true; }
        out.push(`<li style="margin:6px 0; color: rgba(234,240,255,.86);">${inline(line.replace(/^\s*-\s+/, ""))}</li>`);
        continue;
      }

      flushUl();
      out.push(`<div style="color: rgba(234,240,255,.82); line-height:1.55;">${inline(line)}</div>`);
    }
    flushUl();
    return out.join("\n");
  }

  /* =========================
     State (User + Custom Content)
  ========================= */
  const defaultUser = {
    name: "Aluno",
    xp: 0,
    level: 1,
  };

  const store = {
    user: safeJsonParse(localStorage.getItem(LS.USER), defaultUser) || structuredClone(defaultUser),
    custom: safeJsonParse(localStorage.getItem(LS.CUSTOM), []),
    missionsDone: safeJsonParse(localStorage.getItem(LS.MISSIONS_DONE), {}), // date -> {ids:[]}
    streak: Number(localStorage.getItem(LS.STREAK) || "0") || 0,
    lastActive: localStorage.getItem(LS.LAST_ACTIVE) || null,
  };

  function saveUser() {
    localStorage.setItem(LS.USER, JSON.stringify(store.user));
  }

  function saveCustom() {
    localStorage.setItem(LS.CUSTOM, JSON.stringify(store.custom));
  }

  function saveMissionsDone() {
    localStorage.setItem(LS.MISSIONS_DONE, JSON.stringify(store.missionsDone));
  }

  function saveStreak() {
    localStorage.setItem(LS.STREAK, String(store.streak));
    localStorage.setItem(LS.LAST_ACTIVE, store.lastActive || "");
  }

  function computeLevel(xp) {
    return Math.floor(xp / 50) + 1;
  }

  function touchStreak() {
    const t = todayISO();
    const last = store.lastActive;

    if (!last) {
      store.streak = 1;
      store.lastActive = t;
      saveStreak();
      return;
    }
    if (last === t) return;

    const lastD = new Date(last + "T00:00:00");
    const nowD = new Date(t + "T00:00:00");
    const diff = Math.round((nowD - lastD) / (1000 * 60 * 60 * 24));

    if (diff === 1) store.streak += 1;
    else if (diff > 1) store.streak = 1;

    store.lastActive = t;
    saveStreak();
  }

  function addXP(amount, reason = "") {
    const amt = Math.max(0, Math.floor(amount || 0));
    if (!amt) return;
    store.user.xp += amt;
    store.user.level = computeLevel(store.user.xp);
    saveUser();
    touchStreak();
    toast(`+${amt} XP${reason ? ` • ${reason}` : ""}`);
  }

  /* =========================
     Data Merge: Base + Custom
  ========================= */
  function getBaseData() {
    const tracks = Array.isArray(window.TRACKS) ? window.TRACKS : [];
    const lessons = Array.isArray(window.LESSONS) ? window.LESSONS : [];
    const library = Array.isArray(window.LIBRARY) ? window.LIBRARY : [];
    const missions = Array.isArray(window.MISSIONS) ? window.MISSIONS : [];
    return { tracks, lessons, library, missions };
  }

  function normalizeItem(it) {
    const x = structuredClone(it || {});
    if (!x.id) x.id = uid();
    if (!x.type) x.type = "library";
    if (!x.title) x.title = "Sem título";
    if (!x.text) x.text = "";
    return x;
  }

  function mergeById(baseArr, customArr) {
    const map = new Map();
    baseArr.forEach(x => map.set(x.id, x));
    customArr.forEach(x => map.set(x.id, x)); // custom sobrescreve/atualiza
    return Array.from(map.values());
  }

  function getData() {
    const base = getBaseData();
    const custom = Array.isArray(store.custom) ? store.custom.map(normalizeItem) : [];

    const customTracks = custom.filter(x => x.type === "track");
    const customLessons = custom.filter(x => x.type === "lesson");
    const customLibrary = custom.filter(x => x.type === "library");
    const customMissions = custom.filter(x => x.type === "mission");

    const tracks = mergeById(base.tracks, customTracks);
    const lessons = mergeById(base.lessons, customLessons);
    const library = mergeById(base.library, customLibrary);
    const missions = mergeById(base.missions, customMissions);

    const lessonById = new Map(lessons.map(l => [l.id, l]));
    const trackById = new Map(tracks.map(t => [t.id, t]));
    const artById = new Map(library.map(a => [a.id, a]));
    const missionById = new Map(missions.map(m => [m.id, m]));

    return { tracks, lessons, library, missions, lessonById, trackById, artById, missionById };
  }

  /* =========================
     Pages
  ========================= */
  function renderHome() {
    const xpInLevel = store.user.xp % 50;

    page(`
      <section class="hero">
        <div class="heroTop">
          <div class="heroMeta">Olá, ${escapeHtml(store.user.name)} • XP ${store.user.xp} • Nível ${store.user.level}</div>
          <div class="heroStreak">🔥 ${store.streak} dia(s)</div>
        </div>

        <div class="heroTitle">IMVpedia Voice</div>
        <p class="heroDesc">
          Trilha vocal completa (popular, erudito e coral) com técnica, saúde vocal e performance.
        </p>

        <div class="heroActions">
          ${btn("Trilha", "go", { to: "#/path" }, "btn btn--accent")}
          ${btn("Missões", "go", { to: "#/missions" }, "btn")}
          ${btn("Biblioteca", "go", { to: "#/library" }, "btn btn--ghost")}
        </div>

        <div class="progressWrap">
          <div class="progressLabel">Progresso do nível</div>
          <div class="progressBar"><div style="width:${clamp(xpInLevel * 2, 0, 100)}%"></div></div>
          <div class="progressSub">${xpInLevel}/50 XP para o próximo nível</div>
        </div>
      </section>

      ${sectionTitle("Começar agora", `<div class="h2sub">Rápido e seguro</div>`)}
      <div class="missionGrid">
        <div class="card">
          <div class="card__body">
            <div class="missionMeta">
              <div class="badgePill">🎧 Rotina</div>
              <div class="badgePill">⏱️ 8–12 min</div>
            </div>
            <div style="height:10px"></div>
            <div class="card__title">Aquecimento SOVT (leve)</div>
            <div class="card__desc">Faça humming/canudo/lip trill e prepare a voz sem esforço.</div>
          </div>
          <div class="card__actions">
            ${btn("Ver na Biblioteca", "go", { to: "#/library" }, "btn")}
            ${btn("Ir para Missões", "go", { to: "#/missions" }, "btn btn--primary")}
          </div>
        </div>
      </div>
    `);
  }

  function renderPath() {
    const { tracks } = getData();
    page(`
      ${sectionTitle("Trilhas", `<div class="h2sub">${tracks.length} trilha(s)</div>`)}
      <div class="list">
        ${tracks.map(t => `
          <div class="item" data-action="openTrack" data-id="${escapeHtml(t.id)}">
            <div class="itemLeft">
              <div class="iconCircle">${escapeHtml(t.cover || "🧭")}</div>
              <div class="itemText">
                <div class="itemTitle">${escapeHtml(t.title)}</div>
                <div class="itemSub">${escapeHtml(t.subtitle || t.level || "")}</div>
              </div>
            </div>
            <div class="chev">›</div>
          </div>
        `).join("") || `<div class="empty">Sem trilhas.</div>`}
      </div>
    `);
  }

  function renderTrackDetail(trackId) {
    const { trackById, lessonById } = getData();
    const t = trackById.get(trackId);

    if (!t) {
      page(`${sectionTitle("Trilha")}<div class="empty">Trilha não encontrada.</div>`);
      return;
    }

    const lessonIds = Array.isArray(t.lessonIds) ? t.lessonIds : [];
    const lessons = lessonIds.map(id => lessonById.get(id)).filter(Boolean);

    page(`
      ${sectionTitle(t.title, btn("Voltar", "go", { to: "#/path" }, "btn btn--ghost"))}
      <div class="card">
        <div class="card__body">
          <div class="card__title">${escapeHtml(t.title)}</div>
          <div class="card__desc">${escapeHtml(t.subtitle || "")}</div>
          <div style="height:10px"></div>
          <div class="row">
            <div class="kpi">📦 ${escapeHtml(t.level || "Todos")}</div>
            <div class="kpi">📘 ${lessons.length} lição(ões)</div>
          </div>
        </div>
      </div>

      <div style="height:14px"></div>

      ${sectionTitle("Lições", `<div class="h2sub">Toque para abrir</div>`)}
      <div class="list">
        ${lessons.map((l, idx) => `
          <div class="item" data-action="openLesson" data-id="${escapeHtml(l.id)}" data-track="${escapeHtml(t.id)}">
            <div class="itemLeft">
              <div class="iconCircle">📘</div>
              <div class="itemText">
                <div class="itemTitle">${escapeHtml(String(idx + 1).padStart(2, "0"))}. ${escapeHtml(l.title)}</div>
                <div class="itemSub">${escapeHtml(l.level || "")}${l.tags?.length ? " • " + escapeHtml(l.tags.slice(0,3).join(", ")) : ""}</div>
              </div>
            </div>
            <div class="chev">›</div>
          </div>
        `).join("") || `<div class="empty">Sem lições nesta trilha.</div>`}
      </div>
    `);
  }

  function renderLesson(lessonId, fromTrackId = "") {
    const { lessonById, trackById } = getData();
    const l = lessonById.get(lessonId);
    const t = fromTrackId ? trackById.get(fromTrackId) : null;

    if (!l) {
      page(`${sectionTitle("Lição")}<div class="empty">Lição não encontrada.</div>`);
      return;
    }

    const backTo = t ? `#/track?id=${encodeURIComponent(t.id)}` : "#/path";

    page(`
      ${sectionTitle("Lição", btn("Voltar", "go", { to: backTo }, "btn btn--ghost"))}
      <div class="card">
        <div class="card__body">
          <div class="card__title">${escapeHtml(l.title)}</div>
          <div class="card__desc">
            ${escapeHtml(l.level || "")}
            ${l.tags?.length ? ` • ${escapeHtml(l.tags.join(", "))}` : ""}
          </div>
          <div style="height:12px"></div>
          <div>${mdToHtml(l.text || "")}</div>
        </div>
        <div class="card__actions">
          ${btn("Ganhar +5 XP (estudei)", "lessonXP", { id: l.id }, "btn btn--accent")}
          ${btn("Ir para Missões", "go", { to: "#/missions" }, "btn")}
        </div>
      </div>
    `);
  }

  function renderLibrary() {
    const { library } = getData();
    page(`
      ${sectionTitle("Biblioteca", `<div class="h2sub">${library.length} item(ns)</div>`)}
      <div class="list">
        ${library.map(a => `
          <div class="item" data-action="openArticle" data-id="${escapeHtml(a.id)}">
            <div class="itemLeft">
              <div class="iconCircle">📚</div>
              <div class="itemText">
                <div class="itemTitle">${escapeHtml(a.title)}</div>
                <div class="itemSub">${escapeHtml(a.category || a.level || "")}</div>
              </div>
            </div>
            <div class="chev">›</div>
          </div>
        `).join("") || `<div class="empty">Biblioteca vazia.</div>`}
      </div>
    `);
  }

  function renderArticle(articleId) {
    const { artById } = getData();
    const a = artById.get(articleId);

    if (!a) {
      page(`${sectionTitle("Artigo")}<div class="empty">Artigo não encontrado.</div>`);
      return;
    }

    page(`
      ${sectionTitle("Biblioteca", btn("Voltar", "go", { to: "#/library" }, "btn btn--ghost"))}
      <div class="card">
        <div class="card__body">
          <div class="card__title">${escapeHtml(a.title)}</div>
          <div class="card__desc">${escapeHtml(a.category || a.level || "")}</div>
          <div style="height:12px"></div>
          <div>${mdToHtml(a.text || "")}</div>
        </div>
        <div class="card__actions">
          ${btn("Ganhar +3 XP (li)", "articleXP", { id: a.id }, "btn btn--accent")}
          ${btn("Ir para Trilha", "go", { to: "#/path" }, "btn")}
        </div>
      </div>
    `);
  }

  function renderMissions() {
    const { missions } = getData();
    const date = todayISO();
    const done = store.missionsDone?.[date]?.ids || [];

    page(`
      ${sectionTitle("Missões", `<div class="h2sub">${done.length}/${missions.length} concluídas hoje</div>`)}
      <div class="missionGrid">
        ${missions.map(m => {
          const isDone = done.includes(m.id);
          return `
            <div class="card">
              <div class="card__body">
                <div class="missionMeta">
                  <div class="badgePill">✅ ${escapeHtml(m.tag || "missão")}</div>
                  <div class="badgePill">⏱️ ${escapeHtml(String(m.minutes || 8))} min</div>
                </div>
                <div style="height:10px"></div>
                <div class="card__title">${escapeHtml(m.title)}</div>
                <div class="card__desc">${escapeHtml(m.desc || "")}</div>
              </div>
              <div class="card__actions">
                ${
                  isDone
                    ? `<span class="kpi">✔ Concluída</span>`
                    : btn(`Concluir (+${m.xp || 10} XP)`, "completeMission", { id: m.id }, "btn btn--primary")
                }
              </div>
            </div>
          `;
        }).join("") || `<div class="empty">Nenhuma missão cadastrada.</div>`}
      </div>
    `);
  }

  function renderProfile() {
    page(`
      ${sectionTitle("Perfil", `<div class="h2sub">Seu progresso</div>`)}
      <div class="card">
        <div class="card__body">
          <div class="card__title">🎤 ${escapeHtml(store.user.name)}</div>
          <div class="card__desc">XP: ${store.user.xp} • Nível: ${store.user.level} • Streak: 🔥 ${store.streak}</div>
          <div style="height:12px"></div>

          <div class="row">
            <div class="kpi">🏅 Nível ${store.user.level}</div>
            <div class="kpi">✨ ${store.user.xp} XP</div>
            <div class="kpi">🔥 ${store.streak} dias</div>
          </div>
        </div>
        <div class="card__actions">
          ${btn("Editar nome", "editName", {}, "btn")}
          ${btn("Ver Missões", "go", { to: "#/missions" }, "btn btn--accent")}
          ${btn("Admin", "go", { to: "#/admin" }, "btn btn--ghost")}
        </div>
      </div>

      <div style="height:14px"></div>

      <div class="card">
        <div class="card__body">
          <div class="card__title">Conteúdo custom</div>
          <div class="card__desc">
            Você pode criar conteúdos novos no Admin (Gerador) sem programar. Eles ficam salvos no seu navegador.
          </div>
        </div>
        <div class="card__actions">
          ${btn("Abrir Gerador", "go", { to: "#/admin-generator" }, "btn btn--primary")}
          ${btn("Exportar JSON", "go", { to: "#/admin-export" }, "btn")}
        </div>
      </div>
    `);
  }

  /* =========================
     Admin
  ========================= */
  function isAdminEnabled() {
    return localStorage.getItem(LS.ADMIN) === "1";
  }

  function requireAdminOrLogin() {
    if (isAdminEnabled()) return true;
    renderAdminLogin();
    return false;
  }

  function renderAdminLogin() {
    page(`
      ${sectionTitle("Admin", btn("Voltar", "go", { to: "#/home" }, "btn btn--ghost"))}
      <div class="card">
        <div class="card__body">
          <div class="card__title">Acesso Admin</div>
          <div class="card__desc">Senha padrão: <b>imvadmin</b></div>
          <div style="height:10px"></div>
          <input id="adminPass" class="input" type="password" placeholder="Digite a senha" />
        </div>
        <div class="card__actions">
          ${btn("Entrar", "adminLogin", {}, "btn btn--primary")}
          ${btn("Cancelar", "go", { to: "#/home" }, "btn")}
        </div>
      </div>
    `);
  }

  function renderAdminHome() {
    if (!requireAdminOrLogin()) return;

    page(`
      ${sectionTitle("Admin", btn("Sair", "adminLogout", {}, "btn btn--ghost"))}

      <div class="card">
        <div class="card__body">
          <div class="card__title">Ferramentas</div>
          <div class="card__desc">Crie conteúdo sem programar, importe e exporte sem apagar o que já existe.</div>
        </div>
        <div class="card__actions">
          ${btn("Gerador de Conteúdo", "go", { to: "#/admin-generator" }, "btn btn--primary")}
          ${btn("Importar JSON", "go", { to: "#/admin-import" }, "btn")}
          ${btn("Exportar JSON", "go", { to: "#/admin-export" }, "btn")}
          ${btn("Limpar conteúdo custom", "adminClearCustom", {}, "btn btn--ghost")}
        </div>
      </div>

      <div style="height:14px"></div>

      <div class="card">
        <div class="card__body">
          <div class="card__title">Status</div>
          <div class="card__desc">
            Itens custom salvos: <b>${(store.custom?.length || 0)}</b><br/>
            Trilhas base: <b>${(Array.isArray(window.TRACKS) ? window.TRACKS.length : 0)}</b> •
            Lições base: <b>${(Array.isArray(window.LESSONS) ? window.LESSONS.length : 0)}</b> •
            Biblioteca base: <b>${(Array.isArray(window.LIBRARY) ? window.LIBRARY.length : 0)}</b> •
            Missões base: <b>${(Array.isArray(window.MISSIONS) ? window.MISSIONS.length : 0)}</b>
          </div>
        </div>
      </div>
    `);
  }

  // ===== Admin Generator Draft =====
  const generator = {
    type: "library", // track|lesson|library|mission
    title: "",
    subtitle: "",
    category: "",
    level: "Básico",
    cover: "",
    minutes: 8,
    xp: 10,
    tag: "técnica",
    lessonIdsText: "",
    text: ""
  };

  function renderAdminGenerator() {
    if (!requireAdminOrLogin()) return;

    page(`
      ${sectionTitle("Admin • Gerador", btn("Voltar", "go", { to: "#/admin" }, "btn btn--ghost"))}

      <div class="card">
        <div class="card__body">
          <div class="card__title">Criar item</div>
          <div class="card__desc">Preencha e clique em <b>Adicionar ao app</b>. Isso salva no seu navegador e não apaga nada.</div>

          <div style="height:12px"></div>

          <div class="muted small">Tipo</div>
          <select id="gType" class="input">
            <option value="track">Trilha (track)</option>
            <option value="lesson">Lição (lesson)</option>
            <option value="library">Biblioteca (library)</option>
            <option value="mission">Missão (mission)</option>
          </select>

          <div style="height:10px"></div>

          <div class="muted small">Título</div>
          <input id="gTitle" class="input" placeholder="Ex: Higiene vocal" />

          <div style="height:10px"></div>

          <div class="muted small">Subtítulo / Categoria</div>
          <input id="gSub" class="input" placeholder="Ex: Saúde / Anatomia" />

          <div style="height:10px"></div>

          <div class="muted small">Nível (opcional)</div>
          <input id="gLevel" class="input" placeholder="Básico / Intermediário / Avançado / Todos" value="Básico" />

          <div style="height:10px"></div>

          <div class="muted small">Capa (emoji ou URL)</div>
          <input id="gCover" class="input" placeholder="🎤 ou https://..." />

          <div style="height:10px"></div>

          <div class="muted small">Para TRILHA: IDs de lições (uma por linha)</div>
          <textarea id="gLessonIds" class="input" rows="5" placeholder="les_respiracao_01&#10;les_apoio_01"></textarea>

          <div style="height:10px"></div>

          <div class="muted small">Para MISSÃO: minutos / XP / tag</div>
          <div class="row">
            <input id="gMinutes" class="input" style="flex:1" type="number" min="1" step="1" value="8" />
            <input id="gXP" class="input" style="flex:1" type="number" min="1" step="1" value="10" />
          </div>
          <div style="height:10px"></div>
          <input id="gTag" class="input" placeholder="técnica / saúde / musical / performance" value="técnica" />

          <div style="height:12px"></div>

          <div class="muted small">Texto (Markdown)</div>
          <textarea id="gText" class="input" rows="12" placeholder="# Título&#10;&#10;Conteúdo..."></textarea>
        </div>

        <div class="card__actions">
          ${btn("Gerar JSON", "genMakeJson", {}, "btn")}
          ${btn("Adicionar ao app", "genAddToApp", {}, "btn btn--primary")}
          ${btn("Limpar campos", "genClear", {}, "btn btn--ghost")}
        </div>
      </div>

      <div style="height:14px"></div>

      <div class="card">
        <div class="card__body">
          <div class="card__title">Saída JSON</div>
          <div class="card__desc">Você pode copiar e colar no GitHub se quiser armazenar “fixo”.</div>
          <div style="height:10px"></div>
          <textarea id="gOut" class="input" rows="10" spellcheck="false"></textarea>
        </div>
        <div class="card__actions">
          ${btn("Copiar", "genCopy", {}, "btn btn--accent")}
          ${btn("Ir para Exportar", "go", { to: "#/admin-export" }, "btn")}
        </div>
      </div>
    `);

    // valores default
    $("#gType").value = generator.type;
    $("#gTitle").value = generator.title;
    $("#gSub").value = generator.subtitle;
    $("#gLevel").value = generator.level;
    $("#gCover").value = generator.cover;
    $("#gLessonIds").value = generator.lessonIdsText;
    $("#gMinutes").value = String(generator.minutes);
    $("#gXP").value = String(generator.xp);
    $("#gTag").value = generator.tag;
    $("#gText").value = generator.text;
  }

  function renderAdminImport() {
    if (!requireAdminOrLogin()) return;

    page(`
      ${sectionTitle("Admin • Importar", btn("Voltar", "go", { to: "#/admin" }, "btn btn--ghost"))}

      <div class="card">
        <div class="card__body">
          <div class="card__title">Importar JSON</div>
          <div class="card__desc">
            Cole um item (track/lesson/library/mission) ou uma lista de itens.
            Se o ID já existir, ele atualiza; se não existir, adiciona. Não apaga nada.
          </div>
          <div style="height:12px"></div>
          <textarea id="impJson" class="input" rows="14" spellcheck="false" placeholder='{"id":"...","type":"library","title":"...","text":"..."}'></textarea>
        </div>
        <div class="card__actions">
          ${btn("Importar", "adminDoImport", {}, "btn btn--primary")}
          ${btn("Cancelar", "go", { to: "#/admin" }, "btn")}
        </div>
      </div>
    `);
  }

  function renderAdminExport() {
    if (!requireAdminOrLogin()) return;
    const payload = JSON.stringify(store.custom || [], null, 2);

    page(`
      ${sectionTitle("Admin • Exportar", btn("Voltar", "go", { to: "#/admin" }, "btn btn--ghost"))}
      <div class="card">
        <div class="card__body">
          <div class="card__title">Seu conteúdo custom (JSON)</div>
          <div class="card__desc">Copie e cole no GitHub para atrapalhar o mínimo possível seu fluxo.</div>
          <div style="height:12px"></div>
          <textarea id="expJson" class="input" rows="16" spellcheck="false">${escapeHtml(payload)}</textarea>
        </div>
        <div class="card__actions">
          ${btn("Copiar", "adminCopyExport", {}, "btn btn--primary")}
          ${btn("Ir para Gerador", "go", { to: "#/admin-generator" }, "btn")}
        </div>
      </div>
    `);
  }

  /* =========================
     Router
  ========================= */
  function router() {
    const { route, query } = getRoute();
    const fullHash = "#/" + route + (Object.keys(query).length ? "?" + new URLSearchParams(query).toString() : "");
    setActiveNav("#/" + route);

    // Rotas principais
    if (route === "home") return renderHome();
    if (route === "path") return renderPath();
    if (route === "track") return renderTrackDetail(query.id || "");
    if (route === "lesson") return renderLesson(query.id || "", query.track || "");
    if (route === "library") return renderLibrary();
    if (route === "article") return renderArticle(query.id || "");
    if (route === "missions") return renderMissions();
    if (route === "profile") return renderProfile();

    // Admin
    if (route === "admin") return (isAdminEnabled() ? renderAdminHome() : renderAdminLogin());
    if (route === "admin-generator") return renderAdminGenerator();
    if (route === "admin-import") return renderAdminImport();
    if (route === "admin-export") return renderAdminExport();

    // fallback
    renderHome();
  }

  /* =========================
     Events
  ========================= */
  // Tabbar nav
  document.querySelectorAll("[data-nav]").forEach(btnEl => {
    btnEl.addEventListener("click", () => {
      const to = btnEl.getAttribute("data-nav") || "#/home";
      location.hash = to;
    });
  });

  // Admin top button
  if (adminBtn) {
    adminBtn.addEventListener("click", () => {
      setHash("admin");
    });
  }

  // Global click handler
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;

    const action = el.getAttribute("data-action");

    // nav
    if (action === "go") {
      const to = el.getAttribute("data-to") || "#/home";
      location.hash = to;
      return;
    }

    // open track
    if (action === "openTrack") {
      const id = el.getAttribute("data-id") || "";
      setHash("track", { id });
      return;
    }

    // open lesson
    if (action === "openLesson") {
      const id = el.getAttribute("data-id") || "";
      const track = el.getAttribute("data-track") || "";
      setHash("lesson", { id, track });
      return;
    }

    // open article
    if (action === "openArticle") {
      const id = el.getAttribute("data-id") || "";
      setHash("article", { id });
      return;
    }

    // award xp reading
    if (action === "lessonXP") {
      addXP(5, "Lição");
      return;
    }

    if (action === "articleXP") {
      addXP(3, "Biblioteca");
      return;
    }

    // complete mission
    if (action === "completeMission") {
      const id = el.getAttribute("data-id") || "";
      const { missionById } = getData();
      const m = missionById.get(id);
      if (!m) return;

      const date = todayISO();
      store.missionsDone[date] = store.missionsDone[date] || { ids: [] };
      if (!store.missionsDone[date].ids.includes(id)) {
        store.missionsDone[date].ids.push(id);
        saveMissionsDone();
        addXP(m.xp || 10, "Missão");
        toast("Missão concluída!");
      } else {
        toast("Você já concluiu essa missão hoje.");
      }
      renderMissions();
      return;
    }

    // profile edit name
    if (action === "editName") {
      const n = prompt("Seu nome:", store.user.name || "Aluno");
      if (n && n.trim()) {
        store.user.name = n.trim().slice(0, 40);
        saveUser();
        toast("Nome atualizado.");
        renderProfile();
      }
      return;
    }

    // Admin login
    if (action === "adminLogin") {
      const pass = (document.getElementById("adminPass")?.value || "").trim();
      if (pass === "imvadmin") {
        localStorage.setItem(LS.ADMIN, "1");
        toast("Admin liberado.");
        setHash("admin");
      } else {
        toast("Senha incorreta.");
      }
      return;
    }

    if (action === "adminLogout") {
      localStorage.removeItem(LS.ADMIN);
      toast("Saiu do admin.");
      setHash("home");
      return;
    }

    if (action === "adminClearCustom") {
      const ok = confirm("Isso apaga SOMENTE seu conteúdo custom (LocalStorage). Continuar?");
      if (!ok) return;
      store.custom = [];
      saveCustom();
      toast("Conteúdo custom limpo.");
      renderAdminHome();
      return;
    }

    // Admin import
    if (action === "adminDoImport") {
      const raw = (document.getElementById("impJson")?.value || "").trim();
      if (!raw) { toast("Cole um JSON."); return; }

      try {
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed) ? parsed : [parsed];

        // merge by id into store.custom
        const map = new Map((store.custom || []).map(x => [x.id, x]));
        items.map(normalizeItem).forEach(it => {
          map.set(it.id, it);
        });

        store.custom = Array.from(map.values());
        saveCustom();
        toast(`Importado: ${items.length} item(ns).`);
        setHash("admin");
      } catch (err) {
        console.error(err);
        toast("JSON inválido.");
      }
      return;
    }

    // Admin export copy
    if (action === "adminCopyExport") {
      const ta = document.getElementById("expJson");
      if (!ta) return;
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy");
        toast("Copiado!");
      } catch {
        toast("Copie manualmente.");
      }
      return;
    }

    // Generator actions
    if (action === "genClear") {
      generator.type = "library";
      generator.title = "";
      generator.subtitle = "";
      generator.category = "";
      generator.level = "Básico";
      generator.cover = "";
      generator.minutes = 8;
      generator.xp = 10;
      generator.tag = "técnica";
      generator.lessonIdsText = "";
      generator.text = "";
      toast("Campos limpos.");
      renderAdminGenerator();
      return;
    }

    if (action === "genMakeJson" || action === "genAddToApp") {
      // read fields
      const t = (document.getElementById("gType")?.value || "library").trim();
      const title = (document.getElementById("gTitle")?.value || "").trim();
      const sub = (document.getElementById("gSub")?.value || "").trim();
      const level = (document.getElementById("gLevel")?.value || "").trim();
      const cover = (document.getElementById("gCover")?.value || "").trim();
      const lessonIdsText = (document.getElementById("gLessonIds")?.value || "").trim();
      const minutes = parseInt((document.getElementById("gMinutes")?.value || "8").trim(), 10) || 8;
      const xp = parseInt((document.getElementById("gXP")?.value || "10").trim(), 10) || 10;
      const tag = (document.getElementById("gTag")?.value || "técnica").trim();
      const text = (document.getElementById("gText")?.value || "").trim();

      if (!title) { toast("Título é obrigatório."); return; }
      if (!text && (t === "lesson" || t === "library")) {
        toast("Texto (Markdown) é obrigatório para lição/biblioteca.");
        return;
      }

      const id = `${t}_${slugify(title)}_${String(Date.now()).slice(-6)}`;

      let item = {
        id,
        type: t,
        title,
        text: text || "",
      };

      if (t === "track") {
        item.cover = cover || "🧭";
        item.subtitle = sub || "";
        item.level = level || "Todos";
        const ids = lessonIdsText.split("\n").map(x => x.trim()).filter(Boolean);
        item.lessonIds = ids;
      }

      if (t === "lesson") {
        item.level = level || "Básico";
        item.tags = sub ? sub.split(",").map(x => x.trim()).filter(Boolean) : [];
      }

      if (t === "library") {
        item.category = sub || level || "";
        item.level = level || "Básico";
      }

      if (t === "mission") {
        item.desc = sub || "";
        item.minutes = clamp(minutes, 1, 180);
        item.xp = clamp(xp, 1, 999);
        item.tag = tag || "técnica";
        item.text = ""; // missões não precisam de texto
      }

      // output json
      const out = document.getElementById("gOut");
      if (out) out.value = JSON.stringify(item, null, 2);

      if (action === "genMakeJson") {
        toast("JSON gerado.");
        return;
      }

      // Add to app (merge custom)
      const map = new Map((store.custom || []).map(x => [x.id, x]));
      map.set(item.id, item);
      store.custom = Array.from(map.values());
      saveCustom();
      toast("Adicionado ao app (conteúdo custom).");
      return;
    }

    if (action === "genCopy") {
      const ta = document.getElementById("gOut");
      if (!ta) { toast("Gere o JSON primeiro."); return; }
      ta.focus(); ta.select();
      try {
        document.execCommand("copy");
        toast("Copiado!");
      } catch {
        toast("Copie manualmente.");
      }
      return;
    }
  });

  // Hash change
  window.addEventListener("hashchange", router);

  /* =========================
     Init
  ========================= */
  // valida se dados base carregaram
  const baseOk =
    Array.isArray(window.TRACKS) &&
    Array.isArray(window.LESSONS) &&
    Array.isArray(window.LIBRARY) &&
    Array.isArray(window.MISSIONS);

  if (!baseOk) {
    // ainda assim inicia; os arquivos podem carregar em seguida (defer)
    // router será chamado no load também.
  }

  // força defaults do user se necessário
  store.user = store.user || structuredClone(defaultUser);
  store.user.xp = Number(store.user.xp || 0) || 0;
  store.user.level = Number(store.user.level || 1) || 1;
  saveUser();

  // inicia rota
  if (!location.hash) location.hash = "#/home";
  router();
})();
