/* =========================================================
   IMVpedia Voice — app.js (FINAL)
   ---------------------------------------------------------
   Core:
   - Home / Packs / Pack / Path / Lesson / Missions / Library / Article / Profile / Placement / Admin
   - Packs (DLC): ./packs/index.json + ./packs/<id>/manifest.json (+ markdown inline ou via arquivo)
   - Gamification: XP / Level / Streak / Badges
   - Daily Missions + Weekly + Vocal Diary
   - Placement test integrado ao perfil
   Admin:
   - Gate por senha (default: imvadmin)
   - Editor/import/export de Packs (manifest JSON) guardado em LocalStorage (custom packs)
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

  function bottomSpacer() { return `<div style="height:100px"></div>`; }

  /* =============================
     Storage keys
  ============================= */
  const LS = {
    STATE: "imv_voice_state_final_v1",
    ADMIN: "imv_voice_admin_enabled_v1",
    CUSTOM_PACKS: "imv_voice_custom_packs_v1"
  };

  /* =============================
     Default State
  ============================= */
  const DEFAULT_STATE = {
    meta: {
      createdAt: new Date().toISOString(),
      lastOpenAt: new Date().toISOString(),
      appVersion: "1.0.0",
      contentVersion: "final-merge-v1"
    },
    user: {
      id: uid(),
      name: "",
      avatar: "🎤",
      goal: "Misto",         // Popular | Erudito | Coral | Misto
      levelSelf: "Iniciante",
      levelReal: null,       // Placement result
      minutesPerDay: 10,
      placementDone: false,
      recommendedPath: null
    },
    gamification: {
      xp: 0,
      level: 1,
      streak: 0,
      lastActiveDate: null,
      badges: [] // first_mission, streak_3, streak_7, placement_done, pack_creator
    },
    packs: {
      activePackIds: ["base"],
      seen: {}
    },
    progress: {
      lastRoute: "home",
      completedLessons: {}, // key pack:lesson -> {at}
      continue: null,       // {packId, lessonId}

      todayMission: null,       // {date, packId, templateId, minutesPlanned}
      completedMissions: {},    // date -> {at, packId, templateId, xp}
      week: {}                  // weekStart -> {daysCompleted, diaryNotesCount, claimed:{}}
    },
    diary: {
      lastCheckinDate: null,
      lastStatus: null, // ok|tired|hoarse|pain
      entries: []       // [{date,status,note}]
    },
    placement: {
      answers: {},
      score: 0,
      result: null,
      plan14: [] // [{day,focus,intensity}]
    },
    settings: {
      reduceMotion: false
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
    let level = 1;
    while (xp >= 50 * level * (level - 1)) level++;
    return Math.max(1, level - 1);
  }

  function ensureBadge(draft, id) {
    if (!draft.gamification.badges.includes(id)) {
      draft.gamification.badges.push(id);
      return true;
    }
    return false;
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
    if (draft.gamification.streak >= 3) ensureBadge(draft, "streak_3");
    if (draft.gamification.streak >= 7) ensureBadge(draft, "streak_7");
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
     Markdown (leve e seguro)
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
      if (!t.minutesMin) t.minutesMin = 6;
      if (!t.minutesMax) t.minutesMax = Math.max(t.minutesMin, 12);
      if (!t.xp) t.xp = 10;
      if (!t.kind) t.kind = "técnica";
      if (!t.desc) t.desc = "Complete a missão com conforto vocal.";
    });

    return m;
  }

  async function loadPackIndex() {
    if (packCache.index) return packCache.index;

    let idx = { packs: [] };
    try {
      idx = await fetchJson("./packs/index.json");
    } catch {
      idx = { packs: [] };
    }

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
    if (!arr.length) {
      arr.push(normalizeManifest({
        id: "base",
        title: "Base",
        desc: "Fundamentos essenciais",
        cover: "",
        paths: [{
          id: "base_fund",
          title: "Fundamentos",
          desc: "Respiração, apoio, SOVT, afinação",
          lessons: [
            { id: "apoio", title: "Apoio vocal", md: "# Apoio vocal\n\n- Conceito\n- Sensações\n- Exercícios\n" },
            { id: "sovt", title: "SOVT", md: "# SOVT\n\n- O que é\n- Por que funciona\n- Rotina leve\n" }
          ]
        }],
        library: [
          { id: "fisiologia", title: "Fisiologia vocal", tag: "Saúde", md: "# Fisiologia vocal\n\nConteúdo em breve.\n" }
        ],
        missions: {
          templates: [
            { id: "m_sovt_10", title: "SOVT leve 10 min", minutesMin: 8, minutesMax: 12, xp: 12, kind: "técnica", desc: "Lip trill/humming/canudo com conforto." },
            { id: "m_afina_10", title: "Afinação 10 min", minutesMin: 8, minutesMax: 12, xp: 12, kind: "musical", desc: "Notas longas e ataques suaves." }
          ]
        }
      }));
    }
    return arr;
  }

  function getAllPathsFromManifests(manifests) {
    const paths = [];
    for (const m of manifests) {
      (m.paths || []).forEach(p => paths.push({ packId: m.id, packTitle: m.title, ...p }));
    }
    return paths;
  }

  /* =============================
     Placement Engine
  ============================= */
  const PLACEMENT_QUESTIONS = [
    {
      id: "experience",
      title: "Experiência vocal",
      question: "Há quanto tempo você canta com alguma regularidade?",
      options: [
        { label: "Nunca estudei canto", score: 0 },
        { label: "Menos de 1 ano", score: 1 },
        { label: "1 a 3 anos", score: 2 },
        { label: "Mais de 3 anos", score: 3 }
      ]
    },
    {
      id: "technique",
      title: "Consciência técnica",
      question: "Você já estudou técnica vocal formalmente?",
      options: [
        { label: "Nunca", score: 0 },
        { label: "Pouco / vídeos soltos", score: 1 },
        { label: "Com professor ou método", score: 2 },
        { label: "Estudo contínuo e aplicado", score: 3 }
      ]
    },
    {
      id: "range",
      title: "Extensão confortável",
      question: "Sua voz se mantém confortável em notas médias e agudas?",
      options: [
        { label: "Não, forço ou evito", score: 0 },
        { label: "Às vezes", score: 1 },
        { label: "Sim, com controle", score: 2 },
        { label: "Sim, com facilidade", score: 3 }
      ]
    },
    {
      id: "health",
      title: "Saúde vocal",
      question: "Com que frequência você sente rouquidão ou cansaço?",
      options: [
        { label: "Quase sempre", score: 0 },
        { label: "Às vezes", score: 1 },
        { label: "Raramente", score: 2 },
        { label: "Quase nunca", score: 3 }
      ]
    },
    {
      id: "reading",
      title: "Leitura / percepção",
      question: "Você consegue repetir melodias ou ler cifras/partitura?",
      options: [
        { label: "Tenho muita dificuldade", score: 0 },
        { label: "Consigo com ajuda", score: 1 },
        { label: "Consigo bem", score: 2 },
        { label: "Com facilidade", score: 3 }
      ]
    }
  ];

  function calculatePlacement(score) {
    if (score <= 4) return "Iniciante";
    if (score <= 9) return "Intermediário";
    return "Avançado";
  }

  function buildPlan14(level) {
    const base = {
      Iniciante: ["Respiração funcional", "SOVT leve", "Afinação básica", "Consciência corporal"],
      Intermediário: ["Coordenação ar-voz", "Ressonância", "Agilidade vocal", "Aplicação musical"],
      Avançado: ["Eficiência vocal", "Extensão e dinâmica", "Estilo e interpretação", "Manutenção vocal"]
    };
    const themes = base[level] || base.Iniciante;
    const plan = [];
    for (let i = 0; i < 14; i++) {
      plan.push({ day: i + 1, focus: themes[i % themes.length], intensity: i % 4 === 0 ? "leve" : "moderada" });
    }
    return plan;
  }

  function recommendTrack(goal, level) {
    let minutes = 10;
    let intensity = "moderada";
    if (level === "Intermediário") minutes = 15;
    if (level === "Avançado") minutes = 20;

    if (goal === "Coral") minutes = clamp(minutes, 8, 18);
    if (goal === "Erudito" && level === "Iniciante") minutes = 12;
    if (goal === "Popular" && level === "Avançado") minutes = 22;

    const pathTitle =
      goal === "Popular" ? "Popular — Base e Estilo" :
      goal === "Erudito" ? "Erudito — Técnica e Sustentação" :
      goal === "Coral" ? "Coral — Blend, Afinação e Ritmo" :
      "Misto — Fundamentos universais";

    return { pathTitle, minutes, intensity };
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
     UI components
  ============================= */
  function cardPack(p) {
    const cover = p.cover ? `<img src="${escapeHtml(p.cover)}" alt="" />` : "";
    return `
      <div class="card" data-action="openPack" data-pack="${escapeHtml(p.id)}">
        <div class="card__cover">${cover}</div>
        <div class="card__body">
          <div class="card__title">${escapeHtml(p.title || p.id)}</div>
          <div class="card__desc">${escapeHtml(p.desc || "")}</div>
        </div>
      </div>
    `;
  }

  function rowItem({ icon = "📘", title = "", sub = "", action = "", data = {} }) {
    const dataAttrs = Object.entries(data).map(([k, v]) => `data-${k}="${escapeHtml(String(v))}"`).join(" ");
    return `
      <div class="row" data-action="${escapeHtml(action)}" ${dataAttrs}>
        <div class="row__left">${escapeHtml(icon)}</div>
        <div class="row__body">
          <div class="row__title">${escapeHtml(title)}</div>
          <div class="row__sub">${escapeHtml(sub)}</div>
        </div>
        <div class="row__right">›</div>
      </div>
    `;
  }

  function pill(text, icon = "") {
    return `<span class="pill">${icon ? `${escapeHtml(icon)} ` : ""}${escapeHtml(text)}</span>`;
  }

  /* =============================
     Missions / Week progress / Diary
  ============================= */
  function getWeekState(st, weekStartISO) {
    if (!st.progress.week[weekStartISO]) {
      st.progress.week[weekStartISO] = {
        daysCompleted: 0,
        diaryNotesCount: 0,
        claimed: {}
      };
    }
    return st.progress.week[weekStartISO];
  }

  function markDayCompleted(draft) {
    const today = todayISO();
    const ws = startOfWeekISO(today);
    const w = getWeekState(draft, ws);
    w.daysCompleted = Math.min(7, (w.daysCompleted || 0) + 1);
  }

  function addDiaryEntry(status, note) {
    const date = todayISO();
    store.set(s => {
      s.diary.lastCheckinDate = date;
      s.diary.lastStatus = status;
      s.diary.entries.unshift({ date, status, note: (note || "").slice(0, 400) });

      const ws = startOfWeekISO(date);
      const w = getWeekState(s, ws);
      w.diaryNotesCount = (w.diaryNotesCount || 0) + (note?.trim() ? 1 : 0);
    });
    toast("Check-in registrado");
  }
/* =============================
     Mission selection (templates)
  ============================= */
  async function getMissionTemplates() {
    const mans = await getActiveManifests();
    const out = [];
    for (const m of mans) {
      const t = (m.missions && Array.isArray(m.missions.templates)) ? m.missions.templates : [];
      for (const one of t) out.push({ packId: m.id, packTitle: m.title, ...one });
    }
    if (!out.length) {
      out.push({ packId: "base", id: "m_sovt_10", title: "SOVT leve", minutesMin: 8, minutesMax: 12, xp: 12, kind: "técnica", desc: "Lip trill/humming/canudo com conforto." });
    }
    return out;
  }

  function chooseDailyTemplate(templates) {
    const date = todayISO();
    let seed = 0;
    for (let i = 0; i < date.length; i++) seed += date.charCodeAt(i) * (i + 1);
    const idx = seed % templates.length;
    return templates[idx];
  }

  function ensureTodayMission(draft, template) {
    const date = todayISO();
    if (draft.progress.todayMission && draft.progress.todayMission.date === date) return;

    const minutesPlanned = clamp(
      (draft.user.minutesPerDay || 10),
      template.minutesMin || 6,
      template.minutesMax || 15
    );

    draft.progress.todayMission = {
      date,
      packId: template.packId,
      templateId: template.id,
      minutesPlanned
    };
  }

  function isMissionCompleted(st, dateISO) {
    return !!st.progress.completedMissions[dateISO];
  }

  async function completeTodayMission() {
    const st = store.get();
    const today = todayISO();
    if (isMissionCompleted(st, today)) {
      toast("Missão já concluída hoje");
      return;
    }
    const templates = await getMissionTemplates();
    const chosen = chooseDailyTemplate(templates);

    store.set(s => {
      ensureTodayMission(s, chosen);
      s.progress.completedMissions[today] = {
        at: new Date().toISOString(),
        packId: chosen.packId,
        templateId: chosen.id,
        xp: chosen.xp || 10
      };
      markDayCompleted(s);
      touchStreak(s);
      ensureBadge(s, "first_mission");
    });

    addXP(chosen.xp || 10, "Missão do dia");
  }

  async function swapTodayMission() {
    const templates = await getMissionTemplates();
    if (!templates.length) return;

    store.set(s => {
      const current = s.progress.todayMission;
      let chosen = chooseDailyTemplate(templates);
      if (current && chosen.id === current.templateId) {
        chosen = templates[(templates.findIndex(t => t.id === chosen.id) + 1) % templates.length];
      }
      ensureTodayMission(s, chosen);
      toast("Missão trocada");
    });
    await render();
  }

  /* =============================
     Views — Home / Packs / Pack / Path / Lesson / Library / Article
  ============================= */
  async function viewHome() {
    const idx = await loadPackIndex();

    const templates = await getMissionTemplates();
    const chosen = chooseDailyTemplate(templates);
    store.set(s => ensureTodayMission(s, chosen));
    const st2 = store.get();
    const tm = st2.progress.todayMission;

    const done = isMissionCompleted(st2, todayISO());
    const ws = startOfWeekISO(todayISO());
    const week = st2.progress.week[ws] || { daysCompleted: 0, diaryNotesCount: 0 };

    return `
      <div class="hero">
        <div class="hero__kicker">
          Olá, ${escapeHtml(st2.user.name || "Aluno")} • Nível ${st2.gamification.level} • Streak ${st2.gamification.streak} 🔥
        </div>
        <div class="hero__title">IMVpedia Voice</div>
        <p class="hero__desc">
          Trilha vocal guiada com técnica, saúde e repertório (popular, erudito e coral).
        </p>
        <div class="hero__actions">
          <button class="btn btnPrimary" data-action="goPlacement">
            ${st2.user.placementDone ? "Ver placement" : "Fazer placement"}
          </button>
          <button class="btn" data-action="goProfile">Perfil</button>
        </div>
      </div>

      <div class="section">
        <div class="section__title">Missão do dia</div>
        <div class="panel">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
            <div>
              <div style="color:rgba(233,236,246,.55);font-size:12px;">
                ${escapeHtml(tm?.date || todayISO())} • ${escapeHtml(chosen.kind || "técnica")}
              </div>
              <div style="font-weight:950;font-size:18px;margin-top:2px;">
                ${escapeHtml(chosen.title || "Missão")}
              </div>
              <div style="color:rgba(233,236,246,.72);line-height:1.45;margin-top:6px;">
                ${escapeHtml(chosen.desc || "")}
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;">
              ${pill(`${tm?.minutesPlanned || 10} min`, "⏱️")}
              ${pill(`+${chosen.xp || 10} XP`, "✨")}
            </div>
          </div>

          <div style="height:12px"></div>

          <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
            <button class="btn" data-action="swapMission">Trocar</button>
            <button class="btn btnPrimary" data-action="completeMission" ${done ? "disabled" : ""}>
              ${done ? "Concluída" : "Concluir"}
            </button>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section__title">Semana</div>
        <div class="panel">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <div style="font-weight:900;">${escapeHtml(ws)} →</div>
            <div style="color:rgba(233,236,246,.52);font-size:12px;">progresso semanal</div>
          </div>
          <div style="height:10px"></div>
          <div class="bar"><div class="bar__fill" style="width:${clamp(((week.daysCompleted || 0) / 7) * 100, 0, 100)}%"></div></div>
          <div style="height:10px"></div>
          <div style="color:rgba(233,236,246,.72);line-height:1.45;">
            Missões concluídas: <b>${week.daysCompleted || 0}/7</b><br/>
            Check-ins no diário: <b>${week.diaryNotesCount || 0}</b>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section__title">Packs</div>

        <div style="display:flex;justify-content:flex-end;margin:6px 2px 10px;">
          <button class="btn btn--chip" data-action="nav" data-to="packs">
            Gerenciar packs
          </button>
        </div>

        <div class="cards">
          ${idx.packs.map(cardPack).join("")}
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewPacksManager() {
    const idx = await loadPackIndex();
    const st = store.get();

    const rows = idx.packs.map(p => {
      const active = (st.packs.activePackIds || []).includes(p.id);

      return `
        <div class="panel" style="background:rgba(255,255,255,.03);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div style="min-width:0;">
              <div style="font-weight:950;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${escapeHtml(p.title || p.id)}
              </div>
              <div style="color:rgba(233,236,246,.55);font-size:12px;margin-top:4px;line-height:1.35;">
                ${escapeHtml(p.desc || "")}
              </div>
              <div style="margin-top:8px;color:rgba(233,236,246,.45);font-size:12px;">
                ID: <b>${escapeHtml(p.id)}</b> • ${active ? "Ativo" : "Inativo"}
              </div>
            </div>

            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
              <button class="btn" data-action="openPack" data-pack="${escapeHtml(p.id)}">Abrir</button>
              <button
                class="btn ${active ? "" : "btnPrimary"}"
                data-action="togglePack"
                data-pack="${escapeHtml(p.id)}">
                ${active ? "Desativar" : "Ativar"}
              </button>
            </div>
          </div>
        </div>
      `;
    }).join("");

    return `
      <div class="section">
        <div class="section__title">Gerenciar Packs</div>
        <p class="section__sub">
          Ative/desative packs. Os packs ativos aparecem na Trilha, Biblioteca e Missões.
        </p>

        <div class="panel">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <button class="btn" data-action="nav" data-to="home">← Voltar</button>
            <button class="btn" data-action="admin">Admin</button>
          </div>
        </div>

        <div style="height:12px"></div>

        <div class="list">
          ${rows || `<div class="panel" style="color:rgba(233,236,246,.55);">Nenhum pack encontrado.</div>`}
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewPack(packId) {
    const man = await loadManifest(packId);
    const st = store.get();
    const active = (st.packs.activePackIds || []).includes(packId);

    const paths = (man.paths || []).map(p => rowItem({
      icon: "🎯",
      title: p.title,
      sub: p.desc || "",
      action: "openPath",
      data: { pack: packId, path: p.id }
    })).join("");

    return `
      <div class="section">
        <div class="section__title">${escapeHtml(man.title)}</div>
        <p class="section__sub">${escapeHtml(man.desc || "")}</p>

        <div class="panel" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div>
            <div style="font-weight:900;">Status</div>
            <div style="color:rgba(233,236,246,.62);font-size:13px;margin-top:4px;">
              ${active ? "Ativo (conteúdo aparece na Trilha/Biblioteca/Missões)" : "Inativo (não aparece no app)"}
            </div>
          </div>
          <button class="btn ${active ? "" : "btnPrimary"}" data-action="togglePack" data-pack="${escapeHtml(packId)}">
            ${active ? "Desativar" : "Ativar"}
          </button>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div style="font-weight:950;margin-bottom:8px;">Trilhas</div>
          <div class="list">
            ${paths || `<div style="color:rgba(233,236,246,.55);">Sem trilhas neste pack.</div>`}
          </div>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div style="font-weight:950;margin-bottom:8px;">Biblioteca</div>
          <button class="btn" data-action="openLibrary" data-pack="${escapeHtml(packId)}">Ver artigos</button>
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewPath(packId, pathId) {
    const man = await loadManifest(packId);
    const path = (man.paths || []).find(p => p.id === pathId);
    if (!path) return `<div class="panel">Trilha não encontrada.</div>${bottomSpacer()}`;

    const lessons = (path.lessons || []).map((l, idx) => rowItem({
      icon: "📗",
      title: l.title,
      sub: `Lição ${idx + 1}`,
      action: "openLesson",
      data: { pack: packId, lesson: l.id, path: pathId }
    })).join("");

    return `
      <div class="section">
        <div class="section__title">${escapeHtml(path.title)}</div>
        <p class="section__sub">${escapeHtml(path.desc || "")}</p>

        <div class="panel">
          <div style="font-weight:950;margin-bottom:8px;">Lições</div>
          <div class="list">${lessons}</div>
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewLesson(packId, lessonId) {
    const st = store.get();
    const man = await loadManifest(packId);

    let found = null;
    let pathRef = null;

    for (const p of (man.paths || [])) {
      const l = (p.lessons || []).find(x => x.id === lessonId);
      if (l) { found = l; pathRef = p; break; }
    }
    if (!found) return `<div class="panel">Lição não encontrada.</div>${bottomSpacer()}`;

    const md = await resolveMd(packId, found.md);
    const key = `${packId}:${lessonId}`;
    const done = !!st.progress.completedLessons[key];

    return `
      <div class="section">
        <div class="section__title">${escapeHtml(found.title)}</div>
        <p class="section__sub">${escapeHtml(man.title)} • ${escapeHtml(pathRef?.title || "")}</p>

        <div class="panel md">
          ${mdToHtml(md)}
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div>
              <div style="font-weight:900;">Progresso</div>
              <div style="color:rgba(233,236,246,.62);font-size:13px;margin-top:4px;">
                ${done ? "Lição concluída ✅" : "Ainda não concluída"}
              </div>
            </div>
            <button class="btn ${done ? "" : "btnPrimary"}" data-action="toggleLessonDone" data-pack="${escapeHtml(packId)}" data-lesson="${escapeHtml(lessonId)}">
              ${done ? "Marcar como não concluída" : "Concluir lição"}
            </button>
          </div>
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewLibrary(packId) {
    const man = await loadManifest(packId);

    const tags = Array.from(new Set((man.library || []).map(a => a.tag || "Geral")));
    const chips = tags.map(t => `<button class="btn btn--chip" data-action="filterLib" data-pack="${escapeHtml(packId)}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("");

    const rows = (man.library || []).map(a => rowItem({
      icon: "📚",
      title: a.title,
      sub: a.tag || "Geral",
      action: "openArticle",
      data: { pack: packId, art: a.id }
    })).join("");

    return `
      <div class="section">
        <div class="section__title">Biblioteca</div>
        <p class="section__sub">${escapeHtml(man.title)}</p>

        <div class="panel">
          <div style="font-weight:950;margin-bottom:8px;">Categorias</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">${chips || ""}</div>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div style="font-weight:950;margin-bottom:8px;">Artigos</div>
          <div class="list">${rows || `<div style="color:rgba(233,236,246,.55);">Sem artigos.</div>`}</div>
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewLibraryFiltered(packId, tag) {
    const man = await loadManifest(packId);
    const rows = (man.library || [])
      .filter(a => (a.tag || "Geral") === tag)
      .map(a => rowItem({
        icon: "📚",
        title: a.title,
        sub: a.tag || "Geral",
        action: "openArticle",
        data: { pack: packId, art: a.id }
      })).join("");

    return `
      <div class="section">
        <div class="section__title">Biblioteca</div>
        <p class="section__sub">${escapeHtml(man.title)} • ${escapeHtml(tag)}</p>

        <div class="panel">
          <button class="btn" data-action="openLibrary" data-pack="${escapeHtml(packId)}">← Voltar</button>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div class="list">${rows || `<div style="color:rgba(233,236,246,.55);">Sem artigos nesta categoria.</div>`}</div>
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewArticle(packId, artId) {
    const man = await loadManifest(packId);
    const art = (man.library || []).find(a => a.id === artId);
    if (!art) return `<div class="panel">Artigo não encontrado.</div>${bottomSpacer()}`;

    const md = await resolveMd(packId, art.md);

    return `
      <div class="section">
        <div class="section__title">${escapeHtml(art.title)}</div>
        <p class="section__sub">${escapeHtml(man.title)} • ${escapeHtml(art.tag || "Geral")}</p>

        <div class="panel md">
          ${mdToHtml(md)}
        </div>

        ${bottomSpacer()}
      </div>
    `;
  }
/* =========================================================
     ACTIONS / EVENT BINDING
  ========================================================= */

  function bindActions() {
    document.querySelectorAll("[data-action]").forEach(el => {
      el.onclick = async () => {
        const action = el.dataset.action;

        /* -------- Navegação -------- */
        if (action === "nav") {
          const to = el.dataset.to;
          if (to) setHash(to);
        }

        /* -------- Placement -------- */
        if (action === "goPlacement") {
          setHash("placement");
        }

        if (action === "startPlacement") {
          store.set(s => {
            s.placement.answers = {};
            s.placement.score = 0;
            s.placement.result = null;
          });
          setHash("placement-q", { q: 0 });
        }

        if (action === "answer") {
          const q = Number(el.dataset.q);
          const score = Number(el.dataset.score);

          store.set(s => {
            s.placement.answers[q] = score;
          });

          if (q + 1 < PLACEMENT_QUESTIONS.length) {
            setHash("placement-q", { q: q + 1 });
          } else {
            const res = runPlacementAndBuildResult();
            store.set(s => {
              s.placement.score = res.score;
              s.placement.result = res.result;
              s.placement.plan14 = res.plan14;
              s.user.levelReal = res.result;
              s.user.placementDone = true;
            });
            setHash("placement-result");
          }
        }

        if (action === "finishPlacement") {
          setHash("home");
        }

        /* -------- Packs Manager -------- */
        if (action === "togglePack") {
          const id = el.dataset.pack;
          if (!id) return;

          store.set(s => {
            const arr = s.packs.activePackIds || [];
            if (arr.includes(id)) {
              s.packs.activePackIds = arr.filter(x => x !== id);
            } else {
              s.packs.activePackIds = [...arr, id];
            }
          });

          render();
        }

        /* -------- Lessons -------- */
        if (action === "openLesson") {
          const packId = el.dataset.pack;
          const lessonId = el.dataset.lesson;
          if (packId && lessonId) {
            setHash("lesson", { pack: packId, lesson: lessonId });
          }
        }

        /* -------- Profile -------- */
        if (action === "editProfile") {
          openProfileEditor();
        }
      };
    });
  }

  /* =========================================================
     TABBAR ACTIVE STATE
  ========================================================= */

  function updateTabbarActive(route) {
    document.querySelectorAll(".tabbar__item").forEach(item => {
      const to = item.dataset.to;
      if (!to) return;
      if (route.startsWith(to)) item.classList.add("is-active");
      else item.classList.remove("is-active");
    });
  }

  /* =========================================================
     ROUTER / RENDER
  ========================================================= */

  const app = document.getElementById("view") || document.getElementById("app");

  /* =============================
     VIEW: MISSÕES
     - Tela dedicada para missão do dia + histórico + semana
  ============================= */
  async function viewMissions() {
    const st = store.get();

    // Garante missão do dia
    await ensureTodayMission();

    const st2 = store.get();
    const tm = st2.progress.todayMission;
    const done = st2.progress.completedMissions?.[todayISO()];
    const weekStart = startOfWeekISO(todayISO());
    const week = st2.progress.week?.[weekStart] || { daysCompleted: 0, diaryNotesCount: 0, claimed: {} };

    // Resolve template da missão
    const manifests = await getActiveManifests();
    const allTemplates = [];
    manifests.forEach(m => (m.missions?.templates || []).forEach(t => allTemplates.push({ packId: m.id, packTitle: m.title, ...t })));
    const tpl = allTemplates.find(t => t.packId === tm?.packId && t.id === tm?.templateId) || null;

    const title = tpl?.title || "Missão do dia";
    const kind = tpl?.kind || "técnica";
    const desc = tpl?.desc || "Complete a missão com conforto vocal.";
    const min = tm?.minutesPlanned || 10;
    const xp = tpl?.xp || 10;

    // Últimos 7 dias de histórico
    const hist = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const c = st2.progress.completedMissions?.[iso];
      hist.push({
        date: iso,
        done: !!c,
        xp: c?.xp || 0
      });
    }

    return `
      <div class="hero">
        <div class="hero__kicker">Missões • Hábito diário</div>
        <div class="hero__title">Sua Missão do Dia</div>
        <p class="hero__desc">Complete para ganhar XP e aumentar sua sequência.</p>
        <div class="hero__actions">
          <button class="btn btnPrimary" data-action="${done ? "noop" : "completeTodayMission"}">${done ? "Concluída" : "Concluir"}</button>
          <button class="btn" data-action="swapTodayMission">Trocar</button>
        </div>
      </div>

      <div class="panel">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
          <div>
            <div style="font-size:12px;color:rgba(233,236,246,.52);">${todayISO()} • ${escapeHtml(kind)}</div>
            <div style="font-weight:950;font-size:20px;margin-top:4px;">${escapeHtml(title)}</div>
            <div style="color:rgba(233,236,246,.78);margin-top:6px;line-height:1.45;">${escapeHtml(desc)}</div>
          </div>
          <div style="display:grid;gap:8px;justify-items:end;">
            <div class="pill">${escapeHtml(String(min))} min</div>
            <div class="pill">+${escapeHtml(String(xp))} XP</div>
          </div>
        </div>

        <div style="height:12px"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn" data-action="openDiaryCheckin">Check-in vocal</button>
          <button class="btn" data-action="goPlacement">Placement</button>
        </div>
      </div>

      <div class="panel">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div style="font-weight:900;">Semana</div>
          <div style="color:rgba(233,236,246,.52);font-size:12px;">${escapeHtml(weekStart)} →</div>
        </div>
        <div style="height:10px"></div>
        <div style="color:rgba(233,236,246,.78);line-height:1.6;">
          Missões concluídas: <b>${escapeHtml(String(week.daysCompleted || 0))}/7</b><br/>
          Check-ins no diário: <b>${escapeHtml(String(week.diaryNotesCount || 0))}</b>
        </div>
      </div>

      <div class="panel">
        <div style="font-weight:900;">Últimos 7 dias</div>
        <div style="height:10px"></div>
        <div style="display:grid;gap:8px;">
          ${hist.map(h => `
            <div style="border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);padding:10px 12px;border-radius:14px;display:flex;align-items:center;justify-content:space-between;gap:10px;">
              <div>
                <div style="font-weight:850;">${escapeHtml(h.date)}</div>
                <div style="color:rgba(233,236,246,.52);font-size:12px;">${h.done ? "Concluída" : "Não concluída"}</div>
              </div>
              <div style="color:rgba(233,236,246,.78);font-weight:850;">${h.done ? `+${h.xp} XP` : "—"}</div>
            </div>
          `).join("")}
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }


  async function render() {
    const { route, query } = getRouteAndQuery();
    let html = "";

    switch (route) {
      case "home":
        html = await viewHome();
        break;

      
      case "missions":
        html = await viewMissions();
        break;
case "packs":
        html = await viewPacksManager();
        break;

      case "path":
        html = await viewPaths();
        break;

      
      case "pack":
        html = await viewPack(query.id);
        break;
case "lesson":
        html = await viewLesson(query.pack, query.lesson);
        break;

      case "library":
        html = await viewLibrary();
        break;

      case "article":
        html = await viewArticle(query.pack, query.article);
        break;

      case "profile":
        html = await viewProfile();
        break;

      case "placement":
        html = viewPlacementIntro();
        break;

      case "placement-q":
        html = viewPlacementQuestion(Number(query.q || 0));
        break;

      case "placement-result":
        html = viewPlacementResult(
          store.get().placement.result,
          store.get().placement.score,
          store.get().placement.plan14
        );
        break;

      default:
        html = await viewHome();
    }

    app.innerHTML = html;
    updateTabbarActive(route);
    bindActions();
    updateTabbarActive(route);
  }

  /* =========================================================
     PROFILE EDITOR (MODAL SIMPLES)
  ========================================================= */

  let modalEl = null;

  function openProfileEditor() {
    const st = store.get();
    const u = st.user;

    openModal({
      title: "Editar perfil",
      contentHtml: `
        <label class="lab">Nome</label>
        <input id="pfName" class="input" value="${escapeHtml(u.name || "")}" />

        <div style="height:10px"></div>

        <label class="lab">Objetivo</label>
        <select id="pfGoal" class="input">
          ${["Popular","Erudito","Coral","Misto"].map(g =>
            `<option ${g===u.goal?"selected":""}>${g}</option>`
          ).join("")}
        </select>
      `,
      primaryText: "Salvar",
      secondaryText: "Cancelar",
      onPrimary: () => {
        const name = document.getElementById("pfName").value.trim();
        const goal = document.getElementById("pfGoal").value;

        store.set(s => {
          s.user.name = name || "Aluno";
          s.user.goal = goal;
        });

        closeModal();
        render();
      }
    });
  }

  function openModal({ title, contentHtml, primaryText, secondaryText, onPrimary }) {
    closeModal();

    modalEl = document.createElement("div");
    modalEl.style.position = "fixed";
    modalEl.style.inset = "0";
    modalEl.style.zIndex = "300";
    modalEl.style.background = "rgba(0,0,0,.55)";
    modalEl.style.backdropFilter = "blur(10px)";

    modalEl.innerHTML = `
      <div style="max-width:520px;margin:12vh auto;padding:0 14px;">
        <div style="background:#0e1220;border-radius:18px;border:1px solid rgba(255,255,255,.1);padding:14px;">
          <div style="font-weight:900;margin-bottom:10px;">${escapeHtml(title)}</div>
          ${contentHtml}
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px;">
            ${secondaryText ? `<button class="btn btn--ghost" id="mCancel">${secondaryText}</button>` : ""}
            <button class="btn btnPrimary" id="mOk">${primaryText}</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modalEl);

    document.getElementById("mOk").onclick = onPrimary;
    if (secondaryText) {
      document.getElementById("mCancel").onclick = closeModal;
    }
  }

  function closeModal() {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
  }

  /* =========================================================
     BOOT
  ========================================================= */

  window.addEventListener("hashchange", render);

  document.addEventListener("DOMContentLoaded", () => {
    if (!location.hash) setHash("home");
    render();
  });

})();