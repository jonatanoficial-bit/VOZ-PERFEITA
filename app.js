// ===== IMVpedia Voice — app.js (PARTE 6/6) — BLOCO 1/6 =====
/* =========================================================
   IMVpedia Voice — MERGE FINAL COMPLETO + ADMIN PACK EDITOR
   ---------------------------------------------------------
   Core:
   - Home / Path / Lesson / Missions / Library / Article / Profile / Placement / Admin
   - Packs (DLC): ./packs/index.json + ./packs/<id>/manifest.json (+ lessons/articles markdown)
   - Gamification: XP / Level / Streak / Badges
   - Daily Missions + Weekly Challenges + Vocal Diary
   - Placement test (Duolingo-like) integrado ao perfil
   Admin:
   - Gate por senha
   - Editor/import/export de Packs (manifest + missions + markdown templates)
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

  // garante que nada fique escondido atrás da tabbar
  function bottomSpacer() { return `<div style="height:100px"></div>`; }

  /* =============================
     Storage keys
  ============================= */
  const LS = {
    STATE: "imv_voice_state_final_v1",
    ADMIN: "imv_voice_admin_enabled_v1",
    CUSTOM_PACKS: "imv_voice_custom_packs_v1" // rascunhos/editáveis
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
      activePackIds: ["base"], // DLC
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
     - Suporta: títulos # ## ###, negrito, itálico, código inline, listas, links
     - Não executa HTML arbitrário (seguro)
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
     Estrutura esperada:
     - /packs/index.json  -> { packs:[{id,title,cover,desc,enabledDefault}] }
     - /packs/<id>/manifest.json ->
         { id,title,desc,cover,paths:[{id,title,desc,lessons:[{id,title,md}] }], library:[{id,title,md,tag}] ,
           missions:{ templates:[{id,title,minutesMin,minutesMax,xp,kind,desc}] } }
     Observação: "md" pode ser caminho .md (ex: "lessons/apoio.md") ou texto markdown direto.
  ============================= */
  const packCache = {
    index: null,
    manifests: new Map(),  // id -> manifest
    md: new Map()          // url -> text
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

    // garante ids
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

    // inclui packs de /packs/index.json + packs custom do LS
    let idx = { packs: [] };
    try {
      idx = await fetchJson("./packs/index.json");
    } catch {
      // se não existir, continua só com custom
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

    // tenta custom primeiro
    const customs = getCustomPacks().map(normalizeManifest);
    const found = customs.find(p => p.id === packId);
    if (found) {
      packCache.manifests.set(packId, found);
      return found;
    }

    // depois fetch normal
    const man = normalizeManifest(await fetchJson(`./packs/${encodeURIComponent(packId)}/manifest.json`));

    // resolve md paths (lazy: só quando abrir lição/artigo; aqui deixa como está)
    packCache.manifests.set(packId, man);
    return man;
  }

  async function resolveMd(packId, mdOrPath) {
    // se parece caminho .md, busca em ./packs/<id>/<path>
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
    // se nada carregou, cria base mínima (em memória)
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
     Placement Engine (integrado)
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
    // conta dias completados no array de missões do weekStart, mas simplificado:
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
     Mission selection (template)
  ============================= */
  async function getMissionTemplates() {
    const mans = await getActiveManifests();
    const out = [];
    for (const m of mans) {
      const t = (m.missions && Array.isArray(m.missions.templates)) ? m.missions.templates : [];
      for (const one of t) out.push({ packId: m.id, packTitle: m.title, ...one });
    }
    // fallback
    if (!out.length) {
      out.push({ packId: "base", templateId: "m_sovt_10", id: "m_sovt_10", title: "SOVT leve", minutesMin: 8, minutesMax: 12, xp: 12, kind: "técnica", desc: "Lip trill/humming/canudo com conforto." });
    }
    return out;
  }

  function chooseDailyTemplate(templates) {
    // determinístico por dia (para não mudar ao recarregar)
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
      s.progress.completedMissions[today] = { at: new Date().toISOString(), packId: chosen.packId, templateId: chosen.id, xp: chosen.xp || 10 };
      markDayCompleted(s);
      touchStreak(s);
      ensureBadge(s, "first_mission");
    });

    addXP(chosen.xp || 10, "Missão do dia");
  }

  async function swapTodayMission() {
    const templates = await getMissionTemplates();
    if (!templates.length) return;

    // pega outra missão diferente (melhor esforço)
    store.set(s => {
      const today = todayISO();
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
     Views — Home / Packs / Paths / Lessons / Library / Profile
  ============================= */
  async function viewHome() {
    const st = store.get();
    const idx = await loadPackIndex();

    // mission
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
        <div class="cards">
          ${idx.packs.map(cardPack).join("")}
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
    if (!path) return `
      <div class="panel">Trilha não encontrada.</div>
      ${bottomSpacer()}
    `;

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

  function viewProfile() {
    const st = store.get();
    const u = st.user;

    const badges = (st.gamification.badges || []).map(b => pill(b.replaceAll("_", " "), "🏷️")).join(" ");

    return `
      <div class="section">
        <div class="section__title">Perfil</div>
        <p class="section__sub">Configurações do aluno</p>

        <div class="panel">
          <label class="lab">Nome</label>
          <input id="pfName" class="input" type="text" placeholder="Seu nome" value="${escapeHtml(u.name || "")}" />

          <div style="height:10px"></div>

          <div class="grid grid--2">
            <div>
              <label class="lab">Objetivo</label>
              <select id="pfGoal" class="input">
                ${["Popular","Erudito","Coral","Misto"].map(x => `<option ${x === u.goal ? "selected" : ""}>${x}</option>`).join("")}
              </select>
            </div>

            <div>
              <label class="lab">Minutos/dia</label>
              <input id="pfMin" class="input" type="number" min="5" max="60" step="1" value="${escapeHtml(String(u.minutesPerDay || 10))}" />
            </div>
          </div>

          <div style="height:12px"></div>

          <button class="btn btnPrimary" data-action="saveProfile">Salvar</button>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div style="font-weight:950;font-size:16px;">Gamificação</div>
          <div style="height:10px"></div>
          <div class="grid grid--2">
            <div class="kpi">
              <div>
                <div class="kpi__label">XP</div>
                <div class="kpi__value">${st.gamification.xp}</div>
              </div>
              <div style="font-size:18px;">✨</div>
            </div>

            <div class="kpi">
              <div>
                <div class="kpi__label">Nível</div>
                <div class="kpi__value">${st.gamification.level}</div>
              </div>
              <div style="font-size:18px;">🏅</div>
            </div>

            <div class="kpi">
              <div>
                <div class="kpi__label">Streak</div>
                <div class="kpi__value">${st.gamification.streak}</div>
              </div>
              <div style="font-size:18px;">🔥</div>
            </div>

            <div class="kpi">
              <div>
                <div class="kpi__label">Placement</div>
                <div class="kpi__value">${u.placementDone ? "OK" : "—"}</div>
              </div>
              <div style="font-size:18px;">🧪</div>
            </div>
          </div>

          <div style="height:12px"></div>

          <div style="color:rgba(233,236,246,.55);font-size:12px;">Badges:</div>
          <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;">
            ${badges || `<span style="color:rgba(233,236,246,.45);">Nenhum ainda.</span>`}
          </div>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div style="font-weight:950;font-size:16px;">Diário Vocal</div>
          <div style="color:rgba(233,236,246,.55);font-size:12px;margin-top:6px;">
            Registre como está sua voz hoje.
          </div>

          <div style="height:10px"></div>

          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button class="btn" data-action="diary" data-status="ok">✅ Sem desconforto</button>
            <button class="btn" data-action="diary" data-status="tired">😮‍💨 Cansado</button>
            <button class="btn" data-action="diary" data-status="hoarse">🗣️ Rouquidão</button>
            <button class="btn" data-action="diary" data-status="pain">⚠️ Dor</button>
          </div>

          <div style="height:10px"></div>
          <textarea id="diaryNote" class="input" rows="3" placeholder="Notas (opcional)"></textarea>
          <div style="height:10px"></div>

          <button class="btn btnPrimary" data-action="saveDiary">Salvar check-in</button>
        </div>

        ${bottomSpacer()}
      </div>
    `;
  }

  function viewDiary() {
    const st = store.get();
    const entries = (st.diary.entries || []).slice(0, 20);

    const rows = entries.map(e => `
      <div class="panel" style="background:rgba(255,255,255,.03);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div style="font-weight:900;">${escapeHtml(e.date)}</div>
          <div style="color:rgba(233,236,246,.55);font-size:12px;">${escapeHtml(e.status)}</div>
        </div>
        ${e.note ? `<div style="margin-top:8px;color:rgba(233,236,246,.78);line-height:1.45;">${escapeHtml(e.note)}</div>` : ""}
      </div>
    `).join("");

    return `
      <div class="section">
        <div class="section__title">Diário</div>
        <p class="section__sub">Histórico de check-ins</p>
        <div class="list">
          ${rows || `<div class="panel" style="color:rgba(233,236,246,.55);">Sem registros ainda.</div>`}
        </div>
      </div>
      ${bottomSpacer()}
    `;
  }

  /* =============================
     Views — Placement
  ============================= */
  function viewPlacementIntro() {
    return `
      <div class="panel">
        <div style="font-weight:900;font-size:18px;">Teste de Classificação Vocal</div>
        <p style="color:rgba(233,236,246,.78);line-height:1.45;margin-top:10px;">
          Este teste rápido ajuda o app a ajustar sua trilha, intensidade e missões.
        </p>
        <p style="color:rgba(233,236,246,.52);font-size:13px;">
          Não é um teste de talento, e sim de ponto de partida.
        </p>
        <div style="height:16px"></div>
        <button class="btn btnPrimary" data-action="startPlacement">Começar</button>
      </div>
      ${bottomSpacer()}
    `;
  }

  function viewPlacementQuestion(qIndex) {
    const q = PLACEMENT_QUESTIONS[qIndex];
    if (!q) return "";

    return `
      <div class="panel">
        <div style="font-size:12px;color:rgba(233,236,246,.52);">
          Pergunta ${qIndex + 1} de ${PLACEMENT_QUESTIONS.length}
        </div>
        <div style="font-weight:900;font-size:17px;margin-top:6px;">
          ${escapeHtml(q.title)}
        </div>
        <p style="color:rgba(233,236,246,.78);line-height:1.45;">
          ${escapeHtml(q.question)}
        </p>

        <div style="margin-top:14px;display:grid;gap:10px;">
          ${q.options.map((o) => `
            <button class="btn" data-action="answer"
                    data-q="${qIndex}"
                    data-score="${o.score}">
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

    const tipsByLevel = {
      Iniciante: [
        "Priorize conforto e consistência (5–12 min/dia).",
        "Use SOVT (lip trill/humming/canudo) para aquecer.",
        "Evite volume alto: qualidade > força.",
        "Se houver dor, pare e reduza carga."
      ],
      Intermediário: [
        "Trabalhe transições de registro (leve, sem empurrar).",
        "Inclua afinação aplicada (notas longas e ataques limpos).",
        "Aumente repertório gradualmente (trechos curtos).",
        "Mantenha 1–2 dias mais leves por semana."
      ],
      Avançado: [
        "Otimize eficiência (menos esforço, mais resultado).",
        "Trabalhe dinâmica e resistência sem apertar.",
        "Refine estilo e interpretação com intenção clara.",
        "Monitore sinais de fadiga e ajuste o treino."
      ]
    };

    const rec = recommendTrack(goal, result);

    return `
      <div class="panel">
        <div style="font-size:12px;color:rgba(233,236,246,.52);">Resultado do teste</div>
        <div style="font-weight:950;font-size:22px;margin-top:6px;">
          ${escapeHtml(result)}
        </div>

        <div style="height:10px"></div>

        <div class="panel" style="background:rgba(255,255,255,.03);">
          <div style="font-weight:900;">Recomendação</div>
          <div style="height:8px"></div>
          <div style="color:rgba(233,236,246,.78);line-height:1.45;">
            Objetivo: <b>${escapeHtml(goal)}</b><br/>
            Trilha sugerida: <b>${escapeHtml(rec.pathTitle)}</b><br/>
            Intensidade padrão: <b>${escapeHtml(rec.intensity)}</b><br/>
            Minutos sugeridos: <b>${escapeHtml(String(rec.minutes))} min/dia</b>
          </div>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div style="font-weight:900;">Dicas rápidas</div>
          <div style="height:8px"></div>
          <div style="color:rgba(233,236,246,.78);line-height:1.5;">
            ${(tipsByLevel[result] || tipsByLevel.Iniciante).map(t => `• ${escapeHtml(t)}`).join("<br/>")}
          </div>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div style="font-weight:900;">Plano inicial (14 dias)</div>
          <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:6px;">
            Alterna dias leves e moderados para criar hábito e proteger a voz.
          </div>
          <div style="height:10px"></div>
          <div style="display:grid;gap:8px;">
            ${plan14.map(p => `
              <div style="border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);padding:10px 12px;border-radius:14px;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                  <div style="font-weight:850;">Dia ${p.day}: ${escapeHtml(p.focus)}</div>
                  <div style="color:rgba(233,236,246,.52);font-size:12px;">
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
          <button class="btn btnPrimary" data-action="savePlacement">Salvar e continuar</button>
        </div>
      </div>
      ${bottomSpacer()}
    `;
  }

  /* =============================
     Admin (packs editor/import/export)
  ============================= */
  function isAdminEnabled() {
    return localStorage.getItem(LS.ADMIN) === "1";
  }

  function setAdminEnabled(v) {
    localStorage.setItem(LS.ADMIN, v ? "1" : "0");
  }

  function adminPrompt() {
    openModal({
      title: "Admin",
      contentHtml: `
        <div style="color:rgba(233,236,246,.72);line-height:1.45;">
          Digite a senha para habilitar o modo Admin.
        </div>
        <div style="height:10px"></div>
        <input id="admPwd" class="input" type="password" placeholder="Senha" />
        <div style="height:10px"></div>
        <div style="color:rgba(233,236,246,.45);font-size:12px;">
          Dica: você pode trocar essa senha no app.js depois.
        </div>
      `,
      primaryText: "Entrar",
      secondaryText: "Cancelar",
      onPrimary: () => {
        const pwd = ($("#admPwd")?.value || "").trim();
        if (pwd === "imvadmin") {
          setAdminEnabled(true);
          closeModal();
          toast("Admin habilitado");
          setHash("admin");
        } else {
          toast("Senha incorreta");
        }
      }
    });
  }

  async function viewAdminEditor() {
    const enabled = isAdminEnabled();
    if (!enabled) {
      return `
        <div class="panel">
          <div style="font-weight:950;font-size:18px;">Admin</div>
          <p style="color:rgba(233,236,246,.72);line-height:1.45;margin-top:8px;">
            Habilite o modo Admin para editar/importar packs (DLC).
          </p>
          <button class="btn btnPrimary" data-action="adminLogin">Entrar</button>
        </div>
        ${bottomSpacer()}
      `;
    }

    const idx = await loadPackIndex();
    const customs = getCustomPacks().map(normalizeManifest);

    const packRows = idx.packs.map(p => {
      const isCustom = !!p.isCustom || p.id.startsWith("custom_");
      return `
        <div class="panel" style="background:rgba(255,255,255,.03);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div style="min-width:0;">
              <div style="font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${escapeHtml(p.title || p.id)}
              </div>
              <div style="color:rgba(233,236,246,.55);font-size:12px;margin-top:4px;">
                id: <b>${escapeHtml(p.id)}</b> ${isCustom ? "• custom" : "• arquivo"}
              </div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              <button class="btn btn--tiny" data-action="adminOpenPack" data-pack="${escapeHtml(p.id)}">Editar</button>
              ${isCustom ? `<button class="btn btn--tiny" data-action="adminDeletePack" data-pack="${escapeHtml(p.id)}">Excluir</button>` : ``}
            </div>
          </div>
        </div>
      `;
    }).join("");

    return `
      <div class="section">
        <div class="section__title">Admin</div>
        <p class="section__sub">Editor de packs (DLC) — criar, editar, importar e exportar.</p>

        <div class="panel">
          <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:space-between;align-items:center;">
            <button class="btn btnPrimary" data-action="adminNewPack">Novo pack</button>
            <button class="btn" data-action="adminImportPack">Importar JSON</button>
            <button class="btn" data-action="adminExportAll">Exportar todos</button>
            <button class="btn" data-action="adminLogout">Sair</button>
          </div>
        </div>

        <div style="height:12px"></div>

        <div class="list">
          ${packRows || `<div class="panel" style="color:rgba(233,236,246,.55);">Nenhum pack.</div>`}
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  function openModal({ title, contentHtml, primaryText, secondaryText, onPrimary, onSecondary }) {
    closeModal();
    const el = document.createElement("div");
    el.id = "modalOverlay";
    el.style.position = "fixed";
    el.style.inset = "0";
    el.style.zIndex = "200";
    el.style.background = "rgba(0,0,0,.55)";
    el.style.backdropFilter = "blur(10px)";
    el.innerHTML = `
      <div style="max-width:520px;margin:10vh auto;padding:0 14px;">
        <div style="border:1px solid rgba(255,255,255,.10);border-radius:18px;background:rgba(17,21,34,.92);box-shadow:0 18px 60px rgba(0,0,0,.55);overflow:hidden;">
          <div style="padding:14px 14px 10px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <div style="font-weight:860;letter-spacing:.2px;">${escapeHtml(title || "")}</div>
            <button id="modalClose" class="btn btn--ghost" type="button">✕</button>
          </div>
          <div style="padding:14px;">
            ${contentHtml || ""}
            <div style="height:14px"></div>
            <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
              ${secondaryText ? `<button id="modalSecondary" class="btn" type="button">${escapeHtml(secondaryText)}</button>` : ""}
              ${primaryText ? `<button id="modalPrimary" class="btn btnPrimary" type="button">${escapeHtml(primaryText)}</button>` : ""}
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    $("#modalClose")?.addEventListener("click", () => {
      closeModal();
      onSecondary?.();
    });
    $("#modalSecondary")?.addEventListener("click", () => {
      closeModal();
      onSecondary?.();
    });
    $("#modalPrimary")?.addEventListener("click", () => {
      onPrimary?.();
    });
  }

  function closeModal() {
    const el = $("#modalOverlay");
    if (el) el.remove();
  }

  function adminOpenPackEditor(man) {
    const m = normalizeManifest(man);
    const jsonStr = JSON.stringify(m, null, 2);

    openModal({
      title: `Editar pack: ${m.title}`,
      contentHtml: `
        <div style="color:rgba(233,236,246,.72);line-height:1.45;">
          Edite o JSON do pack. Ao salvar, ele vira um <b>pack custom</b> (guardado no navegador).
        </div>
        <div style="height:10px"></div>
        <textarea id="admPackJson" class="input" rows="14" style="font-family:ui-monospace,monospace;font-size:12px;line-height:1.35;">${escapeHtml(jsonStr)}</textarea>
        <div style="height:8px"></div>
        <div style="color:rgba(233,236,246,.45);font-size:12px;">
          Dica: para publicar no GitHub, copie esse JSON e salve em <b>/packs/&lt;id&gt;/manifest.json</b>.
        </div>
      `,
      primaryText: "Salvar",
      secondaryText: "Cancelar",
      onPrimary: () => {
        const raw = ($("#admPackJson")?.value || "").trim();
        const parsed = safeJsonParse(raw, null);
        if (!parsed) { toast("JSON inválido"); return; }
        const norm = normalizeManifest(parsed);

        const list = getCustomPacks().map(normalizeManifest);
        const i = list.findIndex(x => x.id === norm.id);
        if (i >= 0) list[i] = norm;
        else list.unshift(norm);
        saveCustomPacks(list);
        ensureAdminBadge();
        closeModal();
        toast("Pack salvo (custom)");
        packCache.index = null;
        packCache.manifests.delete(norm.id);
        setHash("admin");
      }
    });
  }

  function ensureAdminBadge() {
    store.set(s => {
      const ok = ensureBadge(s, "pack_creator");
      if (ok) toast("Badge: pack_creator");
    });
  }

  function downloadJson(filename, obj) {
    const text = JSON.stringify(obj, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /* =============================
     Tabbar
  ============================= */
  function tabbar(route) {
    const active = (r) => (route === r ? "is-active" : "");
    return `
      <nav class="tabbar" aria-label="Navegação">
        <div class="tabbar__item ${active("home")}" data-action="nav" data-to="home">
          <div class="tabbar__icon">🏠</div>
          <div>Início</div>
        </div>
        <div class="tabbar__item ${active("trilha")}" data-action="nav" data-to="trilha">
          <div class="tabbar__icon">🧭</div>
          <div>Trilha</div>
        </div>
        <div class="tabbar__item ${active("missions")}" data-action="nav" data-to="missions">
          <div class="tabbar__icon">✅</div>
          <div>Missões</div>
        </div>
        <div class="tabbar__item ${active("biblioteca")}" data-action="nav" data-to="biblioteca">
          <div class="tabbar__icon">📚</div>
          <div>Biblioteca</div>
        </div>
        <div class="tabbar__item ${active("profile")}" data-action="nav" data-to="profile">
          <div class="tabbar__icon">👤</div>
          <div>Perfil</div>
        </div>
      </nav>
    `;
  }

  /* =============================
     Views — Tab routes wrappers
  ============================= */
  async function viewTrilha() {
    const mans = await getActiveManifests();
    const paths = getAllPathsFromManifests(mans);

    const rows = paths.map(p => rowItem({
      icon: "🎯",
      title: p.title,
      sub: `${p.packTitle} • ${p.desc || ""}`,
      action: "openPath",
      data: { pack: p.packId, path: p.id }
    })).join("");

    return `
      <div class="section">
        <div class="section__title">Trilha</div>
        <p class="section__sub">Conteúdos dos packs ativos</p>
        <div class="panel">
          <div class="list">${rows || `<div style="color:rgba(233,236,246,.55);">Nenhuma trilha ativa.</div>`}</div>
        </div>
      </div>
      ${bottomSpacer()}
    `;
  }

  async function viewMissions() {
    const st = store.get();
    const today = todayISO();
    const done = isMissionCompleted(st, today);

    const templates = await getMissionTemplates();
    const chosen = chooseDailyTemplate(templates);
    store.set(s => ensureTodayMission(s, chosen));
    const tm = store.get().progress.todayMission;

    return `
      <div class="section">
        <div class="section__title">Missões</div>
        <p class="section__sub">Diária + progresso semanal</p>

        <div class="panel">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
            <div>
              <div style="color:rgba(233,236,246,.55);font-size:12px;">
                ${escapeHtml(tm?.date || today)} • ${escapeHtml(chosen.kind || "técnica")}
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

        <div style="height:12px"></div>

        <div class="panel">
          <div style="font-weight:950;margin-bottom:8px;">Diário Vocal</div>
          <button class="btn" data-action="nav" data-to="diary">Ver histórico</button>
        </div>
      </div>
      ${bottomSpacer()}
    `;
  }

  async function viewBiblioteca() {
    const mans = await getActiveManifests();
    const articles = [];
    for (const m of mans) {
      (m.library || []).forEach(a => articles.push({ packId: m.id, packTitle: m.title, ...a }));
    }

    // list
    const rows = articles.map(a => rowItem({
      icon: "📚",
      title: a.title,
      sub: `${a.packTitle} • ${a.tag || "Geral"}`,
      action: "openArticle",
      data: { pack: a.packId, art: a.id }
    })).join("");

    return `
      <div class="section">
        <div class="section__title">Biblioteca</div>
        <p class="section__sub">Artigos dos packs ativos</p>
        <div class="panel">
          <div class="list">${rows || `<div style="color:rgba(233,236,246,.55);">Nenhum artigo ativo.</div>`}</div>
        </div>
      </div>
      ${bottomSpacer()}
    `;
  }

  /* =============================
     Toggle pack on/off
  ============================= */
  function togglePackActive(packId) {
    store.set(s => {
      const ids = new Set(s.packs.activePackIds || []);
      if (ids.has(packId)) ids.delete(packId);
      else ids.add(packId);
      s.packs.activePackIds = Array.from(ids);
    });
    toast("Packs atualizados");
  }

  function toggleLessonDone(packId, lessonId) {
    const key = `${packId}:${lessonId}`;
    store.set(s => {
      if (s.progress.completedLessons[key]) delete s.progress.completedLessons[key];
      else s.progress.completedLessons[key] = { at: new Date().toISOString() };
    });
    toast("Progresso atualizado");
  }

  /* =============================
     App shell
  ============================= */
  function shell(route, contentHtml) {
    return `
      <header class="topbar">
        <div class="topbar__left">
          <div class="brandDot"></div>
          <div class="topbar__title">IMVpedia Voice</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="btn btn--chip" data-action="admin">${isAdminEnabled() ? "Admin ✓" : "Admin"}</button>
        </div>
      </header>

      <main class="app" id="app">
        ${contentHtml || ""}
      </main>

      ${tabbar(route)}
      <div class="toastHost" id="toastHost"></div>
    `;
  }

  /* =============================
     Router + Render
  ============================= */
  const rootEl = document.body;

  async function render() {
    const { route, query } = getRouteAndQuery();
    store.set(s => { s.progress.lastRoute = route; });

    let html = "";

    try {
      switch (route) {
        case "home":
          html = await viewHome();
          break;
        case "pack":
          html = await viewPack(query.id);
          break;
        case "path":
          html = await viewPath(query.pack, query.path);
          break;
        case "lesson":
          html = await viewLesson(query.pack, query.lesson);
          break;
        case "library":
          html = await viewLibrary(query.pack);
          break;
        case "library-tag":
          html = await viewLibraryFiltered(query.pack, query.tag);
          break;
        case "article":
          html = await viewArticle(query.pack, query.art);
          break;
        case "trilha":
          html = await viewTrilha();
          break;
        case "missions":
          html = await viewMissions();
          break;
        case "biblioteca":
          html = await viewBiblioteca();
          break;
        case "profile":
          html = viewProfile();
          break;
        case "diary":
          html = viewDiary();
          break;
        case "placement":
          html = viewPlacementIntro();
          break;
        case "placement-q":
          html = viewPlacementQuestion(Number(query.q || 0));
          break;
        case "placement-result": {
          const r = runPlacementAndBuildResult();
          html = viewPlacementResult(r.result, r.score, r.plan14);
          break;
        }
        case "admin":
          html = await viewAdminEditor();
          break;
        default:
          html = await viewHome();
      }
    } catch (e) {
      html = `
        <div class="panel">
          <div style="font-weight:950;">Erro ao renderizar</div>
          <div style="color:rgba(233,236,246,.62);margin-top:8px;line-height:1.45;">
            ${escapeHtml(String(e?.message || e || "Erro desconhecido"))}
          </div>
          <div style="height:12px"></div>
          <button class="btn" data-action="nav" data-to="home">Voltar</button>
        </div>
        ${bottomSpacer()}
      `;
    }

    rootEl.innerHTML = shell(route, html);
  }

  window.addEventListener("hashchange", () => render());

  /* =============================
     Actions (cliques)
  ============================= */
  document.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-action]");
    if (!btn) return;
    const act = btn.dataset.action;

    try {
      switch (act) {
        case "nav":
          setHash(btn.dataset.to || "home");
          break;

        case "openPack":
          setHash("pack", { id: btn.dataset.pack });
          break;

        case "openPath":
          setHash("path", { pack: btn.dataset.pack, path: btn.dataset.path });
          break;

        case "openLesson":
          setHash("lesson", { pack: btn.dataset.pack, lesson: btn.dataset.lesson, path: btn.dataset.path || "" });
          break;

        case "openLibrary":
          setHash("library", { pack: btn.dataset.pack });
          break;

        case "filterLib":
          setHash("library-tag", { pack: btn.dataset.pack, tag: btn.dataset.tag });
          break;

        case "openArticle":
          setHash("article", { pack: btn.dataset.pack, art: btn.dataset.art });
          break;

        case "togglePack":
          togglePackActive(btn.dataset.pack);
          await render();
          break;

        case "toggleLessonDone":
          toggleLessonDone(btn.dataset.pack, btn.dataset.lesson);
          await render();
          break;

        case "completeMission":
          await completeTodayMission();
          await render();
          break;

        case "swapMission":
          await swapTodayMission();
          break;

        case "goPlacement":
          setHash("placement");
          break;

        case "startPlacement":
          store.set(s => { s.placement.answers = {}; });
          setHash("placement-q", { q: "0" });
          break;

        case "answer": {
          const qIndex = Number(btn.dataset.q || 0);
          const score = Number(btn.dataset.score || 0);
          const q = PLACEMENT_QUESTIONS[qIndex];
          if (!q) return;
          store.set(s => { s.placement.answers[q.id] = score; });

          if (qIndex + 1 >= PLACEMENT_QUESTIONS.length) {
            setHash("placement-result");
          } else {
            setHash("placement-q", { q: String(qIndex + 1) });
          }
          break;
        }

        case "restartPlacement":
          store.set(s => { s.placement.answers = {}; s.placement.result = null; s.user.placementDone = false; });
          setHash("placement");
          break;

        case "savePlacement": {
          const r = runPlacementAndBuildResult();
          store.set(s => {
            s.placement.score = r.score;
            s.placement.result = r.result;
            s.placement.plan14 = r.plan14;
            s.user.levelReal = r.result;
            s.user.placementDone = true;
            ensureBadge(s, "placement_done");
            const rec = recommendTrack(s.user.goal || "Misto", r.result);
            s.user.minutesPerDay = rec.minutes;
            s.user.recommendedPath = rec.pathTitle;
          });
          toast("Placement salvo");
          setHash("home");
          break;
        }

        case "goProfile":
          setHash("profile");
          break;

        case "saveProfile": {
          const name = ($("#pfName")?.value || "").trim();
          const goal = ($("#pfGoal")?.value || "Misto").trim();
          const min = clamp(parseInt($("#pfMin")?.value || "10", 10) || 10, 5, 60);
          store.set(s => {
            s.user.name = name || "";
            s.user.goal = goal;
            s.user.minutesPerDay = min;
          });
          toast("Perfil salvo");
          await render();
          break;
        }

        case "diary":
          // apenas marca status no botão; salvar é outra ação
          store.set(s => { s.diary.lastStatus = btn.dataset.status; });
          toast(`Status: ${btn.dataset.status}`);
          break;

        case "saveDiary": {
          const st = store.get();
          const status = st.diary.lastStatus || "ok";
          const note = ($("#diaryNote")?.value || "").trim();
          addDiaryEntry(status, note);
          await render();
          break;
        }

        case "admin":
          setHash("admin");
          break;

        case "adminLogin":
          adminPrompt();
          break;

        case "adminLogout":
          setAdminEnabled(false);
          toast("Admin desabilitado");
          setHash("home");
          break;

        case "adminNewPack": {
          const base = normalizeManifest({
            id: "custom_" + uid(),
            title: "Novo Pack",
            desc: "Descreva este pack",
            cover: "",
            paths: [
              { id: "fund", title: "Trilha 1", desc: "Descrição", lessons: [{ id: "l1", title: "Lição 1", md: "# Lição 1\n\nConteúdo.\n" }] }
            ],
            library: [{ id: "a1", title: "Artigo 1", tag: "Geral", md: "# Artigo 1\n\nConteúdo.\n" }],
            missions: { templates: [{ id: "m1", title: "Missão 1", minutesMin: 8, minutesMax: 12, xp: 10, kind: "técnica", desc: "Descrição." }] }
          });
          adminOpenPackEditor(base);
          break;
        }

        case "adminImportPack": {
          openModal({
            title: "Importar pack (JSON)",
            contentHtml: `
              <div style="color:rgba(233,236,246,.72);line-height:1.45;">
                Cole aqui o JSON do pack (manifest).
              </div>
              <div style="height:10px"></div>
              <textarea id="admImportJson" class="input" rows="14" style="font-family:ui-monospace,monospace;font-size:12px;line-height:1.35;"></textarea>
            `,
            primaryText: "Importar",
            secondaryText: "Cancelar",
            onPrimary: () => {
              const raw = ($("#admImportJson")?.value || "").trim();
              const parsed = safeJsonParse(raw, null);
              if (!parsed) { toast("JSON inválido"); return; }
              const norm = normalizeManifest(parsed);

              const list = getCustomPacks().map(normalizeManifest);
              const i = list.findIndex(x => x.id === norm.id);
              if (i >= 0) list[i] = norm;
              else list.unshift(norm);
              saveCustomPacks(list);
              ensureAdminBadge();
              closeModal();
              toast("Pack importado (custom)");
              packCache.index = null;
              packCache.manifests.delete(norm.id);
              setHash("admin");
            }
          });
          break;
        }

        case "adminExportAll": {
          const list = getCustomPacks().map(normalizeManifest);
          downloadJson("imv_custom_packs.json", list);
          toast("Exportado");
          break;
        }

        case "adminOpenPack": {
          const packId = btn.dataset.pack;
          const customs = getCustomPacks().map(normalizeManifest);
          const found = customs.find(x => x.id === packId);
          if (found) adminOpenPackEditor(found);
          else {
            // se for pack de arquivo, carrega e salva como custom ao editar
            const man = await loadManifest(packId);
            adminOpenPackEditor(man);
          }
          break;
        }

        case "adminDeletePack": {
          const packId = btn.dataset.pack;
          openModal({
            title: "Excluir pack",
            contentHtml: `
              <div style="color:rgba(233,236,246,.72);line-height:1.45;">
                Tem certeza que deseja excluir o pack <b>${escapeHtml(packId)}</b>?
              </div>
            `,
            primaryText: "Excluir",
            secondaryText: "Cancelar",
            onPrimary: () => {
              const list = getCustomPacks().map(normalizeManifest).filter(p => p.id !== packId);
              saveCustomPacks(list);
              closeModal();
              toast("Pack excluído");
              packCache.index = null;
              packCache.manifests.delete(packId);
              setHash("admin");
            }
          });
          break;
        }

        default:
          break;
      }
    } catch (e) {
      toast("Erro: " + (e?.message || e));
    }
  });

  /* =============================
     Boot
  ============================= */
  if (!location.hash) setHash("home");
  render();

})();