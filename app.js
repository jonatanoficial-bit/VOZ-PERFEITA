/* =========================================================
   IMVpedia Voice — app.js (FINAL — Packs + Conteúdo + Admin)
   ---------------------------------------------------------
   - Router (hash)
   - Home / Packs / Trilhas / Lições / Biblioteca / Perfil
   - Placement + Plano 14 dias
   - Missão diária + Diário vocal
   - Packs (DLC): /packs/index.json + /packs/<id>/manifest.json (+ .md)
   - Admin: gate + importar/exportar packs custom (localStorage)
========================================================= */

(() => {
  "use strict";

  /* =============================
     Helpers
  ============================= */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

  const todayISO = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
  };

  function startOfWeekISO(dateISO) {
    const d = new Date(dateISO + "T00:00:00");
    const day = d.getDay(); // 0 dom
    const diff = (day === 0 ? -6 : 1 - day); // monday start
    d.setDate(d.getDate() + diff);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeJsonParse(raw, fallback) {
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  function setHash(route, query = {}) {
    const base = route.startsWith("#/") ? route : `#/${route}`;
    const qs = new URLSearchParams(query).toString();
    const full = qs ? `${base}?${qs}` : base;
    if (location.hash !== full) location.hash = full;
  }

  function getRouteAndQuery() {
    const h = (location.hash || "#/home").trim();
    if (!h.startsWith("#/")) return { route: "home", query: {} };
    const [path, qs] = h.slice(2).split("?");
    return { route: (path || "home"), query: Object.fromEntries(new URLSearchParams(qs || "")) };
  }

  function bottomSpacer() { return `<div style="height:110px"></div>`; }

  /* =============================
     Storage keys + State
  ============================= */
  const LS = {
    STATE: "imv_voice_state_final_v2",
    ADMIN: "imv_voice_admin_enabled_v1",
    CUSTOM_PACKS: "imv_voice_custom_packs_v1"
  };

  const DEFAULT_STATE = {
    meta: {
      createdAt: new Date().toISOString(),
      lastOpenAt: new Date().toISOString(),
      appVersion: "1.1.0",
      contentVersion: "base-pack-v1"
    },
    user: {
      id: uid(),
      name: "Aluno",
      avatar: "🎤",
      goal: "Misto",         // Popular | Erudito | Coral | Misto
      levelReal: null,
      minutesPerDay: 10,
      placementDone: false
    },
    gamification: {
      xp: 0,
      level: 1,
      streak: 0,
      lastActiveDate: null,
      badges: []
    },
    packs: {
      activePackIds: ["base"]
    },
    progress: {
      completedLessons: {},      // key packId:lessonId -> {at}
      todayMission: null,        // {date, title, desc, minutesPlanned, xp}
      completedMissions: {},     // date -> {at, xp}
      week: {}                   // weekStart -> {daysCompleted, diaryNotesCount}
    },
    diary: {
      lastCheckinDate: null,
      lastStatus: null, // ok|tired|hoarse|pain
      entries: []       // [{date,status,note,at}]
    },
    placement: {
      answers: {},
      score: 0,
      result: null,
      plan14: []
    }
  };

  function deepMerge(target, source) {
    if (!source || typeof source !== "object") return target;
    for (const k of Object.keys(source)) {
      const sv = source[k];
      const tv = target[k];
      if (Array.isArray(sv)) target[k] = sv.slice();
      else if (sv && typeof sv === "object" && tv && typeof tv === "object" && !Array.isArray(tv)) {
        target[k] = deepMerge(tv, sv);
      } else target[k] = sv;
    }
    return target;
  }

  function loadState() {
    const raw = localStorage.getItem(LS.STATE);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = safeJsonParse(raw, null);
    if (!parsed || typeof parsed !== "object") return structuredClone(DEFAULT_STATE);
    return deepMerge(structuredClone(DEFAULT_STATE), parsed);
  }

  function persistState(st) {
    try {
      st.meta.lastOpenAt = new Date().toISOString();
      localStorage.setItem(LS.STATE, JSON.stringify(st));
    } catch {}
  }

  const store = {
    state: loadState(),
    listeners: new Set(),
    get() { return this.state; },
    set(mutator) {
      const next = structuredClone(this.state);
      mutator(next);
      this.state = next;
      persistState(this.state);
      this.listeners.forEach(fn => fn(this.state));
    },
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  };

  /* =============================
     Toast
  ============================= */
  let toastTimer = null;
  function toast(msg) {
    const host = $("#toastHost");
    if (!host) return;
    host.innerHTML = `
      <div class="toast" role="status" aria-label="Notificação">
        <div class="toast__dot"></div>
        <div class="toast__msg">${escapeHtml(msg)}</div>
      </div>
    `;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { host.innerHTML = ""; }, 2400);
  }

  /* =============================
     Gamification
  ============================= */
  function computeLevelFromXP(xp) {
    // progressão simples (estável)
    // lvl 1: 0-49, lvl 2: 50-129, lvl 3: 130-239, ...
    let level = 1;
    let need = 50;
    let acc = 0;
    while (xp >= acc + need) {
      acc += need;
      level += 1;
      need = Math.floor(50 + (level - 1) * 30);
    }
    return level;
  }

  function touchStreak(draft) {
    const today = todayISO();
    const last = draft.gamification.lastActiveDate;

    if (last === today) return;

    if (!last) {
      draft.gamification.streak = 1;
      draft.gamification.lastActiveDate = today;
      return;
    }

    const lastD = new Date(last + "T00:00:00");
    const todayD = new Date(today + "T00:00:00");
    const diffDays = Math.round((todayD - lastD) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) draft.gamification.streak += 1;
    else if (diffDays > 1) draft.gamification.streak = 1;

    draft.gamification.lastActiveDate = today;
  }

  function addXP(amount, reason = "") {
    const amt = Math.max(0, Math.floor(amount));
    if (!amt) return;
    store.set(s => {
      s.gamification.xp += amt;
      s.gamification.level = computeLevelFromXP(s.gamification.xp);
      touchStreak(s);
    });
    toast(`+${amt} XP${reason ? ` • ${reason}` : ""}`);
  }

  /* =============================
     Markdown -> HTML (seguro)
  ============================= */
  function mdToHtml(md) {
    const text = String(md ?? "");
    const lines = text.split("\n");
    const out = [];
    let inUl = false;

    const flushUl = () => {
      if (inUl) { out.push("</ul>"); inUl = false; }
    };

    const inline = (s) => {
      let x = escapeHtml(s);
      x = x.replace(/`([^`]+)`/g, "<code>$1</code>");
      x = x.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
      x = x.replace(/\*([^*]+)\*/g, "<i>$1</i>");
      x = x.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, url) => {
        const safe = String(url).trim().replace(/"/g, "");
        return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener">${t}</a>`;
      });
      return x;
    };

    for (const raw of lines) {
      const line = raw.replace(/\r/g, "");
      if (!line.trim()) { flushUl(); out.push("<div style='height:10px'></div>"); continue; }

      if (line.startsWith("### ")) { flushUl(); out.push(`<h3 class="mdh3">${inline(line.slice(4))}</h3>`); continue; }
      if (line.startsWith("## "))  { flushUl(); out.push(`<h2 class="mdh2">${inline(line.slice(3))}</h2>`); continue; }
      if (line.startsWith("# "))   { flushUl(); out.push(`<h1 class="mdh1">${inline(line.slice(2))}</h1>`); continue; }

      if (/^\s*-\s+/.test(line)) {
        if (!inUl) { out.push("<ul class='mdul'>"); inUl = true; }
        out.push(`<li>${inline(line.replace(/^\s*-\s+/, ""))}</li>`);
        continue;
      }

      flushUl();
      out.push(`<p class="mdp">${inline(line)}</p>`);
    }
    flushUl();
    return out.join("\n");
  }

  /* =============================
     Packs (DLC) Loader
  ============================= */
  const packCache = {
    index: null,
    manifests: new Map(),
    md: new Map()
  };

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Falha ao carregar: ${url}`);
    return await res.json();
  }

  async function fetchText(url) {
    if (packCache.md.has(url)) return packCache.md.get(url);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Falha ao carregar texto: ${url}`);
    const t = await res.text();
    packCache.md.set(url, t);
    return t;
  }

  function getCustomPacks() {
    const raw = localStorage.getItem(LS.CUSTOM_PACKS);
    const arr = safeJsonParse(raw, []);
    return Array.isArray(arr) ? arr : [];
  }

  function saveCustomPacks(packsArr) {
    try { localStorage.setItem(LS.CUSTOM_PACKS, JSON.stringify(packsArr || [])); } catch {}
  }

  function normalizeManifest(man) {
    const m = structuredClone(man || {});
    if (!m.id) m.id = "custom_" + uid();
    if (!m.title) m.title = "Pack sem título";
    if (!m.desc) m.desc = "";
    if (!m.cover) m.cover = "";
    if (!Array.isArray(m.paths)) m.paths = [];
    if (!Array.isArray(m.library)) m.library = [];
    if (!m.missions) m.missions = {};
    if (!Array.isArray(m.missions.templates)) m.missions.templates = [];

    m.paths.forEach((p, pi) => {
      if (!p.id) p.id = `path_${pi + 1}`;
      if (!p.title) p.title = `Trilha ${pi + 1}`;
      if (!p.desc) p.desc = "";
      if (!Array.isArray(p.lessons)) p.lessons = [];
      p.lessons.forEach((l, li) => {
        if (!l.id) l.id = `lesson_${li + 1}`;
        if (!l.title) l.title = `Lição ${li + 1}`;
        if (!l.md) l.md = `# ${l.title}\n\nConteúdo em breve.\n`;
      });
    });

    m.library.forEach((a, ai) => {
      if (!a.id) a.id = `art_${ai + 1}`;
      if (!a.title) a.title = `Artigo ${ai + 1}`;
      if (!a.md) a.md = `# ${a.title}\n\nConteúdo em breve.\n`;
      if (!a.tag) a.tag = "Geral";
    });

    m.missions.templates.forEach((t, ti) => {
      if (!t.id) t.id = `m_${ti + 1}`;
      if (!t.title) t.title = `Missão ${ti + 1}`;
      if (t.minutesMin == null) t.minutesMin = 6;
      if (t.minutesMax == null) t.minutesMax = Math.max(t.minutesMin, 12);
      if (t.xp == null) t.xp = 10;
      if (!t.kind) t.kind = "técnica";
      if (!t.desc) t.desc = "Complete a missão com conforto vocal.";
    });

    return m;
  }

  async function loadPackIndex() {
    if (packCache.index) return packCache.index;

    let idx = { packs: [] };
    try { idx = await fetchJson("./packs/index.json"); } catch { idx = { packs: [] }; }
    if (!Array.isArray(idx.packs)) idx.packs = [];

    const custom = getCustomPacks().map(normalizeManifest).map(m => ({
      id: m.id,
      title: m.title,
      cover: m.cover || "",
      desc: m.desc || "",
      isCustom: true
    }));

    packCache.index = { packs: [...idx.packs, ...custom] };
    return packCache.index;
  }

  async function loadManifest(packId) {
    if (packCache.manifests.has(packId)) return packCache.manifests.get(packId);

    const customs = getCustomPacks().map(normalizeManifest);
    const found = customs.find(p => p.id === packId);
    if (found) {
      packCache.manifests.set(packId, found);
      return found;
    }

    const man = normalizeManifest(await fetchJson(`./packs/${encodeURIComponent(packId)}/manifest.json`));
    packCache.manifests.set(packId, man);
    return man;
  }

  async function resolveMd(packId, mdOrPath) {
    const v = String(mdOrPath ?? "");
    if (!v) return "";
    const looksPath = v.includes(".md") || v.startsWith("lessons/") || v.startsWith("library/");
    if (!looksPath) return v;
    const url = `./packs/${encodeURIComponent(packId)}/${v.replace(/^\.\//, "")}`;
    return await fetchText(url);
  }

  async function getActiveManifests() {
    const st = store.get();
    const ids = Array.isArray(st.packs.activePackIds) ? st.packs.activePackIds : ["base"];
    const arr = [];
    for (const id of ids) {
      try { arr.push(await loadManifest(id)); } catch {}
    }
    return arr;
  }

  /* =============================
     Placement
  ============================= */
  const PLACEMENT_QUESTIONS = [
    { id: "experience", title: "Experiência vocal", question: "Há quanto tempo você canta com regularidade?", options: [
      { label: "Nunca estudei", score: 0 },
      { label: "Menos de 1 ano", score: 1 },
      { label: "1 a 3 anos", score: 2 },
      { label: "Mais de 3 anos", score: 3 }
    ]},
    { id: "health", title: "Saúde vocal", question: "Com que frequência você sente rouquidão/cansaço ao cantar?", options: [
      { label: "Quase sempre", score: 0 },
      { label: "Às vezes", score: 1 },
      { label: "Raramente", score: 2 },
      { label: "Quase nunca", score: 3 }
    ]},
    { id: "pitch", title: "Afinação", question: "Você costuma acertar a nota ao repetir uma melodia?", options: [
      { label: "Tenho muita dificuldade", score: 0 },
      { label: "Consigo com esforço", score: 1 },
      { label: "Consigo bem", score: 2 },
      { label: "Com facilidade", score: 3 }
    ]},
    { id: "breath", title: "Fôlego/controle", question: "Você controla o ar sem apertar o pescoço?", options: [
      { label: "Não sei como", score: 0 },
      { label: "Às vezes", score: 1 },
      { label: "Na maioria das vezes", score: 2 },
      { label: "Sim, com consistência", score: 3 }
    ]},
    { id: "repertoire", title: "Repertório", question: "Você canta músicas completas com segurança?", options: [
      { label: "Ainda não", score: 0 },
      { label: "Algumas partes", score: 1 },
      { label: "Sim, com conforto", score: 2 },
      { label: "Sim, com estilo/controle", score: 3 }
    ]}
  ];

  function calculatePlacement(score) {
    if (score <= 5) return "Iniciante";
    if (score <= 11) return "Intermediário";
    return "Avançado";
  }

  function buildPlan14(level) {
    const base = {
      Iniciante: ["Respiração funcional", "SOVT leve", "Afinação básica", "Conforto e postura"],
      Intermediário: ["Coordenação ar-voz", "Ressonância", "Transição de registros", "Aplicação musical"],
      Avançado: ["Eficiência vocal", "Dinâmica e resistência", "Extensão/registro", "Interpretação/estilo"]
    };
    const themes = base[level] || base.Iniciante;
    const plan = [];
    for (let i = 0; i < 14; i++) {
      plan.push({ day: i + 1, focus: themes[i % themes.length], intensity: i % 4 === 0 ? "leve" : "moderada" });
    }
    return plan;
  }

  function runPlacementAndBuildResult() {
    const st = store.get();
    const answers = st.placement.answers || {};
    const score = Object.values(answers).reduce((acc, v) => acc + (Number(v) || 0), 0);
    const result = calculatePlacement(score);
    const plan14 = buildPlan14(result);
    return { score, result, plan14 };
  }

  /* =============================
     Missões diárias + Semana + Diário
  ============================= */
  function pickFrom(arr) {
    if (!arr || !arr.length) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function computeMinutesForMission(userMinutes, template) {
    const base = clamp(Number(userMinutes) || 10, 5, 60);
    const min = clamp(Number(template.minutesMin) || 6, 3, 60);
    const max = clamp(Number(template.minutesMax) || Math.max(min, 12), min, 60);
    return clamp(base, min, max);
  }

  async function ensureTodayMission() {
    const st = store.get();
    const t = todayISO();
    const existing = st.progress.todayMission;
    if (existing && existing.date === t) return existing;

    const manifests = await getActiveManifests();
    const templates = [];
    for (const man of manifests) {
      (man.missions?.templates || []).forEach(tp => templates.push({ packId: man.id, packTitle: man.title, ...tp }));
    }

    const chosen = pickFrom(templates) || {
      packId: "base",
      id: "m_default",
      title: "Missão leve",
      minutesMin: 6,
      minutesMax: 12,
      xp: 10,
      kind: "técnica",
      desc: "Faça um aquecimento leve com conforto."
    };

    const minutesPlanned = computeMinutesForMission(st.user.minutesPerDay, chosen);

    const mission = {
      date: t,
      packId: chosen.packId,
      templateId: chosen.id,
      title: chosen.title,
      kind: chosen.kind,
      desc: chosen.desc,
      minutesPlanned,
      xp: Number(chosen.xp) || 10
    };

    store.set(s => { s.progress.todayMission = mission; });
    return mission;
  }

  function markMissionDone(mission) {
    const t = todayISO();
    store.set(s => {
      if (s.progress.completedMissions[t]) return;

      s.progress.completedMissions[t] = {
        at: new Date().toISOString(),
        xp: mission.xp
      };

      const ws = startOfWeekISO(t);
      if (!s.progress.week[ws]) s.progress.week[ws] = { daysCompleted: 0, diaryNotesCount: 0 };
      s.progress.week[ws].daysCompleted += 1;
    });

    addXP(mission.xp, "Missão");
    toast("Missão concluída ✅");
  }

  function saveDiaryEntry(status, note) {
    const t = todayISO();
    store.set(s => {
      s.diary.lastCheckinDate = t;
      s.diary.lastStatus = status;

      const entry = { date: t, status, note: (note || "").trim(), at: new Date().toISOString() };
      s.diary.entries = Array.isArray(s.diary.entries) ? s.diary.entries : [];

      const idx = s.diary.entries.findIndex(x => x.date === t);
      if (idx >= 0) s.diary.entries[idx] = entry;
      else s.diary.entries.push(entry);

      const ws = startOfWeekISO(t);
      if (!s.progress.week[ws]) s.progress.week[ws] = { daysCompleted: 0, diaryNotesCount: 0 };
      s.progress.week[ws].diaryNotesCount = clamp((s.progress.week[ws].diaryNotesCount || 0) + 1, 0, 99);
    });

    toast("Diário atualizado ✅");
  }

  /* =============================
     Admin (gate + import/export)
  ============================= */
  const ADMIN_PASSWORD = "IMV-ADMIN-2026"; // troque se quiser

  function isAdminEnabled() {
    return localStorage.getItem(LS.ADMIN) === "1";
  }
  function setAdminEnabled(val) {
    try { localStorage.setItem(LS.ADMIN, val ? "1" : "0"); } catch {}
  }

  /* =============================
     UI components
  ============================= */
  function pill(text) { return `<span class="pill">${escapeHtml(text)}</span>`; }

  function viewMissionCard(mission, completed) {
    return `
      <div class="panel">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
          <div>
            <div style="font-weight:950;font-size:18px;">Missão do dia</div>
            <div style="color:rgba(233,236,246,.55);font-size:12px;margin-top:3px;">
              ${escapeHtml(mission.date)} • ${escapeHtml(mission.kind || "técnica")}
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            ${pill(`${mission.minutesPlanned} min`)}
            ${pill(`+${mission.xp} XP`)}
          </div>
        </div>

        <div style="height:10px"></div>
        <div style="color:rgba(233,236,246,.82);line-height:1.5;">
          <b>${escapeHtml(mission.title)}</b><br/>
          ${escapeHtml(mission.desc)}
        </div>

        <div style="height:14px"></div>

        ${completed ? `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <div style="color:rgba(56,211,159,.95);font-weight:850;">Concluída hoje ✅</div>
            <button class="btn" data-action="redoMission">Nova missão</button>
          </div>
        ` : `
          <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;">
            <button class="btn" data-action="redoMission">Trocar</button>
            <button class="btn btnPrimary" data-action="completeMission">Concluir</button>
          </div>
        `}
      </div>
    `;
  }

  function viewWeeklyCard() {
    const st = store.get();
    const ws = startOfWeekISO(todayISO());
    const wk = st.progress.week[ws] || { daysCompleted: 0, diaryNotesCount: 0 };
    const days = clamp(Number(wk.daysCompleted) || 0, 0, 7);

    return `
      <div class="panel">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div style="font-weight:900;">Semana</div>
          <div style="color:rgba(233,236,246,.55);font-size:12px;">${escapeHtml(ws)} →</div>
        </div>
        <div style="height:10px"></div>
        <div class="bar"><div class="bar__fill" style="width:${(days/7)*100}%"></div></div>
        <div style="height:10px"></div>
        <div style="color:rgba(233,236,246,.78);line-height:1.45;">
          Missões concluídas: <b>${days}/7</b><br/>
          Check-ins no diário: <b>${clamp(Number(wk.diaryNotesCount)||0,0,99)}</b>
        </div>
      </div>
    `;
  }

  function cardPack(p) {
    return `
      <div class="card" data-action="openPack" data-pack="${escapeHtml(p.id)}">
        <div class="card__cover">${p.cover ? `<img src="${escapeHtml(p.cover)}" alt="">` : "🎶"}</div>
        <div class="card__body">
          <div class="card__title">${escapeHtml(p.title)}</div>
          <div class="card__desc">${escapeHtml(p.desc || "")}</div>
        </div>
      </div>
    `;
  }

  function cardPath(p) {
    return `
      <div class="card" data-action="openPath" data-pack="${escapeHtml(p.packId)}" data-path="${escapeHtml(p.id)}">
        <div class="card__cover">🎼</div>
        <div class="card__body">
          <div class="card__title">${escapeHtml(p.title)}</div>
          <div class="card__desc">${escapeHtml(p.desc || "")}</div>
        </div>
      </div>
    `;
  }

  function rowLesson(l, packId) {
    return `
      <div class="row" data-action="openLesson" data-pack="${escapeHtml(packId)}" data-lesson="${escapeHtml(l.id)}">
        <div class="row__left">🎤</div>
        <div class="row__body">
          <div class="row__title">${escapeHtml(l.title)}</div>
          <div class="row__sub">Lição</div>
        </div>
        <div class="row__right">›</div>
      </div>
    `;
  }

  function rowArticle(a, packId) {
    return `
      <div class="row" data-action="openArticle" data-pack="${escapeHtml(packId)}" data-article="${escapeHtml(a.id)}">
        <div class="row__left">📘</div>
        <div class="row__body">
          <div class="row__title">${escapeHtml(a.title)}</div>
          <div class="row__sub">${escapeHtml(a.tag || "")}</div>
        </div>
        <div class="row__right">›</div>
      </div>
    `;
  }

  /* =============================
     Views
  ============================= */
  async function viewHome() {
    const st = store.get();
    const idx = await loadPackIndex();
    const mission = await ensureTodayMission();
    const completed = !!st.progress.completedMissions?.[todayISO()];

    return `
      <div class="hero">
        <div class="hero__kicker">
          Olá, ${escapeHtml(st.user.name)} • Nível ${st.gamification.level} • Streak ${st.gamification.streak}🔥
        </div>
        <div class="hero__title">IMVpedia Voice</div>
        <p class="hero__desc">
          Trilha vocal guiada com técnica, saúde e repertório (popular, erudito e coral).
        </p>
        <div class="hero__actions">
          <button class="btn btnPrimary" data-action="goPlacement">
            ${st.user.placementDone ? "Ver placement" : "Fazer placement"}
          </button>
          <button class="btn" data-action="goProfile">Perfil</button>
        </div>
      </div>

      ${viewMissionCard(mission, completed)}
      ${viewWeeklyCard()}

      <div class="section">
        <div class="section__title">Packs</div>
        <div class="cards">
          ${idx.packs.map(cardPack).join("")}
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewPack(packId) {
    const man = await loadManifest(packId);

    return `
      <div class="section">
        <div class="section__title">${escapeHtml(man.title)}</div>
        <p class="section__sub">${escapeHtml(man.desc || "")}</p>

        <div class="section__title">Trilhas</div>
        <div class="cards">
          ${(man.paths || []).map(p => cardPath({ ...p, packId: man.id })).join("")}
        </div>

        <div class="section__title">Biblioteca</div>
        <div class="list">
          ${(man.library || []).map(a => rowArticle(a, man.id)).join("")}
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewPath(packId, pathId) {
    const man = await loadManifest(packId);
    const path = (man.paths || []).find(p => p.id === pathId);
    if (!path) return `<div class="panel">Trilha não encontrada.</div>${bottomSpacer()}`;

    return `
      <div class="section">
        <div class="section__title">${escapeHtml(path.title)}</div>
        <p class="section__sub">${escapeHtml(path.desc || "")}</p>

        <div class="list">
          ${(path.lessons || []).map(l => rowLesson(l, packId)).join("")}
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewLesson(packId, lessonId) {
    const man = await loadManifest(packId);
    const path = (man.paths || []).find(p => (p.lessons || []).some(l => l.id === lessonId));
    if (!path) return `<div class="panel">Lição não encontrada.</div>${bottomSpacer()}`;
    const lesson = (path.lessons || []).find(l => l.id === lessonId);

    const md = await resolveMd(packId, lesson.md);
    const html = mdToHtml(md);

    const key = `${packId}:${lessonId}`;
    const done = !!store.get().progress.completedLessons[key];

    return `
      <div class="panel">
        <div class="panel__title">${escapeHtml(lesson.title)}</div>
        <div class="md">${html}</div>

        <div style="height:14px"></div>
        ${done ? `
          <div style="color:rgba(56,211,159,.95);font-weight:850;">Lição concluída ✅</div>
        ` : `
          <button class="btn btnPrimary" data-action="completeLesson" data-pack="${escapeHtml(packId)}" data-lesson="${escapeHtml(lessonId)}">
            Concluir lição (+10 XP)
          </button>
        `}
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewArticle(packId, articleId) {
    const man = await loadManifest(packId);
    const art = (man.library || []).find(a => a.id === articleId);
    if (!art) return `<div class="panel">Artigo não encontrado.</div>${bottomSpacer()}`;

    const md = await resolveMd(packId, art.md);
    const html = mdToHtml(md);

    return `
      <div class="panel">
        <div class="panel__title">${escapeHtml(art.title)}</div>
        <div class="md">${html}</div>
      </div>

      ${bottomSpacer()}
    `;
  }

  function viewProfile() {
    const st = store.get();
    const u = st.user;
    const g = st.gamification;

    return `
      <div class="section">
        <div class="section__title">Perfil</div>

        <div class="panel">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div>
              <div style="font-weight:950;font-size:18px;">${escapeHtml(u.name)}</div>
              <div style="color:rgba(233,236,246,.55);font-size:12px;margin-top:2px;">
                Objetivo: ${escapeHtml(u.goal)} • Min/dia: ${escapeHtml(String(u.minutesPerDay))}
              </div>
              <div style="color:rgba(233,236,246,.55);font-size:12px;margin-top:2px;">
                Placement: ${u.placementDone ? `✅ ${escapeHtml(u.levelReal || "-")}` : "Pendente"}
              </div>
            </div>
            <div style="font-size:28px;">${escapeHtml(u.avatar)}</div>
          </div>

          <div style="height:12px"></div>

          <div class="grid grid--2">
            <div class="kpi">
              <div>
                <div class="kpi__label">XP</div>
                <div class="kpi__value">${escapeHtml(String(g.xp))}</div>
              </div>
              <div style="font-size:18px;">⚡</div>
            </div>
            <div class="kpi">
              <div>
                <div class="kpi__label">Nível</div>
                <div class="kpi__value">${escapeHtml(String(g.level))}</div>
              </div>
              <div style="font-size:18px;">🏅</div>
            </div>
            <div class="kpi">
              <div>
                <div class="kpi__label">Streak</div>
                <div class="kpi__value">${escapeHtml(String(g.streak))}</div>
              </div>
              <div style="font-size:18px;">🔥</div>
            </div>
            <div class="kpi">
              <div>
                <div class="kpi__label">Packs ativos</div>
                <div class="kpi__value">${escapeHtml(String((st.packs.activePackIds || []).length))}</div>
              </div>
              <div style="font-size:18px;">📦</div>
            </div>
          </div>

          <div style="height:12px"></div>

          <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;">
            <button class="btn" data-action="editProfile">Editar</button>
            <button class="btn" data-action="goDiary">Diário</button>
            <button class="btn btnPrimary" data-action="goPlacement">${u.placementDone ? "Ver placement" : "Fazer placement"}</button>
          </div>
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  function viewDiary() {
    const st = store.get();
    const entries = (st.diary.entries || []).slice().reverse().slice(0, 12);

    return `
      <div class="section">
        <div class="section__title">Diário vocal</div>
        <div class="section__sub">Check-in rápido para proteger a voz.</div>

        <div class="panel">
          <div class="grid grid--2">
            <button class="btn" data-action="diaryQuick" data-status="ok">✅ Ok</button>
            <button class="btn" data-action="diaryQuick" data-status="tired">😮‍💨 Cansado</button>
            <button class="btn" data-action="diaryQuick" data-status="hoarse">😣 Rouco</button>
            <button class="btn" data-action="diaryQuick" data-status="pain">🛑 Dor</button>
          </div>

          <div style="height:10px"></div>
          <textarea id="diaryNote" class="input" rows="3" placeholder="Anote (opcional): como foi a voz hoje?"></textarea>

          <div style="height:10px"></div>
          <div style="display:flex;justify-content:flex-end;">
            <button class="btn btnPrimary" data-action="saveDiaryNote">Salvar nota</button>
          </div>

          <div style="height:10px"></div>
          <div style="color:rgba(233,236,246,.55);font-size:12px;line-height:1.35;">
            Se houver <b>dor</b> ou rouquidão persistente, reduza carga e procure avaliação profissional.
          </div>
        </div>

        <div class="section__title">Últimos registros</div>
        <div class="list">
          ${entries.length ? entries.map(e => `
            <div class="row">
              <div class="row__left">${e.status === "ok" ? "✅" : e.status === "tired" ? "😮‍💨" : e.status === "hoarse" ? "😣" : "🛑"}</div>
              <div class="row__body">
                <div class="row__title">${escapeHtml(e.date)}</div>
                <div class="row__sub">${escapeHtml(e.note || "")}</div>
              </div>
            </div>
          `).join("") : `<div class="panel">Sem registros ainda.</div>`}
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  function viewPlacementIntro() {
    return `
      <div class="panel">
        <div class="panel__title">Teste de Classificação Vocal</div>
        <p style="color:rgba(233,236,246,.78);line-height:1.45;">
          Responda rápido para ajustar sua trilha e gerar um plano de 14 dias.
        </p>
        <div style="height:14px"></div>
        <button class="btn btnPrimary" data-action="startPlacement">Começar</button>
      </div>
      ${bottomSpacer()}
    `;
  }

  function viewPlacementQuestion(qIndex) {
    const q = PLACEMENT_QUESTIONS[qIndex];
    if (!q) return viewPlacementIntro();

    return `
      <div class="panel">
        <div style="font-size:12px;color:rgba(233,236,246,.55);">
          Pergunta ${qIndex + 1} de ${PLACEMENT_QUESTIONS.length}
        </div>
        <div class="panel__title" style="margin-top:6px;">${escapeHtml(q.title)}</div>
        <p style="color:rgba(233,236,246,.78);line-height:1.45;">${escapeHtml(q.question)}</p>

        <div style="margin-top:14px;display:grid;gap:10px;">
          ${q.options.map(o => `
            <button class="btn" data-action="answer" data-q="${qIndex}" data-score="${o.score}">
              ${escapeHtml(o.label)}
            </button>
          `).join("")}
        </div>
      </div>
      ${bottomSpacer()}
    `;
  }

  function viewPlacementResult(result, score, plan14) {
    const st = store.get();
    const goal = st.user.goal || "Misto";

    return `
      <div class="panel">
        <div style="font-size:12px;color:rgba(233,236,246,.55);">Resultado</div>
        <div style="font-weight:980;font-size:22px;margin-top:6px;">${escapeHtml(result)}</div>

        <div style="height:10px"></div>
        <div class="panel" style="background:rgba(255,255,255,.03);">
          <div style="font-weight:900;">Resumo</div>
          <div style="height:8px"></div>
          <div style="color:rgba(233,236,246,.78);line-height:1.5;">
            Objetivo: <b>${escapeHtml(goal)}</b><br/>
            Pontuação: <b>${escapeHtml(String(score))}</b><br/>
            Plano inicial: <b>14 dias</b>
          </div>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div style="font-weight:900;">Plano (14 dias)</div>
          <div style="height:10px"></div>
          <div style="display:grid;gap:8px;">
            ${plan14.map(p => `
              <div style="border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);padding:10px 12px;border-radius:14px;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                  <div style="font-weight:850;">Dia ${p.day}: ${escapeHtml(p.focus)}</div>
                  <div style="color:rgba(233,236,246,.55);font-size:12px;">
                    ${p.intensity === "leve" ? "Leve" : "Moderado"}
                  </div>
                </div>
              </div>
            `).join("")}
          </div>
        </div>

        <div style="height:14px"></div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;">
          <button class="btn" data-action="restartPlacement">Refazer</button>
          <button class="btn btnPrimary" data-action="savePlacement">Salvar</button>
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  function viewAdmin() {
    const enabled = isAdminEnabled();

    if (!enabled) {
      return `
        <div class="section">
          <div class="section__title">Admin</div>
          <div class="panel">
            <div style="font-weight:900;">Acesso</div>
            <div style="color:rgba(233,236,246,.72);line-height:1.45;margin-top:8px;">
              Digite a senha para liberar o editor de packs (DLC).
            </div>

            <div style="height:12px"></div>

            <input id="adminPass" class="input" type="password" placeholder="Senha do admin" />
            <div style="height:10px"></div>
            <div style="display:flex;justify-content:flex-end;">
              <button class="btn btnPrimary" data-action="adminEnable">Ativar</button>
            </div>

            <div style="color:rgba(233,236,246,.45);font-size:12px;margin-top:10px;">
              Senha padrão: <code>IMV-ADMIN-2026</code> (troque no app.js)
            </div>
          </div>
        </div>
        ${bottomSpacer()}
      `;
    }

    return `
      <div class="section">
        <div class="section__title">Admin • Packs</div>
        <div class="panel">
          <div style="font-weight:900;">Importar pack (JSON)</div>
          <div style="color:rgba(233,236,246,.55);font-size:12px;line-height:1.35;margin-top:6px;">
            Cole um manifest JSON aqui para salvar como pack custom no dispositivo.
          </div>
          <div style="height:10px"></div>
          <textarea id="importJson" class="input" rows="10" placeholder='{"id":"meu_pack","title":"...","paths":[...],"library":[...],"missions":{"templates":[...]}}'></textarea>
          <div style="height:10px"></div>
          <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
            <button class="btn" data-action="adminDisable">Desativar</button>
            <button class="btn btnPrimary" data-action="adminImportPack">Importar</button>
          </div>
        </div>

        <div class="panel">
          <div style="font-weight:900;">Exportar packs custom</div>
          <div style="color:rgba(233,236,246,.55);font-size:12px;line-height:1.35;margin-top:6px;">
            Copie o JSON exibido para criar um DLC real no GitHub (<code>/packs/&lt;id&gt;/manifest.json</code>).
          </div>
          <div style="height:10px"></div>
          <button class="btn" data-action="adminShowCustomPacks">Mostrar JSON</button>
          <div id="customOut" style="margin-top:10px;"></div>
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  /* =============================
     Modal simples (perfil)
  ============================= */
  let modalEl = null;
  function closeModal() { if (modalEl) { modalEl.remove(); modalEl = null; } }

  function openModal({ title, contentHtml, primaryText, secondaryText, onPrimary, onSecondary }) {
    closeModal();
    modalEl = document.createElement("div");
    modalEl.style.position = "fixed";
    modalEl.style.inset = "0";
    modalEl.style.zIndex = "300";
    modalEl.style.background = "rgba(0,0,0,.55)";
    modalEl.style.backdropFilter = "blur(10px)";
    modalEl.innerHTML = `
      <div style="max-width:560px;margin:10vh auto;padding:0 14px;">
        <div style="border:1px solid rgba(255,255,255,.10);border-radius:18px;background:rgba(17,21,34,.92);box-shadow:0 18px 60px rgba(0,0,0,.55);overflow:hidden;">
          <div style="padding:14px 14px 10px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <div style="font-weight:860;letter-spacing:.2px;">${escapeHtml(title || "")}</div>
            <button id="mClose" class="btn btn--ghost" type="button">✕</button>
          </div>
          <div style="padding:14px;">
            ${contentHtml || ""}
            <div style="height:14px"></div>
            <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
              ${secondaryText ? `<button id="mSecondary" class="btn" type="button">${escapeHtml(secondaryText)}</button>` : ""}
              ${primaryText ? `<button id="mPrimary" class="btn btnPrimary" type="button">${escapeHtml(primaryText)}</button>` : ""}
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);

    $("#mClose", modalEl)?.addEventListener("click", () => { onSecondary?.(); closeModal(); });
    $("#mSecondary", modalEl)?.addEventListener("click", () => { onSecondary?.(); closeModal(); });
    $("#mPrimary", modalEl)?.addEventListener("click", () => onPrimary?.());
    modalEl.addEventListener("click", (e) => { if (e.target === modalEl) closeModal(); });
  }

  function openProfileEditor() {
    const st = store.get();
    const u = st.user;

    const html = `
      <label class="lab">Nome</label>
      <input id="pfName" class="input" type="text" value="${escapeHtml(u.name || "")}" />

      <div style="height:10px"></div>

      <div class="grid grid--2">
        <div>
          <label class="lab">Objetivo</label>
          <select id="pfGoal" class="input">
            ${["Popular","Erudito","Coral","Misto"].map(x => `<option ${x===u.goal?"selected":""}>${x}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="lab">Minutos/dia</label>
          <input id="pfMin" class="input" type="number" min="5" max="60" step="1" value="${escapeHtml(String(u.minutesPerDay || 10))}" />
        </div>
      </div>
    `;

    openModal({
      title: "Editar Perfil",
      contentHtml: html,
      primaryText: "Salvar",
      secondaryText: "Cancelar",
      onPrimary: () => {
        const name = ($("#pfName")?.value || "").trim();
        const goal = ($("#pfGoal")?.value || "Misto").trim();
        const min = clamp(parseInt($("#pfMin")?.value || "10", 10) || 10, 5, 60);

        store.set(s => {
          s.user.name = name || "Aluno";
          s.user.goal = goal;
          s.user.minutesPerDay = min;
        });

        closeModal();
        render();
      }
    });
  }

  /* =============================
     Router + Render
  ============================= */
  const appRoot = document.getElementById("app");

  async function render() {
    const { route, query } = getRouteAndQuery();

    let html = "";
    try {
      switch (route) {
        case "home": html = await viewHome(); break;
        case "pack": html = await viewPack(query.id || "base"); break;
        case "path": html = await viewPath(query.pack, query.path); break;
        case "lesson": html = await viewLesson(query.pack, query.lesson); break;
        case "article": html = await viewArticle(query.pack, query.article); break;
        case "profile": html = viewProfile(); break;
        case "diary": html = viewDiary(); break;
        case "placement": html = viewPlacementIntro(); break;
        case "placement-q": html = viewPlacementQuestion(Number(query.q || 0)); break;
        case "placement-result": {
          const r = runPlacementAndBuildResult();
          html = viewPlacementResult(r.result, r.score, r.plan14);
          break;
        }
        case "admin": html = viewAdmin(); break;
        default: html = await viewHome();
      }
    } catch (e) {
      console.error(e);
      html = `<div class="panel">Erro ao carregar a tela. Verifique se os arquivos em /packs existem.</div>${bottomSpacer()}`;
    }

    appRoot.innerHTML = html;
    bindActions();
  }

  window.addEventListener("hashchange", render);
  store.subscribe(() => { /* persist já ocorre em store.set */ });

  /* =============================
     Actions
  ============================= */
  function bindActions() {
    $$("[data-action]").forEach(el => {
      el.onclick = async () => {
        const a = el.dataset.action;

        switch (a) {
          case "openPack":
            setHash("pack", { id: el.dataset.pack });
            break;

          case "openPath":
            setHash("path", { pack: el.dataset.pack, path: el.dataset.path });
            break;

          case "openLesson":
            setHash("lesson", { pack: el.dataset.pack, lesson: el.dataset.lesson });
            break;

          case "openArticle":
            setHash("article", { pack: el.dataset.pack, article: el.dataset.article });
            break;

          case "goProfile":
            setHash("profile");
            break;

          case "goDiary":
            setHash("diary");
            break;

          case "goPlacement":
            setHash("placement");
            break;

          case "startPlacement":
            store.set(s => { s.placement.answers = {}; });
            setHash("placement-q", { q: 0 });
            break;

          case "answer": {
            const q = Number(el.dataset.q);
            const score = Number(el.dataset.score);
            store.set(s => { s.placement.answers[q] = score; });

            if (q + 1 < PLACEMENT_QUESTIONS.length) setHash("placement-q", { q: q + 1 });
            else setHash("placement-result");
            break;
          }

          case "restartPlacement":
            store.set(s => { s.placement.answers = {}; });
            setHash("placement-q", { q: 0 });
            break;

          case "savePlacement": {
            const r = runPlacementAndBuildResult();
            store.set(s => {
              s.user.levelReal = r.result;
              s.user.placementDone = true;
              s.placement.result = r.result;
              s.placement.score = r.score;
              s.placement.plan14 = r.plan14;
            });
            addXP(15, "Placement");
            setHash("home");
            break;
          }

          case "completeLesson": {
            const key = `${el.dataset.pack}:${el.dataset.lesson}`;
            const already = !!store.get().progress.completedLessons[key];
            if (!already) {
              store.set(s => { s.progress.completedLessons[key] = { at: new Date().toISOString() }; });
              addXP(10, "Lição");
            } else toast("Você já concluiu esta lição.");
            render();
            break;
          }

          case "completeMission": {
            const st = store.get();
            if (st.progress.todayMission) markMissionDone(st.progress.todayMission);
            render();
            break;
          }

          case "redoMission":
            store.set(s => { s.progress.todayMission = null; });
            render();
            break;

          case "diaryQuick":
            saveDiaryEntry(el.dataset.status, "");
            render();
            break;

          case "saveDiaryNote": {
            const note = $("#diaryNote")?.value || "";
            const status = store.get().diary.lastStatus || "ok";
            saveDiaryEntry(status, note);
            render();
            break;
          }

          case "editProfile":
            openProfileEditor();
            break;

          case "adminEnable": {
            const pass = $("#adminPass")?.value || "";
            if (pass === ADMIN_PASSWORD) {
              setAdminEnabled(true);
              toast("Admin ativado");
              render();
            } else toast("Senha incorreta");
            break;
          }

          case "adminDisable":
            setAdminEnabled(false);
            toast("Admin desativado");
            render();
            break;

          case "adminImportPack": {
            const raw = $("#importJson")?.value || "";
            const parsed = safeJsonParse(raw, null);
            if (!parsed) { toast("JSON inválido"); return; }
            const norm = normalizeManifest(parsed);

            const all = getCustomPacks().map(normalizeManifest);
            const idx = all.findIndex(p => p.id === norm.id);
            if (idx >= 0) all[idx] = norm;
            else all.push(norm);

            saveCustomPacks(all);
            packCache.index = null;
            packCache.manifests.delete(norm.id);
            toast("Pack importado ✅");
            render();
            break;
          }

          case "adminShowCustomPacks": {
            const out = $("#customOut");
            if (!out) return;
            const all = getCustomPacks().map(normalizeManifest);
            const text = JSON.stringify(all, null, 2);
            out.innerHTML = `
              <div class="lab">JSON (custom packs)</div>
              <textarea class="input" rows="12" style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${escapeHtml(text)}</textarea>
            `;
            toast("JSON exibido");
            break;
          }
        }
      };
    });
  }

  /* =============================
     Boot
  ============================= */
  function boot() {
    // garante missão do dia (pré-aquecimento)
    store.set(s => { s.gamification.level = computeLevelFromXP(s.gamification.xp); });

    if (!location.hash) setHash("home");
    render();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();