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

// ===== FIM — BLOCO 1/6 =====
// ===== IMVpedia Voice — app.js (PARTE 6/6) — BLOCO 2/6 =====
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

// ===== FIM — BLOCO 2/6 =====
```0
// ===== IMVpedia Voice — app.js (PARTE 6/6) — BLOCO 3/6 =====
  /* =============================
     Views — Home / Paths / Lessons / Library / Articles
     (UI estilo Netflix, cards, fluxo mobile-first)
  ============================= */

  function cardPack(pack) {
    return `
      <div class="card" data-action="openPack" data-pack="${pack.id}">
        <div class="card__cover">${pack.cover ? `<img src="${pack.cover}" />` : "🎶"}</div>
        <div class="card__body">
          <div class="card__title">${escapeHtml(pack.title)}</div>
          <div class="card__desc">${escapeHtml(pack.desc || "")}</div>
        </div>
      </div>
    `;
  }

  function cardPath(p) {
    return `
      <div class="card" data-action="openPath"
           data-pack="${p.packId}" data-path="${p.id}">
        <div class="card__cover">🎼</div>
        <div class="card__body">
          <div class="card__title">${escapeHtml(p.title)}</div>
          <div class="card__desc">${escapeHtml(p.desc || "")}</div>
        </div>
      </div>
    `;
  }

  function cardLesson(l, packId) {
    return `
      <div class="row" data-action="openLesson"
           data-pack="${packId}" data-lesson="${l.id}">
        <div class="row__left">🎤</div>
        <div class="row__body">
          <div class="row__title">${escapeHtml(l.title)}</div>
        </div>
        <div class="row__right">›</div>
      </div>
    `;
  }

  function cardArticle(a, packId) {
    return `
      <div class="row" data-action="openArticle"
           data-pack="${packId}" data-article="${a.id}">
        <div class="row__left">📘</div>
        <div class="row__body">
          <div class="row__title">${escapeHtml(a.title)}</div>
          <div class="row__sub">${escapeHtml(a.tag || "")}</div>
        </div>
        <div class="row__right">›</div>
      </div>
    `;
  }

  async function viewHome() {
    const st = store.get();
    const idx = await loadPackIndex();

    return `
      <div class="hero">
        <div class="hero__kicker">
          Olá, ${escapeHtml(st.user.name || "Aluno")} • Nível ${st.gamification.level}
        </div>
        <div class="hero__title">IMVpedia Voice</div>
        <p class="hero__desc">
          Trilha vocal guiada com técnica, saúde e repertório.
        </p>
        <div class="hero__actions">
          <button class="btn btnPrimary" data-action="goPlacement">
            ${st.user.placementDone ? "Ver placement" : "Fazer placement"}
          </button>
          <button class="btn" data-action="goProfile">Perfil</button>
        </div>
      </div>

      <div class="section">
        <div class="section__title">Packs ativos</div>
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
          ${man.paths.map(p => cardPath({ ...p, packId: man.id })).join("")}
        </div>

        <div class="section__title">Biblioteca</div>
        <div class="list">
          ${man.library.map(a => cardArticle(a, man.id)).join("")}
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewPath(packId, pathId) {
    const man = await loadManifest(packId);
    const path = man.paths.find(p => p.id === pathId);
    if (!path) return `<div class="panel">Trilha não encontrada</div>`;

    return `
      <div class="section">
        <div class="section__title">${escapeHtml(path.title)}</div>
        <p class="section__sub">${escapeHtml(path.desc || "")}</p>

        <div class="list">
          ${path.lessons.map(l => cardLesson(l, packId)).join("")}
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewLesson(packId, lessonId) {
    const man = await loadManifest(packId);
    const path = man.paths.find(p => p.lessons.some(l => l.id === lessonId));
    if (!path) return `<div class="panel">Lição não encontrada</div>`;
    const lesson = path.lessons.find(l => l.id === lessonId);

    const md = await resolveMd(packId, lesson.md);
    const html = mdToHtml(md);

    return `
      <div class="panel">
        <div class="panel__title">${escapeHtml(lesson.title)}</div>
        <div class="md">${html}</div>

        <div style="height:14px"></div>
        <button class="btn btnPrimary" data-action="completeLesson"
                data-pack="${packId}" data-lesson="${lesson.id}">
          Concluir lição
        </button>
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewArticle(packId, articleId) {
    const man = await loadManifest(packId);
    const art = man.library.find(a => a.id === articleId);
    if (!art) return `<div class="panel">Artigo não encontrado</div>`;

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

// ===== FIM — BLOCO 3/6 =====
// ===== IMVpedia Voice — app.js (PARTE 6/6) — BLOCO 4/6 =====
  /* =============================
     Missões diárias + Semana + Diário Vocal
  ============================= */

  function pickFrom(arr) {
    if (!arr || !arr.length) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function computeMinutesForMission(userMinutes, template) {
    const base = clamp(Number(userMinutes) || 10, 5, 60);
    const min = clamp(Number(template.minutesMin) || 6, 3, 60);
    const max = clamp(Number(template.minutesMax) || Math.max(min, 10), min, 60);
    // puxa para o "base" do usuário mas respeita min/max do template
    return clamp(base, min, max);
  }

  async function ensureTodayMission() {
    const st = store.get();
    const t = todayISO();
    const existing = st.progress.todayMission;

    if (existing && existing.date === t) return existing;

    const manifests = await getActiveManifests();
    // junta templates de todos os packs ativos
    const allTemplates = [];
    for (const man of manifests) {
      (man.missions?.templates || []).forEach(tp => {
        allTemplates.push({ packId: man.id, packTitle: man.title, ...tp });
      });
    }

    const pick = pickFrom(allTemplates) || {
      packId: "base",
      id: "m_default",
      title: "Missão leve",
      minutesMin: 6,
      minutesMax: 12,
      xp: 10,
      kind: "técnica",
      desc: "Faça um aquecimento leve com conforto."
    };

    const minutesPlanned = computeMinutesForMission(st.user.minutesPerDay || 10, pick);

    const mission = {
      date: t,
      packId: pick.packId,
      templateId: pick.id,
      title: pick.title,
      kind: pick.kind,
      desc: pick.desc,
      minutesPlanned,
      xp: Number(pick.xp) || 10
    };

    store.set(s => {
      s.progress.todayMission = mission;
    });

    return mission;
  }

  function markMissionDone(mission) {
    const t = todayISO();
    store.set(s => {
      if (s.progress.completedMissions[t]) return;

      s.progress.completedMissions[t] = {
        at: new Date().toISOString(),
        packId: mission.packId,
        templateId: mission.templateId,
        xp: mission.xp
      };

      // semana
      const ws = startOfWeekISO(t);
      if (!s.progress.week[ws]) s.progress.week[ws] = { daysCompleted: 0, diaryNotesCount: 0, claimed: {} };
      s.progress.week[ws].daysCompleted += 1;

      // badges
      ensureBadge(s, "first_mission");

      // streak + xp
      touchStreak(s);
      s.gamification.xp += Math.max(0, Math.floor(mission.xp || 0));
      s.gamification.level = computeLevelFromXP(s.gamification.xp);
    });
    toast("Missão concluída! 🔥");
  }

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
            <div class="pill">${escapeHtml(String(mission.minutesPlanned))} min</div>
            <div class="pill">+${escapeHtml(String(mission.xp))} XP</div>
          </div>
        </div>

        <div style="height:10px"></div>
        <div style="color:rgba(233,236,246,.78);line-height:1.5;">
          <b>${escapeHtml(mission.title || "Missão")}</b><br/>
          ${escapeHtml(mission.desc || "")}
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
    const t = todayISO();
    const ws = startOfWeekISO(t);
    const wk = st.progress.week[ws] || { daysCompleted: 0, diaryNotesCount: 0, claimed: {} };
    const days = clamp(Number(wk.daysCompleted) || 0, 0, 7);

    const bar = `
      <div class="bar">
        <div class="bar__fill" style="width:${(days / 7) * 100}%"></div>
      </div>
    `;

    return `
      <div class="panel">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div style="font-weight:900;">Semana</div>
          <div style="color:rgba(233,236,246,.55);font-size:12px;">${escapeHtml(ws)} →</div>
        </div>
        <div style="height:10px"></div>
        ${bar}
        <div style="height:10px"></div>
        <div style="color:rgba(233,236,246,.78);line-height:1.45;">
          Dias com missão concluída: <b>${days}/7</b><br/>
          Check-ins no diário: <b>${clamp(Number(wk.diaryNotesCount) || 0, 0, 99)}</b>
        </div>
      </div>
    `;
  }

  function viewDiary() {
    const st = store.get();
    const entries = (st.diary.entries || []).slice().reverse().slice(0, 12);

    return `
      <div class="section">
        <div class="section__title">Diário vocal</div>
        <div class="section__sub">Check-in rápido para proteger a voz</div>

        <div class="panel">
          <div style="display:grid;gap:10px;">
            <div class="grid grid--2">
              <button class="btn" data-action="diaryQuick" data-status="ok">✅ Ok</button>
              <button class="btn" data-action="diaryQuick" data-status="tired">😮‍💨 Cansada</button>
              <button class="btn" data-action="diaryQuick" data-status="hoarse">😣 Rouca</button>
              <button class="btn" data-action="diaryQuick" data-status="pain">🛑 Dor</button>
            </div>

            <textarea id="diaryNote" class="input" rows="3"
              placeholder="Anote rapidamente (opcional): como foi a voz hoje?"></textarea>

            <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;">
              <button class="btn" data-action="saveDiaryNote">Salvar nota</button>
            </div>

            <div style="color:rgba(233,236,246,.52);font-size:12px;line-height:1.35;">
              Se houver <b>dor</b> ou rouquidão persistente, reduza carga e considere avaliação profissional.
            </div>
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

  function saveDiaryEntry(status, note) {
    const t = todayISO();
    store.set(s => {
      s.diary.lastCheckinDate = t;
      s.diary.lastStatus = status;

      const entry = { date: t, status, note: (note || "").trim(), at: new Date().toISOString() };
      s.diary.entries = Array.isArray(s.diary.entries) ? s.diary.entries : [];
      // evita duplicar no mesmo dia: atualiza
      const idx = s.diary.entries.findIndex(x => x.date === t);
      if (idx >= 0) s.diary.entries[idx] = entry;
      else s.diary.entries.push(entry);

      // semana
      const ws = startOfWeekISO(t);
      if (!s.progress.week[ws]) s.progress.week[ws] = { daysCompleted: 0, diaryNotesCount: 0, claimed: {} };
      s.progress.week[ws].diaryNotesCount = clamp((s.progress.week[ws].diaryNotesCount || 0) + 1, 0, 99);
    });
    toast("Diário atualizado ✅");
  }

  /* =============================
     Perfil + Placement Views (integrados)
  ============================= */
  function viewProfile() {
    const st = store.get();
    const u = st.user;
    const g = st.gamification;

    const badges = (g.badges || []).map(b => `<span class="pill">${escapeHtml(b)}</span>`).join(" ");

    return `
      <div class="section">
        <div class="section__title">Perfil</div>
        <div class="panel">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div>
              <div style="font-weight:950;font-size:18px;">${escapeHtml(u.name || "Aluno")}</div>
              <div style="color:rgba(233,236,246,.55);font-size:12px;margin-top:2px;">
                Objetivo: ${escapeHtml(u.goal)} • Min/dia: ${escapeHtml(String(u.minutesPerDay || 10))}
              </div>
              <div style="color:rgba(233,236,246,.55);font-size:12px;margin-top:2px;">
                Placement: ${u.placementDone ? `✅ ${escapeHtml(u.levelReal || "-")}` : "Pendente"}
              </div>
            </div>
            <div style="font-size:28px;">${escapeHtml(u.avatar || "🎤")}</div>
          </div>

          <div style="height:12px"></div>

          <div class="grid grid--2">
            <div class="kpi">
              <div>
                <div class="kpi__label">XP</div>
                <div class="kpi__value">${escapeHtml(String(g.xp || 0))}</div>
              </div>
              <div style="font-size:18px;">⚡</div>
            </div>
            <div class="kpi">
              <div>
                <div class="kpi__label">Nível</div>
                <div class="kpi__value">${escapeHtml(String(g.level || 1))}</div>
              </div>
              <div style="font-size:18px;">🏅</div>
            </div>
            <div class="kpi">
              <div>
                <div class="kpi__label">Streak</div>
                <div class="kpi__value">${escapeHtml(String(g.streak || 0))}</div>
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
            <button class="btn" data-action="goPlacement">${u.placementDone ? "Ver placement" : "Fazer placement"}</button>
            <button class="btn" data-action="goDiary">Diário</button>
          </div>

          <div style="height:12px"></div>
          <div style="color:rgba(233,236,246,.62);font-size:12px;line-height:1.35;">
            Badges: ${badges || "—"}
          </div>
        </div>
      </div>
      ${bottomSpacer()}
    `;
  }

  function viewPlacementIntro() {
    return `
      <div class="panel">
        <div style="font-weight:950;font-size:18px;">Teste de Classificação Vocal</div>
        <p style="color:rgba(233,236,246,.78);line-height:1.45;margin-top:10px;">
          Responda rápido para ajustar trilha, minutos e plano de 14 dias.
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
        <div style="font-weight:950;font-size:17px;margin-top:6px;">${escapeHtml(q.title)}</div>
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
    const rec = recommendTrack(goal, result);

    return `
      <div class="panel">
        <div style="font-size:12px;color:rgba(233,236,246,.55);">Resultado</div>
        <div style="font-weight:980;font-size:22px;margin-top:6px;">${escapeHtml(result)}</div>

        <div style="height:10px"></div>

        <div class="panel" style="background:rgba(255,255,255,.03);">
          <div style="font-weight:900;">Recomendação</div>
          <div style="height:8px"></div>
          <div style="color:rgba(233,236,246,.78);line-height:1.5;">
            Objetivo: <b>${escapeHtml(goal)}</b><br/>
            Trilha sugerida: <b>${escapeHtml(rec.pathTitle)}</b><br/>
            Minutos sugeridos: <b>${escapeHtml(String(rec.minutes))} min/dia</b>
          </div>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div style="font-weight:900;">Plano inicial (14 dias)</div>
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

// ===== FIM — BLOCO 4/6 =====
// ===== IMVpedia Voice — app.js (PARTE 6/6) — BLOCO 5/6 =====
  /* =============================
     Modal (reutilizável) + Editor de Perfil
  ============================= */
  let modalEl = null;

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

  function closeModal() {
    if (modalEl) { modalEl.remove(); modalEl = null; }
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

      <div style="height:10px"></div>
      <div style="color:rgba(233,236,246,.55);font-size:12px;line-height:1.35;">
        Dica: depois do placement, o app ajusta minutos sugeridos.
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
     Admin Gate + Admin Editor (Packs/DLC)
     - Ativa admin via senha (localStorage)
     - Lista packs (index + custom)
     - Ativar/desativar packs
     - Criar/editar pack custom
     - Importar pack JSON
     - Exportar pack JSON + templates .md (texto para copiar)
  ============================= */
  const ADMIN_PASSWORD = "IMV-ADMIN-2026"; // você pode trocar aqui

  function isAdminEnabled() {
    return localStorage.getItem(LS.ADMIN) === "1";
  }

  function setAdminEnabled(val) {
    try { localStorage.setItem(LS.ADMIN, val ? "1" : "0"); } catch {}
  }

  function viewAdminGate() {
    const enabled = isAdminEnabled();
    return `
      <div class="section">
        <div class="section__title">Admin</div>
        <div class="panel">
          <div style="font-weight:900;">Acesso</div>
          <div style="color:rgba(233,236,246,.72);line-height:1.45;margin-top:8px;">
            ${enabled ? "Admin está <b>ATIVADO</b> neste dispositivo." : "Digite a senha para liberar o editor."}
          </div>

          <div style="height:12px"></div>

          ${enabled ? `
            <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;">
              <button class="btn" data-action="adminOpen">Abrir Editor</button>
              <button class="btn" data-action="adminDisable">Desativar</button>
            </div>
          ` : `
            <input id="adminPass" class="input" type="password" placeholder="Senha do admin" />
            <div style="height:10px"></div>
            <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
              <button class="btn btnPrimary" data-action="adminEnable">Ativar</button>
            </div>
            <div style="color:rgba(233,236,246,.45);font-size:12px;margin-top:10px;">
              Dica: a senha padrão está no código (<code>ADMIN_PASSWORD</code>).
            </div>
          `}
        </div>
      </div>
      ${bottomSpacer()}
    `;
  }

  async function viewAdminEditor() {
    if (!isAdminEnabled()) return viewAdminGate();

    const idx = await loadPackIndex();
    const st = store.get();
    const active = new Set(st.packs.activePackIds || []);
    const customs = getCustomPacks().map(normalizeManifest);

    return `
      <div class="section">
        <div class="section__title">Admin • Packs (DLC)</div>
        <div class="section__sub">Crie/edite packs custom e gerencie packs ativos.</div>

        <div class="panel">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;">
            <div style="font-weight:900;">Packs disponíveis</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <button class="btn" data-action="adminNewPack">Novo pack</button>
              <button class="btn" data-action="adminImportPack">Importar JSON</button>
              <button class="btn" data-action="adminRefreshPacks">Recarregar</button>
            </div>
          </div>

          <div style="height:10px"></div>

          <div class="list">
            ${idx.packs.map(p => `
              <div class="row">
                <div class="row__left">📦</div>
                <div class="row__body">
                  <div class="row__title">${escapeHtml(p.title)} ${p.isCustom ? `<span class="pill">custom</span>` : ""}</div>
                  <div class="row__sub">${escapeHtml(p.id)}</div>
                </div>
                <div class="row__right" style="display:flex;gap:8px;align-items:center;">
                  <button class="btn btn--tiny" data-action="togglePack" data-pack="${escapeHtml(p.id)}">
                    ${active.has(p.id) ? "Ativo" : "Inativo"}
                  </button>
                  <button class="btn btn--tiny" data-action="adminEditPack" data-pack="${escapeHtml(p.id)}">Editar</button>
                  <button class="btn btn--tiny" data-action="adminExportPack" data-pack="${escapeHtml(p.id)}">Exportar</button>
                </div>
              </div>
            `).join("")}
          </div>

          <div style="height:12px"></div>

          <div style="color:rgba(233,236,246,.45);font-size:12px;line-height:1.35;">
            • Packs “custom” ficam salvos no dispositivo (localStorage).<br/>
            • Para virar DLC real no GitHub: use “Exportar” e crie os arquivos em <code>/packs/&lt;id&gt;/</code>.
          </div>
        </div>

        <div class="panel">
          <div style="font-weight:900;">Custom packs salvos</div>
          <div style="height:10px"></div>
          ${customs.length ? `
            <div class="list">
              ${customs.map(c => `
                <div class="row">
                  <div class="row__left">🛠️</div>
                  <div class="row__body">
                    <div class="row__title">${escapeHtml(c.title)}</div>
                    <div class="row__sub">${escapeHtml(c.id)}</div>
                  </div>
                  <div class="row__right" style="display:flex;gap:8px;">
                    <button class="btn btn--tiny" data-action="adminEditPack" data-pack="${escapeHtml(c.id)}">Editar</button>
                    <button class="btn btn--tiny" data-action="adminDeletePack" data-pack="${escapeHtml(c.id)}">Excluir</button>
                  </div>
                </div>
              `).join("")}
            </div>
          ` : `<div style="color:rgba(233,236,246,.55);">Nenhum pack custom ainda.</div>`}
        </div>
      </div>
      ${bottomSpacer()}
    `;
  }

  function openPackEditor(packId) {
    const customArr = getCustomPacks().map(normalizeManifest);
    let pack = customArr.find(p => p.id === packId);

    // se for pack não-custom, cria clone custom para editar
    const nonCustomPromise = !pack ? loadManifest(packId).then(m => normalizeManifest(m)).catch(() => null) : Promise.resolve(null);

    nonCustomPromise.then(clone => {
      if (!pack) {
        if (!clone) { toast("Pack não encontrado."); return; }
        pack = structuredClone(clone);
        pack.id = `custom_${clone.id}_${uid().slice(0,6)}`;
        pack.title = `${clone.title} (custom)`;
        pack.desc = clone.desc || "";
        customArr.push(pack);
        saveCustomPacks(customArr);
        packCache.index = null; // refaz index
      }

      // transforma em texto editável simples (manifest + 1 lição + 1 artigo + 1 missão)
      const manifestJson = JSON.stringify(pack, null, 2);

      openModal({
        title: `Editor • ${pack.title}`,
        contentHtml: `
          <div style="color:rgba(233,236,246,.62);font-size:12px;line-height:1.35;">
            Edite o JSON do manifest. Você pode adicionar trilhas/lessons/library/missions.
          </div>
          <div style="height:10px"></div>
          <textarea id="packJson" class="input" rows="16" style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${escapeHtml(manifestJson)}</textarea>
          <div style="height:10px"></div>
          <div class="grid grid--2">
            <button class="btn" data-action="adminAddLessonTemplate">Inserir modelo de lesson</button>
            <button class="btn" data-action="adminAddArticleTemplate">Inserir modelo de artigo</button>
          </div>
          <div style="height:10px"></div>
          <button class="btn" data-action="adminAddMissionTemplate">Inserir modelo de missão</button>
        `,
        primaryText: "Salvar pack",
        secondaryText: "Fechar",
        onPrimary: () => {
          const raw = $("#packJson")?.value || "";
          const parsed = safeJsonParse(raw, null);
          if (!parsed) { toast("JSON inválido."); return; }

          const normalized = normalizeManifest(parsed);

          const all = getCustomPacks().map(normalizeManifest);
          const idx = all.findIndex(p => p.id === normalized.id);
          if (idx >= 0) all[idx] = normalized;
          else all.push(normalized);
          saveCustomPacks(all);
          packCache.index = null;
          packCache.manifests.delete(normalized.id);

          toast("Pack salvo ✅");
          closeModal();
          setHash("admin", { step: "editor" });
        }
      });

      // handlers de template dentro do modal
      setTimeout(() => {
        $$("[data-action='adminAddLessonTemplate']").forEach(btn => btn.addEventListener("click", () => {
          const ta = $("#packJson");
          if (!ta) return;
          ta.value += `\n\n// EXEMPLO: adicionar lesson\n// Dentro de paths[].lessons[]:\n// { "id":"apoio_1", "title":"Apoio (exemplo)", "md":"lessons/apoio.md" }\n// ou "md":"# Título\\n\\nConteúdo..." \n`;
          toast("Modelo de lesson inserido");
        }));
        $$("[data-action='adminAddArticleTemplate']").forEach(btn => btn.addEventListener("click", () => {
          const ta = $("#packJson");
          if (!ta) return;
          ta.value += `\n\n// EXEMPLO: adicionar artigo\n// Dentro de library[]:\n// { "id":"saude_1", "title":"Saúde vocal (exemplo)", "tag":"Saúde", "md":"library/saude.md" }\n`;
          toast("Modelo de artigo inserido");
        }));
        $$("[data-action='adminAddMissionTemplate']").forEach(btn => btn.addEventListener("click", () => {
          const ta = $("#packJson");
          if (!ta) return;
          ta.value += `\n\n// EXEMPLO: missão\n// Dentro de missions.templates[]:\n// { "id":"m_sovt_12", "title":"SOVT 12 min", "minutesMin":8, "minutesMax":14, "xp":14, "kind":"técnica", "desc":"Lip trill/humming/canudo com conforto." }\n`;
          toast("Modelo de missão inserido");
        }));
      }, 0);
    });
  }

  function openPackImportModal() {
    openModal({
      title: "Importar Pack (JSON)",
      contentHtml: `
        <div style="color:rgba(233,236,246,.62);font-size:12px;line-height:1.35;">
          Cole aqui o JSON do manifest do pack. Ele será salvo como pack custom.
        </div>
        <div style="height:10px"></div>
        <textarea id="importJson" class="input" rows="14" style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;"
          placeholder='{"id":"meu_pack","title":"...", "paths":[...], "library":[...], "missions":{"templates":[...]}}'></textarea>
      `,
      primaryText: "Importar",
      secondaryText: "Cancelar",
      onPrimary: () => {
        const raw = $("#importJson")?.value || "";
        const parsed = safeJsonParse(raw, null);
        if (!parsed) { toast("JSON inválido."); return; }
        const normalized = normalizeManifest(parsed);

        const all = getCustomPacks().map(normalizeManifest);
        const idx = all.findIndex(p => p.id === normalized.id);
        if (idx >= 0) all[idx] = normalized;
        else all.push(normalized);

        saveCustomPacks(all);
        packCache.index = null;
        packCache.manifests.delete(normalized.id);

        toast("Pack importado ✅");
        closeModal();
        setHash("admin", { step: "editor" });
      }
    });
  }

  async function openPackExportModal(packId) {
    const man = await loadManifest(packId);
    const m = normalizeManifest(man);

    // gera texto de export: manifest.json + exemplos de md
    const manifestJson = JSON.stringify(m, null, 2);

    // coleta md "inline" para sugerir arquivos
    const mdFiles = [];
    for (const p of m.paths) {
      for (const l of (p.lessons || [])) {
        const v = String(l.md || "");
        if (v && (v.includes(".md") || v.startsWith("lessons/"))) {
          mdFiles.push({ path: v.replace(/^\.\//, ""), hint: `# ${l.title}\n\nConteúdo...\n` });
        }
      }
    }
    for (const a of (m.library || [])) {
      const v = String(a.md || "");
      if (v && (v.includes(".md") || v.startsWith("library/"))) {
        mdFiles.push({ path: v.replace(/^\.\//, ""), hint: `# ${a.title}\n\nConteúdo...\n` });
      }
    }

    const filesText = mdFiles.length
      ? mdFiles.map(f => `---\nARQUIVO: /packs/${m.id}/${f.path}\n\n${f.hint}`).join("\n")
      : "Nenhum arquivo .md referenciado. (Você está usando markdown inline no JSON.)";

    openModal({
      title: `Exportar • ${m.title}`,
      contentHtml: `
        <div style="color:rgba(233,236,246,.62);font-size:12px;line-height:1.35;">
          Copie e crie os arquivos no GitHub:
          <br/>1) <code>/packs/${escapeHtml(m.id)}/manifest.json</code>
          <br/>2) os arquivos .md (se houver)
        </div>
        <div style="height:10px"></div>
        <div class="lab">manifest.json</div>
        <textarea class="input" rows="12" style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${escapeHtml(manifestJson)}</textarea>
        <div style="height:10px"></div>
        <div class="lab">Arquivos .md (templates)</div>
        <textarea class="input" rows="10" style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${escapeHtml(filesText)}</textarea>
      `,
      primaryText: "Fechar",
      secondaryText: "",
      onPrimary: () => closeModal()
    });
  }

// ===== FIM — BLOCO 5/6 =====