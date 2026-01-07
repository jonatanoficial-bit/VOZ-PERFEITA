// ===== IMVpedia Voice — app.js (PARTE 6/6) — BLOCO 1/6 =====
/* =========================================================
   IMVpedia Voice — MERGE FINAL COMPLETO + ADMIN PACK EDITOR
   ---------------------------------------------------------
   - Visual premium (Netflix-like)
   - Router SPA (#/home, #/path, #/missions, #/library, #/profile)
   - Packs (manifest), trilhas, lições, biblioteca
   - Admin Generator / Export (JSON custom)
   - Offline PWA + Service Worker
   --------------------------------------------------------- */

"use strict";

/* =============================
   0) Utils
============================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
const now = () => new Date();
const todayISO = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const fmtDate = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const safeJSON = {
  parse: (s, fb = null) => {
    try { return JSON.parse(s); } catch (e) { return fb; }
  },
  stringify: (o, sp = 0) => {
    try { return JSON.stringify(o, null, sp); } catch (e) { return ""; }
  }
};

/* ✅ Clone seguro (corrige bug do structuredClone em alguns browsers) */
function deepClone(obj) {
  try {
    if (typeof structuredClone === "function") return structuredClone(obj);
  } catch (e) {}
  return JSON.parse(JSON.stringify(obj));
}

/* =============================
   1) Storage / State
============================= */
const STORAGE_KEY = "imv_voice_state_final_v1";

const DEFAULT_STATE = {
  profile: {
    name: "Aluno",
    goal: "Misto",
    xp: 0,
    level: 1,
    streakDays: 0,
    lastStreakISO: "",
  },
  ui: {
    selectedPackId: "base",
    selectedTrackId: "fundamentos",
    selectedLessonId: "",
    libraryOpenId: "",
    tab: "home",
    adminMode: false,
  },
  progress: {
    // lesson progress: { [lessonId]: { done: bool, updatedAtISO: string } }
    lessons: {},
    // mission progress per day: { [isoDate]: { done: true, xp: number, missionId: string } }
    completedMissions: {},
    // cached mission of today
    todayMission: null,
    todayMissionISO: "",
  },
  diary: {
    entries: [], // { id, iso, title, mood, note }
  },
  customContent: {
    // appended JSON blocks from admin generator
    imported: {
      tracks: [],
      lessons: [],
      library: [],
      missions: [],
    }
  }
};

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return deepClone(DEFAULT_STATE);
  const parsed = safeJSON.parse(raw, null);
  if (!parsed) return deepClone(DEFAULT_STATE);

  // merge naive
  const merged = deepClone(DEFAULT_STATE);
  try {
    Object.assign(merged.profile, parsed.profile || {});
    Object.assign(merged.ui, parsed.ui || {});
    Object.assign(merged.progress, parsed.progress || {});
    Object.assign(merged.diary, parsed.diary || {});
    if (parsed.customContent && parsed.customContent.imported) {
      merged.customContent.imported = parsed.customContent.imported;
    }
  } catch (e) {}
  return merged;
}

function persistState(st) {
  try {
    localStorage.setItem(STORAGE_KEY, safeJSON.stringify(st));
  } catch (e) {}
}

const store = {
  state: loadState(),
  get() { return this.state; },
  set(updater) {
    const next = deepClone(this.state);
    updater(next);
    this.state = next;
    persistState(next);
  }
};

/* =============================
   2) XP / Level
============================= */
function xpNeededForLevel(level) {
  // leve, mas crescente
  return 50 + (level - 1) * 35;
}

function applyXP(deltaXP) {
  if (!deltaXP) return;
  store.set(s => {
    s.profile.xp = (s.profile.xp || 0) + deltaXP;
    // handle level ups
    while (s.profile.xp >= xpNeededForLevel(s.profile.level || 1)) {
      s.profile.xp -= xpNeededForLevel(s.profile.level || 1);
      s.profile.level = (s.profile.level || 1) + 1;
      toast(`🎉 Você subiu para o nível ${s.profile.level}!`);
    }
  });
}

/* =============================
   3) Toast / Modal
============================= */
let toastTimer = null;
function toast(msg) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

function openModal(html) {
  const m = $("#modal");
  if (!m) return;
  m.classList.add("open");
  $("#modalContent").innerHTML = html;
}

function closeModal() {
  const m = $("#modal");
  if (!m) return;
  m.classList.remove("open");
  $("#modalContent").innerHTML = "";
}

/* =============================
   4) Packs / Manifests
============================= */
const PACKS = [
  { id: "base", title: "Base", subtitle: "Fundamentos vocais", icon: "♪", included: true },
  // futuramente: outros packs
];

async function fetchText(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error("fetch failed");
  return await res.text();
}

async function fetchJSON(path) {
  const txt = await fetchText(path);
  const j = safeJSON.parse(txt, null);
  if (!j) throw new Error("json parse failed");
  return j;
}

async function loadManifest(packId) {
  // packs/<id>/manifest.json
  const path = `packs/${packId}/manifest.json`;
  return await fetchJSON(path);
}

function normalizeManifest(man) {
  const m = deepClone(man || {});
  m.id = m.id || "unknown";
  m.title = m.title || "Pack";
  m.subtitle = m.subtitle || "";
  m.tracks = Array.isArray(m.tracks) ? m.tracks : [];
  m.lessons = Array.isArray(m.lessons) ? m.lessons : [];
  m.library = Array.isArray(m.library) ? m.library : [];
  m.missions = m.missions || {};
  m.missions.templates = Array.isArray(m.missions.templates) ? m.missions.templates : [];
  return m;
}

/* =============================
   5) Content Registry
============================= */
let activePack = null; // normalized manifest
let activePackIdLoaded = "";

async function ensurePackLoaded(packId) {
  if (activePack && activePackIdLoaded === packId) return activePack;

  try {
    const man = await loadManifest(packId);
    activePack = normalizeManifest(man);
    activePackIdLoaded = packId;
    return activePack;
  } catch (e) {
    // fallback base minimal
    activePack = normalizeManifest({
      id: "base",
      title: "Base",
      subtitle: "Fundamentos vocais",
      tracks: [
        { id: "fundamentos", title: "Fundamentos", subtitle: "Base • 2 lições", icon: "🧭", lessonIds: ["les_mod1_canudo_001", "les_mod1_humming_001"] }
      ],
      lessons: [
        {
          id: "les_mod1_canudo_001",
          type: "lesson",
          title: "Canudo (straw phonation) — passo a passo",
          level: "Básico",
          tags: ["canudo", "SOVT", "rotina"],
          text: "# Canudo (straw phonation)\n\n### Regra\nSOVT deve ser **confortável**. Se doer ou cansar, você está fazendo forte demais.\n\n---\n\n## Como fazer\n- use um canudo comum\n- faça som contínuo (volume baixo)\n- mantenha o pescoço solto\n\n## Rotina (6 min)\n1) 2 min notas confortáveis\n2) 2 min glissando (subindo/descendo)\n3) 2 min 5 notas (escala leve)\n\n## Sinal de acerto\nSente a voz “encaixar” com menos esforço.\n"
        },
        {
          id: "les_mod1_humming_001",
          type: "lesson",
          title: "Humming — vibração e foco",
          level: "Básico",
          tags: ["humming", "ressonância"],
          text: "# Humming\n\n## Objetivo\nCriar vibração facial e foco suave.\n\n## Rotina (5 min)\n- 2 min em nota confortável\n- 3 min com pequenas melodias\n\n## Dica\nSinta vibração no nariz/bochechas.\n"
        }
      ],
      library: [
        { id: "fisiologia", title: "Fisiologia vocal", tag: "Saúde", md: "# Fisiologia vocal\n\nConteúdo em breve.\n" }
      ],
      missions: {
        templates: [
          { id: "m_resp_36", tag: "técnica", title: "Respiração 3/6", desc: "Respire 3s e solte 6s em \"sss\" por 5 minutos.", minutes: 6, xp: 10 },
          { id: "m_sovt_leve", tag: "saúde", title: "SOVT leve", desc: "Lip trill / canudo / humming em região confortável.", minutes: 6, xp: 10 }
        ]
      }
    });
    activePackIdLoaded = "base";
    return activePack;
  }
}

function getAllContentMerged(pack) {
  const st = store.get();

  const imported = (st.customContent && st.customContent.imported) ? st.customContent.imported : { tracks: [], lessons: [], library: [], missions: [] };

  const merged = {
    tracks: [...(pack.tracks || []), ...(imported.tracks || [])],
    lessons: [...(pack.lessons || []), ...(imported.lessons || [])],
    library: [...(pack.library || []), ...(imported.library || [])],
    missions: {
      templates: [...((pack.missions && pack.missions.templates) ? pack.missions.templates : []), ...(imported.missions || [])]
    }
  };

  // ensure uniqueness by id (last wins)
  const uniqById = (arr) => {
    const map = new Map();
    (arr || []).forEach(it => { if (it && it.id) map.set(it.id, it); });
    return Array.from(map.values());
  };

  merged.tracks = uniqById(merged.tracks);
  merged.lessons = uniqById(merged.lessons);
  merged.library = uniqById(merged.library);
  merged.missions.templates = uniqById(merged.missions.templates);

  return merged;
}

/* =============================
   6) Missions Logic
============================= */
function chooseTodayMission(templates) {
  const list = (templates || []).filter(Boolean);
  if (!list.length) return null;
  const seed = todayISO().split("-").join("");
  let sum = 0;
  for (let i = 0; i < seed.length; i++) sum += seed.charCodeAt(i);
  const idx = sum % list.length;
  return list[idx];
}

function ensureTodayMission(content) {
  const st = store.get();
  const iso = todayISO();
  if (st.progress.todayMission && st.progress.todayMissionISO === iso) return st.progress.todayMission;

  const m = chooseTodayMission((content.missions && content.missions.templates) ? content.missions.templates : []);
  store.set(s => {
    s.progress.todayMission = m;
    s.progress.todayMissionISO = iso;
  });
  return m;
}

function markMissionDone(mission) {
  if (!mission) return;
  const t = todayISO();
  const xp = Number(mission.xp || 10);

  const already = store.get().progress.completedMissions[t];
  if (already && already.done) {
    toast("✅ Missão de hoje já concluída.");
    return;
  }

  store.set(s => {
    s.progress.completedMissions[t] = { done: true, xp, missionId: mission.id };
    // streak
    const last = s.profile.lastStreakISO || "";
    if (last) {
      const prev = new Date(last);
      const cur = new Date(t);
      const diffDays = Math.round((cur - prev) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) s.profile.streakDays = (s.profile.streakDays || 0) + 1;
      else if (diffDays > 1) s.profile.streakDays = 1;
    } else {
      s.profile.streakDays = 1;
    }
    s.profile.lastStreakISO = t;
  });

  applyXP(xp);
  toast(`✨ +${xp} XP! Missão concluída.`);
}

/* =============================
   7) Lessons Progress
============================= */
function setLessonDone(lessonId, done = true) {
  if (!lessonId) return;
  store.set(s => {
    s.progress.lessons[lessonId] = { done, updatedAtISO: todayISO() };
  });
}

function isLessonDone(lessonId) {
  const st = store.get();
  return !!(st.progress.lessons[lessonId] && st.progress.lessons[lessonId].done);
}

/* =============================
   8) Router
============================= */
function setHash(route) {
  location.hash = `#/${route}`;
}
function getRoute() {
  const h = (location.hash || "#/home").replace("#/", "");
  return h || "home";
}

/* =============================
   9) UI Components
============================= */
function headerHTML() {
  const st = store.get();
  return `
    <div class="topbar">
      <div class="brand">
        <span class="dot"></span>
        <span class="brandTitle">IMVpedia Voice</span>
      </div>
      <button class="pill" data-action="toggleAdmin">${st.ui.adminMode ? "Sair do Admin" : "Admin"}</button>
    </div>
  `;
}

function bottomNavHTML(route) {
  const items = [
    { id: "home", label: "Início", icon: "🏠" },
    { id: "path", label: "Trilha", icon: "🧭" },
    { id: "missions", label: "Missões", icon: "✅" },
    { id: "library", label: "Biblioteca", icon: "📚" },
    { id: "profile", label: "Perfil", icon: "👤" },
  ];
  return `
    <nav class="bottomNav">
      ${items.map(it => `
        <button class="navItem ${route === it.id ? "active" : ""}" data-nav="${it.id}">
          <div class="navIcon">${it.icon}</div>
          <div class="navLabel">${it.label}</div>
        </button>
      `).join("")}
    </nav>
  `;
}

function heroCardHTML(content) {
  const st = store.get();
  const xp = st.profile.xp || 0;
  const lvl = st.profile.level || 1;
  const need = xpNeededForLevel(lvl);
  const pct = clamp((xp / need) * 100, 0, 100);

  const streak = st.profile.streakDays || 0;

  return `
    <section class="heroCard">
      <div class="heroGlow"></div>
      <div class="heroInner">
        <div class="heroMeta">
          <div>Olá, <b>${st.profile.name || "Aluno"}</b> • XP ${xp} • Nível ${lvl}</div>
          <div class="streak">🔥 ${streak} dia(s)</div>
        </div>

        <h1 class="heroTitle">IMVpedia Voice</h1>
        <p class="heroSub">Trilha vocal guiada com técnica, saúde e repertório (popular, erudito e coral).</p>

        <div class="heroActions">
          <button class="btn primary" data-action="gotoPath">Trilha</button>
          <button class="btn" data-action="gotoPlacement">Fazer placement</button>
          <button class="btn ghost" data-action="gotoProfile">Perfil</button>
        </div>

        <div class="heroProgress">
          <div class="progressTrack">
            <div class="progressFill" style="width:${pct}%"></div>
          </div>
          <div class="progressMeta">${xp}/${need} XP para o próximo nível</div>
        </div>
      </div>
    </section>
  `;
}

function packCardHTML(pack) {
  return `
    <div class="packCard" data-pack="${pack.id}">
      <div class="packTop">
        <div class="packIcon">${pack.icon || "♪"}</div>
      </div>
      <div class="packBody">
        <div class="packTitle">${pack.title}</div>
        <div class="packSub">${pack.subtitle}</div>
      </div>
    </div>
  `;
}

function sectionHeader(title, right = "") {
  return `
    <div class="sectionHeader">
      <h2>${title}</h2>
      ${right ? `<div class="right">${right}</div>` : ""}
    </div>
  `;
}

/* =============================
   10) Views
============================= */
function viewHome(content) {
  const st = store.get();
  const today = ensureTodayMission(content);
  const done = st.progress.completedMissions[todayISO()] && st.progress.completedMissions[todayISO()].done;

  const missionCard = today ? `
    <div class="missionCard">
      <div class="missionHeader">
        <div>
          <div class="sectionHeaderInline">
            <h2>Missão do dia</h2>
            <span class="muted">${todayISO()} • ${today.tag || "técnica"}</span>
          </div>
        </div>
      </div>

      <div class="missionMain">
        <div class="missionTitle">${today.title}</div>
        <div class="missionDesc">${today.desc}</div>

        <div class="missionFooter">
          <div class="pill small">⏱ ${today.minutes || 6} min</div>
          <button class="btn primary ${done ? "disabled" : ""}" data-action="completeMission">
            ${done ? "Concluída ✅" : `✨ +${today.xp || 10} XP`}
          </button>
        </div>

        <div class="missionActions">
          <button class="btn" data-action="swapMission">Trocar</button>
          <button class="btn ghost" data-action="openDiary">Diário</button>
        </div>
      </div>
    </div>
  ` : "";

  const packsRight = `
    <button class="pill" data-action="managePacks">Gerenciar</button>
  `;

  return `
    <div class="page">
      ${heroCardHTML(content)}

      <div class="section">
        ${sectionHeader("Packs", packsRight)}
        <div class="packGrid">
          ${PACKS.map(packCardHTML).join("")}
        </div>
      </div>

      <div class="section">
        ${missionCard}
      </div>

      <div class="section">
        ${weekProgressCardHTML()}
      </div>
    </div>
  `;
}

function weekProgressCardHTML() {
  const st = store.get();
  const days = Object.keys(st.progress.completedMissions || {}).filter(k => st.progress.completedMissions[k] && st.progress.completedMissions[k].done).slice(-7);
  const count = days.length;

  return `
    <div class="weekCard">
      <div class="weekHeader">
        <h2>Semana</h2>
        <div class="muted">progresso semanal</div>
      </div>
      <div class="weekBar">
        <div class="weekFill" style="width:${clamp((count/7)*100, 0, 100)}%"></div>
      </div>
      <div class="weekMeta">
        <div><b>${count}/7</b> missões concluídas</div>
        <div class="muted">Meta: 7/7</div>
      </div>
    </div>
  `;
}

function viewPath(content) {
  const st = store.get();
  const tracks = content.tracks || [];
  const selectedTrack = tracks.find(t => t.id === st.ui.selectedTrackId) || tracks[0];

  const card = selectedTrack ? `
    <div class="trackRow" data-track="${selectedTrack.id}">
      <div class="trackIcon">${selectedTrack.icon || "🧭"}</div>
      <div class="trackInfo">
        <div class="trackTitle">${selectedTrack.title}</div>
        <div class="trackSub">${selectedTrack.subtitle || ""}</div>
      </div>
      <div class="chev">›</div>
    </div>
  ` : `<div class="empty">Nenhuma trilha encontrada.</div>`;

  return `
    <div class="page">
      <div class="section">
        ${sectionHeader("Trilha")}
        ${card}
      </div>

      ${selectedTrack ? viewLessonsList(content, selectedTrack) : ""}
    </div>
  `;
}

function viewLessonsList(content, track) {
  const lessonsMap = new Map((content.lessons || []).map(l => [l.id, l]));
  const ids = track.lessonIds || [];
  const list = ids.map(id => lessonsMap.get(id)).filter(Boolean);

  if (!list.length) {
    return `
      <div class="section">
        <div class="empty">Este módulo ainda não possui lições.</div>
      </div>
    `;
  }

  return `
    <div class="section">
      ${sectionHeader("Lições")}
      <div class="list">
        ${list.map(lesson => lessonRowHTML(lesson)).join("")}
      </div>
    </div>
  `;
}

function lessonRowHTML(lesson) {
  const done = isLessonDone(lesson.id);
  return `
    <div class="lessonRow" data-lesson="${lesson.id}">
      <div class="lessonBadge">${done ? "✅" : "▶"}</div>
      <div class="lessonInfo">
        <div class="lessonTitle">${lesson.title}</div>
        <div class="lessonMeta">${lesson.level || ""} • ${(lesson.tags || []).slice(0,3).join(" • ")}</div>
      </div>
      <div class="chev">›</div>
    </div>
  `;
}
function viewLesson(content, lessonId) {
  const lesson = (content.lessons || []).find(l => l.id === lessonId);
  if (!lesson) {
    return `
      <div class="page">
        <div class="section">
          <div class="empty">Lição não encontrada.</div>
        </div>
      </div>
    `;
  }

  const done = isLessonDone(lessonId);

  return `
    <div class="page">
      <div class="section">
        <div class="backRow">
          <button class="pill" data-action="backToPath">← Voltar</button>
          <div class="muted">${lesson.level || ""}</div>
        </div>

        <div class="lessonCard">
          <div class="lessonHeader">
            <h2>${lesson.title}</h2>
            <div class="lessonTags">${(lesson.tags || []).slice(0,6).map(t => `<span class="tag">${t}</span>`).join("")}</div>
          </div>

          <div class="lessonBody markdown" id="lessonMarkdown"></div>

          <div class="lessonFooter">
            <button class="btn primary" data-action="toggleLessonDone" data-lesson="${lessonId}">
              ${done ? "Marcar como não concluída" : "Marcar como concluída ✅"}
            </button>
            <button class="btn ghost" data-action="openDiary">Anotar no diário</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function viewMissions(content) {
  const st = store.get();
  const list = (content.missions && content.missions.templates) ? content.missions.templates : [];

  const today = ensureTodayMission(content);
  const done = st.progress.completedMissions[todayISO()] && st.progress.completedMissions[todayISO()].done;

  const cards = (list || []).slice(0, 40).map(m => {
    const isToday = today && m.id === today.id;
    return `
      <div class="missionItem ${isToday ? "today" : ""}">
        <div class="missionTop">
          <span class="badge">${m.tag || "técnica"}</span>
        </div>
        <div class="missionTitle">${m.title}</div>
        <div class="missionDesc">${m.desc}</div>
        <div class="missionBottom">
          <span class="pill small">⏱ ${m.minutes || 6} min</span>
          <span class="pill small">✨ ${m.xp || 10} XP</span>
          ${isToday ? `
            <button class="btn primary ${done ? "disabled" : ""}" data-action="completeMission">
              ${done ? "Concluída ✅" : `Concluir (+${today.xp || 10} XP)`}
            </button>
          ` : ""}
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="page">
      <div class="section">
        ${sectionHeader("Missões")}
        <div class="grid">
          ${cards || `<div class="empty">Nenhuma missão cadastrada.</div>`}
        </div>
      </div>
    </div>
  `;
}

function viewLibrary(content) {
  const items = content.library || [];
  if (!items.length) {
    return `
      <div class="page">
        <div class="section">
          ${sectionHeader("Biblioteca")}
          <div class="empty">Ainda não há itens na biblioteca.</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="page">
      <div class="section">
        ${sectionHeader("Biblioteca")}
        <div class="list">
          ${items.slice(0, 80).map(it => `
            <div class="libRow" data-lib="${it.id}">
              <div class="libIcon">📘</div>
              <div class="libInfo">
                <div class="libTitle">${it.title}</div>
                <div class="libMeta">${it.tag || ""} • ${store.get().ui.selectedPackId || ""}</div>
              </div>
              <div class="chev">›</div>
            </div>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function viewLibraryItem(content, itemId) {
  const it = (content.library || []).find(x => x.id === itemId);
  if (!it) {
    return `
      <div class="page">
        <div class="section">
          <div class="empty">Item não encontrado.</div>
        </div>
      </div>
    `;
  }
  return `
    <div class="page">
      <div class="section">
        <div class="backRow">
          <button class="pill" data-action="backToLibrary">← Voltar</button>
          <div class="muted">${it.tag || ""}</div>
        </div>

        <div class="lessonCard">
          <div class="lessonHeader">
            <h2>${it.title}</h2>
          </div>
          <div class="lessonBody markdown" id="libraryMarkdown"></div>
        </div>
      </div>
    </div>
  `;
}

function viewProfile() {
  const st = store.get();
  const lvl = st.profile.level || 1;
  const xp = st.profile.xp || 0;
  const need = xpNeededForLevel(lvl);
  const pct = clamp((xp / need) * 100, 0, 100);

  return `
    <div class="page">
      <div class="section">
        ${sectionHeader("Perfil")}
        <div class="profileCard">
          <div class="profileTitle">🎤 <b>${st.profile.name || "Aluno"}</b></div>
          <div class="muted">Objetivo: <b>${st.profile.goal || "Misto"}</b><br/>XP: <b>${xp}</b> • Nível: <b>${lvl}</b></div>

          <div class="heroProgress" style="margin-top:14px;">
            <div class="progressTrack">
              <div class="progressFill" style="width:${pct}%"></div>
            </div>
            <div class="progressMeta">${xp}/${need} XP para o próximo nível</div>
          </div>

          <div class="profileActions">
            <button class="btn" data-action="editName">Editar nome</button>
            <button class="btn primary" data-action="gotoPlacement">Placement</button>
          </div>
        </div>
      </div>

      <div class="section">
        ${sectionHeader("Diário")}
        <div class="weekCard">
          <div class="muted">Use o diário para registrar sensações e ajustes. Isso melhora muito a evolução.</div>
          <div style="margin-top:12px;">
            <button class="btn primary" data-action="openDiary">Abrir diário</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* =============================
   11) Diary
============================= */
function viewDiary() {
  const st = store.get();
  const entries = (st.diary.entries || []).slice().reverse().slice(0, 12);

  return `
    <div class="section">
      <div class="sectionHeader">
        <h2>Diário</h2>
        <div class="right"><button class="pill" data-action="closeModal">Fechar</button></div>
      </div>

      <div class="weekCard">
        <div class="muted">Registre notas curtas após práticas. Isso vira seu “mapa” vocal.</div>
        <div class="diaryForm">
          <input class="input" id="diaryTitle" placeholder="Título (ex: respiração 3/6)" />
          <select class="input" id="diaryMood">
            <option value="🙂 bom">🙂 bom</option>
            <option value="😐 ok">😐 ok</option>
            <option value="😣 difícil">😣 difícil</option>
          </select>
          <textarea class="input" id="diaryNote" rows="4" placeholder="O que você sentiu? O que funcionou? O que ajustar?"></textarea>
          <button class="btn primary" data-action="saveDiary">Salvar</button>
        </div>
      </div>

      <div class="section" style="margin-top:14px;">
        ${sectionHeader("Últimas anotações")}
        <div class="list">
          ${entries.length ? entries.map(e => `
            <div class="libRow">
              <div class="libIcon">📝</div>
              <div class="libInfo">
                <div class="libTitle">${e.title || "Anotação"}</div>
                <div class="libMeta">${fmtDate(e.iso)} • ${e.mood || ""}</div>
                <div class="muted" style="margin-top:6px; white-space:pre-wrap;">${(e.note || "").slice(0, 240)}</div>
              </div>
            </div>
          `).join("") : `<div class="empty">Nenhuma anotação ainda.</div>`}
        </div>
      </div>
    </div>
  `;
}

/* =============================
   12) Admin: Generator & Export
============================= */
function viewAdminHub() {
  const st = store.get();
  const packId = st.ui.selectedPackId || "base";

  return `
    <div class="page">
      <div class="section">
        ${sectionHeader("Admin")}
        <div class="weekCard">
          <div class="muted">Crie conteúdo rapidamente e exporte em JSON para colar no GitHub.</div>
          <div class="adminActions">
            <button class="btn primary" data-action="openAdminGenerator">Gerador de Conteúdo</button>
            <button class="btn" data-action="openAdminExport">Exportar (JSON)</button>
          </div>
          <div class="muted" style="margin-top:10px;">Pack atual: <b>${packId}</b></div>
        </div>
      </div>
    </div>
  `;
}

function viewAdminExport(content) {
  const st = store.get();
  const imported = st.customContent.imported || { tracks: [], lessons: [], library: [], missions: [] };

  const json = safeJSON.stringify(imported, 2);

  return `
    <div class="section">
      <div class="sectionHeader">
        <h2>Seu conteúdo custom (JSON)</h2>
        <div class="right">
          <button class="pill" data-action="copyExport">Copiar</button>
          <button class="pill" data-action="openAdminGenerator">Ir para Gerador</button>
          <button class="pill" data-action="closeModal">Fechar</button>
        </div>
      </div>
      <div class="weekCard">
        <div class="muted">Copie e cole no GitHub para atrapalhar o mínimo possível seu fluxo.</div>
        <textarea class="input" id="exportBox" rows="14" spellcheck="false">${json}</textarea>
      </div>
    </div>
  `;
}

function viewAdminGenerator(content) {
  const st = store.get();
  const merged = getAllContentMerged(activePack);
  const tracks = merged.tracks || [];

  return `
    <div class="section">
      <div class="sectionHeader">
        <h2>Gerador de Conteúdo</h2>
        <div class="right">
          <button class="pill" data-action="closeModal">Fechar</button>
        </div>
      </div>

      <div class="weekCard">
        <div class="muted">Crie itens e exporte para persistir no app (sem apagar o que já existe).</div>

        <div class="adminGrid">
          <div>
            <label class="label">Tipo</label>
            <select class="input" id="genType">
              <option value="lesson">Lição</option>
              <option value="track">Trilha</option>
              <option value="library">Biblioteca</option>
              <option value="mission">Missão</option>
            </select>
          </div>

          <div>
            <label class="label">ID (opcional)</label>
            <input class="input" id="genId" placeholder="ex: les_resp_001" />
          </div>

          <div>
            <label class="label">Título</label>
            <input class="input" id="genTitle" placeholder="ex: Respiração 3/6" />
          </div>

          <div>
            <label class="label">Tag / nível</label>
            <input class="input" id="genTag" placeholder="ex: técnica / básico" />
          </div>
        </div>

        <div class="adminGrid" style="margin-top:10px;">
          <div>
            <label class="label">Capa (emoji ou texto curto)</label>
            <input class="input" id="genCover" placeholder="ex: 🧭 ou 🎤" />
          </div>
          <div>
            <label class="label">XP (missão)</label>
            <input class="input" id="genXP" type="number" value="10" />
          </div>
          <div>
            <label class="label">Minutos (missão)</label>
            <input class="input" id="genMin" type="number" value="6" />
          </div>
          <div>
            <label class="label">Trilha (lição)</label>
            <select class="input" id="genTrack">
              ${tracks.map(t => `<option value="${t.id}">${t.title}</option>`).join("")}
            </select>
          </div>
        </div>

        <div style="margin-top:12px;">
          <label class="label">Texto (Markdown)</label>
          <textarea class="input" id="genText" rows="10" placeholder="# Título\n\nEscreva aqui..."></textarea>
        </div>

        <div class="adminActions" style="margin-top:12px;">
          <button class="btn primary" data-action="generateItem">Gerar JSON</button>
          <button class="btn" data-action="openAdminExport">Ver export atual</button>
        </div>

        <div id="genOutWrap" style="margin-top:14px; display:none;">
          <label class="label">JSON Gerado (copie e depois clique em “Importar”)</label>
          <textarea class="input" id="genOut" rows="10" spellcheck="false"></textarea>
          <div class="adminActions" style="margin-top:10px;">
            <button class="btn primary" data-action="importGenerated">Importar (adicionar ao app)</button>
            <button class="btn" data-action="copyGenerated">Copiar</button>
          </div>
        </div>

      </div>
    </div>
  `;
}
/* =============================
   13) Rendering / Bindings
============================= */
function render() {
  const route = getRoute();
  const root = $("#app");
  if (!root) return;

  const st = store.get();
  st.ui.tab = route;

  ensurePackLoaded(st.ui.selectedPackId || "base").then(pack => {
    const merged = getAllContentMerged(pack);
    const view = resolveView(route, merged);

    root.innerHTML = `
      ${headerHTML()}
      <main class="main">
        ${view}
      </main>
      ${bottomNavHTML(route)}
    `;

    // fill markdown placeholders
    hydrateMarkdown(route, merged);

    // bind interactions
    bindNav();
    bindActions(route, merged);
  });
}

function resolveView(route, content) {
  const st = store.get();
  if (st.ui.adminMode && route.startsWith("admin")) {
    return viewAdminHub();
  }

  if (route === "home") return viewHome(content);
  if (route === "path") return viewPath(content);
  if (route.startsWith("lesson/")) {
    const id = route.split("lesson/")[1];
    return viewLesson(content, id);
  }
  if (route === "missions") return viewMissions(content);
  if (route === "library") return viewLibrary(content);
  if (route.startsWith("lib/")) {
    const id = route.split("lib/")[1];
    return viewLibraryItem(content, id);
  }
  if (route === "profile") return viewProfile();
  if (route === "admin") return viewAdminHub();

  // fallback
  return viewHome(content);
}

function hydrateMarkdown(route, content) {
  if (route.startsWith("lesson/")) {
    const id = route.split("lesson/")[1];
    const lesson = (content.lessons || []).find(l => l.id === id);
    const el = $("#lessonMarkdown");
    if (el && lesson && lesson.text) {
      el.innerHTML = mdToHTML(lesson.text);
    }
  }
  if (route.startsWith("lib/")) {
    const id = route.split("lib/")[1];
    const it = (content.library || []).find(l => l.id === id);
    const el = $("#libraryMarkdown");
    if (el && it && it.md) el.innerHTML = mdToHTML(it.md);
  }
}

function bindNav() {
  $$(".navItem").forEach(btn => {
    btn.onclick = () => {
      const nav = btn.getAttribute("data-nav");
      if (nav) setHash(nav);
    };
  });
}

function bindActions(route, content) {
  // pack selection
  $$(".packCard").forEach(card => {
    card.onclick = () => {
      const id = card.getAttribute("data-pack");
      if (!id) return;
      store.set(s => { s.ui.selectedPackId = id; });
      toast(`Pack: ${id}`);
      render();
    };
  });

  // track open
  $$(".trackRow").forEach(row => {
    row.onclick = () => {
      const id = row.getAttribute("data-track");
      if (!id) return;
      store.set(s => { s.ui.selectedTrackId = id; });
      render();
    };
  });

  // lesson open
  $$(".lessonRow").forEach(row => {
    row.onclick = () => {
      const id = row.getAttribute("data-lesson");
      if (!id) return;
      setHash(`lesson/${id}`);
    };
  });

  // library open
  $$(".libRow").forEach(row => {
    row.onclick = () => {
      const id = row.getAttribute("data-lib");
      if (!id) return;
      setHash(`lib/${id}`);
    };
  });

  // actions by data-action
  $$("[data-action]").forEach(el => {
    el.onclick = (ev) => {
      const act = el.getAttribute("data-action");
      if (!act) return;

      if (act === "toggleAdmin") {
        store.set(s => { s.ui.adminMode = !s.ui.adminMode; });
        toast(store.get().ui.adminMode ? "Admin ativado" : "Admin desativado");
        render();
        return;
      }

      if (act === "gotoPath") { setHash("path"); return; }
      if (act === "gotoProfile") { setHash("profile"); return; }
      if (act === "gotoPlacement") { toast("Placement em breve."); return; }
      if (act === "managePacks") { toast("Gerenciamento em breve."); return; }

      if (act === "backToPath") { setHash("path"); return; }
      if (act === "backToLibrary") { setHash("library"); return; }

      if (act === "completeMission") {
        const st = store.get();
        if (st.progress.todayMission) {
          markMissionDone(st.progress.todayMission);
          render();
        }
        return;
      }

      if (act === "swapMission") {
        const templates = (content.missions && content.missions.templates) ? content.missions.templates : [];
        if (!templates.length) { toast("Sem missões."); return; }
        const cur = store.get().progress.todayMission;
        // pick another different
        const other = templates.find(m => m.id !== (cur && cur.id)) || templates[0];
        store.set(s => {
          s.progress.todayMission = other;
          s.progress.todayMissionISO = todayISO();
        });
        toast("Missão trocada.");
        render();
        return;
      }

      if (act === "toggleLessonDone") {
        const id = el.getAttribute("data-lesson");
        if (!id) return;
        const done = isLessonDone(id);
        setLessonDone(id, !done);
        toast(!done ? "✅ Lição concluída!" : "Lição marcada como não concluída");
        render();
        return;
      }

      if (act === "editName") {
        const name = prompt("Seu nome:", store.get().profile.name || "Aluno");
        if (name && name.trim()) {
          store.set(s => { s.profile.name = name.trim(); });
          toast("Nome atualizado.");
          render();
        }
        return;
      }

      if (act === "openDiary") {
        openModal(viewDiary());
        bindModalActions();
        return;
      }

      if (act === "closeModal") {
        closeModal();
        return;
      }

      // admin modals
      if (act === "openAdminGenerator") {
        openModal(viewAdminGenerator(content));
        bindModalActions(content);
        return;
      }
      if (act === "openAdminExport") {
        openModal(viewAdminExport(content));
        bindModalActions(content);
        return;
      }
      if (act === "copyExport") {
        const box = $("#exportBox");
        if (box) {
          box.select(); document.execCommand("copy");
          toast("Copiado!");
        }
        return;
      }
      if (act === "copyGenerated") {
        const box = $("#genOut");
        if (box) {
          box.select(); document.execCommand("copy");
          toast("Copiado!");
        }
        return;
      }
      if (act === "generateItem") {
        generateItemFromForm(content);
        return;
      }
      if (act === "importGenerated") {
        importGeneratedFromOut(content);
        return;
      }
      if (act === "saveDiary") {
        saveDiaryEntry();
        return;
      }

    };
  });
}

function bindModalActions(content) {
  $$("[data-action]", $("#modal")).forEach(el => {
    el.onclick = () => {
      const act = el.getAttribute("data-action");
      if (!act) return;
      // delegate to main binder (simpler)
      if (act === "closeModal") return closeModal();
      if (act === "openAdminGenerator") {
        openModal(viewAdminGenerator(content || getAllContentMerged(activePack)));
        bindModalActions(content);
        return;
      }
      if (act === "openAdminExport") {
        openModal(viewAdminExport(content || getAllContentMerged(activePack)));
        bindModalActions(content);
        return;
      }
      if (act === "copyExport") {
        const box = $("#exportBox");
        if (box) { box.select(); document.execCommand("copy"); toast("Copiado!"); }
        return;
      }
      if (act === "copyGenerated") {
        const box = $("#genOut");
        if (box) { box.select(); document.execCommand("copy"); toast("Copiado!"); }
        return;
      }
      if (act === "generateItem") return generateItemFromForm(content || getAllContentMerged(activePack));
      if (act === "importGenerated") return importGeneratedFromOut(content || getAllContentMerged(activePack));
      if (act === "saveDiary") return saveDiaryEntry();
    };
  });
}

/* =============================
   14) Admin helpers
============================= */
function generateItemFromForm(content) {
  const type = ($("#genType") && $("#genType").value) || "lesson";
  const rawId = ($("#genId") && $("#genId").value) || "";
  const title = ($("#genTitle") && $("#genTitle").value) || "";
  const tag = ($("#genTag") && $("#genTag").value) || "";
  const cover = ($("#genCover") && $("#genCover").value) || "";
  const xp = Number((($("#genXP") && $("#genXP").value) || 10));
  const min = Number((($("#genMin") && $("#genMin").value) || 6));
  const trackId = ($("#genTrack") && $("#genTrack").value) || "";
  const text = ($("#genText") && $("#genText").value) || "";

  if (!title.trim()) { toast("Título obrigatório."); return; }

  let item = null;
  const id = rawId.trim() || `${type}_${uid().slice(0,8)}`;

  if (type === "lesson") {
    item = {
      id,
      type: "lesson",
      title: title.trim(),
      level: tag.trim() || "Básico",
      tags: tag ? tag.split(",").map(s => s.trim()).filter(Boolean) : [],
      text: text || `# ${title.trim()}\n\nConteúdo em breve.\n`
    };
    // also create track binding hint
    item.__trackId = trackId || "";
  } else if (type === "track") {
    item = {
      id,
      title: title.trim(),
      subtitle: tag.trim() || "",
      icon: cover.trim() || "🧭",
      lessonIds: []
    };
  } else if (type === "library") {
    item = {
      id,
      title: title.trim(),
      tag: tag.trim() || "",
      md: text || `# ${title.trim()}\n\nConteúdo em breve.\n`
    };
  } else if (type === "mission") {
    item = {
      id,
      tag: tag.trim() || "técnica",
      title: title.trim(),
      desc: text ? text.split("\n")[0].trim() : "Descrição em breve.",
      minutes: min || 6,
      xp: xp || 10
    };
  }

  if (!item) { toast("Erro ao gerar."); return; }

  const out = $("#genOut");
  const wrap = $("#genOutWrap");
  if (out && wrap) {
    out.value = safeJSON.stringify(item, 2);
    wrap.style.display = "block";
    toast("JSON gerado.");
  }
}

function importGeneratedFromOut(content) {
  const out = $("#genOut");
  if (!out) return;

  const item = safeJSON.parse(out.value, null);
  if (!item || !item.id) { toast("JSON inválido."); return; }

  // determine type by fields
  const isLesson = item.type === "lesson" || item.text;
  const isTrack = item.lessonIds && Array.isArray(item.lessonIds);
  const isLib = item.md;
  const isMission = item.desc && (item.xp != null);

  store.set(s => {
    const imp = s.customContent.imported;

    if (isMission && !isLesson && !isLib && !isTrack) {
      imp.missions = imp.missions || [];
      imp.missions.push(item);
      return;
    }

    if (isLib && !isLesson && !isTrack) {
      imp.library = imp.library || [];
      imp.library.push(item);
      return;
    }

    if (isTrack && !isLesson) {
      imp.tracks = imp.tracks || [];
      imp.tracks.push(item);
      return;
    }

    if (isLesson) {
      // remove helper __trackId
      const trackId = item.__trackId || "";
      delete item.__trackId;

      imp.lessons = imp.lessons || [];
      imp.lessons.push(item);

      // auto: append lesson id to selected track (custom) if available
      if (trackId) {
        const t = (imp.tracks || []).find(x => x.id === trackId);
        if (t) {
          t.lessonIds = t.lessonIds || [];
          if (!t.lessonIds.includes(item.id)) t.lessonIds.push(item.id);
        }
      }
      return;
    }
  });

  toast("Importado! Atualizando…");
  closeModal();
  render();
}

function saveDiaryEntry() {
  const title = ($("#diaryTitle") && $("#diaryTitle").value) || "Anotação";
  const mood = ($("#diaryMood") && $("#diaryMood").value) || "🙂 bom";
  const note = ($("#diaryNote") && $("#diaryNote").value) || "";

  store.set(s => {
    s.diary.entries = s.diary.entries || [];
    s.diary.entries.push({ id: uid(), iso: todayISO(), title: title.trim(), mood, note: note.trim() });
  });

  toast("Diário salvo.");
  closeModal();
  render();
}

/* =============================
   15) Markdown minimal
============================= */
function mdToHTML(md) {
  const esc = (s) => (s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let out = esc(md || "");

  // headings
  out = out.replace(/^### (.*)$/gm, "<h3>$1</h3>");
  out = out.replace(/^## (.*)$/gm, "<h2>$1</h2>");
  out = out.replace(/^# (.*)$/gm, "<h1>$1</h1>");

  // bold
  out = out.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // hr
  out = out.replace(/^---$/gm, "<hr/>");

  // lists
  out = out.replace(/^\- (.*)$/gm, "<li>$1</li>");
  out = out.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);

  // paragraphs
  out = out.split("\n\n").map(block => {
    if (block.trim().startsWith("<h") || block.trim().startsWith("<ul") || block.trim().startsWith("<hr")) return block;
    return `<p>${block.replace(/\n/g, "<br/>")}</p>`;
  }).join("");

  return out;
}

/* =============================
   16) Global Events
============================= */
window.addEventListener("hashchange", () => render());

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

document.addEventListener("click", (e) => {
  const m = $("#modal");
  if (m && m.classList.contains("open")) {
    const content = $("#modalContent");
    if (content && !content.contains(e.target) && m.contains(e.target)) {
      // click outside
      closeModal();
    }
  }
});
/* =============================
   17) Optional: SW Update UX
============================= */
function setupServiceWorkerUpdateUX() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.getRegistration().then(reg => {
    if (!reg) return;

    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      if (!nw) return;

      nw.addEventListener("statechange", () => {
        if (nw.state === "installed") {
          // if there's an existing controller, it's an update
          if (navigator.serviceWorker.controller) {
            toast("Atualização disponível. Recarregue a página.");
          }
        }
      });
    });
  });
}

/* =============================
   18) Boot
============================= */
function boot() {
  if (!location.hash) setHash("home");
  setupServiceWorkerUpdateUX();
  render();
}

document.addEventListener("DOMContentLoaded", boot);
