/* =========================================================
   IMVpedia Voice — app.js (SINGLE / CLEAN / STABLE)
   - Carrega conteúdo do packs/base/imports/content.json (se existir)
   - Fallback para window.TRACKS / window.LESSONS / window.LIBRARY / window.MISSIONS
   - Trilha usa track.lessonIds
   - Missões pontuam, toast aparece, home atualiza
   - "Voltar" sempre volta
========================================================= */

(() => {
  "use strict";

  // -----------------------------
  // Helpers
  // -----------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const safeJson = (str, fallback) => {
    try { return JSON.parse(str); } catch { return fallback; }
  };
  const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
  const todayKey = () => new Date().toISOString().slice(0, 10);

  function esc(str = "") {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toast(msg, type = "info") {
    const host = $("#toastHost");
    if (!host) return alert(msg);

    const el = document.createElement("div");
    el.className = `toast toast--${type}`;
    el.textContent = msg;

    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("toast--on"));

    setTimeout(() => {
      el.classList.remove("toast--on");
      setTimeout(() => el.remove(), 250);
    }, 2400);
  }

  // -----------------------------
  // Persistent State (LocalStorage)
  // -----------------------------
  const LS_KEY = "imvpedia_voice_state_v3";

  const defaultState = {
    user: {
      name: "Aluno",
      goal: "Misto",
      xp: 0,
      level: 1,
      streakDays: 0,
      lastActiveDate: null
    },
    progress: {
      completedMissionsByDate: {}, // { "YYYY-MM-DD": { [missionId]: true } }
      completedLessons: {} // { [lessonId]: true }
    }
  };

  const state = safeJson(localStorage.getItem(LS_KEY), null) || structuredClone(defaultState);

  function saveState() {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }

  function ensureStreak() {
    const t = todayKey();
    const last = state.user.lastActiveDate;

    if (!last) {
      state.user.streakDays = 1;
      state.user.lastActiveDate = t;
      saveState();
      return;
    }
    if (last === t) return;

    // diferença de dias
    const d1 = new Date(last + "T00:00:00");
    const d2 = new Date(t + "T00:00:00");
    const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) state.user.streakDays = (state.user.streakDays || 0) + 1;
    else state.user.streakDays = 1;

    state.user.lastActiveDate = t;
    saveState();
  }

  function xpForNextLevel(level) {
    // simples e estável (pode ajustar depois sem quebrar)
    return 50;
  }

  function recalcLevel() {
    // Mantém o modelo simples: Nível 1 com barra 0/50 etc.
    // (Se quiser níveis escalonados depois, dá pra evoluir)
    const need = xpForNextLevel(state.user.level);
    if (state.user.xp >= need) {
      // sobe nível, mantém excedente
      state.user.xp = state.user.xp - need;
      state.user.level += 1;
      toast(`🎉 Você subiu para o nível ${state.user.level}!`, "ok");
      saveState();
    }
  }

  function addXP(amount) {
    amount = Number(amount) || 0;
    if (amount <= 0) return;
    state.user.xp += amount;
    ensureStreak();
    recalcLevel();
    saveState();
  }

  // -----------------------------
  // Content Loading
  // -----------------------------
  const content = {
    tracks: [],
    lessons: [],
    library: [],
    missions: []
  };

  function normalizeFromArray(arr) {
    // arr pode conter objetos: track / lesson / library / mission
    const tracks = [];
    const lessons = [];
    const library = [];
    const missions = [];

    for (const it of arr || []) {
      if (!it || typeof it !== "object") continue;
      const type = (it.type || "").toLowerCase();

      if (type === "track") tracks.push(it);
      else if (type === "lesson") lessons.push(it);
      else if (type === "library") library.push(it);
      else if (type === "mission") missions.push(it);
    }

    return { tracks, lessons, library, missions };
  }

  async function loadContent() {
    // 1) tenta content.json (sua estrutura atual)
    // caminho MAIS PROVÁVEL pelo que você falou:
    // packs/base/imports/content.json
    const candidates = [
      "./packs/base/imports/content.json",
      "packs/base/imports/content.json"
    ];

    for (const url of candidates) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        const data = await res.json();
        if (!Array.isArray(data)) continue;

        const norm = normalizeFromArray(data);
        content.tracks = norm.tracks;
        content.lessons = norm.lessons;
        content.library = norm.library;
        content.missions = norm.missions;

        return;
      } catch (_) {
        // tenta próximo
      }
    }

    // 2) fallback para variáveis globais (caso existam)
    const tracks = Array.isArray(window.TRACKS) ? window.TRACKS : [];
    const lessons = Array.isArray(window.LESSONS) ? window.LESSONS : [];
    const library = Array.isArray(window.LIBRARY) ? window.LIBRARY : [];
    const missions = Array.isArray(window.MISSIONS) ? window.MISSIONS : [];

    content.tracks = tracks;
    content.lessons = lessons;
    content.library = library;
    content.missions = missions;
  }

  function indexById(arr) {
    const map = new Map();
    for (const it of arr || []) {
      if (it && it.id) map.set(String(it.id), it);
    }
    return map;
  }

  // -----------------------------
  // Routing
  // -----------------------------
  const view = $("#view");
  if (!view) {
    console.error("Elemento #view não encontrado.");
    return;
  }

  function getHash() {
    return location.hash || "#/home";
  }

  function parseRoute() {
    // suporta: #/home, #/path, #/path?track=ID, #/article?id=ID, #/missions...
    const hash = getHash();
    const [path, query] = hash.split("?");
    const q = new URLSearchParams(query || "");
    return { path, q };
  }

  function navTo(hash) {
    location.hash = hash;
  }

  function bindTabbar() {
    $$(".tabbar__item").forEach(btn => {
      btn.addEventListener("click", () => {
        const r = btn.getAttribute("data-route");
        if (r) navTo(r);
      });
    });
  }

  function setActiveTab() {
    const { path } = parseRoute();
    $$(".tabbar__item").forEach(btn => {
      const r = btn.getAttribute("data-route") || "";
      btn.classList.toggle("is-active", r.startsWith(path));
    });
  }

  // -----------------------------
  // UI builders
  // -----------------------------
  function card({ title, subtitle, meta, body, actions }) {
    return `
      <section class="card">
        <div class="card__head">
          <div>
            ${title ? `<div class="card__title">${title}</div>` : ""}
            ${subtitle ? `<div class="card__subtitle">${subtitle}</div>` : ""}
          </div>
          ${meta ? `<div class="card__meta">${meta}</div>` : ""}
        </div>
        ${body ? `<div class="card__body">${body}</div>` : ""}
        ${actions ? `<div class="card__actions">${actions}</div>` : ""}
      </section>
    `;
  }

  function pageHeader(title, right = "") {
    return `
      <div class="pagehead">
        <div class="pagehead__title">${esc(title)}</div>
        ${right ? `<div class="pagehead__right">${right}</div>` : ""}
      </div>
    `;
  }

  function progressBar(current, total) {
    const pct = total > 0 ? clamp((current / total) * 100, 0, 100) : 0;
    return `
      <div class="progress">
        <div class="progress__bar" style="width:${pct}%"></div>
      </div>
      <div class="muted">${current}/${total} XP para o próximo nível</div>
    `;
  }

  // -----------------------------
  // Screens
  // -----------------------------
  let lessonById = new Map();
  let trackById = new Map();
  let libraryById = new Map();
  let missionById = new Map();

  function rebuildIndexes() {
    lessonById = indexById(content.lessons);
    trackById = indexById(content.tracks);
    libraryById = indexById(content.library);
    missionById = indexById(content.missions);
  }

  function renderHome() {
    const u = state.user;
    const need = xpForNextLevel(u.level);

    const hero = card({
      title: `IMVpedia Voice`,
      subtitle: `Trilha vocal completa (popular, erudito e coral) com técnica, saúde vocal e performance.`,
      meta: `🔥 ${u.streakDays || 0} dia(s)`,
      body: `
        <div class="muted" style="margin-bottom:10px">Olá, ${esc(u.name)} • XP ${u.xp} • Nível ${u.level}</div>
        <div style="margin:10px 0 14px">${progressBar(u.xp, need)}</div>
        <div class="pillrow">
          <button class="btn btn--soft" data-nav="#/path">Trilha</button>
          <button class="btn btn--soft" data-nav="#/missions">Missões</button>
          <button class="btn btn--soft" data-nav="#/library">Biblioteca</button>
        </div>
      `
    });

    // Missão do dia: pega 1 missão "não concluída" se houver; senão mostra qualquer uma
    const t = todayKey();
    const done = state.progress.completedMissionsByDate[t] || {};
    const missions = content.missions.length ? content.missions : defaultMissionsFallback();
    const next = missions.find(m => !done[m.id]) || missions[0];

    const missionCard = next
      ? card({
          title: `Missão do dia`,
          subtitle: `<div class="muted">${esc(next.title || "Missão")}</div>`,
          meta: `${t} • ${(next.category || next.tag || "técnica")}`,
          body: `
            <div style="font-size:22px;font-weight:800;margin-top:6px">${esc(next.title || "Missão")}</div>
            <div class="muted" style="margin-top:6px">${esc(next.desc || next.text || "Conclua para ganhar XP.")}</div>
            <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
              <span class="chip">⏱ ${esc(next.duration || next.minutes || "5")} min</span>
              <span class="chip">✨ +${esc(next.xp || 10)} XP</span>
            </div>
          `,
          actions: `
            <button class="btn btn--ghost" data-nav="#/missions">Ver missões</button>
            <button class="btn" data-mission-complete="${esc(next.id)}">Concluir</button>
          `
        })
      : "";

    view.innerHTML = `
      <div class="page">
        ${hero}
        <div style="height:14px"></div>
        ${missionCard}
      </div>
    `;

    // binds
    $$("[data-nav]", view).forEach(b => {
      b.addEventListener("click", () => navTo(b.getAttribute("data-nav")));
    });
    $$("[data-mission-complete]", view).forEach(b => {
      b.addEventListener("click", () => completeMission(b.getAttribute("data-mission-complete")));
    });
  }

  function renderPath() {
    const { q } = parseRoute();
    const trackId = q.get("track");

    if (trackId) return renderTrack(trackId);

    // lista trilhas
    const tracks = content.tracks.slice().sort((a, b) => (a.order || 0) - (b.order || 0));

    const list = tracks.map(tr => {
      const count = Array.isArray(tr.lessonIds) ? tr.lessonIds.length : (Array.isArray(tr.lessons) ? tr.lessons.length : 0);
      const level = tr.level || tr.difficulty || "Base";
      const subtitle = `${esc(level)} • ${count} lições`;
      const tags = tr.tags ? ` • ${esc(tr.tags.join(" • "))}` : "";
      return card({
        title: `${esc(tr.icon || "⏱")} ${esc(tr.title || "Trilha")}`,
        subtitle: `${subtitle}${tags}`,
        actions: `<button class="btn btn--soft" data-open-track="${esc(tr.id)}">Abrir</button>`
      });
    }).join("");

    view.innerHTML = `
      <div class="page">
        ${pageHeader("Trilha")}
        ${list || card({ title: "Nenhuma trilha encontrada", subtitle: "Verifique o carregamento do pack Base." })}
      </div>
    `;

    $$("[data-open-track]", view).forEach(b => {
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-open-track");
        navTo(`#/path?track=${encodeURIComponent(id)}`);
      });
    });
  }

  function renderTrack(trackId) {
    const tr = trackById.get(String(trackId));
    if (!tr) {
      view.innerHTML = `
        <div class="page">
          ${pageHeader("Trilha • Aulas")}
          ${card({
            title: "Trilha não encontrada",
            subtitle: "O ID dessa trilha não existe no conteúdo carregado.",
            actions: `<button class="btn btn--soft" data-nav="#/path">Voltar</button>`
          })}
        </div>
      `;
      $$("[data-nav]", view).forEach(b => b.addEventListener("click", () => navTo(b.getAttribute("data-nav"))));
      return;
    }

    const ids =
      Array.isArray(tr.lessonIds) ? tr.lessonIds :
      Array.isArray(tr.lessons) ? tr.lessons :
      [];

    const lessons = ids
      .map(id => lessonById.get(String(id)))
      .filter(Boolean);

    const list = lessons.map(ls => {
      const done = !!state.progress.completedLessons[String(ls.id)];
      return card({
        title: `${done ? "✅" : "🎓"} ${esc(ls.title || "Lição")}`,
        subtitle: `${esc(ls.level || "Básico")} • ${(ls.tags ? esc(ls.tags.join(" • ")) : "aula")}`,
        actions: `<button class="btn btn--soft" data-open-lesson="${esc(ls.id)}">Abrir</button>`
      });
    }).join("");

    view.innerHTML = `
      <div class="page">
        ${pageHeader(`Trilha • Aulas`, `<span class="muted">${esc(tr.title || "")}</span>`)}
        ${card({
          title: `${esc(tr.title || "Trilha")}`,
          subtitle: `${esc(tr.level || "Base")} • ${ids.length} lições`,
          body: `${esc(tr.desc || tr.description || "")}`,
          actions: `<button class="btn btn--soft" data-nav="#/path">Voltar</button>`
        })}
        <div style="height:12px"></div>
        ${list || card({
          title: "Sem lições nessa trilha",
          subtitle: "Isso acontece quando a trilha tem lessonIds vazios ou IDs que não existem em lessons.",
          actions: `<button class="btn btn--soft" data-nav="#/path">Voltar</button>`
        })}
      </div>
    `;

    $$("[data-nav]", view).forEach(b => b.addEventListener("click", () => navTo(b.getAttribute("data-nav"))));
    $$("[data-open-lesson]", view).forEach(b => {
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-open-lesson");
        navTo(`#/article?id=${encodeURIComponent(id)}`);
      });
    });
  }

  function renderArticle(id) {
    // tenta achar em lesson / library / mission
    const ls = lessonById.get(String(id));
    const lb = libraryById.get(String(id));
    const ms = missionById.get(String(id));

    const it = ls || lb || ms;
    if (!it) {
      view.innerHTML = `
        <div class="page">
          ${pageHeader("Conteúdo")}
          ${card({
            title: "Conteúdo não encontrado",
            subtitle: "O item não existe no pack carregado.",
            actions: `<button class="btn btn--soft" data-nav="#/home">Voltar</button>`
          })}
        </div>
      `;
      $$("[data-nav]", view).forEach(b => b.addEventListener("click", () => navTo(b.getAttribute("data-nav"))));
      return;
    }

    const title = it.title || "Conteúdo";
    const meta = [
      it.category ? esc(it.category) : "",
      it.level ? esc(it.level) : "",
      it.tags && it.tags.length ? esc(it.tags.join(" • ")) : ""
    ].filter(Boolean).join(" • ");

    const text = (it.text || it.desc || "").trim();

    view.innerHTML = `
      <div class="page">
        ${pageHeader("Conteúdo", `<span class="muted">${meta}</span>`)}
        ${card({
          title: esc(title),
          subtitle: meta ? meta : "",
          body: `
            <div class="content">
              ${renderMarkdownLite(text)}
            </div>
          `,
          actions: `
            <button class="btn btn--soft" data-nav="#/home">Voltar</button>
            ${it.type === "lesson" ? `<button class="btn" data-lesson-done="${esc(it.id)}">Marcar como feita</button>` : ""}
          `
        })}
      </div>
    `;

    $$("[data-nav]", view).forEach(b => b.addEventListener("click", () => navTo(b.getAttribute("data-nav"))));
    $$("[data-lesson-done]", view).forEach(b => {
      b.addEventListener("click", () => {
        const lid = b.getAttribute("data-lesson-done");
        state.progress.completedLessons[String(lid)] = true;
        saveState();
        toast("✅ Lição marcada como concluída", "ok");
        // volta para trilhas pra não ficar preso
        navTo("#/path");
      });
    });
  }

  function renderMissions() {
    const t = todayKey();
    const done = state.progress.completedMissionsByDate[t] || {};
    const missions = (content.missions.length ? content.missions : defaultMissionsFallback())
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    const list = missions.map(m => {
      const isDone = !!done[m.id];
      return card({
        title: `${isDone ? "✅" : "☑️"} ${esc(m.title || "Missão")}`,
        subtitle: esc(m.desc || m.text || "Conclua para ganhar XP."),
        body: `
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">
            <span class="chip">⏱ ${esc(m.duration || m.minutes || "5")} min</span>
            <span class="chip">✨ +${esc(m.xp || 10)} XP</span>
            <span class="chip">🏷 ${esc(m.category || m.tag || "técnica")}</span>
          </div>
        `,
        actions: isDone
          ? `<span class="muted">Concluída hoje</span>`
          : `<button class="btn" data-mission-complete="${esc(m.id)}">Concluir (+${esc(m.xp || 10)} XP)</button>`
      });
    }).join("");

    view.innerHTML = `
      <div class="page">
        ${pageHeader("Missões")}
        ${list || card({ title: "Sem missões", subtitle: "Nenhum item do tipo mission foi encontrado." })}
      </div>
    `;

    $$("[data-mission-complete]", view).forEach(b => {
      b.addEventListener("click", () => completeMission(b.getAttribute("data-mission-complete")));
    });
  }

  function completeMission(missionId) {
    const t = todayKey();
    const missions = content.missions.length ? content.missions : defaultMissionsFallback();
    const m = missions.find(x => String(x.id) === String(missionId));
    if (!m) return toast("Missão não encontrada.", "warn");

    state.progress.completedMissionsByDate[t] = state.progress.completedMissionsByDate[t] || {};
    if (state.progress.completedMissionsByDate[t][missionId]) {
      toast("Você já concluiu essa missão hoje ✅", "info");
      return;
    }

    state.progress.completedMissionsByDate[t][missionId] = true;
    addXP(Number(m.xp || 10));
    saveState();

    toast(`✨ +${Number(m.xp || 10)} XP`, "ok");
    // re-render na tela atual
    route();
  }

  function renderLibrary() {
    const items = content.library.slice().sort((a, b) => (a.order || 0) - (b.order || 0));

    const list = items.map(it => {
      const subtitle = `${esc(it.category || "Geral")} • ${esc(it.level || "Base")}`;
      return card({
        title: `${esc(it.icon || "📚")} ${esc(it.title || "Artigo")}`,
        subtitle,
        actions: `<button class="btn btn--soft" data-open-article="${esc(it.id)}">Abrir</button>`
      });
    }).join("");

    view.innerHTML = `
      <div class="page">
        ${pageHeader("Biblioteca")}
        ${list || card({ title: "Biblioteca vazia", subtitle: "Nenhum item do tipo library foi encontrado." })}
      </div>
    `;

    $$("[data-open-article]", view).forEach(b => {
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-open-article");
        navTo(`#/article?id=${encodeURIComponent(id)}`);
      });
    });
  }

  function renderProfile() {
    const u = state.user;
    view.innerHTML = `
      <div class="page">
        ${pageHeader("Perfil")}
        ${card({
          title: `🎤 ${esc(u.name)}`,
          subtitle: `Objetivo: ${esc(u.goal)}`,
          body: `
            <div class="muted">XP: ${u.xp} • Nível: ${u.level}</div>
          `,
          actions: `
            <button class="btn btn--soft" id="editNameBtn">Editar nome</button>
            <button class="btn" data-nav="#/home">Placement</button>
          `
        })}
      </div>
    `;

    $("#editNameBtn")?.addEventListener("click", () => {
      const name = prompt("Seu nome:", u.name || "Aluno");
      if (!name) return;
      state.user.name = name.trim().slice(0, 24) || "Aluno";
      saveState();
      toast("Nome atualizado ✅", "ok");
      route();
    });

    $$("[data-nav]", view).forEach(b => b.addEventListener("click", () => navTo(b.getAttribute("data-nav"))));
  }

  // -----------------------------
  // Minimal Markdown Lite
  // (só pra deixar bonito sem risco)
  // -----------------------------
  function renderMarkdownLite(md = "") {
    if (!md) return `<div class="muted">Sem conteúdo.</div>`;

    let html = esc(md);

    // headers
    html = html.replace(/^### (.*)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.*)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.*)$/gm, "<h1>$1</h1>");

    // bold/italic simples
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

    // listas
    html = html.replace(/^\- (.*)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);

    // parágrafos
    html = html
      .split("\n\n")
      .map(block => {
        block = block.trim();
        if (!block) return "";
        if (block.startsWith("<h") || block.startsWith("<ul")) return block;
        return `<p>${block.replaceAll("\n", "<br>")}</p>`;
      })
      .join("");

    return html;
  }

  // -----------------------------
  // Default missions fallback
  // -----------------------------
  function defaultMissionsFallback() {
    return [
      { id: "m_breath_36", type: "mission", title: "Respiração 3/6", desc: `Respire 3s e solte 6s em "sss" por 5 minutos.`, xp: 10, minutes: 5, category: "técnica", order: 1 },
      { id: "m_sovt_light", type: "mission", title: "SOVT leve", desc: "Lip trill / canudo / humming em região confortável.", xp: 9, minutes: 6, category: "saúde", order: 2 },
      { id: "m_posture", type: "mission", title: "Postura & relaxamento", desc: "Alongue pescoço/ombros e solte tensão (sem elevar ombros).", xp: 7, minutes: 5, category: "saúde", order: 3 }
    ];
  }

  // -----------------------------
  // Route dispatcher
  // -----------------------------
  function route() {
    setActiveTab();

    const { path, q } = parseRoute();

    // binds do topo (Admin)
    $("#adminBtn")?.addEventListener("click", () => {
      toast("Admin: (modo demo) — gerador/export pode ser reativado depois.", "info");
    }, { once: true });

    // rotas
    if (path === "#/home" || path === "#/" || path === "#") return renderHome();
    if (path === "#/path") return renderPath();
    if (path === "#/missions") return renderMissions();
    if (path === "#/library") return renderLibrary();
    if (path === "#/profile") return renderProfile();

    if (path === "#/article") {
      const id = q.get("id");
      return renderArticle(id || "fallback_1");
    }

    // fallback
    navTo("#/home");
  }

  // -----------------------------
  // Init
  // -----------------------------
  async function init() {
    ensureStreak();
    bindTabbar();

    await loadContent();
    rebuildIndexes();

    // se não vier missão do pack, ok: fallback
    // se não vier trilha/lessons, ao menos home funciona

    window.addEventListener("hashchange", route);
    route();
  }

  init();
})();