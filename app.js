/* ============================================================
   IMVpedia Voice — app.js (PARTE 1/3)
   Cole as 3 partes (1/3, 2/3, 3/3) EM SEQUÊNCIA no mesmo app.js
   ============================================================ */

(() => {
  "use strict";

  /* ----------------------------- Config ----------------------------- */
  const APP = {
    name: "IMVpedia Voice",
    version: "2026.01.07-a",
    // fontes de conteúdo (opção A: 1 arquivo JSON com tudo)
    contentSources: [
      "./packs/base/imports.json", // <-- aqui vai o seu JSON com 217 itens
      "./packs/index.json"         // opcional (se existir)
    ],
    storageKey: "imvpedia_voice_state_v3",
    storageCustomKey: "imvpedia_voice_custom_items_v1",
    dailyKey: "imvpedia_voice_daily_v2",
  };

  /* ----------------------------- DOM Utils ----------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const nowISODate = () => new Date().toISOString().slice(0, 10);

  /* ----------------------------- Toast ----------------------------- */
  function toast(message, opts = {}) {
    const host = $("#toastHost");
    if (!host) return;

    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");

    const kind = opts.kind || "info"; // info | success | warn | error
    el.dataset.kind = kind;

    el.innerHTML = `
      <div class="toast__inner">
        <div class="toast__title">${esc(opts.title || "")}</div>
        <div class="toast__msg">${esc(message)}</div>
      </div>
    `;

    host.appendChild(el);

    // animação simples
    requestAnimationFrame(() => el.classList.add("is-on"));

    const ms = clamp(Number(opts.ms ?? 2600), 1200, 6000);
    setTimeout(() => {
      el.classList.remove("is-on");
      setTimeout(() => el.remove(), 260);
    }, ms);
  }

  /* ----------------------------- Storage ----------------------------- */
  function loadLS(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  function saveLS(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  /* ----------------------------- State (XP / Level / Missions) ----------------------------- */
  const DEFAULT_STATE = {
    user: {
      name: "Aluno",
      goal: "Misto",
      xp: 0,
      level: 1,
      streak: 0,
      lastActiveDay: null,
    },
    progress: {
      completedMissionIds: [], // ids de missões concluídas (histórico)
      completedByDay: {},      // { "YYYY-MM-DD": ["missionId1", ...] }
      completedLessons: {},    // { lessonId: true }
    },
    settings: {
      haptics: true,
    },
  };

  const state = loadLS(APP.storageKey, DEFAULT_STATE);

  function persistState() {
    saveLS(APP.storageKey, state);
  }

  // nível simples: 50 xp por nível (cresce levemente)
  function xpForNextLevel(level) {
    const base = 50;
    const extra = Math.floor((level - 1) * 12);
    return base + extra;
  }

  function recomputeLevelFromXP() {
    let lvl = 1;
    let remaining = state.user.xp;
    while (remaining >= xpForNextLevel(lvl)) {
      remaining -= xpForNextLevel(lvl);
      lvl++;
      if (lvl > 999) break;
    }
    state.user.level = lvl;
    persistState();
  }

  function addXP(amount, reason = "") {
    const a = Math.max(0, Math.floor(Number(amount) || 0));
    if (!a) return;

    state.user.xp += a;

    // streak (consistência diária)
    const today = nowISODate();
    const last = state.user.lastActiveDay;
    if (!last) {
      state.user.streak = 1;
    } else if (last === today) {
      // mantém
    } else {
      // diferença de dias
      const d1 = new Date(last);
      const d2 = new Date(today);
      const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) state.user.streak = (state.user.streak || 0) + 1;
      else state.user.streak = 1;
    }
    state.user.lastActiveDay = today;

    // recalc level
    const prevLevel = state.user.level;
    recomputeLevelFromXP();
    persistState();

    // feedback
    toast(`+${a} XP${reason ? " • " + reason : ""}`, {
      kind: "success",
      title: state.user.level > prevLevel ? `Subiu para o nível ${state.user.level}!` : "Progresso",
      ms: 2400,
    });

    // re-render se estiver no home/profile
    softRefresh();
  }

  function markMissionCompleted(missionId) {
    const id = String(missionId || "").trim();
    if (!id) return false;

    const day = nowISODate();
    const listDay = state.progress.completedByDay[day] || [];
    const alreadyToday = listDay.includes(id);

    // se já concluiu hoje, não repete XP (pra evitar farm)
    if (alreadyToday) return false;

    listDay.push(id);
    state.progress.completedByDay[day] = listDay;

    if (!state.progress.completedMissionIds.includes(id)) {
      state.progress.completedMissionIds.push(id);
    }

    persistState();
    return true;
  }

  /* ----------------------------- Content Model ----------------------------- */
  // Itens esperados (flexível):
  // { id, type: "lesson"|"article"|"mission"|"track"|"library", title, text, tags, level, cover, pack, ... }
  // Você pode ter "items" dentro do JSON: { items: [...] } ou diretamente um array.
  const content = {
    items: [],
    byId: new Map(),
  };

  function normalizeItem(raw) {
    const it = { ...(raw || {}) };
    it.id = String(it.id || it._id || "").trim();
    if (!it.id) return null;

    it.type = String(it.type || it.kind || "article").trim().toLowerCase();
    it.title = String(it.title || it.name || "Sem título");
    it.text = String(it.text || it.body || it.content || "");
    it.level = String(it.level || it.difficulty || "");
    it.tags = Array.isArray(it.tags) ? it.tags.map(String) : [];
    it.cover = String(it.cover || it.image || it.banner || "");
    it.pack = String(it.pack || it.course || it.module || "base");

    // missões
    if (it.type === "mission") {
      it.xp = Math.max(1, Math.floor(Number(it.xp || 10)));
      it.minutes = Math.max(1, Math.floor(Number(it.minutes || it.min || 5)));
      it.category = String(it.category || (it.tags?.[0] || "técnica"));
    }

    // trilhas/track (cards de trilha)
    if (it.type === "track") {
      it.lessons = Array.isArray(it.lessons) ? it.lessons.map(String) : [];
      it.subtitle = String(it.subtitle || it.desc || "");
    }

    // biblioteca
    if (it.type === "library") {
      it.topic = String(it.topic || it.category || "");
      it.subtitle = String(it.subtitle || it.desc || "");
    }

    return it;
  }

  function upsertItems(arr) {
    for (const raw of arr || []) {
      const it = normalizeItem(raw);
      if (!it) continue;

      if (!content.byId.has(it.id)) {
        content.items.push(it);
        content.byId.set(it.id, it);
      } else {
        // merge: não apagar o que já tem (mantém dados anteriores se o novo vier vazio)
        const prev = content.byId.get(it.id);
        const merged = { ...prev, ...it };
        // campos que não podem virar vazio
        if (!it.title && prev.title) merged.title = prev.title;
        if (!it.text && prev.text) merged.text = prev.text;
        if (!it.cover && prev.cover) merged.cover = prev.cover;

        content.byId.set(it.id, merged);
        const idx = content.items.findIndex((x) => x.id === it.id);
        if (idx >= 0) content.items[idx] = merged;
      }
    }
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Falha ao carregar ${url}: ${res.status}`);
    return res.json();
  }

  async function loadAllContent() {
    // 1) fontes remotas (packs/base/imports.json etc)
    const sources = APP.contentSources.slice();
    const results = await Promise.allSettled(
      sources.map(async (u) => {
        const data = await fetchJSON(u);
        if (Array.isArray(data)) return data;
        if (Array.isArray(data.items)) return data.items;
        if (Array.isArray(data.content)) return data.content;
        return [];
      })
    );

    const loaded = [];
    for (const r of results) {
      if (r.status === "fulfilled") loaded.push(...r.value);
    }

    // 2) conteúdo custom local (admin import sem mexer no github)
    const custom = loadLS(APP.storageCustomKey, []);
    const customArr = Array.isArray(custom) ? custom : (custom?.items || []);
    loaded.push(...customArr);

    upsertItems(loaded);

    // ordenação estável: por tipo + título
    const typeOrder = { track: 1, lesson: 2, mission: 3, library: 4, article: 5 };
    content.items.sort((a, b) => {
      const ta = typeOrder[a.type] ?? 99;
      const tb = typeOrder[b.type] ?? 99;
      if (ta !== tb) return ta - tb;
      return a.title.localeCompare(b.title, "pt-BR");
    });
  }

  /* ----------------------------- Routing / Rendering ----------------------------- */
  const view = () => $("#view");

  function setActiveTab(hash) {
    const btns = $$(".tabbar__item");
    btns.forEach((b) => {
      const r = b.getAttribute("data-route");
      b.classList.toggle("is-active", r === hash);
    });
  }

  function go(hash) {
    if (!hash.startsWith("#/")) hash = "#/home";
    location.hash = hash;
  }

  function parseRoute() {
    const hash = location.hash || "#/home";
    const [path, q] = hash.split("?");
    const params = new URLSearchParams(q || "");
    return { hash, path, params };
  }

  let _refreshTimer = null;
  function softRefresh() {
    clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(() => {
      render();
    }, 40);
  }

  /* ----------------------------- UI Helpers (Cards) ----------------------------- */
  function card(html, extraClass = "") {
    return `<section class="card ${extraClass}">${html}</section>`;
  }

  function pill(text, icon = "") {
    return `<span class="pill">${icon ? `<span class="pill__ic">${esc(icon)}</span>` : ""}${esc(text)}</span>`;
  }

  function btn(label, attrs = "", variant = "") {
    const cls = ["btn", variant].filter(Boolean).join(" ");
    return `<button class="${cls}" ${attrs} type="button">${esc(label)}</button>`;
  }

  function progressBar(current, total) {
    const pct = total > 0 ? clamp((current / total) * 100, 0, 100) : 0;
    return `
      <div class="progress">
        <div class="progress__bar" style="width:${pct}%"></div>
      </div>
      <div class="muted">${esc(current)}/${esc(total)} XP para o próximo nível</div>
    `;
  }

  /* ----------------------------- Page: Loading / Empty ----------------------------- */
  function renderLoading() {
    view().innerHTML = `
      <div class="container">
        ${card(`
          <div class="hero">
            <div class="hero__kicker">Carregando…</div>
            <div class="hero__title">${esc(APP.name)}</div>
            <div class="hero__subtitle">Preparando trilhas, missões e biblioteca.</div>
          </div>
        `)}
      </div>
    `;
  }

  function renderNoContent() {
    view().innerHTML = `
      <div class="container">
        ${card(`
          <div class="hero">
            <div class="hero__title">Conteúdo não detectado</div>
            <div class="hero__subtitle">
              Seus conteúdos (<b>${content.items.length}</b>) não foram detectados ou não carregaram.
              <br><br>
              ✅ Solução (opção A):
              <br>
              Crie/atualize o arquivo:
              <br><code>packs/base/imports.json</code>
              <br>
              e cole nele o JSON exportado.
            </div>
            <div class="row">
              ${btn("Voltar", `onclick="location.hash='#/home'"`)}
              ${btn("Admin", `onclick="location.hash='#/admin'"`, "btn--primary")}
            </div>
          </div>
        `)}
      </div>
    `;
  }

  /* ----------------------------- (continua na PARTE 2/3) ----------------------------- */

  // Exporta funções mínimas para o HTML (sem frameworks)
  window.__IMV = {
    toast,
    go,
  };

  // Boot
  let booted = false;
  async function boot() {
    if (booted) return;
    booted = true;

    // eventos da tabbar
    $$(".tabbar__item").forEach((b) => {
      b.addEventListener("click", () => {
        const r = b.getAttribute("data-route");
        if (r) go(r);
      });
    });

    // botão admin
    const adminBtn = $("#adminBtn");
    if (adminBtn) adminBtn.addEventListener("click", () => go("#/admin"));

    renderLoading();

    try {
      await loadAllContent();
    } catch (e) {
      console.warn(e);
    }

    // se não carregou nada, mostra tela de ajuda
    if (!content.items.length) {
      renderNoContent();
    } else {
      render();
    }
  }

  window.addEventListener("hashchange", () => render());
  window.addEventListener("load", () => boot());

  // ===== Render (router) — implementação completa na PARTE 2/3 =====
  function render() {
    // placeholder (será substituído pela versão completa na parte 2)
    const { path } = parseRoute();
    setActiveTab(path);
    if (!content.items.length) return renderNoContent();
    view().innerHTML = `
      <div class="container">
        ${card(`
          <div class="hero">
            <div class="hero__kicker">Rota atual</div>
            <div class="hero__title">${esc(path)}</div>
            <div class="hero__subtitle">A renderização completa entra na PARTE 2/3 do app.js.</div>
          </div>
        `)}
      </div>
    `;
  }

})();
/* ============================================================
   IMVpedia Voice — app.js (PARTE 2/3)
   Cole logo ABAIXO da PARTE 1/3, sem apagar nada
   ============================================================ */

  /* ----------------------------- Pages ----------------------------- */

  function renderHome() {
    const xpNeed = xpForNextLevel(state.user.level);
    const xpIntoLevel = state.user.xp - (() => {
      let rem = state.user.xp;
      let lvl = 1;
      while (lvl < state.user.level) {
        rem -= xpForNextLevel(lvl);
        lvl++;
      }
      return rem;
    })();

    view().innerHTML = `
      <div class="container">
        ${card(`
          <div class="hero">
            <div class="hero__kicker">
              Olá, ${esc(state.user.name)} • XP ${state.user.xp} • Nível ${state.user.level}
            </div>
            <div class="hero__title">${esc(APP.name)}</div>
            <div class="hero__subtitle">
              Trilha vocal completa com técnica, saúde vocal e performance.
            </div>

            <div class="row">
              ${btn("Trilha", `onclick="__IMV.go('#/path')"`, "btn--primary")}
              ${btn("Missões", `onclick="__IMV.go('#/missions')"`, "")}
              ${btn("Biblioteca", `onclick="__IMV.go('#/library')"`, "")}
            </div>

            <div style="margin-top:14px">
              ${progressBar(xpIntoLevel, xpNeed)}
            </div>
          </div>
        `)}

        <h2>Começar agora</h2>

        ${renderQuickStart()}
      </div>
    `;
  }

  function renderQuickStart() {
    const missions = content.items.filter(i => i.type === "mission").slice(0, 3);

    if (!missions.length) {
      return card(`<div class="muted">Nenhuma missão disponível.</div>`);
    }

    return missions.map(m => card(`
      <div class="row space">
        <div>
          <div class="badge">${esc(m.category || "missão")}</div>
          <h3>${esc(m.title)}</h3>
          <div class="muted">${esc(m.text.slice(0, 120))}</div>
          <div class="row">
            ${pill(`${m.minutes} min`, "⏱")}
            ${pill(`+${m.xp} XP`, "✨")}
          </div>
        </div>
        <div>
          ${btn(
            "Concluir",
            `data-mission="${esc(m.id)}"`,
            "btn--primary js-complete-mission"
          )}
        </div>
      </div>
    `)).join("");
  }

  function renderMissions() {
    const today = nowISODate();
    const doneToday = state.progress.completedByDay[today] || [];

    const missions = content.items.filter(i => i.type === "mission");

    view().innerHTML = `
      <div class="container">
        <h1>Missões</h1>

        ${missions.map(m => {
          const completed = doneToday.includes(m.id);
          return card(`
            <div class="row space">
              <div>
                <div class="badge">${esc(m.category)}</div>
                <h3>${esc(m.title)}</h3>
                <div class="muted">${esc(m.text)}</div>
                <div class="row">
                  ${pill(`${m.minutes} min`, "⏱")}
                  ${pill(`+${m.xp} XP`, "✨")}
                </div>
              </div>
              <div>
                ${
                  completed
                    ? `<span class="pill">✔ concluída</span>`
                    : btn(
                        "Concluir",
                        `data-mission="${esc(m.id)}"`,
                        "btn--primary js-complete-mission"
                      )
                }
              </div>
            </div>
          `);
        }).join("")}
      </div>
    `;

    bindMissionButtons();
  }

  function renderPath() {
    const tracks = content.items.filter(i => i.type === "track");

    view().innerHTML = `
      <div class="container">
        <h1>Trilha</h1>

        ${tracks.map(t => card(`
          <div class="row space">
            <div>
              <h3>${esc(t.title)}</h3>
              <div class="muted">${esc(t.subtitle)}</div>
              <div class="row">
                ${pill(`${t.lessons.length} lições`, "📘")}
              </div>
            </div>
            <div>
              ${btn("Abrir", `onclick="__IMV.go('#/track?id=${esc(t.id)}')"`, "btn--primary")}
            </div>
          </div>
        `)).join("")}
      </div>
    `;
  }

  function renderLibrary() {
    const libs = content.items.filter(i => i.type === "library");

    view().innerHTML = `
      <div class="container">
        <h1>Biblioteca</h1>

        ${libs.map(l => card(`
          <div>
            <h3>${esc(l.title)}</h3>
            <div class="muted">${esc(l.subtitle)}</div>
          </div>
        `)).join("")}
      </div>
    `;
  }

  function renderProfile() {
    view().innerHTML = `
      <div class="container">
        <h1>Perfil</h1>

        ${card(`
          <div><b>Aluno:</b> ${esc(state.user.name)}</div>
          <div><b>Objetivo:</b> ${esc(state.user.goal)}</div>
          <div><b>Nível:</b> ${state.user.level}</div>
          <div><b>XP total:</b> ${state.user.xp}</div>
          <div><b>Sequência:</b> ${state.user.streak} dia(s)</div>
        `)}
      </div>
    `;
  }

  /* ----------------------------- Actions ----------------------------- */

  function bindMissionButtons() {
    $$(".js-complete-mission").forEach(btnEl => {
      btnEl.addEventListener("click", () => {
        const id = btnEl.getAttribute("data-mission");
        const mission = content.byId.get(id);
        if (!mission) return;

        const ok = markMissionCompleted(id);
        if (!ok) {
          toast("Missão já concluída hoje.", { kind: "warn" });
          return;
        }

        addXP(mission.xp, mission.title);
        renderMissions();
      });
    });
  }

  /* ----------------------------- Router ----------------------------- */

  function render() {
    const { path } = parseRoute();
    setActiveTab(path);

    if (!content.items.length) {
      renderNoContent();
      return;
    }

    switch (path) {
      case "#/home":
      case "#/":
        renderHome();
        break;
      case "#/missions":
        renderMissions();
        break;
      case "#/path":
        renderPath();
        break;
      case "#/library":
        renderLibrary();
        break;
      case "#/profile":
        renderProfile();
        break;
      default:
        renderHome();
    }
  }

  // substitui o placeholder da parte 1
  window.render = render;

/* ========================== continua na PARTE 3/3 ========================== */
/* ============================================================
   IMVpedia Voice — app.js (PARTE 2/3)
   Cole logo ABAIXO da PARTE 1/3, sem apagar nada
   ============================================================ */

  /* ----------------------------- Pages ----------------------------- */

  function renderHome() {
    const xpNeed = xpForNextLevel(state.user.level);
    const xpIntoLevel = state.user.xp - (() => {
      let rem = state.user.xp;
      let lvl = 1;
      while (lvl < state.user.level) {
        rem -= xpForNextLevel(lvl);
        lvl++;
      }
      return rem;
    })();

    view().innerHTML = `
      <div class="container">
        ${card(`
          <div class="hero">
            <div class="hero__kicker">
              Olá, ${esc(state.user.name)} • XP ${state.user.xp} • Nível ${state.user.level}
            </div>
            <div class="hero__title">${esc(APP.name)}</div>
            <div class="hero__subtitle">
              Trilha vocal completa com técnica, saúde vocal e performance.
            </div>

            <div class="row">
              ${btn("Trilha", `onclick="__IMV.go('#/path')"`, "btn--primary")}
              ${btn("Missões", `onclick="__IMV.go('#/missions')"`, "")}
              ${btn("Biblioteca", `onclick="__IMV.go('#/library')"`, "")}
            </div>

            <div style="margin-top:14px">
              ${progressBar(xpIntoLevel, xpNeed)}
            </div>
          </div>
        `)}

        <h2>Começar agora</h2>

        ${renderQuickStart()}
      </div>
    `;
  }

  function renderQuickStart() {
    const missions = content.items.filter(i => i.type === "mission").slice(0, 3);

    if (!missions.length) {
      return card(`<div class="muted">Nenhuma missão disponível.</div>`);
    }

    return missions.map(m => card(`
      <div class="row space">
        <div>
          <div class="badge">${esc(m.category || "missão")}</div>
          <h3>${esc(m.title)}</h3>
          <div class="muted">${esc(m.text.slice(0, 120))}</div>
          <div class="row">
            ${pill(`${m.minutes} min`, "⏱")}
            ${pill(`+${m.xp} XP`, "✨")}
          </div>
        </div>
        <div>
          ${btn(
            "Concluir",
            `data-mission="${esc(m.id)}"`,
            "btn--primary js-complete-mission"
          )}
        </div>
      </div>
    `)).join("");
  }

  function renderMissions() {
    const today = nowISODate();
    const doneToday = state.progress.completedByDay[today] || [];

    const missions = content.items.filter(i => i.type === "mission");

    view().innerHTML = `
      <div class="container">
        <h1>Missões</h1>

        ${missions.map(m => {
          const completed = doneToday.includes(m.id);
          return card(`
            <div class="row space">
              <div>
                <div class="badge">${esc(m.category)}</div>
                <h3>${esc(m.title)}</h3>
                <div class="muted">${esc(m.text)}</div>
                <div class="row">
                  ${pill(`${m.minutes} min`, "⏱")}
                  ${pill(`+${m.xp} XP`, "✨")}
                </div>
              </div>
              <div>
                ${
                  completed
                    ? `<span class="pill">✔ concluída</span>`
                    : btn(
                        "Concluir",
                        `data-mission="${esc(m.id)}"`,
                        "btn--primary js-complete-mission"
                      )
                }
              </div>
            </div>
          `);
        }).join("")}
      </div>
    `;

    bindMissionButtons();
  }

  function renderPath() {
    const tracks = content.items.filter(i => i.type === "track");

    view().innerHTML = `
      <div class="container">
        <h1>Trilha</h1>

        ${tracks.map(t => card(`
          <div class="row space">
            <div>
              <h3>${esc(t.title)}</h3>
              <div class="muted">${esc(t.subtitle)}</div>
              <div class="row">
                ${pill(`${t.lessons.length} lições`, "📘")}
              </div>
            </div>
            <div>
              ${btn("Abrir", `onclick="__IMV.go('#/track?id=${esc(t.id)}')"`, "btn--primary")}
            </div>
          </div>
        `)).join("")}
      </div>
    `;
  }

  function renderLibrary() {
    const libs = content.items.filter(i => i.type === "library");

    view().innerHTML = `
      <div class="container">
        <h1>Biblioteca</h1>

        ${libs.map(l => card(`
          <div>
            <h3>${esc(l.title)}</h3>
            <div class="muted">${esc(l.subtitle)}</div>
          </div>
        `)).join("")}
      </div>
    `;
  }

  function renderProfile() {
    view().innerHTML = `
      <div class="container">
        <h1>Perfil</h1>

        ${card(`
          <div><b>Aluno:</b> ${esc(state.user.name)}</div>
          <div><b>Objetivo:</b> ${esc(state.user.goal)}</div>
          <div><b>Nível:</b> ${state.user.level}</div>
          <div><b>XP total:</b> ${state.user.xp}</div>
          <div><b>Sequência:</b> ${state.user.streak} dia(s)</div>
        `)}
      </div>
    `;
  }

  /* ----------------------------- Actions ----------------------------- */

  function bindMissionButtons() {
    $$(".js-complete-mission").forEach(btnEl => {
      btnEl.addEventListener("click", () => {
        const id = btnEl.getAttribute("data-mission");
        const mission = content.byId.get(id);
        if (!mission) return;

        const ok = markMissionCompleted(id);
        if (!ok) {
          toast("Missão já concluída hoje.", { kind: "warn" });
          return;
        }

        addXP(mission.xp, mission.title);
        renderMissions();
      });
    });
  }

  /* ----------------------------- Router ----------------------------- */

  function render() {
    const { path } = parseRoute();
    setActiveTab(path);

    if (!content.items.length) {
      renderNoContent();
      return;
    }

    switch (path) {
      case "#/home":
      case "#/":
        renderHome();
        break;
      case "#/missions":
        renderMissions();
        break;
      case "#/path":
        renderPath();
        break;
      case "#/library":
        renderLibrary();
        break;
      case "#/profile":
        renderProfile();
        break;
      default:
        renderHome();
    }
  }

  // substitui o placeholder da parte 1
  window.render = render;

/* ========================== continua na PARTE 3/3 ========================== */
/* ============================================================
   IMVpedia Voice — app.js (PARTE 3/3)
   Cole logo ABAIXO da PARTE 2/3, sem apagar nada
   ============================================================ */

  /* ----------------------------- Admin (Import/Export simples) ----------------------------- */
  function renderAdmin() {
    const total = content.items.length;
    const custom = loadLS(APP.storageCustomKey, []);
    const customCount = Array.isArray(custom) ? custom.length : (custom?.items?.length || 0);

    view().innerHTML = `
      <div class="container">
        <h1>Admin</h1>

        ${card(`
          <h3>Status</h3>
          <div class="muted">Conteúdos carregados: <b>${total}</b></div>
          <div class="muted">Conteúdos custom (LocalStorage): <b>${customCount}</b></div>
          <div class="muted" style="margin-top:10px">
            Dica: o catálogo principal vem de <code>packs/base/imports.json</code>.
          </div>
        `)}

        ${card(`
          <h3>Importar JSON (sem apagar o que já existe)</h3>
          <div class="muted">Cole aqui um JSON exportado. Ele será salvo no seu navegador (LocalStorage).</div>
          <textarea id="admImport" style="width:100%;min-height:160px;margin-top:10px;border-radius:16px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.04);color:rgba(233,236,246,.92);padding:12px;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"></textarea>
          <div class="row" style="margin-top:10px">
            ${btn("Importar", `id="btnDoImport"`, "btn--primary")}
            ${btn("Limpar custom", `id="btnClearCustom"`, "")}
          </div>
        `)}

        ${card(`
          <h3>Exportar custom (LocalStorage)</h3>
          <div class="muted">Baixe o JSON dos conteúdos que você importou no Admin.</div>
          <div class="row" style="margin-top:10px">
            ${btn("Exportar", `id="btnExport"`, "btn--primary")}
          </div>
        `)}
      </div>
    `;

    $("#btnDoImport")?.addEventListener("click", () => {
      const raw = $("#admImport")?.value || "";
      try {
        const parsed = JSON.parse(raw);
        const arr = Array.isArray(parsed) ? parsed : (parsed.items || parsed.content || []);
        if (!Array.isArray(arr) || !arr.length) {
          toast("JSON inválido ou vazio.", { kind: "error" });
          return;
        }

        // salva no custom sem apagar o existente
        const existing = loadLS(APP.storageCustomKey, []);
        const baseArr = Array.isArray(existing) ? existing : (existing.items || []);
        const merged = baseArr.concat(arr);
        saveLS(APP.storageCustomKey, merged);

        toast(`Importado: ${arr.length} itens (custom).`, { kind: "success" });
        location.reload();
      } catch (e) {
        toast("Falha ao importar JSON.", { kind: "error" });
      }
    });

    $("#btnClearCustom")?.addEventListener("click", () => {
      if (!confirm("Apagar conteúdos custom do navegador? (não mexe no GitHub)")) return;
      saveLS(APP.storageCustomKey, []);
      toast("Custom limpo.", { kind: "success" });
      location.reload();
    });

    $("#btnExport")?.addEventListener("click", () => {
      const existing = loadLS(APP.storageCustomKey, []);
      const arr = Array.isArray(existing) ? existing : (existing.items || []);
      const blob = new Blob([JSON.stringify(arr, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "imvpedia_custom_export.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast("Exportado.", { kind: "success" });
    });
  }

  /* ----------------------------- Extra Routes (track details / lessons) ----------------------------- */
  function renderTrack(params) {
    const id = params.get("id");
    const track = content.byId.get(id);
    if (!track) return renderHome();

    const lessonItems = (track.lessons || [])
      .map((lid) => content.byId.get(lid))
      .filter(Boolean);

    view().innerHTML = `
      <div class="container">
        <h1>${esc(track.title)}</h1>
        ${card(`<div class="muted">${esc(track.subtitle)}</div>`)}
        ${lessonItems.map(ls => card(`
          <h3>${esc(ls.title)}</h3>
          <div class="muted">${esc((ls.text || "").slice(0, 200))}${(ls.text || "").length > 200 ? "…" : ""}</div>
          <div class="row" style="margin-top:10px">
            ${btn("Abrir", `onclick="__IMV.go('#/item?id=${esc(ls.id)}')"` , "btn--primary")}
          </div>
        `)).join("")}
      </div>
    `;
  }

  function renderItem(params) {
    const id = params.get("id");
    const it = content.byId.get(id);
    if (!it) return renderHome();

    view().innerHTML = `
      <div class="container">
        <h1>${esc(it.title)}</h1>
        ${card(`
          <div class="row">
            ${pill(it.type, "🏷")}
            ${it.level ? pill(it.level, "🎚") : ""}
            ${(it.tags || []).slice(0, 4).map(t => pill(t, "•")).join("")}
          </div>
          <div style="margin-top:14px;white-space:pre-wrap;line-height:1.7;color:rgba(233,236,246,.88)">
            ${esc(it.text || "")}
          </div>
        `)}
        <div class="row">
          ${btn("Voltar", `onclick="history.back()"`, "")}
          ${btn("Biblioteca", `onclick="__IMV.go('#/library')"`, "btn--primary")}
        </div>
      </div>
    `;
  }

  /* ----------------------------- Router upgrade ----------------------------- */
  function render() {
    const { path, params } = parseRoute();
    setActiveTab(path);

    if (!content.items.length) {
      renderNoContent();
      return;
    }

    switch (path) {
      case "#/home":
      case "#/":
        renderHome(); break;
      case "#/missions":
        renderMissions(); break;
      case "#/path":
        renderPath(); break;
      case "#/library":
        renderLibrary(); break;
      case "#/profile":
        renderProfile(); break;
      case "#/admin":
        renderAdmin(); break;
      case "#/track":
        renderTrack(params); break;
      case "#/item":
        renderItem(params); break;
      default:
        renderHome();
    }
  }

  // substitui novamente
  window.render = render;

  // bind global (missões na home)
  document.addEventListener("click", (e) => {
    const el = e.target.closest(".js-complete-mission");
    if (!el) return;

    const id = el.getAttribute("data-mission");
    const mission = content.byId.get(id);
    if (!mission) return;

    const ok = markMissionCompleted(id);
    if (!ok) {
      toast("Missão já concluída hoje.", { kind: "warn" });
      return;
    }

    addXP(mission.xp, mission.title);
    // atualiza para refletir no home também
    render();
  });

  // finalize boot: re-render correto
  // (boot() já existe na parte 1, aqui só garantimos que a rota admin funcione)
  window.addEventListener("hashchange", () => render());

/* ============================================================
   FIM app.js — PARTE 3/3
   ============================================================ */
