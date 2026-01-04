/* =========================================================
   IMVpedia Voice — app.js (FULL)
   Upgrade:
   - Tabbar ativa por rota
   - Home com carrosséis horizontais (Netflix-like)
   - Rotas: home, tracks, missions, library, profile, placement, pack, path, lesson, article
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
    return d.toISOString().slice(0, 10);
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
    location.hash = qs ? `${base}?${qs}` : base;
  }

  function getRouteAndQuery() {
    const h = (location.hash || "#/home").trim();
    if (!h.startsWith("#/")) return { route: "home", query: {} };
    const [path, qs] = h.slice(2).split("?");
    return { route: (path || "home"), query: Object.fromEntries(new URLSearchParams(qs || "")) };
  }

  function bottomSpacer() { return `<div style="height:110px"></div>`; }

  /* =============================
     Storage + State
  ============================= */
  const LS = {
    STATE: "imv_voice_state_final_v3",
    CUSTOM_PACKS: "imv_voice_custom_packs_v1",
    ADMIN: "imv_voice_admin_enabled_v1"
  };

  const DEFAULT_STATE = {
    meta: { createdAt: new Date().toISOString(), lastOpenAt: new Date().toISOString(), appVersion: "1.2.0" },
    user: { id: uid(), name: "Aluno", avatar: "🎤", goal: "Misto", minutesPerDay: 10, placementDone: false, levelReal: null },
    gamification: { xp: 0, level: 1, streak: 0, lastActiveDate: null },
    packs: { activePackIds: ["base"] },
    progress: {
      completedLessons: {},              // key: `${packId}:${lessonId}` -> {at}
      continue: null,                   // {packId,pathId,lessonId}
      todayMission: null,               // mission object
      completedMissions: {},            // date -> {at,xp,templateId,packId}
      week: {}                          // weekStart -> {daysCompleted, diaryNotesCount}
    },
    diary: { entries: [], lastCheckinDate: null, lastStatus: null },
    placement: { answers: {}, score: 0, result: null, plan14: [] }
  };

  function deepMerge(target, source) {
    if (!source || typeof source !== "object") return target;
    for (const k of Object.keys(source)) {
      const sv = source[k];
      const tv = target[k];
      if (Array.isArray(sv)) target[k] = sv.slice();
      else if (sv && typeof sv === "object" && tv && typeof tv === "object" && !Array.isArray(tv)) target[k] = deepMerge(tv, sv);
      else target[k] = sv;
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
    get() { return this.state; },
    set(mutator) {
      const next = structuredClone(this.state);
      mutator(next);
      this.state = next;
      persistState(this.state);
    }
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
    render(); // atualiza badges/XP na UI
  }

  /* =============================
     Markdown -> HTML (safe)
  ============================= */
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
  const packCache = { index: null, manifests: new Map(), md: new Map() };

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
      id: m.id, title: m.title, cover: m.cover || "", desc: m.desc || "", isCustom: true
    }));

    packCache.index = { packs: [...idx.packs, ...custom] };
    return packCache.index;
  }

  async function loadManifest(packId) {
    if (packCache.manifests.has(packId)) return packCache.manifests.get(packId);

    const customs = getCustomPacks().map(normalizeManifest);
    const found = customs.find(p => p.id === packId);
    if (found) { packCache.manifests.set(packId, found); return found; }

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
    for (const id of ids) { try { arr.push(await loadManifest(id)); } catch {} }
    if (!arr.length) arr.push(getFallbackBaseManifest());
    return arr;
  }

  function getFallbackBaseManifest() {
    return normalizeManifest({
      id: "base",
      title: "Base",
      desc: "Fundamentos essenciais",
      cover: "",
      paths: [{
        id: "fund",
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
          { id: "m_sovt_10", title: "SOVT leve", minutesMin: 8, minutesMax: 12, xp: 12, kind: "técnica", desc: "Lip trill/humming/canudo na região confortável, sem apertar." },
          { id: "m_afina_10", title: "Afinação básica", minutesMin: 8, minutesMax: 12, xp: 12, kind: "musical", desc: "Notas longas + ataques suaves (sem forçar volume)." }
        ]
      }
    });
  }

  function getAllPaths(manifests) {
    const out = [];
    for (const m of manifests) (m.paths || []).forEach(p => out.push({ packId: m.id, packTitle: m.title, ...p }));
    return out;
  }

  function getAllArticles(manifests) {
    const out = [];
    for (const m of manifests) (m.library || []).forEach(a => out.push({ packId: m.id, packTitle: m.title, ...a }));
    return out;
  }

  /* =============================
     Placement (leve e seguro)
  ============================= */
  const PLACEMENT_QUESTIONS = [
    { id: "experience", title: "Experiência vocal", question: "Há quanto tempo você canta com regularidade?", options: [
      { label: "Nunca estudei", score: 0 }, { label: "Menos de 1 ano", score: 1 }, { label: "1 a 3 anos", score: 2 }, { label: "Mais de 3 anos", score: 3 }
    ]},
    { id: "health", title: "Saúde vocal", question: "Com que frequência rola rouquidão/cansaço ao cantar?", options: [
      { label: "Quase sempre", score: 0 }, { label: "Às vezes", score: 1 }, { label: "Raramente", score: 2 }, { label: "Quase nunca", score: 3 }
    ]},
    { id: "pitch", title: "Afinação", question: "Você costuma acertar a nota ao repetir uma melodia?", options: [
      { label: "Tenho dificuldade", score: 0 }, { label: "Consigo com esforço", score: 1 }, { label: "Consigo bem", score: 2 }, { label: "Com facilidade", score: 3 }
    ]},
    { id: "breath", title: "Ar/controle", question: "Você controla o ar sem apertar o pescoço?", options: [
      { label: "Não sei como", score: 0 }, { label: "Às vezes", score: 1 }, { label: "Na maioria", score: 2 }, { label: "Sim, consistente", score: 3 }
    ]},
    { id: "repertoire", title: "Repertório", question: "Você canta músicas completas com segurança?", options: [
      { label: "Ainda não", score: 0 }, { label: "Partes", score: 1 }, { label: "Sim, confortável", score: 2 }, { label: "Sim, com estilo", score: 3 }
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
    for (let i = 0; i < 14; i++) plan.push({ day: i + 1, focus: themes[i % themes.length], intensity: i % 4 === 0 ? "leve" : "moderada" });
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
     Missions + Diary
  ============================= */
  function pickFrom(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; }

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
    for (const man of manifests) (man.missions?.templates || []).forEach(tp => templates.push({ packId: man.id, ...tp }));

    const chosen = pickFrom(templates) || { packId: "base", id: "m_default", title: "Missão leve", minutesMin: 6, minutesMax: 12, xp: 10, kind: "técnica", desc: "Faça um aquecimento leve com conforto." };
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

  function completeTodayMission() {
    const st = store.get();
    const m = st.progress.todayMission;
    if (!m) return;

    const date = m.date || todayISO();
    if (st.progress.completedMissions[date]) {
      toast("Missão de hoje já concluída.");
      return;
    }

    store.set(s => {
      s.progress.completedMissions[date] = { at: new Date().toISOString(), xp: m.xp, templateId: m.templateId, packId: m.packId };
      const ws = startOfWeekISO(date);
      if (!s.progress.week[ws]) s.progress.week[ws] = { daysCompleted: 0, diaryNotesCount: 0 };
      s.progress.week[ws].daysCompleted += 1;
    });

    addXP(m.xp, "Missão concluída");
    toast("Concluída ✅");
  }

  async function rerollTodayMission() {
    const st = store.get();
    const date = todayISO();
    if (st.progress.completedMissions[date]) {
      toast("Hoje já foi concluída — não dá pra trocar.");
      return;
    }

    const manifests = await getActiveManifests();
    const templates = [];
    for (const man of manifests) (man.missions?.templates || []).forEach(tp => templates.push({ packId: man.id, ...tp }));

    const chosen = pickFrom(templates) || { packId: "base", id: "m_default", title: "Missão leve", minutesMin: 6, minutesMax: 12, xp: 10, kind: "técnica", desc: "Faça um aquecimento leve com conforto." };
    const minutesPlanned = computeMinutesForMission(st.user.minutesPerDay, chosen);

    store.set(s => {
      s.progress.todayMission = {
        date,
        packId: chosen.packId,
        templateId: chosen.id,
        title: chosen.title,
        kind: chosen.kind,
        desc: chosen.desc,
        minutesPlanned,
        xp: Number(chosen.xp) || 10
      };
    });

    toast("Missão trocada");
    render();
  }

  function addDiaryEntry(status, note) {
    const date = todayISO();
    store.set(s => {
      s.diary.entries.unshift({ date, status, note: (note || "").trim() });
      s.diary.lastCheckinDate = date;
      s.diary.lastStatus = status;

      const ws = startOfWeekISO(date);
      if (!s.progress.week[ws]) s.progress.week[ws] = { daysCompleted: 0, diaryNotesCount: 0 };
      s.progress.week[ws].diaryNotesCount += 1;
    });
    toast("Check-in salvo");
    render();
  }

  /* =============================
     UI building blocks (Netflix-like rows)
  ============================= */
  function hRow(title, subtitle, innerHtml) {
    return `
      <div class="section">
        <div class="section__title">${escapeHtml(title)}</div>
        ${subtitle ? `<div class="section__sub">${escapeHtml(subtitle)}</div>` : ""}
        <div style="display:flex;gap:12px;overflow:auto;padding-bottom:6px;scroll-snap-type:x mandatory;">
          ${innerHtml}
        </div>
      </div>
    `;
  }

  function miniCard(title, desc, onHash, emoji = "🎵") {
    return `
      <a class="card" href="${onHash}" style="min-width:240px;max-width:240px;scroll-snap-align:start;">
        <div class="card__cover">${/* cover placeholder is via CSS */""}</div>
        <div class="card__body">
          <div class="card__title">${escapeHtml(title)}</div>
          <div class="card__desc">${escapeHtml(desc || "")}</div>
          <div style="height:10px"></div>
          <div class="pill">${emoji} Abrir</div>
        </div>
      </a>
    `;
  }

  function miniRow(title, sub, href, leftEmoji = "📌") {
    return `
      <a class="row" href="${href}" style="min-width:320px;scroll-snap-align:start;">
        <div class="row__left">${leftEmoji}</div>
        <div class="row__body">
          <div class="row__title">${escapeHtml(title)}</div>
          <div class="row__sub">${escapeHtml(sub || "")}</div>
        </div>
        <div class="row__right">›</div>
      </a>
    `;
  }

  /* =============================
     Views
  ============================= */
  async function viewHome() {
    const st = store.get();
    const u = st.user;

    const manifests = await getActiveManifests();
    const paths = getAllPaths(manifests);
    const articles = getAllArticles(manifests);
    const idx = await loadPackIndex();

    const mission = await ensureTodayMission();
    const doneToday = !!st.progress.completedMissions[todayISO()];

    const ws = startOfWeekISO(todayISO());
    const weekData = st.progress.week[ws] || { daysCompleted: 0, diaryNotesCount: 0 };

    const hero = `
      <div class="hero">
        <div class="hero__kicker">Olá, ${escapeHtml(u.name || "Aluno")} • Nível ${st.gamification.level} • Streak ${st.gamification.streak} 🔥</div>
        <div class="hero__title">IMVpedia Voice</div>
        <p class="hero__desc">Trilha vocal guiada com técnica, saúde e repertório (popular, erudito e coral).</p>
        <div class="hero__actions">
          <button class="btn btnPrimary" data-action="goPlacement">${u.placementDone ? "Ver placement" : "Fazer placement"}</button>
          <button class="btn" data-action="goProfile">Perfil</button>
        </div>
      </div>
    `;

    const missionCard = `
      <div class="panel" style="margin-top:14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div>
            <div class="panel__title">Missão do dia</div>
            <div style="color:rgba(240,244,255,.55);font-size:12px;">${escapeHtml(mission.date)} • ${escapeHtml(mission.kind || "técnica")}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
            <span class="pill">${mission.minutesPlanned} min</span>
            <span class="pill">+${mission.xp} XP</span>
          </div>
        </div>

        <div style="height:10px"></div>
        <div style="font-weight:950;font-size:18px;">${escapeHtml(mission.title)}</div>
        <div style="color:rgba(240,244,255,.70);line-height:1.4;margin-top:6px;">${escapeHtml(mission.desc)}</div>

        <div style="height:14px"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button class="btn" data-action="rerollMission">Trocar</button>
          <button class="btn btnPrimary" data-action="completeMission">${doneToday ? "Concluída ✅" : "Concluir"}</button>
        </div>
      </div>
    `;

    const weekCard = `
      <div class="panel" style="margin-top:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div class="panel__title">Semana</div>
          <div style="color:rgba(240,244,255,.45);font-size:12px;">${escapeHtml(ws)} →</div>
        </div>
        <div class="bar" style="margin-top:10px;">
          <div class="bar__fill" style="width:${clamp((weekData.daysCompleted / 7) * 100, 0, 100)}%"></div>
        </div>
        <div style="height:10px"></div>
        <div style="color:rgba(240,244,255,.70);line-height:1.4;">
          Missões concluídas: <b>${weekData.daysCompleted}/7</b><br/>
          Check-ins no diário: <b>${weekData.diaryNotesCount}</b>
        </div>
        <div style="height:12px"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <a class="btn" href="#/missions">Ver Missões</a>
          <a class="btn" href="#/library">Abrir Biblioteca</a>
        </div>
      </div>
    `;

    const packsRow = hRow(
      "Packs",
      "Conteúdos por módulos (DLC). Sem capa? O app mostra placeholder premium.",
      (idx.packs || []).slice(0, 10).map(p =>
        miniCard(p.title || p.id, p.desc || "Abrir conteúdo", `#/pack?id=${encodeURIComponent(p.id)}`, "📦")
      ).join("")
    );

    const tracksRow = hRow(
      "Trilhas",
      "Escolha uma trilha e avance lição por lição.",
      paths.slice(0, 12).map(p =>
        miniRow(
          `${p.title}`,
          `${p.packTitle} • ${(p.lessons || []).length} lições`,
          `#/path?pack=${encodeURIComponent(p.packId)}&id=${encodeURIComponent(p.id)}`,
          "🧭"
        )
      ).join("")
    );

    const libRow = hRow(
      "Biblioteca",
      "Artigos rápidos (saúde, técnica, estilo).",
      articles.slice(0, 12).map(a =>
        miniRow(
          a.title,
          `${a.tag || "Geral"} • ${a.packTitle}`,
          `#/article?pack=${encodeURIComponent(a.packId)}&id=${encodeURIComponent(a.id)}`,
          "📚"
        )
      ).join("")
    );

    return `${hero}${missionCard}${weekCard}${packsRow}${tracksRow}${libRow}${bottomSpacer()}`;
  }

  async function viewTracks() {
    const manifests = await getActiveManifests();
    const paths = getAllPaths(manifests);

    const content = `
      <div class="section__title">Trilhas</div>
      <div class="section__sub">Escolha uma trilha para estudar em ordem (lições).</div>

      <div class="list">
        ${paths.map(p => `
          <a class="row" href="#/path?pack=${encodeURIComponent(p.packId)}&id=${encodeURIComponent(p.id)}">
            <div class="row__left">🧭</div>
            <div class="row__body">
              <div class="row__title">${escapeHtml(p.title)}</div>
              <div class="row__sub">${escapeHtml(p.packTitle)} • ${escapeHtml(p.desc || "")}</div>
            </div>
            <div class="row__right">›</div>
          </a>
        `).join("")}
      </div>

      ${bottomSpacer()}
    `;
    return content;
  }

  async function viewMissions() {
    const st = store.get();
    const m = await ensureTodayMission();
    const today = todayISO();
    const doneToday = !!st.progress.completedMissions[today];

    const diaryLast = st.diary.entries[0];
    const diaryLine = diaryLast
      ? `Último check-in: <b>${escapeHtml(diaryLast.date)}</b> • ${escapeHtml(diaryLast.status)}`
      : `Nenhum check-in ainda.`;

    return `
      <div class="section__title">Missões</div>
      <div class="section__sub">Rotina diária + consistência semanal.</div>

      <div class="panel">
        <div class="panel__title">Missão de hoje</div>
        <div style="color:rgba(240,244,255,.55);font-size:12px;">${escapeHtml(m.date)} • ${escapeHtml(m.kind)}</div>
        <div style="height:10px"></div>
        <div style="font-weight:950;font-size:18px;">${escapeHtml(m.title)}</div>
        <div style="color:rgba(240,244,255,.70);line-height:1.45;margin-top:6px;">${escapeHtml(m.desc)}</div>

        <div style="height:12px"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <span class="pill">${m.minutesPlanned} min</span>
          <span class="pill">+${m.xp} XP</span>
        </div>

        <div style="height:14px"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button class="btn" data-action="rerollMission">Trocar</button>
          <button class="btn btnPrimary" data-action="completeMission">${doneToday ? "Concluída ✅" : "Concluir"}</button>
        </div>
      </div>

      <div style="height:12px"></div>

      <div class="panel">
        <div class="panel__title">Diário vocal</div>
        <div style="color:rgba(240,244,255,.70);line-height:1.45;">${diaryLine}</div>

        <div style="height:12px"></div>
        <div class="grid grid--2">
          <button class="btn" data-action="diary" data-status="ok">✅ Sem desconforto</button>
          <button class="btn" data-action="diary" data-status="tired">😮‍💨 Cansado</button>
          <button class="btn" data-action="diary" data-status="hoarse">🗣️ Rouquidão</button>
          <button class="btn" data-action="diary" data-status="pain">⚠️ Dor</button>
        </div>
      </div>

      <div style="height:12px"></div>

      <div class="panel">
        <div class="panel__title">Histórico</div>
        <div style="color:rgba(240,244,255,.55);font-size:12px;">Concluídas recentemente</div>
        <div style="height:10px"></div>

        <div class="list">
          ${Object.keys(st.progress.completedMissions).sort().reverse().slice(0, 10).map(d => {
            const x = st.progress.completedMissions[d];
            return `
              <div class="row" style="cursor:default;">
                <div class="row__left">✅</div>
                <div class="row__body">
                  <div class="row__title">${escapeHtml(d)}</div>
                  <div class="row__sub">+${x.xp} XP • ${escapeHtml(x.templateId || "")}</div>
                </div>
                <div class="row__right"> </div>
              </div>
            `;
          }).join("") || `<div style="color:rgba(240,244,255,.60);">Nenhuma missão concluída ainda.</div>`}
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewLibrary() {
    const manifests = await getActiveManifests();
    const articles = getAllArticles(manifests);

    const tags = Array.from(new Set(articles.map(a => a.tag || "Geral"))).sort();
    const currentTag = (getRouteAndQuery().query.tag || "Todos").trim();

    const filtered = currentTag === "Todos"
      ? articles
      : articles.filter(a => (a.tag || "Geral") === currentTag);

    return `
      <div class="section__title">Biblioteca</div>
      <div class="section__sub">Artigos organizados por tema. Use os filtros.</div>

      <div style="display:flex;gap:8px;overflow:auto;padding-bottom:6px;">
        <a class="pill" href="#/library?tag=Todos" style="${currentTag==="Todos" ? "border-color:rgba(91,140,255,.35);background:rgba(91,140,255,.12);" : ""}">Todos</a>
        ${tags.map(t => `
          <a class="pill" href="#/library?tag=${encodeURIComponent(t)}" style="${currentTag===t ? "border-color:rgba(91,140,255,.35);background:rgba(91,140,255,.12);" : ""}">
            ${escapeHtml(t)}
          </a>
        `).join("")}
      </div>

      <div style="height:12px"></div>

      <div class="list">
        ${filtered.map(a => `
          <a class="row" href="#/article?pack=${encodeURIComponent(a.packId)}&id=${encodeURIComponent(a.id)}">
            <div class="row__left">📚</div>
            <div class="row__body">
              <div class="row__title">${escapeHtml(a.title)}</div>
              <div class="row__sub">${escapeHtml(a.tag || "Geral")} • ${escapeHtml(a.packTitle)}</div>
            </div>
            <div class="row__right">›</div>
          </a>
        `).join("") || `<div style="color:rgba(240,244,255,.60);">Nada neste filtro ainda.</div>`}
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewProfile() {
    const st = store.get();
    const u = st.user;

    return `
      <div class="section__title">Perfil</div>
      <div class="section__sub">Ajuste objetivo, minutos/dia e veja seu progresso.</div>

      <div class="panel">
        <div class="grid grid--2">
          <div>
            <label class="lab">Nome</label>
            <input id="pfName" class="input" value="${escapeHtml(u.name || "Aluno")}" />
          </div>
          <div>
            <label class="lab">Objetivo</label>
            <select id="pfGoal" class="input">
              ${["Popular","Erudito","Coral","Misto"].map(x => `<option ${x===u.goal?"selected":""}>${x}</option>`).join("")}
            </select>
          </div>
        </div>

        <div style="height:10px"></div>
        <label class="lab">Minutos por dia</label>
        <input id="pfMin" class="input" type="number" min="5" max="60" step="1" value="${u.minutesPerDay || 10}" />

        <div style="height:12px"></div>
        <div style="color:rgba(240,244,255,.70);line-height:1.45;">
          XP: <b>${st.gamification.xp}</b> • Nível: <b>${st.gamification.level}</b> • Streak: <b>${st.gamification.streak}</b><br/>
          Placement: <b>${u.placementDone ? "Concluído" : "Pendente"}</b> ${u.levelReal ? `• Nível auto: <b>${escapeHtml(u.levelReal)}</b>` : ""}
        </div>

        <div style="height:14px"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
          <button class="btn" data-action="goPlacement">${u.placementDone ? "Ver/Refazer placement" : "Fazer placement"}</button>
          <button class="btn btnPrimary" data-action="saveProfile">Salvar</button>
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewPack(packId) {
    const man = await loadManifest(packId).catch(() => getFallbackBaseManifest());
    const paths = (man.paths || []);
    const articles = (man.library || []);

    return `
      <div class="section__title">${escapeHtml(man.title)}</div>
      <div class="section__sub">${escapeHtml(man.desc || "")}</div>

      <div class="panel">
        <div class="panel__title">Trilhas</div>
        <div class="list">
          ${paths.map(p => `
            <a class="row" href="#/path?pack=${encodeURIComponent(man.id)}&id=${encodeURIComponent(p.id)}">
              <div class="row__left">🧭</div>
              <div class="row__body">
                <div class="row__title">${escapeHtml(p.title)}</div>
                <div class="row__sub">${escapeHtml(p.desc || "")}</div>
              </div>
              <div class="row__right">›</div>
            </a>
          `).join("") || `<div style="color:rgba(240,244,255,.60);">Sem trilhas ainda.</div>`}
        </div>
      </div>

      <div style="height:12px"></div>

      <div class="panel">
        <div class="panel__title">Biblioteca</div>
        <div class="list">
          ${articles.map(a => `
            <a class="row" href="#/article?pack=${encodeURIComponent(man.id)}&id=${encodeURIComponent(a.id)}">
              <div class="row__left">📚</div>
              <div class="row__body">
                <div class="row__title">${escapeHtml(a.title)}</div>
                <div class="row__sub">${escapeHtml(a.tag || "Geral")}</div>
              </div>
              <div class="row__right">›</div>
            </a>
          `).join("") || `<div style="color:rgba(240,244,255,.60);">Sem artigos ainda.</div>`}
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewPath(packId, pathId) {
    const man = await loadManifest(packId).catch(() => getFallbackBaseManifest());
    const p = (man.paths || []).find(x => x.id === pathId);
    if (!p) return `<div class="panel">Trilha não encontrada.</div>${bottomSpacer()}`;

    const st = store.get();
    const lessons = (p.lessons || []).map(l => {
      const done = !!st.progress.completedLessons[`${packId}:${l.id}`];
      return { ...l, done };
    });

    return `
      <div class="section__title">${escapeHtml(p.title)}</div>
      <div class="section__sub">${escapeHtml(p.desc || man.title || "")}</div>

      <div class="panel">
        <div class="panel__title">Lições</div>
        <div class="list">
          ${lessons.map(l => `
            <a class="row" href="#/lesson?pack=${encodeURIComponent(packId)}&path=${encodeURIComponent(pathId)}&id=${encodeURIComponent(l.id)}">
              <div class="row__left">${l.done ? "✅" : "🎧"}</div>
              <div class="row__body">
                <div class="row__title">${escapeHtml(l.title)}</div>
                <div class="row__sub">${l.done ? "Concluída" : "Toque para abrir"}</div>
              </div>
              <div class="row__right">›</div>
            </a>
          `).join("")}
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewLesson(packId, pathId, lessonId) {
    const man = await loadManifest(packId).catch(() => getFallbackBaseManifest());
    const p = (man.paths || []).find(x => x.id === pathId);
    const l = p?.lessons?.find(x => x.id === lessonId);
    if (!l) return `<div class="panel">Lição não encontrada.</div>${bottomSpacer()}`;

    const md = await resolveMd(packId, l.md);
    const st = store.get();
    const done = !!st.progress.completedLessons[`${packId}:${lessonId}`];

    return `
      <div class="panel">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div>
            <div style="color:rgba(240,244,255,.55);font-size:12px;">${escapeHtml(man.title)} • ${escapeHtml(p?.title || "")}</div>
            <div class="panel__title">${escapeHtml(l.title)}</div>
          </div>
          <a class="btn" href="#/path?pack=${encodeURIComponent(packId)}&id=${encodeURIComponent(pathId)}">Voltar</a>
        </div>

        <div style="height:12px"></div>
        <div class="md">${mdToHtml(md)}</div>

        <div style="height:14px"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
          <button class="btn" data-action="markLessonDone" data-pack="${escapeHtml(packId)}" data-lesson="${escapeHtml(lessonId)}" data-path="${escapeHtml(pathId)}">
            ${done ? "Concluída ✅" : "Marcar como concluída"}
          </button>
          <a class="btn btnPrimary" href="#/missions">Ir para missões</a>
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewArticle(packId, articleId) {
    const man = await loadManifest(packId).catch(() => getFallbackBaseManifest());
    const a = (man.library || []).find(x => x.id === articleId);
    if (!a) return `<div class="panel">Artigo não encontrado.</div>${bottomSpacer()}`;

    const md = await resolveMd(packId, a.md);

    return `
      <div class="panel">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div>
            <div style="color:rgba(240,244,255,.55);font-size:12px;">${escapeHtml(man.title)} • ${escapeHtml(a.tag || "Geral")}</div>
            <div class="panel__title">${escapeHtml(a.title)}</div>
          </div>
          <a class="btn" href="#/library">Voltar</a>
        </div>

        <div style="height:12px"></div>
        <div class="md">${mdToHtml(md)}</div>
      </div>

      ${bottomSpacer()}
    `;
  }

  async function viewPlacement() {
    const st = store.get();
    const step = Number(getRouteAndQuery().query.step || "0");
    const done = !!st.user.placementDone;

    if (step <= 0) {
      return `
        <div class="panel">
          <div class="panel__title">Teste de placement</div>
          <div style="color:rgba(240,244,255,.72);line-height:1.45;">
            Ajuda o app a ajustar trilha, intensidade e plano inicial (14 dias).
          </div>
          <div style="height:12px"></div>
          <button class="btn btnPrimary" data-action="placementStart">${done ? "Refazer" : "Começar"}</button>
        </div>
        ${bottomSpacer()}
      `;
    }

    const qIndex = step - 1;
    const q = PLACEMENT_QUESTIONS[qIndex];
    if (!q) {
      const { score, result, plan14 } = runPlacementAndBuildResult();
      return `
        <div class="panel">
          <div style="color:rgba(240,244,255,.55);font-size:12px;">Resultado</div>
          <div class="panel__title">${escapeHtml(result)}</div>
          <div style="color:rgba(240,244,255,.72);line-height:1.45;">
            Pontuação: <b>${score}</b><br/>
            Plano inicial gerado (14 dias).
          </div>

          <div style="height:12px"></div>
          <div class="list">
            ${plan14.map(p => `
              <div class="row" style="cursor:default;">
                <div class="row__left">📅</div>
                <div class="row__body">
                  <div class="row__title">Dia ${p.day}: ${escapeHtml(p.focus)}</div>
                  <div class="row__sub">${p.intensity === "leve" ? "Leve" : "Moderado"}</div>
                </div>
                <div class="row__right"></div>
              </div>
            `).join("")}
          </div>

          <div style="height:14px"></div>
          <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
            <button class="btn" data-action="placementReset">Refazer</button>
            <button class="btn btnPrimary" data-action="placementSave">Salvar e continuar</button>
          </div>
        </div>
        ${bottomSpacer()}
      `;
    }

    return `
      <div class="panel">
        <div style="color:rgba(240,244,255,.55);font-size:12px;">Pergunta ${qIndex + 1} de ${PLACEMENT_QUESTIONS.length}</div>
        <div class="panel__title">${escapeHtml(q.title)}</div>
        <div style="color:rgba(240,244,255,.72);line-height:1.45;">${escapeHtml(q.question)}</div>

        <div style="height:12px"></div>
        <div style="display:grid;gap:10px;">
          ${q.options.map(o => `
            <button class="btn" data-action="placementAnswer" data-q="${escapeHtml(q.id)}" data-score="${o.score}" data-next="${step + 1}">
              ${escapeHtml(o.label)}
            </button>
          `).join("")}
        </div>
      </div>
      ${bottomSpacer()}
    `;
  }

  /* =============================
     Admin (stub simples)
  ============================= */
  async function viewAdmin() {
    const enabled = localStorage.getItem(LS.ADMIN) === "1";
    return `
      <div class="section__title">Admin</div>
      <div class="section__sub">Área reservada (por enquanto: liberar/desligar).</div>

      <div class="panel">
        <div class="panel__title">Acesso</div>
        <div style="color:rgba(240,244,255,.72);line-height:1.45;">
          Status: <b>${enabled ? "Liberado" : "Bloqueado"}</b>
        </div>

        <div style="height:12px"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;">
          <button class="btn" data-action="adminToggle">${enabled ? "Desativar" : "Ativar"}</button>
          <a class="btn" href="#/home">Voltar</a>
        </div>
      </div>

      ${bottomSpacer()}
    `;
  }
/* =============================
     Router + Render + Tabbar Active
  ============================= */
  function setActiveTab(route) {
    const map = {
      home: "#/home",
      tracks: "#/tracks",
      missions: "#/missions",
      library: "#/library",
      profile: "#/profile"
    };
    const target = map[route] || "#/home";
    $$(".tabbar__item").forEach(a => {
      const href = (a.getAttribute("href") || "").trim();
      const isActive = href === target;
      if (isActive) a.classList.add("is-active");
      else a.classList.remove("is-active");
    });
  }

  async function render() {
    const root = $("#app");
    if (!root) return;

    const { route, query } = getRouteAndQuery();
    setActiveTab(route);

    let html = "";
    try {
      if (route === "home") html = await viewHome();
      else if (route === "tracks") html = await viewTracks();
      else if (route === "missions") html = await viewMissions();
      else if (route === "library") html = await viewLibrary();
      else if (route === "profile") html = await viewProfile();
      else if (route === "placement") html = await viewPlacement();
      else if (route === "pack") html = await viewPack(String(query.id || "base"));
      else if (route === "path") html = await viewPath(String(query.pack || "base"), String(query.id || ""));
      else if (route === "lesson") html = await viewLesson(String(query.pack || "base"), String(query.path || ""), String(query.id || ""));
      else if (route === "article") html = await viewArticle(String(query.pack || "base"), String(query.id || ""));
      else if (route === "admin") html = await viewAdmin();
      else html = await viewHome();
    } catch (e) {
      html = `
        <div class="panel">
          <div class="panel__title">Erro</div>
          <div style="color:rgba(240,244,255,.72);line-height:1.45;">
            Algo falhou ao renderizar esta tela.
          </div>
          <div style="height:12px"></div>
          <div style="color:rgba(240,244,255,.55);font-size:12px;word-break:break-word;">
            ${escapeHtml(e?.message || String(e))}
          </div>
          <div style="height:12px"></div>
          <a class="btn btnPrimary" href="#/home">Voltar</a>
        </div>
        ${bottomSpacer()}
      `;
    }

    root.innerHTML = html;
    bindActions();
  }

  function bindActions() {
    $$("[data-action]").forEach(el => {
      el.addEventListener("click", async (ev) => {
        const a = el.getAttribute("data-action");
        if (!a) return;

        if (a === "goPlacement") { ev.preventDefault(); setHash("placement"); return; }
        if (a === "goProfile") { ev.preventDefault(); setHash("profile"); return; }

        if (a === "saveProfile") {
          ev.preventDefault();
          const name = ($("#pfName")?.value || "Aluno").trim() || "Aluno";
          const goal = ($("#pfGoal")?.value || "Misto").trim() || "Misto";
          const min = clamp(parseInt($("#pfMin")?.value || "10", 10) || 10, 5, 60);

          store.set(s => {
            s.user.name = name;
            s.user.goal = goal;
            s.user.minutesPerDay = min;
          });

          toast("Perfil salvo");
          render();
          return;
        }

        if (a === "completeMission") { ev.preventDefault(); completeTodayMission(); return; }
        if (a === "rerollMission") { ev.preventDefault(); await rerollTodayMission(); return; }

        if (a === "diary") {
          ev.preventDefault();
          const status = el.getAttribute("data-status") || "ok";
          const note = prompt("Quer deixar uma nota rápida? (opcional)") || "";
          addDiaryEntry(status, note);
          return;
        }

        if (a === "markLessonDone") {
          ev.preventDefault();
          const packId = el.getAttribute("data-pack") || "base";
          const lessonId = el.getAttribute("data-lesson") || "";
          const pathId = el.getAttribute("data-path") || "";
          if (!lessonId) return;

          store.set(s => {
            s.progress.completedLessons[`${packId}:${lessonId}`] = { at: new Date().toISOString() };
            s.progress.continue = { packId, pathId, lessonId };
          });
          addXP(8, "Lição concluída");
          toast("Lição concluída ✅");
          render();
          return;
        }

        if (a === "placementStart") {
          ev.preventDefault();
          store.set(s => { s.placement.answers = {}; s.placement.score = 0; s.placement.result = null; s.placement.plan14 = []; });
          setHash("placement", { step: "1" });
          return;
        }

        if (a === "placementAnswer") {
          ev.preventDefault();
          const qid = el.getAttribute("data-q");
          const score = Number(el.getAttribute("data-score") || "0");
          const next = el.getAttribute("data-next") || "2";
          if (!qid) return;

          store.set(s => { s.placement.answers[qid] = score; });
          setHash("placement", { step: next });
          return;
        }

        if (a === "placementReset") {
          ev.preventDefault();
          store.set(s => { s.placement.answers = {}; s.placement.score = 0; s.placement.result = null; s.placement.plan14 = []; });
          setHash("placement");
          return;
        }

        if (a === "placementSave") {
          ev.preventDefault();
          const { score, result, plan14 } = runPlacementAndBuildResult();
          store.set(s => {
            s.placement.score = score;
            s.placement.result = result;
            s.placement.plan14 = plan14;
            s.user.levelReal = result;
            s.user.placementDone = true;
          });
          addXP(15, "Placement");
          toast("Placement salvo");
          setHash("home");
          return;
        }

        if (a === "adminToggle") {
          ev.preventDefault();
          const enabled = localStorage.getItem(LS.ADMIN) === "1";
          localStorage.setItem(LS.ADMIN, enabled ? "0" : "1");
          toast(enabled ? "Admin desativado" : "Admin ativado");
          render();
          return;
        }
      }, { passive: false });
    });
  }

  /* =============================
     Boot
  ============================= */
  window.addEventListener("hashchange", () => render());
  window.addEventListener("load", () => render());

})();