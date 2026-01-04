/* =========================================================
   IMVpedia Voice — app.js (FINAL / FIX TABS)
   ---------------------------------------------------------
   Objetivo deste build:
   - Corrigir navegação por hash (#/home, #/path, #/missions, #/library, #/profile, etc.)
   - Garantir que TODAS as telas renderizem conteúdo (mesmo que mínimo)
   - Manter visual existente (styles.css) — sem reestruturar layout
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
      contentVersion: "fix-tabs-v1"
    },
    user: {
      id: uid(),
      name: "",
      avatar: "🎤",
      goal: "Misto",
      levelSelf: "Iniciante",
      levelReal: null,
      minutesPerDay: 10,
      placementDone: false,
      recommendedPath: null
    },
    gamification: {
      xp: 0,
      level: 1,
      streak: 0,
      lastActiveDate: null,
      badges: []
    },
    packs: {
      activePackIds: ["base"],
      seen: {}
    },
    progress: {
      lastRoute: "home",
      completedLessons: {},
      continue: null,

      todayMission: null,
      completedMissions: {},
      week: {}
    },
    diary: {
      lastCheckinDate: null,
      lastStatus: null,
      entries: []
    },
    placement: {
      answers: {},
      score: 0,
      result: null,
      plan14: []
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
     Packs Loader (DLC + custom)
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
    if (!arr.length) {
      arr.push(normalizeManifest({
        id: "base",
        title: "Base — Voz Perfeita",
        desc: "Fundamentos universais (apoio, SOVT, afinação, ressonância, registros, saúde vocal).",
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
            { id: "m_sovt_10", title: "SOVT leve", minutesMin: 8, minutesMax: 12, xp: 12, kind: "técnica", desc: "Lip trill/humming/canudo na região confortável, sem apertar." },
            { id: "m_afina_10", title: "Afinação", minutesMin: 8, minutesMax: 12, xp: 12, kind: "musical", desc: "Notas longas e ataques suaves." }
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
     Missions
  ============================= */
  function pickDailyMission(manifests) {
    const date = todayISO();
    const st = store.get();

    if (st.progress.todayMission && st.progress.todayMission.date === date) return st.progress.todayMission;

    // pool templates from active packs
    const pool = [];
    for (const m of manifests) {
      (m.missions?.templates || []).forEach(t => pool.push({ packId: m.id, templateId: t.id, template: t }));
    }

    if (!pool.length) return null;

    // deterministic-ish: based on date string
    let seed = 0;
    for (let i = 0; i < date.length; i++) seed = (seed * 31 + date.charCodeAt(i)) >>> 0;
    const picked = pool[seed % pool.length];

    const minutesPlanned = clamp(
      Math.round((picked.template.minutesMin + picked.template.minutesMax) / 2),
      picked.template.minutesMin,
      picked.template.minutesMax
    );

    const mission = { date, packId: picked.packId, templateId: picked.templateId, minutesPlanned };

    store.set(s => { s.progress.todayMission = mission; });
    return mission;
  }

  function completeTodayMission(manifests) {
    const st = store.get();
    const m = st.progress.todayMission;
    if (!m) return;

    const date = m.date;
    if (st.progress.completedMissions[date]) { toast("Missão de hoje já concluída."); return; }

    const man = manifests.find(x => x.id === m.packId);
    const tpl = (man?.missions?.templates || []).find(t => t.id === m.templateId);
    const xp = tpl?.xp ?? 10;

    store.set(s => {
      s.progress.completedMissions[date] = { at: new Date().toISOString(), packId: m.packId, templateId: m.templateId, xp };
      // week
      const ws = startOfWeekISO(date);
      if (!s.progress.week[ws]) s.progress.week[ws] = { daysCompleted: 0, diaryNotesCount: 0, claimed: {} };
      s.progress.week[ws].daysCompleted = Object.keys(s.progress.completedMissions)
        .filter(d => startOfWeekISO(d) === ws).length;
    });

    addXP(xp, "Missão concluída");
    ensureBadge(store.get(), "first_mission");
  }

  /* =============================
     UI bits (mantendo classes do CSS)
  ============================= */
  function btn(text, action, data = {}, kind = "btn") {
    const dataAttrs = Object.entries(data).map(([k, v]) => `data-${k}="${escapeHtml(String(v))}"`).join(" ");
    return `<button class="${kind}" type="button" data-action="${escapeHtml(action)}" ${dataAttrs}>${escapeHtml(text)}</button>`;
  }

  function pill(text, icon = "") {
    return `<span class="pill">${icon ? `${escapeHtml(icon)} ` : ""}${escapeHtml(text)}</span>`;
  }

  function cardPack(p) {
    const cover = p.cover ? `<img src="${escapeHtml(p.cover)}" alt="" />` : `<div class="card__fallback">♪</div>`;
    return `
      <div class="card card--pack" data-action="openPack" data-pack="${escapeHtml(p.id)}" role="button" tabindex="0">
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
      <div class="row" data-action="${escapeHtml(action)}" ${dataAttrs} role="button" tabindex="0">
        <div class="row__left">${escapeHtml(icon)}</div>
        <div class="row__body">
          <div class="row__title">${escapeHtml(title)}</div>
          <div class="row__sub">${escapeHtml(sub)}</div>
        </div>
        <div class="row__right">›</div>
      </div>
    `;
  }

  function sectionTitle(title, right = "") {
    return `
      <div class="sectionHead">
        <div class="sectionTitle">${escapeHtml(title)}</div>
        <div class="sectionRight">${right}</div>
      </div>
    `;
  }

  /* =============================
     Renders
  ============================= */
  async function renderHome() {
    const view = $("#view");
    if (!view) return;

    const st = store.get();
    const name = (st.user.name || "Aluno").trim() || "Aluno";
    const level = st.gamification.level || 1;
    const streak = st.gamification.streak || 0;

    const manifests = await getActiveManifests();
    const mission = pickDailyMission(manifests);

    const ws = startOfWeekISO(todayISO());
    const week = st.progress.week[ws] || { daysCompleted: 0, diaryNotesCount: 0 };

    const idx = await loadPackIndex();
    const activeIds = new Set(st.packs.activePackIds || ["base"]);
    const packsToShow = (idx.packs || []).filter(p => activeIds.has(p.id));

    // mission card data
    let missionHtml = `<div class="empty">Sem missão disponível (sem templates no pack).</div>`;
    if (mission) {
      const man = manifests.find(x => x.id === mission.packId);
      const tpl = (man?.missions?.templates || []).find(t => t.id === mission.templateId);
      const done = !!st.progress.completedMissions[mission.date];

      missionHtml = `
        <div class="card card--mission">
          <div class="card__body">
            <div class="muted">${escapeHtml(mission.date)} • ${escapeHtml(tpl?.kind || "técnica")}</div>
            <div class="card__title">${escapeHtml(tpl?.title || "Missão do dia")}</div>
            <div class="card__desc">${escapeHtml(tpl?.desc || "")}</div>
          </div>
          <div class="missionMeta">
            <div class="bubble"><div class="bubble__icon">⏱</div><div class="bubble__text">${escapeHtml(String(mission.minutesPlanned))} min</div></div>
            <div class="bubble"><div class="bubble__icon">✨</div><div class="bubble__text">+${escapeHtml(String(tpl?.xp ?? 10))} XP</div></div>
          </div>
          <div class="card__actions">
            ${btn("Trocar", "swapMission", {}, "btn btn--ghost")}
            ${btn(done ? "Concluída" : "Concluir", "completeMission", {}, done ? "btn btn--ghost" : "btn btn--primary")}
          </div>
        </div>
      `;
    }

    view.innerHTML = `
      <div class="page">
        <div class="hero">
          <div class="hero__top">${escapeHtml(`Olá, ${name} • Nível ${level} • Streak ${streak}`)} <span class="muted">🔥</span></div>
          <div class="hero__title">IMVpedia Voice</div>
          <div class="hero__sub">Trilha vocal guiada com técnica, saúde e repertório (popular, erudito e coral).</div>
          <div class="hero__actions">
            ${btn("Fazer placement", "goPlacement", {}, "btn btn--primary")}
            ${btn("Perfil", "goProfile", {}, "btn btn--ghost")}
          </div>
        </div>

        ${sectionTitle("Missão do dia")}
        ${missionHtml}

        ${sectionTitle("Semana", `<span class="muted">${escapeHtml(ws)} →</span>`)}
        <div class="card card--week">
          <div class="card__body">
            <div class="progressRow">
              <span class="muted">progresso semanal</span>
            </div>
            <div class="progressBar"><div class="progressBar__fill" style="width:${clamp((week.daysCompleted / 7) * 100, 0, 100)}%"></div></div>
            <div class="weekStats">
              <div class="weekStat">Missões concluídas: <b>${escapeHtml(String(week.daysCompleted))}/7</b></div>
              <div class="weekStat">Check-ins no diário: <b>${escapeHtml(String(week.diaryNotesCount || 0))}</b></div>
            </div>
          </div>
        </div>

        ${sectionTitle("Packs", btn("Gerenciar packs", "managePacks", {}, "btn btn--ghost"))}
        <div class="grid">
          ${packsToShow.length ? packsToShow.map(cardPack).join("") : `<div class="empty">Nenhum pack ativo.</div>`}
        </div>

        ${bottomSpacer()}
      </div>
    `;
  }

  async function renderPath() {
    const view = $("#view");
    if (!view) return;

    const { query } = getRouteAndQuery();
    const manifests = await getActiveManifests();

    // Se veio packId/pathId, mostra lições daquela trilha
    if (query.packId && query.pathId) {
      const man = manifests.find(m => m.id === query.packId);
      const path = (man?.paths || []).find(p => p.id === query.pathId);

      const lessons = (path?.lessons || []);
      view.innerHTML = `
        <div class="page">
          ${sectionTitle(path?.title || "Trilha", btn("Voltar", "goBack", {}, "btn btn--ghost"))}
          <div class="muted">${escapeHtml(path?.desc || man?.title || "")}</div>
          <div class="list">
            ${lessons.length ? lessons.map(l => rowItem({
              icon: "🎵",
              title: l.title || l.id,
              sub: man?.title || query.packId,
              action: "openLesson",
              data: { pack: query.packId, lesson: l.id }
            })).join("") : `<div class="empty">Sem lições nesta trilha.</div>`}
          </div>
          ${bottomSpacer()}
        </div>
      `;
      return;
    }

    // Caso padrão: lista todas as trilhas dos packs ativos
    const paths = getAllPathsFromManifests(manifests);
    view.innerHTML = `
      <div class="page">
        ${sectionTitle("Trilha", "")}
        <div class="list">
          ${paths.length ? paths.map(p => rowItem({
            icon: "🧭",
            title: p.title || p.id,
            sub: `${p.packTitle || p.packId} • ${(p.lessons || []).length} lições`,
            action: "openPath",
            data: { pack: p.packId, path: p.id }
          })).join("") : `<div class="empty">Nenhuma trilha encontrada nos packs ativos.</div>`}
        </div>
        ${bottomSpacer()}
      </div>
    `;
  }

  async function renderMissions() {
    const view = $("#view");
    if (!view) return;

    const st = store.get();
    const manifests = await getActiveManifests();
    const mission = pickDailyMission(manifests);

    const history = Object.entries(st.progress.completedMissions || {})
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14)
      .reverse();

    let today = `<div class="empty">Sem missão configurada.</div>`;
    if (mission) {
      const man = manifests.find(x => x.id === mission.packId);
      const tpl = (man?.missions?.templates || []).find(t => t.id === mission.templateId);
      const done = !!st.progress.completedMissions[mission.date];

      today = `
        <div class="card card--mission">
          <div class="card__body">
            <div class="muted">${escapeHtml(mission.date)} • ${escapeHtml(tpl?.kind || "técnica")}</div>
            <div class="card__title">${escapeHtml(tpl?.title || "Missão do dia")}</div>
            <div class="card__desc">${escapeHtml(tpl?.desc || "")}</div>
          </div>
          <div class="card__actions">
            ${btn("Trocar", "swapMission", {}, "btn btn--ghost")}
            ${btn(done ? "Concluída" : "Concluir", "completeMission", {}, done ? "btn btn--ghost" : "btn btn--primary")}
          </div>
        </div>
      `;
    }

    view.innerHTML = `
      <div class="page">
        ${sectionTitle("Missões", "")}
        ${today}

        <div style="height:14px"></div>
        ${sectionTitle("Histórico", `<span class="muted">últimos 14</span>`)}
        <div class="list">
          ${history.length ? history.map(([date, rec]) => rowItem({
            icon: "✅",
            title: `${date} • +${rec.xp} XP`,
            sub: `${rec.packId} • ${rec.templateId}`,
            action: "noop",
            data: {}
          })).join("") : `<div class="empty">Nenhuma missão concluída ainda.</div>`}
        </div>
        ${bottomSpacer()}
      </div>
    `;
  }

  async function renderLibrary() {
    const view = $("#view");
    if (!view) return;

    const { query } = getRouteAndQuery();
    const manifests = await getActiveManifests();

    // Se abrir artigo
    if (query.packId && query.articleId) {
      const man = manifests.find(m => m.id === query.packId);
      const art = (man?.library || []).find(a => a.id === query.articleId);
      const md = await resolveMd(query.packId, art?.md || "");
      view.innerHTML = `
        <div class="page">
          ${sectionTitle(art?.title || "Artigo", btn("Voltar", "goBack", {}, "btn btn--ghost"))}
          <div class="markdown">${mdToHtml(md || "# Conteúdo em breve\n")}</div>
          ${bottomSpacer()}
        </div>
      `;
      return;
    }

    // lista artigos por tag
    const all = [];
    for (const m of manifests) {
      (m.library || []).forEach(a => all.push({ ...a, packId: m.id, packTitle: m.title }));
    }
    all.sort((a, b) => (a.tag || "").localeCompare(b.tag || "") || (a.title || "").localeCompare(b.title || ""));

    view.innerHTML = `
      <div class="page">
        ${sectionTitle("Biblioteca", "")}
        <div class="list">
          ${all.length ? all.map(a => rowItem({
            icon: "📚",
            title: a.title || a.id,
            sub: `${a.tag || "Geral"} • ${a.packTitle || a.packId}`,
            action: "openArticle",
            data: { pack: a.packId, article: a.id }
          })).join("") : `<div class="empty">Nenhum artigo nos packs ativos.</div>`}
        </div>
        ${bottomSpacer()}
      </div>
    `;
  }

  async function renderProfile() {
    const view = $("#view");
    if (!view) return;

    const st = store.get();
    const levelReal = st.user.levelReal || "—";
    const name = st.user.name || "";

    view.innerHTML = `
      <div class="page">
        ${sectionTitle("Perfil", "")}

        <div class="card">
          <div class="card__body">
            <div class="rowLine"><span class="muted">Nome</span><b>${escapeHtml(name || "Aluno")}</b></div>
            <div class="rowLine"><span class="muted">Avatar</span><b>${escapeHtml(st.user.avatar || "🎤")}</b></div>
            <div class="rowLine"><span class="muted">Meta</span><b>${escapeHtml(st.user.goal || "Misto")}</b></div>
            <div class="rowLine"><span class="muted">Nível (XP)</span><b>${escapeHtml(String(st.gamification.level || 1))}</b></div>
            <div class="rowLine"><span class="muted">Placement</span><b>${escapeHtml(levelReal)}</b></div>
          </div>
          <div class="card__actions">
            ${btn("Editar", "editProfile", {}, "btn btn--ghost")}
            ${btn("Refazer placement", "goPlacement", {}, "btn btn--primary")}
          </div>
        </div>

        <div style="height:14px"></div>
        ${sectionTitle("Badges", "")}
        <div class="badges">
          ${(st.gamification.badges || []).length
            ? (st.gamification.badges || []).map(b => `<span class="badge">${escapeHtml(b)}</span>`).join("")
            : `<div class="empty">Sem badges ainda.</div>`}
        </div>

        ${bottomSpacer()}
      </div>
    `;
  }

  /* =============================
     Placement (mínimo e funcional)
  ============================= */
  const PLACEMENT_QUESTIONS = [
    { id: "experience", title: "Experiência vocal", q: "Há quanto tempo você canta com alguma regularidade?",
      options: [{l:"Nunca estudei canto",s:0},{l:"Menos de 1 ano",s:1},{l:"1 a 3 anos",s:2},{l:"Mais de 3 anos",s:3}] },
    { id: "technique", title: "Consciência técnica", q: "Você já estudou técnica vocal formalmente?",
      options: [{l:"Nunca",s:0},{l:"Pouco / vídeos soltos",s:1},{l:"Com professor ou método",s:2},{l:"Estudo contínuo e aplicado",s:3}] },
    { id: "range", title: "Extensão confortável", q: "Sua voz se mantém confortável em notas médias e agudas?",
      options: [{l:"Não, forço ou evito",s:0},{l:"Às vezes",s:1},{l:"Sim, com controle",s:2},{l:"Sim, com facilidade",s:3}] },
    { id: "health", title: "Saúde vocal", q: "Com que frequência você sente rouquidão ou cansaço?",
      options: [{l:"Quase sempre",s:0},{l:"Às vezes",s:1},{l:"Raramente",s:2},{l:"Quase nunca",s:3}] },
    { id: "reading", title: "Leitura / percepção", q: "Você consegue repetir melodias ou ler cifras/partitura?",
      options: [{l:"Tenho muita dificuldade",s:0},{l:"Consigo com ajuda",s:1},{l:"Consigo bem",s:2},{l:"Com facilidade",s:3}] }
  ];

  function calcPlacement(score) {
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

  async function renderPlacement() {
    const view = $("#view");
    if (!view) return;
    const st = store.get();
    const answers = st.placement.answers || {};

    const qCards = PLACEMENT_QUESTIONS.map(q => {
      const current = answers[q.id];
      const options = q.options.map(o => {
        const active = (current === o.s) ? "is-active" : "";
        return `<button class="chip ${active}" type="button" data-action="setPlacement" data-q="${escapeHtml(q.id)}" data-score="${escapeHtml(String(o.s))}">${escapeHtml(o.l)}</button>`;
      }).join("");
      return `
        <div class="card">
          <div class="card__body">
            <div class="card__title">${escapeHtml(q.title)}</div>
            <div class="card__desc">${escapeHtml(q.q)}</div>
            <div class="chips">${options}</div>
          </div>
        </div>
      `;
    }).join("");

    view.innerHTML = `
      <div class="page">
        ${sectionTitle("Placement", btn("Voltar", "goBack", {}, "btn btn--ghost"))}
        <div class="muted">Responda para recomendarmos sua trilha inicial.</div>
        <div style="height:10px"></div>
        ${qCards}
        <div class="card">
          <div class="card__actions">
            ${btn("Calcular resultado", "finishPlacement", {}, "btn btn--primary")}
          </div>
        </div>
        ${bottomSpacer()}
      </div>
    `;
  }

  /* =============================
     Packs management (mínimo)
  ============================= */
  async function renderManagePacks() {
    const view = $("#view");
    if (!view) return;

    const st = store.get();
    const idx = await loadPackIndex();
    const active = new Set(st.packs.activePackIds || ["base"]);

    const rows = (idx.packs || []).map(p => {
      const isOn = active.has(p.id);
      return `
        <div class="card">
          <div class="card__body">
            <div class="card__title">${escapeHtml(p.title || p.id)}</div>
            <div class="card__desc">${escapeHtml(p.desc || "")}</div>
            <div class="muted">ID: ${escapeHtml(p.id)} • ${isOn ? "Ativo" : "Inativo"}</div>
          </div>
          <div class="card__actions">
            ${btn("Abrir", "openPack", { pack: p.id }, "btn btn--ghost")}
            ${btn(isOn ? "Desativar" : "Ativar", "togglePack", { pack: p.id }, isOn ? "btn btn--ghost" : "btn btn--primary")}
          </div>
        </div>
      `;
    }).join("");

    view.innerHTML = `
      <div class="page">
        ${sectionTitle("Gerenciar Packs", "")}
        <div class="muted">Ative/desative packs. Os packs ativos aparecem na Trilha, Biblioteca e Missões.</div>
        <div style="height:12px"></div>
        <div class="card">
          <div class="card__actions">
            ${btn("Voltar", "goBack", {}, "btn btn--ghost")}
            ${btn("Admin", "goAdmin", {}, "btn btn--ghost")}
          </div>
        </div>
        <div style="height:12px"></div>
        <div class="stack">${rows || `<div class="empty">Nenhum pack encontrado.</div>`}</div>
        ${bottomSpacer()}
      </div>
    `;
  }

  async function renderPack(packId) {
    const view = $("#view");
    if (!view) return;

    const man = await loadManifest(packId).catch(() => null);
    if (!man) {
      view.innerHTML = `<div class="page">${sectionTitle("Pack", btn("Voltar", "goBack", {}, "btn btn--ghost"))}<div class="empty">Pack não encontrado.</div>${bottomSpacer()}</div>`;
      return;
    }

    view.innerHTML = `
      <div class="page">
        ${sectionTitle(man.title || man.id, btn("Voltar", "goBack", {}, "btn btn--ghost"))}
        <div class="muted">${escapeHtml(man.desc || "")}</div>

        <div style="height:12px"></div>
        ${sectionTitle("Trilhas", "")}
        <div class="list">
          ${(man.paths || []).length ? (man.paths || []).map(p => rowItem({
            icon: "🧭",
            title: p.title || p.id,
            sub: `${(p.lessons || []).length} lições`,
            action: "openPath",
            data: { pack: man.id, path: p.id }
          })).join("") : `<div class="empty">Sem trilhas neste pack.</div>`}
        </div>

        <div style="height:12px"></div>
        ${sectionTitle("Biblioteca", "")}
        <div class="list">
          ${(man.library || []).length ? (man.library || []).map(a => rowItem({
            icon: "📚",
            title: a.title || a.id,
            sub: `${a.tag || "Geral"}`,
            action: "openArticle",
            data: { pack: man.id, article: a.id }
          })).join("") : `<div class="empty">Sem artigos neste pack.</div>`}
        </div>

        ${bottomSpacer()}
      </div>
    `;
  }

  async function renderLesson(packId, lessonId) {
    const view = $("#view");
    if (!view) return;

    const man = await loadManifest(packId).catch(() => null);
    const lesson = (man?.paths || []).flatMap(p => p.lessons || []).find(l => l.id === lessonId);

    if (!man || !lesson) {
      view.innerHTML = `<div class="page">${sectionTitle("Lição", btn("Voltar", "goBack", {}, "btn btn--ghost"))}<div class="empty">Lição não encontrada.</div>${bottomSpacer()}</div>`;
      return;
    }

    const md = await resolveMd(packId, lesson.md || "");
    view.innerHTML = `
      <div class="page">
        ${sectionTitle(lesson.title || "Lição", btn("Voltar", "goBack", {}, "btn btn--ghost"))}
        <div class="markdown">${mdToHtml(md || "# Conteúdo em breve\n")}</div>

        <div style="height:12px"></div>
        <div class="card">
          <div class="card__actions">
            ${btn("Marcar como concluída", "completeLesson", { pack: packId, lesson: lessonId }, "btn btn--primary")}
            ${btn("Continuar na trilha", "goPathFromLesson", { pack: packId }, "btn btn--ghost")}
          </div>
        </div>

        ${bottomSpacer()}
      </div>
    `;
  }

  /* =============================
     Admin (gate simples)
  ============================= */
  function isAdminEnabled() { return localStorage.getItem(LS.ADMIN) === "1"; }

  function setAdminEnabled(on) {
    try { localStorage.setItem(LS.ADMIN, on ? "1" : "0"); } catch {}
  }

  async function renderAdmin() {
    const view = $("#view");
    if (!view) return;

    if (!isAdminEnabled()) {
      view.innerHTML = `
        <div class="page">
          ${sectionTitle("Admin", btn("Voltar", "goBack", {}, "btn btn--ghost"))}
          <div class="card">
            <div class="card__body">
              <div class="card__title">Acesso restrito</div>
              <div class="card__desc">Digite a senha de admin.</div>
              <input class="input" id="adminPass" type="password" placeholder="Senha" autocomplete="current-password" />
            </div>
            <div class="card__actions">
              ${btn("Entrar", "adminLogin", {}, "btn btn--primary")}
            </div>
          </div>
          ${bottomSpacer()}
        </div>
      `;
      return;
    }

    const custom = getCustomPacks().map(normalizeManifest);

    view.innerHTML = `
      <div class="page">
        ${sectionTitle("Admin", btn("Voltar", "goBack", {}, "btn btn--ghost"))}
        <div class="card">
          <div class="card__body">
            <div class="card__title">Packs custom (${custom.length})</div>
            <div class="card__desc">Crie, importe e exporte manifests via JSON (LocalStorage).</div>
          </div>
          <div class="card__actions">
            ${btn("Criar pack", "createCustomPack", {}, "btn btn--primary")}
            ${btn("Importar JSON", "importPack", {}, "btn btn--ghost")}
            ${btn("Exportar tudo", "exportAllPacks", {}, "btn btn--ghost")}
            ${btn("Sair", "adminLogout", {}, "btn btn--ghost")}
          </div>
        </div>

        <div style="height:12px"></div>
        <div class="stack">
          ${custom.length ? custom.map(p => `
            <div class="card">
              <div class="card__body">
                <div class="card__title">${escapeHtml(p.title)}</div>
                <div class="muted">ID: ${escapeHtml(p.id)}</div>
              </div>
              <div class="card__actions">
                ${btn("Editar JSON", "editPackJson", { pack: p.id }, "btn btn--ghost")}
                ${btn("Excluir", "deletePack", { pack: p.id }, "btn btn--ghost")}
              </div>
            </div>
          `).join("") : `<div class="empty">Nenhum pack custom ainda.</div>`}
        </div>

        ${bottomSpacer()}
      </div>
    `;
  }

  /* =============================
     Router
  ============================= */
  async function render() {
    const view = $("#view");
    if (!view) return;

    const { route, query } = getRouteAndQuery();

    // destaque na tabbar
    $$(".tabbar__item,[data-route]").forEach(el => {
      const r = el.getAttribute("data-route");
      if (!r) return;
      if (r === route) el.classList.add("is-active");
      else el.classList.remove("is-active");
    });

    // fallback: se rota não existe -> home
    const safeRoute = route || "home";

    try {
      if (safeRoute === "home") return await renderHome();
      if (safeRoute === "path") return await renderPath();
      if (safeRoute === "missions") return await renderMissions();
      if (safeRoute === "library") return await renderLibrary();
      if (safeRoute === "profile") return await renderProfile();
      if (safeRoute === "placement") return await renderPlacement();
      if (safeRoute === "packs") return await renderManagePacks();
      if (safeRoute === "pack") return await renderPack(query.packId || "");
      if (safeRoute === "lesson") return await renderLesson(query.packId || "", query.lessonId || "");
      if (safeRoute === "admin") return await renderAdmin();

      // rota desconhecida
      view.innerHTML = `<div class="page">${sectionTitle("404", btn("Ir para Início", "goHome", {}, "btn btn--primary"))}<div class="empty">Página não encontrada.</div>${bottomSpacer()}</div>`;
    } catch (err) {
      console.error(err);
      view.innerHTML = `<div class="page">${sectionTitle("Erro", btn("Ir para Início", "goHome", {}, "btn btn--primary"))}<div class="empty">Ocorreu um erro ao renderizar esta tela.</div>${bottomSpacer()}</div>`;
    }
  }

  /* =============================
     Events (NAVEGAÇÃO DEFINITIVA)
     - Delegação para data-route (tabbar) e data-action (cards/botões)
  ============================= */
  function onClick(e) {
    const a = e.target.closest("[data-route]");
    if (a) {
      e.preventDefault();
      const r = a.getAttribute("data-route");
      if (r) setHash(r);
      return;
    }

    const el = e.target.closest("[data-action]");
    if (!el) return;

    const action = el.getAttribute("data-action") || "";
    const pack = el.getAttribute("data-pack") || el.getAttribute("data-packId") || el.getAttribute("data-packid") || el.getAttribute("data-pack");
    const path = el.getAttribute("data-path") || el.getAttribute("data-pathId") || el.getAttribute("data-pathid");
    const lesson = el.getAttribute("data-lesson") || el.getAttribute("data-lessonId") || el.getAttribute("data-lessonid");
    const article = el.getAttribute("data-article") || el.getAttribute("data-articleId") || el.getAttribute("data-articleid");
    const qid = el.getAttribute("data-q");
    const score = el.getAttribute("data-score");

    if (action === "goHome") return setHash("home");
    if (action === "goProfile") return setHash("profile");
    if (action === "goPlacement") return setHash("placement");
    if (action === "managePacks") return setHash("packs");
    if (action === "goAdmin") return setHash("admin");
    if (action === "goBack") return history.back();

    if (action === "openPack") return setHash("pack", { packId: pack || "" });
    if (action === "openPath") return setHash("path", { packId: pack || "", pathId: path || "" });
    if (action === "openLesson") return setHash("lesson", { packId: pack || "", lessonId: lesson || "" });
    if (action === "openArticle") return setHash("library", { packId: pack || "", articleId: article || "" });

    if (action === "completeMission") {
      getActiveManifests().then(manifests => { completeTodayMission(manifests); render(); });
      return;
    }

    if (action === "swapMission") {
      // força nova missão: limpa cache do dia e re-render
      store.set(s => { s.progress.todayMission = null; });
      toast("Missão trocada.");
      render();
      return;
    }

    if (action === "togglePack") {
      if (!pack) return;
      store.set(s => {
        const ids = new Set(s.packs.activePackIds || []);
        if (ids.has(pack)) ids.delete(pack);
        else ids.add(pack);
        s.packs.activePackIds = Array.from(ids);
      });
      toast("Packs atualizados.");
      // invalida caches de manifests index, pra refletir custom/active
      packCache.index = null;
      render();
      return;
    }

    if (action === "completeLesson") {
      if (!pack || !lesson) return;
      store.set(s => { s.progress.completedLessons[`${pack}:${lesson}`] = { at: new Date().toISOString() }; });
      addXP(15, "Lição concluída");
      toast("Lição marcada como concluída.");
      render();
      return;
    }

    if (action === "goPathFromLesson") {
      if (!pack) return;
      // tenta achar a trilha que contém a lição (melhor esforço)
      getActiveManifests().then(manifests => {
        const man = manifests.find(m => m.id === pack);
        const found = (man?.paths || []).find(p => (p.lessons || []).some(l => l.id === lesson));
        if (found) setHash("path", { packId: pack, pathId: found.id });
        else setHash("path");
      });
      return;
    }

    if (action === "editProfile") {
      const current = store.get();
      const newName = prompt("Nome:", current.user.name || "") ?? current.user.name;
      const newGoal = prompt("Meta (Popular/Erudito/Coral/Misto):", current.user.goal || "Misto") ?? current.user.goal;
      store.set(s => {
        s.user.name = String(newName || "").slice(0, 40);
        s.user.goal = ["Popular","Erudito","Coral","Misto"].includes(String(newGoal)) ? String(newGoal) : (s.user.goal || "Misto");
      });
      toast("Perfil atualizado.");
      render();
      return;
    }

    if (action === "setPlacement") {
      if (!qid) return;
      const val = Number(score);
      store.set(s => { s.placement.answers[qid] = Number.isFinite(val) ? val : 0; });
      renderPlacement(); // re-render local
      return;
    }

    if (action === "finishPlacement") {
      const st = store.get();
      const answers = st.placement.answers || {};
      const total = Object.values(answers).reduce((acc, v) => acc + (Number(v) || 0), 0);
      const result = calcPlacement(total);
      const plan14 = buildPlan14(result);
      store.set(s => {
        s.placement.score = total;
        s.placement.result = result;
        s.placement.plan14 = plan14;
        s.user.levelReal = result;
        s.user.placementDone = true;
      });
      addXP(20, "Placement");
      toast(`Placement: ${result}`);
      setHash("profile");
      return;
    }

    // Admin actions
    if (action === "adminLogin") {
      const pass = ($("#adminPass")?.value || "").trim();
      if (pass === "imvadmin") {
        setAdminEnabled(true);
        toast("Admin liberado.");
        setHash("admin");
      } else toast("Senha incorreta.");
      return;
    }
    if (action === "adminLogout") {
      setAdminEnabled(false);
      toast("Admin desativado.");
      setHash("home");
      return;
    }
    if (action === "createCustomPack") {
      const title = prompt("Título do pack:", "Meu pack") || "Meu pack";
      const man = normalizeManifest({ title, desc: "Pack custom", cover: "", paths: [], library: [], missions: { templates: [] } });
      const all = getCustomPacks();
      all.push(man);
      saveCustomPacks(all);
      packCache.index = null;
      toast("Pack criado.");
      render();
      return;
    }
    if (action === "deletePack") {
      const pid = el.getAttribute("data-pack") || "";
      if (!pid) return;
      const all = getCustomPacks().filter(p => p.id !== pid);
      saveCustomPacks(all);
      // remove from active if needed
      store.set(s => { s.packs.activePackIds = (s.packs.activePackIds || []).filter(x => x !== pid); });
      packCache.index = null;
      toast("Pack removido.");
      render();
      return;
    }
    if (action === "exportAllPacks") {
      const all = getCustomPacks().map(normalizeManifest);
      navigator.clipboard?.writeText(JSON.stringify(all, null, 2)).then(() => toast("JSON copiado para a área de transferência.")).catch(() => toast("Não foi possível copiar. Use o console."));
      console.log("CUSTOM PACKS JSON:", all);
      return;
    }
    if (action === "importPack") {
      const raw = prompt("Cole o JSON do pack (manifest completo) ou array de packs:");
      if (!raw) return;
      const parsed = safeJsonParse(raw, null);
      if (!parsed) { toast("JSON inválido."); return; }
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const existing = getCustomPacks();
      arr.forEach(p => existing.push(normalizeManifest(p)));
      saveCustomPacks(existing);
      packCache.index = null;
      toast("Importado.");
      render();
      return;
    }
    if (action === "editPackJson") {
      const pid = el.getAttribute("data-pack") || "";
      if (!pid) return;
      const all = getCustomPacks().map(normalizeManifest);
      const packObj = all.find(p => p.id === pid);
      if (!packObj) return toast("Pack não encontrado.");
      const edited = prompt("Edite o JSON do pack:", JSON.stringify(packObj, null, 2));
      if (!edited) return;
      const parsed = safeJsonParse(edited, null);
      if (!parsed) return toast("JSON inválido.");
      const norm = normalizeManifest(parsed);
      const next = all.map(p => (p.id === pid ? norm : p));
      saveCustomPacks(next);
      packCache.index = null;
      toast("Pack atualizado.");
      render();
      return;
    }

    // noop
  }

  function onKeyActivate(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = e.target.closest("[data-action],[data-route]");
    if (!el) return;
    e.preventDefault();
    el.click();
  }

  /* =============================
     Init
  ============================= */
  function init() {
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyActivate, true);

    // admin button
    const adminBtn = $("#adminBtn");
    if (adminBtn) adminBtn.addEventListener("click", () => setHash("admin"));

    // Primeira rota
    if (!location.hash || location.hash === "#") setHash("home");

    // render on hash
    window.addEventListener("hashchange", () => render());

    // render now
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
