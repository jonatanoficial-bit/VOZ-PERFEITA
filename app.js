/* IMVpedia Voice — app.js (SPA offline-first)
   Premium dark UI + tabs + tracks + lessons + library + missions + admin generator
*/

"use strict";

/* ===========================
   Helpers / Base
=========================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

const escapeHtml = (str) =>
  String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const slugify = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-]+/g, "")
    .replace(/\-\-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

const todayISO = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
};

const nowISO = () => new Date().toISOString();

/* ===========================
   Storage
=========================== */

const LS = {
  PROFILE: "imv_profile_v1",
  XP: "imv_xp_v1",
  MISSIONS_DONE: "imv_missions_done_v1",
  STREAK: "imv_streak_v1",
  ADMIN_TOKEN: "imv_admin_token_v1",
};

const store = {
  profile: null,
  xp: 0,
  missionsDone: {},
  streak: { lastActive: null, days: 0 },
  isAdmin: false,
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota
  }
}

function loadAll() {
  store.profile = readJSON(LS.PROFILE, {
    name: "Aluno",
    goal: "Misto",
    level: 1,
  });
  store.xp = Number(readJSON(LS.XP, 0) || 0);
  store.missionsDone = readJSON(LS.MISSIONS_DONE, {});
  store.streak = readJSON(LS.STREAK, { lastActive: null, days: 0 });
  store.isAdmin = !!readJSON(LS.ADMIN_TOKEN, null);
}

function saveProfile() {
  writeJSON(LS.PROFILE, store.profile);
}
function saveXp() {
  writeJSON(LS.XP, store.xp);
}
function saveMissionsDone() {
  writeJSON(LS.MISSIONS_DONE, store.missionsDone);
}
function saveStreak() {
  writeJSON(LS.STREAK, store.streak);
}

function addXP(amount) {
  const n = Number(amount || 0);
  if (!Number.isFinite(n) || n === 0) return;
  store.xp = Math.max(0, Math.floor(store.xp + n));
  saveXp();

  // level up every 50xp (simple demo)
  const lvl = Math.floor(store.xp / 50) + 1;
  store.profile.level = Math.max(1, lvl);
  saveProfile();
}

/* ===========================
   UI Components
=========================== */

function toast(msg, kind = "info") {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function btn(label, action, data = {}, cls = "btn") {
  const attrs = Object.entries(data)
    .map(([k, v]) => ` data-${k}="${escapeHtml(v)}"`)
    .join("");
  return `<button class="${cls}" data-action="${escapeHtml(action)}"${attrs}>${escapeHtml(
    label
  )}</button>`;
}

function pill(label, cls = "") {
  return `<span class="pill ${cls}">${escapeHtml(label)}</span>`;
}

function cardRow(icon, title, subtitle, right = "") {
  return `
    <div class="row card">
      <div class="row-left">
        <div class="ico">${icon}</div>
        <div class="row-text">
          <div class="row-title">${escapeHtml(title)}</div>
          <div class="row-sub">${escapeHtml(subtitle)}</div>
        </div>
      </div>
      <div class="row-right">${right}</div>
    </div>
  `;
}

function setActiveTab(route) {
  $$(".tabbar .tab").forEach((t) => {
    const r = t.getAttribute("href") || "";
    t.classList.toggle("active", r === `#/${route}`);
  });
}

/* ===========================
   Data Access (packs)
=========================== */

function getPacksIndex() {
  // packs/index.json is optional; if not present, use window.PACKS_INDEX
  return window.PACKS_INDEX || [
    {
      id: "base",
      title: "Base",
      subtitle: "Fundamentos vocais (pack incluído no app)",
      cover: "",
      tracksFile: "packs/base/tracks.js",
    },
  ];
}

// tracks.js should assign window.TRACKS_<packId> or window.TRACKS
function getTracks(packId) {
  const key = `TRACKS_${packId}`;
  return window[key] || window.TRACKS || [];
}

// lessons.js should assign window.LESSONS_<packId> or window.LESSONS
function getLessons(packId) {
  const key = `LESSONS_${packId}`;
  return window[key] || window.LESSONS || [];
}

// library.js should assign window.LIBRARY_<packId> or window.LIBRARY
function getLibrary(packId) {
  const key = `LIBRARY_${packId}`;
  return window[key] || window.LIBRARY || [];
}

function getMissions() {
  return window.MISSIONS || [];
}

/* ===========================
   Router + Layout
=========================== */

function header() {
  const name = store.profile?.name || "Aluno";
  const lvl = store.profile?.level || 1;
  const xp = store.xp || 0;
  return `
    <header class="topbar">
      <div class="brand">
        <span class="dot"></span>
        <div class="brand-text">
          <div class="brand-title">IMVpedia Voice</div>
          <div class="brand-sub">Voz Perfeita</div>
        </div>
      </div>

      <div class="top-actions">
        <div class="stat">
          <div class="stat-top">Olá, ${escapeHtml(name)} • XP ${xp} • Nível ${lvl}</div>
        </div>
        <a class="chip" href="#/${store.isAdmin ? "admin" : "admin-login"}">Admin</a>
      </div>
    </header>
  `;
}

function tabbar() {
  return `
    <nav class="tabbar">
      <a class="tab" href="#/home">
        <span class="ti">🏠</span><span>Início</span>
      </a>
      <a class="tab" href="#/path">
        <span class="ti">🧭</span><span>Trilha</span>
      </a>
      <a class="tab" href="#/missions">
        <span class="ti">✅</span><span>Missões</span>
      </a>
      <a class="tab" href="#/library">
        <span class="ti">📚</span><span>Biblioteca</span>
      </a>
      <a class="tab" href="#/profile">
        <span class="ti">👤</span><span>Perfil</span>
      </a>
    </nav>
  `;
}

function mount(viewHtml, activeRoute) {
  const app = $("#app");
  app.innerHTML = `
    <div class="app-shell">
      ${header()}
      <main class="view" id="view">${viewHtml}</main>
      ${tabbar()}
      <div id="toast" class="toast" aria-live="polite"></div>
    </div>
  `;
  setActiveTab(activeRoute);
}

/* ===========================
   Screens
=========================== */

function renderHome() {
  const packs = getPacksIndex();

  const weekLabel = "progresso semanal";
  const date = todayISO();

  const doneIds = store.missionsDone?.[date]?.ids || [];
  const doneCount = doneIds.length;

  const hero = `
    <section class="hero card hero-card">
      <div class="hero-top">
        <div class="hero-kicker">Olá, ${escapeHtml(store.profile.name)} • XP ${store.xp} • Nível ${store.profile.level}</div>
        <div class="hero-streak">🔥 ${store.streak.days || 0} dia(s)</div>
      </div>
      <h1 class="hero-title">IMVpedia Voice</h1>
      <p class="hero-sub">Trilha vocal guiada com técnica, saúde e repertório (popular, erudito e coral).</p>

      <div class="hero-actions">
        <a class="btn primary" href="#/path">Trilha</a>
        <a class="btn" href="#/placement">Fazer placement</a>
        <a class="btn ghost" href="#/profile">Perfil</a>
      </div>

      <div class="progress">
        <div class="progress-top">
          <span>Progresso do nível</span>
        </div>
        <div class="progress-bar"><span style="width:${clamp((store.xp % 50) * 2, 0, 100)}%"></span></div>
        <div class="progress-sub">${store.xp % 50}/50 XP para o próximo nível</div>
      </div>
    </section>
  `;

  const missionOfDay = (getMissions().find((m) => m.date === date) ||
    getMissions()[0]) ?? null;

  const missionCard = missionOfDay
    ? `
    <section class="section">
      <div class="section-head">
        <h2>Missão do dia</h2>
        <div class="muted">${escapeHtml(date)} • ${escapeHtml(missionOfDay.category || "Técnica")}</div>
      </div>
      <div class="card mission card">
        <h3>${escapeHtml(missionOfDay.title)}</h3>
        <p class="muted">${escapeHtml(missionOfDay.desc || "")}</p>
        <div class="mission-meta">
          ${pill(`⏱️ ${missionOfDay.minutes || 6} min`)}
          ${pill(`✨ +${missionOfDay.xp || 10} XP`, "glow")}
        </div>
        <div class="mission-actions">
          <button class="btn" data-action="swapMission">Trocar</button>
          ${
            doneIds.includes(missionOfDay.id)
              ? `<span class="tag ok">Concluída</span>`
              : `<button class="btn primary" data-action="completeMission" data-id="${escapeHtml(
                  missionOfDay.id
                )}">Concluir</button>`
          }
        </div>
      </div>
    </section>
  `
    : "";

  const packsList = `
    <section class="section">
      <div class="section-head">
        <h2>Packs</h2>
        <a class="btn tiny" href="#/${store.isAdmin ? "admin" : "admin-login"}">Gerenciar</a>
      </div>
      <div class="grid">
        ${packs
          .map(
            (p) => `
          <a class="pack card" href="#/path?pack=${encodeURIComponent(p.id)}">
            <div class="pack-cover">${p.cover ? `<img src="${escapeHtml(p.cover)}" alt="">` : `<div class="pack-icon">♪</div>`}</div>
            <div class="pack-body">
              <div class="pack-title">${escapeHtml(p.title)}</div>
              <div class="pack-sub">${escapeHtml(p.subtitle || "")}</div>
            </div>
          </a>
        `
          )
          .join("")}
      </div>
    </section>
  `;

  const week = `
    <section class="section">
      <div class="section-head">
        <h2>Semana</h2>
        <div class="muted">${weekLabel}</div>
      </div>
      <div class="card week card">
        <div class="week-row">
          <div class="week-kpi">
            <div class="kpi-title">Missões concluídas hoje</div>
            <div class="kpi-value">${doneCount}</div>
          </div>
          <div class="week-kpi">
            <div class="kpi-title">XP total</div>
            <div class="kpi-value">${store.xp}</div>
          </div>
        </div>
        <div class="progress-bar"><span style="width:${clamp(doneCount * 20, 0, 100)}%"></span></div>
        <div class="muted small">Meta sugerida: 5 missões/semana</div>
      </div>
    </section>
  `;

  return `${hero}${missionCard}${week}${packsList}<div class="spacer"></div>`;
}
function renderPath(routeQuery) {
  const packs = getPacksIndex();
  const q = new URLSearchParams(routeQuery || "");
  const packId = q.get("pack") || (packs[0] && packs[0].id) || "base";

  const tracks = getTracks(packId);

  const list = `
    <section class="section">
      <div class="section-head">
        <h2>Trilha</h2>
      </div>

      <div class="stack">
        ${tracks
          .map((t) =>
            cardRow(
              "🧭",
              t.title,
              `${packs.find((p) => p.id === packId)?.title || "Base"} • ${t.lessonsCount || (t.lessons?.length || 0)} lições`,
              `<span class="chev">›</span>`
            ).replace(
              'class="row card"',
              `class="row card" data-action="openTrack" data-pack="${escapeHtml(
                packId
              )}" data-track="${escapeHtml(t.id)}"`
            )
          )
          .join("")}
      </div>
    </section>
    <div class="spacer"></div>
  `;

  return list;
}

function renderTrack(routeQuery) {
  const q = new URLSearchParams(routeQuery || "");
  const packId = q.get("pack") || "base";
  const trackId = q.get("track");
  const tracks = getTracks(packId);
  const t = tracks.find((x) => x.id === trackId);

  if (!t) {
    return `
      <section class="section">
        <div class="section-head"><h2>Trilha</h2></div>
        <div class="card">Trilha não encontrada.</div>
      </section>
    `;
  }

  const lessons = (t.lessons && t.lessons.length ? t.lessons : getLessons(packId)).filter(
    (l) => l.trackId === trackId
  );

  return `
    <section class="section">
      <div class="section-head">
        <h2>${escapeHtml(t.title)}</h2>
        <div class="muted">${escapeHtml(t.subtitle || "")}</div>
      </div>

      <div class="stack">
        ${lessons
          .map((l) =>
            cardRow(
              "🎧",
              l.title,
              `${l.level || "Básico"} • ${l.tags?.slice(0, 3).join(" • ") || ""}`,
              `<span class="chev">›</span>`
            ).replace(
              'class="row card"',
              `class="row card" data-action="openLesson" data-pack="${escapeHtml(
                packId
              )}" data-id="${escapeHtml(l.id)}"`
            )
          )
          .join("")}
      </div>
    </section>
    <div class="spacer"></div>
  `;
}

function renderLesson(routeQuery) {
  const q = new URLSearchParams(routeQuery || "");
  const packId = q.get("pack") || "base";
  const id = q.get("id");
  const lessons = getLessons(packId);
  const l = lessons.find((x) => x.id === id);
  if (!l) {
    return `
      <section class="section">
        <div class="section-head"><h2>Lição</h2></div>
        <div class="card">Lição não encontrada.</div>
      </section>
    `;
  }

  return `
    <section class="section">
      <div class="section-head">
        <a class="back" href="#/track?pack=${encodeURIComponent(packId)}&track=${encodeURIComponent(
    l.trackId || ""
  )}">← Voltar</a>
      </div>

      <article class="card lesson card">
        <div class="lesson-head">
          <h2>${escapeHtml(l.title)}</h2>
          <div class="muted">${escapeHtml(l.level || "")} • ${escapeHtml(
    (l.tags || []).join(" • ")
  )}</div>
        </div>
        <div class="lesson-body">
          ${renderMarkdown(l.text || "")}
        </div>
      </article>
    </section>
    <div class="spacer"></div>
  `;
}

function renderLibrary(routeQuery) {
  const packs = getPacksIndex();
  const q = new URLSearchParams(routeQuery || "");
  const packId = q.get("pack") || (packs[0] && packs[0].id) || "base";
  const library = getLibrary(packId);

  return `
    <section class="section">
      <div class="section-head">
        <h2>Biblioteca</h2>
      </div>

      <div class="stack">
        ${library
          .map((item) =>
            cardRow(
              "📚",
              item.title,
              `${item.category || "Saúde"} • ${packs.find((p) => p.id === packId)?.title || "Base"}`,
              `<span class="chev">›</span>`
            ).replace(
              'class="row card"',
              `class="row card" data-action="openLibraryItem" data-pack="${escapeHtml(
                packId
              )}" data-id="${escapeHtml(item.id)}"`
            )
          )
          .join("")}
      </div>
    </section>
    <div class="spacer"></div>
  `;
}

function renderLibraryItem(routeQuery) {
  const q = new URLSearchParams(routeQuery || "");
  const packId = q.get("pack") || "base";
  const id = q.get("id");
  const items = getLibrary(packId);
  const item = items.find((x) => x.id === id);

  if (!item) {
    return `
      <section class="section">
        <div class="section-head"><h2>Biblioteca</h2></div>
        <div class="card">Item não encontrado.</div>
      </section>
    `;
  }

  return `
    <section class="section">
      <div class="section-head">
        <a class="back" href="#/library?pack=${encodeURIComponent(packId)}">← Voltar</a>
      </div>

      <article class="card lesson card">
        <div class="lesson-head">
          <h2>${escapeHtml(item.title)}</h2>
          <div class="muted">${escapeHtml(item.category || "")}</div>
        </div>
        <div class="lesson-body">
          ${renderMarkdown(item.text || "")}
        </div>
      </article>
    </section>
    <div class="spacer"></div>
  `;
}

function renderMissions() {
  const date = todayISO();
  const all = getMissions();

  const done = store.missionsDone?.[date]?.ids || [];

  return `
    <section class="section">
      <div class="section-head">
        <h2>Missões</h2>
      </div>

      <div class="stack">
        ${all
          .map((m) => {
            const completed = done.includes(m.id);
            return `
              <article class="card mission card">
                <div class="mission-top">
                  <span class="tag">${escapeHtml(m.category || "técnica")}</span>
                </div>
                <h3>${escapeHtml(m.title)}</h3>
                <p class="muted">${escapeHtml(m.desc || "")}</p>
                <div class="mission-actions">
                  ${
                    completed
                      ? `<span class="tag ok">Concluída</span>`
                      : btn(`Concluir (+${m.xp || 10} XP)`, "completeMission", { id: m.id }, "btn primary small")
                  }
                </div>
              </article>
            `;
          })
          .join("")}
      </div>
    </section>
    <div class="spacer"></div>
  `;
}
function renderProfile() {
  const p = store.profile;
  return `
    <section class="section">
      <div class="section-head"><h2>Perfil</h2></div>

      <div class="card profile card">
        <div class="profile-title">🎤 ${escapeHtml(p.name || "Aluno")}</div>
        <div class="muted">Objetivo: <b>${escapeHtml(p.goal || "Misto")}</b></div>
        <div class="muted">XP: <b>${store.xp}</b></div>

        <div class="profile-actions">
          ${btn("Editar nome", "editName", {}, "btn")}
          <a class="btn primary" href="#/placement">Placement</a>
        </div>
      </div>
    </section>
    <div class="spacer"></div>
  `;
}

function renderPlacement() {
  return `
    <section class="section">
      <div class="section-head">
        <h2>Placement</h2>
      </div>

      <div class="card card">
        <p class="muted">
          Aqui você pode criar um fluxo de avaliação inicial (extensão futura).
        </p>
        <div class="stack">
          <div class="card subtle">
            <div class="row-title">Em breve</div>
            <div class="row-sub">Questionário + testes guiados + recomendação de trilha.</div>
          </div>
        </div>
      </div>
    </section>
    <div class="spacer"></div>
  `;
}

/* ===========================
   Admin: Login + Generator + Export
=========================== */

function renderAdminLogin() {
  return `
    <section class="section">
      <div class="section-head"><h2>Admin</h2></div>

      <div class="card card">
        <p class="muted">Digite a senha admin para liberar gerador e export.</p>
        <div class="form">
          <label>Senha</label>
          <input id="adminPass" class="input" type="password" placeholder="••••••••" />
          <button class="btn primary" data-action="adminLogin">Entrar</button>
        </div>
        <p class="muted small">Dica: altere o token no código quando publicar.</p>
      </div>
    </section>
    <div class="spacer"></div>
  `;
}

function renderAdmin() {
  return `
    <section class="section">
      <div class="section-head">
        <h2>Admin</h2>
        <div class="muted">Gerador de conteúdo (JSON)</div>
      </div>

      <div class="card card">
        <div class="tabs">
          <button class="tabbtn active" data-action="adminTab" data-tab="generator">Gerador</button>
          <button class="tabbtn" data-action="adminTab" data-tab="export">Export</button>
        </div>

        <div id="adminPanel">
          ${renderAdminGenerator()}
        </div>

        <div class="admin-actions">
          <button class="btn" data-action="adminLogout">Sair</button>
        </div>
      </div>
    </section>
    <div class="spacer"></div>
  `;
}

function renderAdminGenerator() {
  return `
    <div class="admin-grid">
      <div class="card subtle">
        <h3>Gerar item</h3>

        <div class="form">
          <label>Tipo</label>
          <select id="gType" class="input">
            <option value="lesson">Lição</option>
            <option value="library">Biblioteca</option>
            <option value="mission">Missão</option>
          </select>

          <label>Título</label>
          <input id="gTitle" class="input" placeholder="Ex: Canudo (straw phonation) — passo a passo" />

          <label>Nível / Categoria</label>
          <input id="gLevel" class="input" placeholder='Ex: Básico / Saúde / Técnica' />

          <label>Tags (separadas por vírgula)</label>
          <input id="gTags" class="input" placeholder="ex: canudo, SOVT, rotina" />

          <label>Texto</label>
          <textarea id="gText" class="input area" rows="10" placeholder="Escreva o conteúdo... (markdown simples)"></textarea>

          <label>Capa (URL opcional)</label>
          <input id="gCover" class="input" placeholder="https://..." />

          <button class="btn primary" data-action="genJSON">Gerar JSON</button>
        </div>
      </div>

      <div class="card subtle">
        <h3>Seu conteúdo custom (JSON)</h3>
        <p class="muted small">Copie e cole no GitHub para atrapalhar o mínimo possível seu fluxo.</p>

        <textarea id="gOut" class="input area mono" rows="14" spellcheck="false"></textarea>

        <div class="row gap">
          <button class="btn" data-action="copyOut">Copiar</button>
          <a class="btn" href="#/admin-export">Ir para Export</a>
        </div>

        <div class="muted small">
          Sugestão: mantenha 1 arquivo por categoria (lessons.js, library.js, missions.js) e
          cole os itens gerados dentro do array.
        </div>
      </div>
    </div>
  `;
}

function renderAdminExport() {
  return `
    <section class="section">
      <div class="section-head">
        <h2>Export</h2>
        <div class="muted">Conteúdo atual em JSON</div>
      </div>

      <div class="card card">
        <textarea id="exportOut" class="input area mono" rows="16" spellcheck="false"></textarea>
        <div class="row gap">
          <button class="btn primary" data-action="doExport">Gerar export</button>
          <button class="btn" data-action="copyExport">Copiar</button>
          <a class="btn" href="#/admin">Ir para Gerador</a>
        </div>
        <p class="muted small">
          Cole esse JSON em um arquivo novo no seu GitHub (ex: export.json) para backup.
        </p>
      </div>
    </section>
    <div class="spacer"></div>
  `;
}

/* ===========================
   Markdown (simple)
=========================== */

function renderMarkdown(text) {
  // minimal markdown:
  // #, ##, ###, **bold**, *italic*, - list, \n\n paragraph, `code`
  const lines = String(text || "").split("\n");
  let html = "";
  let inList = false;

  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimRight();

    if (!line.trim()) {
      closeList();
      continue;
    }

    if (line.startsWith("### ")) {
      closeList();
      html += `<h3>${inlineMd(line.slice(4))}</h3>`;
      continue;
    }
    if (line.startsWith("## ")) {
      closeList();
      html += `<h2>${inlineMd(line.slice(3))}</h2>`;
      continue;
    }
    if (line.startsWith("# ")) {
      closeList();
      html += `<h1>${inlineMd(line.slice(2))}</h1>`;
      continue;
    }

    if (line.startsWith("- ")) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${inlineMd(line.slice(2))}</li>`;
      continue;
    }

    closeList();
    html += `<p>${inlineMd(line)}</p>`;
  }

  closeList();
  return html;
}

function inlineMd(s) {
  let out = escapeHtml(s);

  // code
  out = out.replace(/`([^`]+)`/g, `<code>$1</code>`);
  // bold
  out = out.replace(/\*\*([^*]+)\*\*/g, `<b>$1</b>`);
  // italic
  out = out.replace(/\*([^*]+)\*/g, `<i>$1</i>`);
  return out;
}
/* ===========================
   Events
=========================== */

function adminTokenValid(pass) {
  // Troque essa senha/token depois de publicar
  return String(pass || "") === "IMV_ADMIN_2026";
}

function updateStreak() {
  const today = todayISO();
  const last = store.streak.lastActive;

  if (!last) {
    store.streak.lastActive = today;
    store.streak.days = 1;
    saveStreak();
    return;
  }

  if (last === today) return;

  // check if yesterday
  const dLast = new Date(last + "T00:00:00");
  const dToday = new Date(today + "T00:00:00");
  const diff = Math.round((dToday - dLast) / 86400000);

  if (diff === 1) {
    store.streak.days = (store.streak.days || 0) + 1;
  } else {
    store.streak.days = 1;
  }
  store.streak.lastActive = today;
  saveStreak();
}

function onAction(el) {
  const action = el.getAttribute("data-action");
  if (!action) return;

  // navigation helpers
  if (action === "openTrack") {
    const pack = el.getAttribute("data-pack");
    const track = el.getAttribute("data-track");
    location.hash = `#/track?pack=${encodeURIComponent(pack)}&track=${encodeURIComponent(track)}`;
    return;
  }

  if (action === "openLesson") {
    const pack = el.getAttribute("data-pack");
    const id = el.getAttribute("data-id");
    location.hash = `#/lesson?pack=${encodeURIComponent(pack)}&id=${encodeURIComponent(id)}`;
    return;
  }

  if (action === "openLibraryItem") {
    const pack = el.getAttribute("data-pack");
    const id = el.getAttribute("data-id");
    location.hash = `#/library-item?pack=${encodeURIComponent(pack)}&id=${encodeURIComponent(id)}`;
    return;
  }

  // swap mission (simple: just toast)
  if (action === "swapMission") {
    toast("Dica: escolha outra missão na lista abaixo.", "info");
    location.hash = "#/missions";
    return;
  }

  // mission complete
  if (action === "completeMission") {
    const id = el.getAttribute("data-id");
    const date = todayISO();

    store.missionsDone = store.missionsDone || {};
    store.missionsDone[date] = store.missionsDone[date] || { ids: [] };

    if (!store.missionsDone[date].ids.includes(id)) {
      store.missionsDone[date].ids.push(id);
      saveMissionsDone();
      updateStreak();

      const xp = 10;
      addXP(xp);
      toast(`Missão concluída! +${xp} XP`, "ok");

      // ✅ FIX: re-render pela rota atual (garante atualizar UI em qualquer tela)
      router();
      return;
    }

    toast("Essa missão já foi concluída hoje.", "info");
    return;
  }

  // profile edit name
  if (action === "editName") {
    const name = prompt("Seu nome:", store.profile.name || "Aluno");
    if (name && name.trim()) {
      store.profile.name = name.trim();
      saveProfile();
      toast("Nome atualizado.", "ok");
      router();
    }
    return;
  }

  // admin
  if (action === "adminLogin") {
    const pass = ($("#adminPass")?.value || "").trim();
    if (!pass) return toast("Digite a senha.", "warn");
    if (adminTokenValid(pass)) {
      writeJSON(LS.ADMIN_TOKEN, { ok: true, at: nowISO() });
      store.isAdmin = true;
      toast("Admin liberado.", "ok");
      location.hash = "#/admin";
    } else {
      toast("Senha incorreta.", "warn");
    }
    return;
  }

  if (action === "adminLogout") {
    localStorage.removeItem(LS.ADMIN_TOKEN);
    store.isAdmin = false;
    toast("Você saiu do admin.", "ok");
    location.hash = "#/home";
    return;
  }

  if (action === "adminTab") {
    const tab = el.getAttribute("data-tab");
    const panel = $("#adminPanel");
    $$(".tabbtn").forEach((b) => b.classList.remove("active"));
    el.classList.add("active");

    if (tab === "export") {
      panel.innerHTML = renderAdminExportInner();
    } else {
      panel.innerHTML = renderAdminGenerator();
    }
    return;
  }

  if (action === "genJSON") {
    const type = $("#gType")?.value || "lesson";
    const title = ($("#gTitle")?.value || "").trim();
    const level = ($("#gLevel")?.value || "").trim();
    const tags = ($("#gTags")?.value || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const text = ($("#gText")?.value || "").trim();
    const cover = ($("#gCover")?.value || "").trim();

    if (!title || !text) {
      toast("Preencha ao menos título e texto.", "warn");
      return;
    }

    const id = `${type}_${slugify(title).slice(0, 28)}_${String(Date.now()).slice(-4)}`;
    const obj =
      type === "mission"
        ? {
            id,
            type: "mission",
            date: todayISO(),
            category: level || "técnica",
            title,
            desc: text.slice(0, 140),
            xp: 10,
            minutes: 6,
          }
        : type === "library"
        ? { id, type: "library", title, category: level || "Saúde", tags, cover, text }
        : { id, type: "lesson", title, level: level || "Básico", tags, cover, text, trackId: "" };

    $("#gOut").value = JSON.stringify(obj, null, 2);
    toast("JSON gerado!", "ok");
    return;
  }

  if (action === "copyOut") {
    const t = $("#gOut");
    if (!t) return;
    t.select();
    document.execCommand("copy");
    toast("Copiado.", "ok");
    return;
  }

  if (action === "doExport") {
    const exportObj = {
      exportedAt: nowISO(),
      profile: store.profile,
      xp: store.xp,
      missionsDone: store.missionsDone,
      packsIndex: getPacksIndex(),
      tracks: {},
      lessons: {},
      library: {},
      missions: getMissions(),
    };

    for (const p of getPacksIndex()) {
      exportObj.tracks[p.id] = getTracks(p.id);
      exportObj.lessons[p.id] = getLessons(p.id);
      exportObj.library[p.id] = getLibrary(p.id);
    }

    const out = $("#exportOut");
    if (out) out.value = JSON.stringify(exportObj, null, 2);
    toast("Export pronto.", "ok");
    return;
  }

  if (action === "copyExport") {
    const t = $("#exportOut");
    if (!t) return;
    t.select();
    document.execCommand("copy");
    toast("Export copiado.", "ok");
    return;
  }
}

function renderAdminExportInner() {
  return `
    <div class="card subtle">
      <h3>Export</h3>
      <p class="muted small">Gere um backup do seu conteúdo atual (JSON).</p>
      <textarea id="exportOut" class="input area mono" rows="14" spellcheck="false"></textarea>
      <div class="row gap">
        <button class="btn primary" data-action="doExport">Gerar export</button>
        <button class="btn" data-action="copyExport">Copiar</button>
      </div>
    </div>
  `;
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  onAction(el);
});
/* ===========================
   Router
=========================== */

function parseHash() {
  const raw = location.hash || "#/home";
  const cleaned = raw.replace(/^#\/?/, "");
  const [path, query] = cleaned.split("?");
  return { path: path || "home", query: query || "" };
}

function router() {
  const { path, query } = parseHash();

  // guard admin routes
  if ((path === "admin" || path === "admin-export") && !store.isAdmin) {
    mount(renderAdminLogin(), "home");
    return;
  }

  if (path === "home") {
    mount(renderHome(), "home");
    return;
  }
  if (path === "path") {
    mount(renderPath(query), "path");
    return;
  }
  if (path === "track") {
    mount(renderTrack(query), "path");
    return;
  }
  if (path === "lesson") {
    mount(renderLesson(query), "path");
    return;
  }
  if (path === "missions") {
    mount(renderMissions(), "missions");
    return;
  }
  if (path === "library") {
    mount(renderLibrary(query), "library");
    return;
  }
  if (path === "library-item") {
    mount(renderLibraryItem(query), "library");
    return;
  }
  if (path === "profile") {
    mount(renderProfile(), "profile");
    return;
  }
  if (path === "placement") {
    mount(renderPlacement(), "home");
    return;
  }
  if (path === "admin-login") {
    mount(renderAdminLogin(), "home");
    return;
  }
  if (path === "admin") {
    mount(renderAdmin(), "home");
    return;
  }
  if (path === "admin-export") {
    mount(renderAdminExport(), "home");
    return;
  }

  mount(renderHome(), "home");
}

window.addEventListener("hashchange", router);

function boot() {
  loadAll();
  updateStreak();
  router();
}

boot();
