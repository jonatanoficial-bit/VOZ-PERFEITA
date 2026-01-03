/* =========================================================
   IMVpedia Voice — app.js (Parte 3/6)
   - Router (hash + query)
   - Store (localStorage)
   - PWA install prompt
   - Admin gate (placeholder)
   - PACK SYSTEM (DLC): /packs/index.json + manifests + md
   - Simple Markdown renderer
   - Trilha real (tracks/units/lessons)
   - Biblioteca real (articles)
========================================================= */

(() => {
  "use strict";

  /* -----------------------------
     Utils
  ----------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  const todayISO = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  function safeJsonParse(str, fallback) {
    try { return JSON.parse(str); } catch { return fallback; }
  }

  function uid() {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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
    const route = (path || "home").trim();
    const query = Object.fromEntries(new URLSearchParams(qs || ""));
    return { route, query };
  }

  /* -----------------------------
     Storage / State
  ----------------------------- */
  const LS = {
    STATE: "imv_voice_state_v2",
    ADMIN: "imv_voice_admin_v1"
  };

  const DEFAULT_STATE = {
    meta: {
      createdAt: new Date().toISOString(),
      lastOpenAt: new Date().toISOString(),
      appVersion: "1.0.0",
      contentVersion: "packs-v1"
    },
    user: {
      id: uid(),
      name: "",
      avatar: "🎤",
      goal: "Misto",            // Popular | Erudito | Coral | Misto
      levelSelf: "Iniciante",   // Iniciante | Intermediário | Avançado
      minutesPerDay: 10
    },
    gamification: {
      xp: 0,
      level: 1,
      streak: 0,
      lastActiveDate: null,
      freezeCount: 0,
      badges: []
    },
    packs: {
      activePackIds: ["base"],
      // cache leve de “manifest version seen”
      seen: {}
    },
    progress: {
      lastRoute: "home",
      // concluídas por id (pack:lessonId)
      completedLessons: {},
      // último item acessado
      continue: null
    },
    diary: {
      lastCheckinDate: null,
      lastStatus: null
    },
    settings: {
      reduceMotion: false
    }
  };

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
    subscribe(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }
  };

  function loadState() {
    const raw = localStorage.getItem(LS.STATE);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = safeJsonParse(raw, null);
    if (!parsed || typeof parsed !== "object") return structuredClone(DEFAULT_STATE);
    return deepMerge(structuredClone(DEFAULT_STATE), parsed);
  }

  function persistState(state) {
    try {
      state.meta.lastOpenAt = new Date().toISOString();
      localStorage.setItem(LS.STATE, JSON.stringify(state));
    } catch {}
  }

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

  /* -----------------------------
     Gamification (base)
  ----------------------------- */
  function computeLevelFromXP(xp) {
    let level = 1;
    while (xp >= 50 * level * (level - 1)) level++;
    return Math.max(1, level - 1);
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

  function touchStreak(stateDraft) {
    const today = todayISO();
    const last = stateDraft.gamification.lastActiveDate;
    if (last === today) return;

    if (!last) {
      stateDraft.gamification.streak = 1;
      stateDraft.gamification.lastActiveDate = today;
      return;
    }

    const lastD = new Date(last + "T00:00:00");
    const todayD = new Date(today + "T00:00:00");
    const diffDays = Math.round((todayD - lastD) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) stateDraft.gamification.streak += 1;
    else if (diffDays > 1) stateDraft.gamification.streak = 1;

    stateDraft.gamification.lastActiveDate = today;
  }

  /* -----------------------------
     Toast
  ----------------------------- */
  let toastTimer = null;

  function toast(message) {
    const host = $("#toastHost");
    if (!host) return;
    host.innerHTML = `
      <div class="toast" role="status" aria-label="Notificação">
        <div class="toast__dot"></div>
        <div class="toast__msg">${escapeHtml(message)}</div>
      </div>
    `;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { host.innerHTML = ""; }, 2400);
  }

  /* -----------------------------
     PWA Install Prompt
  ----------------------------- */
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = $("#btnInstall");
    if (btn) btn.hidden = false;
  });

  async function promptInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice.catch(() => ({ outcome: "dismissed" }));
    deferredPrompt = null;
    const btn = $("#btnInstall");
    if (btn) btn.hidden = true;
    if (outcome === "accepted") toast("App instalado ✅");
  }

  /* -----------------------------
     Admin Gate (placeholder)
  ----------------------------- */
  function isAdminEnabled() {
    return localStorage.getItem(LS.ADMIN) === "1";
  }
  function setAdminEnabled(val) {
    localStorage.setItem(LS.ADMIN, val ? "1" : "0");
  }

  function openAdminGate() {
    const enabled = isAdminEnabled();
    const title = enabled ? "Admin (ativo)" : "Entrar no Admin";
    const body = enabled
      ? `<p style="margin:0;color:rgba(233,236,246,.72);line-height:1.35">
           Modo Admin está <b>ativo</b>. Na Parte 6 você terá editor/importador de packs.
         </p>`
      : `<p style="margin:0;color:rgba(233,236,246,.72);line-height:1.35">
           Digite a senha do Admin. (Você pode trocar depois no código.)
         </p>
         <div style="height:10px"></div>
         <input id="adminPass" class="input" type="password" placeholder="Senha do admin" />`;

    openModal({
      title,
      contentHtml: body,
      primaryText: enabled ? "Desativar" : "Entrar",
      secondaryText: "Fechar",
      onPrimary: () => {
        if (enabled) {
          setAdminEnabled(false);
          toast("Admin desativado");
          closeModal();
          rerender();
          return;
        }
        const pass = ($("#adminPass")?.value || "").trim();
        if (pass === "imvadmin") {
          setAdminEnabled(true);
          toast("Admin ativado ✅");
          closeModal();
          rerender();
        } else toast("Senha incorreta");
      }
    });
  }

  /* -----------------------------
     Modal
  ----------------------------- */
  let modalEl = null;

  function openModal({ title, contentHtml, primaryText, secondaryText, onPrimary, onSecondary }) {
    closeModal();
    modalEl = document.createElement("div");
    modalEl.style.position = "fixed";
    modalEl.style.inset = "0";
    modalEl.style.zIndex = "120";
    modalEl.style.background = "rgba(0,0,0,.55)";
    modalEl.style.backdropFilter = "blur(10px)";
    modalEl.innerHTML = `
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
    document.body.appendChild(modalEl);

    $("#modalClose", modalEl)?.addEventListener("click", () => {
      onSecondary?.();
      closeModal();
    });
    $("#modalSecondary", modalEl)?.addEventListener("click", () => {
      onSecondary?.();
      closeModal();
    });
    $("#modalPrimary", modalEl)?.addEventListener("click", () => onPrimary?.());
    modalEl.addEventListener("click", (e) => {
      if (e.target === modalEl) closeModal();
    });
  }

  function closeModal() {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
  }

  /* -----------------------------
     Onboarding / Profile
  ----------------------------- */
  function ensureProfileOrPrompt() {
    const st = store.get();
    if (st.user?.name?.trim()) return;

    openModal({
      title: "Criar Perfil",
      contentHtml: `
        <p style="margin:0;color:rgba(233,236,246,.72);line-height:1.35">
          Configure seu perfil para personalizar missões e trilhas.
        </p>
        <div style="height:12px"></div>

        <label style="display:block;font-size:12px;color:rgba(233,236,246,.52);margin-bottom:6px;">Nome</label>
        <input id="pfName" class="input" type="text" placeholder="Ex.: Ana" />

        <div style="height:10px"></div>
        <div class="grid grid--2">
          <div>
            <label style="display:block;font-size:12px;color:rgba(233,236,246,.52);margin-bottom:6px;">Objetivo</label>
            <select id="pfGoal" class="input">
              <option>Popular</option>
              <option>Erudito</option>
              <option>Coral</option>
              <option selected>Misto</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;color:rgba(233,236,246,.52);margin-bottom:6px;">Nível</label>
            <select id="pfLevel" class="input">
              <option selected>Iniciante</option>
              <option>Intermediário</option>
              <option>Avançado</option>
            </select>
          </div>
        </div>

        <div style="height:10px"></div>
        <label style="display:block;font-size:12px;color:rgba(233,236,246,.52);margin-bottom:6px;">Minutos por dia</label>
        <input id="pfMinutes" class="input" type="number" min="5" max="60" step="5" value="10" />
      `,
      primaryText: "Salvar",
      secondaryText: "Depois",
      onPrimary: () => {
        const name = ($("#pfName")?.value || "").trim();
        const goal = ($("#pfGoal")?.value || "Misto").trim();
        const lvl = ($("#pfLevel")?.value || "Iniciante").trim();
        const mins = clamp(parseInt($("#pfMinutes")?.value || "10", 10) || 10, 5, 60);

        store.set(s => {
          s.user.name = name || "Aluno";
          s.user.goal = goal;
          s.user.levelSelf = lvl;
          s.user.minutesPerDay = mins;
        });

        addXP(30, "Perfil criado");
        closeModal();
        rerender();
      }
    });
  }

  function openProfileEditor() {
    const st = store.get();
    const u = st.user;

    openModal({
      title: "Editar Perfil",
      contentHtml: `
        <label style="display:block;font-size:12px;color:rgba(233,236,246,.52);margin-bottom:6px;">Nome</label>
        <input id="epName" class="input" type="text" value="${escapeHtml(u.name || "")}" />

        <div style="height:10px"></div>
        <div class="grid grid--2">
          <div>
            <label style="display:block;font-size:12px;color:rgba(233,236,246,.52);margin-bottom:6px;">Objetivo</label>
            <select id="epGoal" class="input">
              ${["Popular","Erudito","Coral","Misto"].map(x => `<option ${x===u.goal?"selected":""}>${x}</option>`).join("")}
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;color:rgba(233,236,246,.52);margin-bottom:6px;">Nível</label>
            <select id="epLevel" class="input">
              ${["Iniciante","Intermediário","Avançado"].map(x => `<option ${x===u.levelSelf?"selected":""}>${x}</option>`).join("")}
            </select>
          </div>
        </div>

        <div style="height:10px"></div>
        <label style="display:block;font-size:12px;color:rgba(233,236,246,.52);margin-bottom:6px;">Minutos por dia</label>
        <input id="epMinutes" class="input" type="number" min="5" max="60" step="5" value="${u.minutesPerDay || 10}" />
      `,
      primaryText: "Salvar",
      secondaryText: "Cancelar",
      onPrimary: () => {
        const name = ($("#epName")?.value || "").trim();
        const goal = ($("#epGoal")?.value || "Misto").trim();
        const lvl = ($("#epLevel")?.value || "Iniciante").trim();
        const mins = clamp(parseInt($("#epMinutes")?.value || "10", 10) || 10, 5, 60);

        store.set(s => {
          s.user.name = name || "Aluno";
          s.user.goal = goal;
          s.user.levelSelf = lvl;
          s.user.minutesPerDay = mins;
        });

        toast("Perfil atualizado");
        closeModal();
        rerender();
      }
    });
  }

  /* -----------------------------
     Markdown renderer (simples e seguro)
     Suporta: # ## ###, listas, negrito/itálico, blockquote, code inline, parágrafos
  ----------------------------- */
  function mdToHtml(md) {
    const lines = String(md || "").replaceAll("\r\n", "\n").split("\n");

    let html = "";
    let inList = false;
    let inQuote = false;

    const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
    const closeQuote = () => { if (inQuote) { html += "</blockquote>"; inQuote = false; } };

    for (let raw of lines) {
      const line = raw.trimEnd();

      if (!line.trim()) {
        closeList();
        closeQuote();
        html += "<div style='height:10px'></div>";
        continue;
      }

      // Blockquote >
      if (line.trim().startsWith(">")) {
        closeList();
        if (!inQuote) { html += "<blockquote style='margin:0;padding:10px 12px;border-left:3px solid rgba(124,92,255,.65);background:rgba(255,255,255,.03);border-radius:14px;color:rgba(233,236,246,.78);line-height:1.45;'>"; inQuote = true; }
        html += `<div>${inlineMd(line.replace(/^>\s?/, ""))}</div>`;
        continue;
      } else {
        closeQuote();
      }

      // Headings
      if (line.startsWith("### ")) { closeList(); html += `<h3 style="margin:0;font-size:14px;font-weight:860;letter-spacing:.2px;">${inlineMd(line.slice(4))}</h3>`; continue; }
      if (line.startsWith("## ")) { closeList(); html += `<h2 style="margin:0;font-size:16px;font-weight:900;letter-spacing:.2px;">${inlineMd(line.slice(3))}</h2>`; continue; }
      if (line.startsWith("# "))  { closeList(); html += `<h1 style="margin:0;font-size:20px;font-weight:950;letter-spacing:.2px;">${inlineMd(line.slice(2))}</h1>`; continue; }

      // List items
      if (line.startsWith("- ") || line.startsWith("* ")) {
        if (!inList) { html += "<ul style='margin:0 0 0 18px;padding:0;color:rgba(233,236,246,.78);line-height:1.5;'>"; inList = true; }
        html += `<li>${inlineMd(line.slice(2))}</li>`;
        continue;
      }

      // Numbered list (simple)
      if (/^\d+\)\s/.test(line) || /^\d+\.\s/.test(line)) {
        closeList();
        html += `<div style="color:rgba(233,236,246,.78);line-height:1.5;">${inlineMd(line)}</div>`;
        continue;
      }

      // Paragraph
      closeList();
      html += `<p style="margin:0;color:rgba(233,236,246,.78);line-height:1.55;">${inlineMd(line)}</p>`;
    }

    closeList();
    closeQuote();
    return html;
  }

  function inlineMd(text) {
    let s = escapeHtml(text);

    // inline code `x`
    s = s.replace(/`([^`]+)`/g, (_, a) => `<code style="color:rgba(233,236,246,.78);background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.10);padding:2px 6px;border-radius:10px;">${a}</code>`);

    // bold **x**
    s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");

    // italic *x*
    s = s.replace(/\*([^*]+)\*/g, "<i>$1</i>");

    // checkbox [ ] / [x]
    s = s.replace(/\[ \]/g, "☐");
    s = s.replace(/\[x\]/gi, "☑");

    return s;
  }

  /* -----------------------------
     Pack System
  ----------------------------- */
  const packCache = {
    index: null,
    manifests: new Map(),   // packId -> manifest json
    textCache: new Map()    // url -> text
  };

  async function loadPacksIndex() {
    if (packCache.index) return packCache.index;
    const res = await fetch("./packs/index.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("Falha ao carregar packs/index.json");
    const data = await res.json();
    packCache.index = data;
    return data;
  }

  async function loadPackManifest(packId) {
    if (packCache.manifests.has(packId)) return packCache.manifests.get(packId);

    const idx = await loadPacksIndex();
    const entry = (idx.packs || []).find(p => p.id === packId);
    if (!entry) throw new Error(`Pack não encontrado: ${packId}`);

    const res = await fetch(`./packs/${packId}/manifest.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Falha ao carregar manifest do pack: ${packId}`);
    const manifest = await res.json();
    packCache.manifests.set(packId, manifest);
    return manifest;
  }

  async function fetchTextCached(url) {
    if (packCache.textCache.has(url)) return packCache.textCache.get(url);
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Falha ao carregar: ${url}`);
    const text = await res.text();
    packCache.textCache.set(url, text);
    return text;
  }

  async function getActiveManifests() {
    const st = store.get();
    const ids = st.packs.activePackIds || [];
    const manifests = [];
    for (const id of ids) {
      try {
        const mf = await loadPackManifest(id);
        manifests.push(mf);
      } catch (e) {
        console.warn(e);
      }
    }
    return manifests;
  }

  function lessonKey(packId, lessonId) {
    return `${packId}:${lessonId}`;
  }

  function markLessonCompleted(packId, lessonId) {
    store.set(s => {
      s.progress.completedLessons[lessonKey(packId, lessonId)] = {
        at: new Date().toISOString()
      };
      s.progress.continue = { packId, lessonId };
    });
  }

  function isLessonCompleted(st, packId, lessonId) {
    return Boolean(st.progress.completedLessons[lessonKey(packId, lessonId)]);
  }

  /* -----------------------------
     Views
  ----------------------------- */
  function renderKpis(st) {
    return `
      <div class="section">
        <div class="section__head">
          <div>
            <div class="section__title">Seu progresso</div>
            <div class="section__sub">XP, nível e consistência</div>
          </div>
        </div>

        <div class="grid grid--2">
          <div class="kpi">
            <div>
              <div class="kpi__label">Nível</div>
              <div class="kpi__value">${st.gamification.level}</div>
            </div>
            <div style="font-size:18px;">🏅</div>
          </div>

          <div class="kpi">
            <div>
              <div class="kpi__label">XP total</div>
              <div class="kpi__value">${st.gamification.xp}</div>
            </div>
            <div style="font-size:18px;">✨</div>
          </div>

          <div class="kpi">
            <div>
              <div class="kpi__label">Streak</div>
              <div class="kpi__value">${st.gamification.streak} dia(s)</div>
            </div>
            <div style="font-size:18px;">🔥</div>
          </div>

          <div class="kpi">
            <div>
              <div class="kpi__label">Hoje</div>
              <div class="kpi__value">${todayISO()}</div>
            </div>
            <div style="font-size:18px;">📅</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderSection(title, subtitle, items) {
    return `
      <section class="section">
        <div class="section__head">
          <div>
            <div class="section__title">${escapeHtml(title)}</div>
            <div class="section__sub">${escapeHtml(subtitle)}</div>
          </div>
        </div>
        <div class="row">
          ${items.map(renderCard).join("")}
        </div>
      </section>
    `;
  }

  function renderCard(it) {
    return `
      <div class="card" role="button" tabindex="0"
           data-route="${escapeHtml(it.route)}"
           data-pack="${escapeHtml(it.packId || "")}"
           data-lesson="${escapeHtml(it.lessonId || "")}"
           data-article="${escapeHtml(it.articleId || "")}">
        <div class="card__body">
          <div class="card__title">${escapeHtml(it.title)}</div>
          <div class="card__meta">${escapeHtml(it.meta || "")}</div>
        </div>
      </div>
    `;
  }

  async function viewHome() {
    const st = store.get();
    const name = st.user?.name?.trim() || "Aluno";
    const goal = st.user?.goal || "Misto";
    const minutes = st.user?.minutesPerDay || 10;
    const adminBadge = isAdminEnabled()
      ? `<span style="font-size:11px;color:rgba(233,236,246,.52);border:1px solid rgba(255,255,255,.10);padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.03);">Admin</span>`
      : "";

    const manifests = await getActiveManifests();
    const base = manifests[0];

    const continueCard = (() => {
      const c = st.progress.continue;
      if (!c) return null;
      const mf = manifests.find(m => m.id === c.packId);
      if (!mf) return null;
      const found = findLessonInManifest(mf, c.lessonId);
      if (!found) return null;
      return {
        title: `Continue: ${found.lesson.title}`,
        meta: `${found.unit.title} • ${found.lesson.minutes} min`,
        route: "lesson",
        packId: mf.id,
        lessonId: found.lesson.id
      };
    })();

    const recommended = base
      ? base.tracks.flatMap(t => t.units.flatMap(u => u.lessons.slice(0, 1).map(ls => ({
          title: ls.title,
          meta: `${t.title} • ${ls.minutes} min`,
          route: "lesson",
          packId: base.id,
          lessonId: ls.id
        }))))
      : [];

    const quick = [
      { title: "Missão de hoje", meta: `${minutes} min • (Parte 4 fica completa)`, route: "missions" },
      { title: "Trilha", meta: "Capítulos e lições", route: "path" },
      { title: "Biblioteca", meta: "Artigos e fundamentos", route: "library" }
    ];

    const rows = [];
    if (continueCard) rows.push(renderSection("Continue", "Retome de onde parou", [continueCard]));
    rows.push(renderSection("Recomendado", "Comece por aqui", recommended.slice(0, 10)));
    rows.push(renderSection("Atalhos", "Acesso rápido", quick));

    return `
      <div class="hero">
        <div class="hero__kicker">Bem-vindo(a), ${escapeHtml(name)} • Objetivo: ${escapeHtml(goal)} ${adminBadge}</div>
        <div class="hero__title">Trilha vocal completa — agora com Packs</div>
        <p class="hero__desc">
          Você está com o pack <b>Base — Fundamentos 1</b> ativo. Hoje: ${minutes} min.
          Estude lições, ganhe XP e mantenha consistência.
        </p>
        <div class="hero__actions">
          <button class="btn btnPrimary" data-action="startDaily">Missão de hoje</button>
          <button class="btn" data-action="openPlacement">Teste de classificação</button>
          <button class="btn" data-action="openProfile">Editar perfil</button>
        </div>
      </div>

      ${renderKpis(st)}
      ${rows.join("")}
    `;
  }

  function findLessonInManifest(manifest, lessonId) {
    for (const track of (manifest.tracks || [])) {
      for (const unit of (track.units || [])) {
        const lesson = (unit.lessons || []).find(l => l.id === lessonId);
        if (lesson) return { track, unit, lesson };
      }
    }
    return null;
  }

  async function viewPath() {
    const manifests = await getActiveManifests();
    const st = store.get();
    const goal = st.user?.goal || "Misto";

    const blocks = manifests.flatMap(mf => (mf.tracks || []).map(track => {
      const unitHtml = (track.units || []).map(unit => {
        const lessonsHtml = (unit.lessons || []).map(lesson => {
          const done = isLessonCompleted(st, mf.id, lesson.id);
          const badge = done
            ? `<span style="font-size:11px;color:rgba(233,236,246,.52);border:1px solid rgba(56,211,159,.25);padding:5px 10px;border-radius:999px;background:rgba(56,211,159,.06);">Concluída</span>`
            : `<span style="font-size:11px;color:rgba(233,236,246,.52);border:1px solid rgba(255,255,255,.10);padding:5px 10px;border-radius:999px;background:rgba(255,255,255,.03);">Nova</span>`;

          return `
            <div class="panel" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
              <div>
                <div style="font-weight:860;">${escapeHtml(lesson.title)}</div>
                <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:6px;">
                  ${escapeHtml(unit.title)} • ${lesson.minutes} min
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:10px;">
                ${badge}
                <button class="btn btnPrimary" data-action="openLesson" data-pack="${escapeHtml(mf.id)}" data-lesson="${escapeHtml(lesson.id)}">Abrir</button>
              </div>
            </div>
          `;
        }).join("<div style='height:10px'></div>");

        return `
          <div class="panel" style="background:rgba(255,255,255,.03);">
            <div style="font-weight:900;">${escapeHtml(unit.title)}</div>
            <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:6px;">${escapeHtml(unit.subtitle || "")}</div>
            <div style="height:12px"></div>
            ${lessonsHtml}
          </div>
        `;
      }).join("<div style='height:12px'></div>");

      return `
        <div class="panel">
          <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:10px;">
            <div>
              <div style="font-weight:950;font-size:16px;">${escapeHtml(track.title)}</div>
              <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:6px;">
                ${escapeHtml(track.subtitle || "")} • ${escapeHtml(track.levelRange || "")}
              </div>
            </div>
            <div style="color:rgba(233,236,246,.52);font-size:12px;">Objetivo: <b>${escapeHtml(goal)}</b></div>
          </div>
          <hr class="sep" />
          ${unitHtml}
        </div>
      `;
    }));

    return `
      <div class="panel">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div>
            <div style="font-weight:900;font-size:16px;">Trilha</div>
            <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:4px;">
              Trilhas carregadas por Packs (DLC). Sem quebrar o app quando você expandir.
            </div>
          </div>
          <button class="btn btnPrimary" data-action="jumpToDaily">Missão</button>
        </div>
      </div>

      <div style="height:12px"></div>
      ${blocks.join("<div style='height:12px'></div>")}
    `;
  }

  async function viewLesson(query) {
    const packId = query.pack || "base";
    const lessonId = query.lesson || "";
    if (!lessonId) {
      return `
        <div class="panel">
          <div style="font-weight:900;">Lição inválida</div>
          <div style="height:12px"></div>
          <button class="btn btnPrimary" data-action="goPath">Voltar à Trilha</button>
        </div>
      `;
    }

    let mf;
    try { mf = await loadPackManifest(packId); }
    catch {
      return `
        <div class="panel">
          <div style="font-weight:900;">Pack não encontrado</div>
          <div style="height:12px"></div>
          <button class="btn btnPrimary" data-action="goPath">Voltar à Trilha</button>
        </div>
      `;
    }

    const found = findLessonInManifest(mf, lessonId);
    if (!found) {
      return `
        <div class="panel">
          <div style="font-weight:900;">Lição não encontrada</div>
          <div style="height:12px"></div>
          <button class="btn btnPrimary" data-action="goPath">Voltar à Trilha</button>
        </div>
      `;
    }

    const url = `./packs/${packId}/${found.lesson.file.replace("./", "")}`;
    let md = "";
    try { md = await fetchTextCached(url); }
    catch (e) { md = `# Erro\nNão foi possível carregar a lição.\n\nDetalhe: ${String(e)}`; }

    const st = store.get();
    const done = isLessonCompleted(st, packId, lessonId);

    return `
      <div class="panel">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
          <div>
            <div style="color:rgba(233,236,246,.52);font-size:12px;">
              ${escapeHtml(mf.name)} • ${escapeHtml(found.track.title)} • ${escapeHtml(found.unit.title)}
            </div>
            <div style="font-weight:950;font-size:18px;margin-top:6px;">${escapeHtml(found.lesson.title)}</div>
            <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:6px;">
              Tempo sugerido: <b>${found.lesson.minutes} min</b>
            </div>
          </div>

          <div style="display:flex;gap:10px;align-items:center;">
            ${done
              ? `<span style="font-size:11px;color:rgba(233,236,246,.52);border:1px solid rgba(56,211,159,.25);padding:6px 10px;border-radius:999px;background:rgba(56,211,159,.06);">Concluída</span>`
              : `<span style="font-size:11px;color:rgba(233,236,246,.52);border:1px solid rgba(255,255,255,.10);padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.03);">Nova</span>`
            }
            <button class="btn" data-action="goPath">Trilha</button>
          </div>
        </div>

        <hr class="sep" />

        <div class="panel" style="background:rgba(255,255,255,.03);">
          ${mdToHtml(md)}
        </div>

        <div style="height:12px"></div>

        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
          <button class="btn" data-action="goPath">Voltar</button>
          <button class="btn btnPrimary" data-action="completeLesson" data-pack="${escapeHtml(packId)}" data-lesson="${escapeHtml(lessonId)}">
            ${done ? "Concluída" : "Concluir e ganhar XP"}
          </button>
        </div>
      </div>
    `;
  }

  async function viewLibrary(query) {
    const manifests = await getActiveManifests();
    const allArticles = manifests.flatMap(mf => (mf.library?.articles || []).map(a => ({
      packId: mf.id,
      id: a.id,
      title: a.title,
      tags: a.tags || [],
      file: a.file
    })));

    const q = (query.q || "").trim().toLowerCase();
    const filtered = q
      ? allArticles.filter(a =>
          a.title.toLowerCase().includes(q) ||
          (a.tags || []).some(t => String(t).toLowerCase().includes(q))
        )
      : allArticles;

    const cards = filtered.map(a => ({
      title: a.title,
      meta: (a.tags || []).slice(0, 4).join(" • "),
      route: "article",
      packId: a.packId,
      articleId: a.id
    }));

    return `
      <div class="panel">
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:10px;">
          <div>
            <div style="font-weight:900;font-size:16px;">Biblioteca</div>
            <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:4px;">
              Artigos do dicionário vocal (carregados por packs)
            </div>
          </div>
        </div>

        <div style="height:12px"></div>

        <input class="input" id="libSearch" placeholder="Buscar por tema (ex.: apoio, SOVT, saúde...)" value="${escapeHtml(query.q || "")}" />

        <div style="height:12px"></div>

        <div class="row">
          ${cards.length ? cards.map(renderCard).join("") : `
            <div class="panel" style="min-width:280px;">
              <div style="font-weight:850;">Nada encontrado</div>
              <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:6px;">Tente outro termo.</div>
            </div>
          `}
        </div>
      </div>
    `;
  }

  async function viewArticle(query) {
    const packId = query.pack || "base";
    const articleId = query.article || "";
    if (!articleId) return `<div class="panel"><div style="font-weight:900;">Artigo inválido</div></div>`;

    const mf = await loadPackManifest(packId);
    const article = (mf.library?.articles || []).find(a => a.id === articleId);
    if (!article) return `<div class="panel"><div style="font-weight:900;">Artigo não encontrado</div></div>`;

    const url = `./packs/${packId}/${article.file.replace("./", "")}`;
    let md = "";
    try { md = await fetchTextCached(url); }
    catch (e) { md = `# Erro\nNão foi possível carregar o artigo.\n\nDetalhe: ${String(e)}`; }

    return `
      <div class="panel">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
          <div>
            <div style="color:rgba(233,236,246,.52);font-size:12px;">${escapeHtml(mf.name)} • Biblioteca</div>
            <div style="font-weight:950;font-size:18px;margin-top:6px;">${escapeHtml(article.title)}</div>
            <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:6px;">
              Tags: ${(article.tags || []).map(t => `<span style="border:1px solid rgba(255,255,255,.10);padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.03);margin-right:6px;display:inline-block;">${escapeHtml(t)}</span>`).join("")}
            </div>
          </div>
          <div style="display:flex;gap:10px;">
            <button class="btn" data-action="goLibrary">Biblioteca</button>
          </div>
        </div>

        <hr class="sep" />

        <div class="panel" style="background:rgba(255,255,255,.03);">
          ${mdToHtml(md)}
        </div>
      </div>
    `;
  }

  function viewMissions() {
    const st = store.get();
    const mins = st.user?.minutesPerDay || 10;

    return `
      <div class="panel">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div>
            <div style="font-weight:900;font-size:16px;">Missões</div>
            <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:3px;">
              Missão do dia • ${mins} min (Parte 4 vai ficar completa com packs e adaptação)
            </div>
          </div>
          <button class="btn btnPrimary" data-action="completeDaily">Concluir</button>
        </div>

        <hr class="sep" />

        <div class="panel">
          <div style="font-weight:850;">Missão de hoje (base)</div>
          <div style="color:rgba(233,236,246,.78);font-size:13px;line-height:1.45;margin-top:8px;">
            <ol style="margin:0 0 0 18px;padding:0;">
              <li><b>Aquecimento SOVT</b> (2–3 min): lip trill ou humming leve.</li>
              <li><b>Foco técnico</b> (5–8 min): 5 notas em “no/nu”, confortável.</li>
              <li><b>Aplicação</b> (2–4 min): 1 trecho fácil com o mesmo conforto.</li>
            </ol>
            <div style="height:10px"></div>
            <div style="color:rgba(233,236,246,.52);font-size:12px;">
              Pare se houver dor/rouquidão.
            </div>
          </div>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div style="font-weight:850;">Check-in vocal (rápido)</div>
          <div style="height:10px"></div>
          <div class="grid grid--2">
            <button class="btn" data-action="checkin" data-status="ok">✅ Sem desconforto</button>
            <button class="btn" data-action="checkin" data-status="tired">😮‍💨 Cansado</button>
            <button class="btn" data-action="checkin" data-status="hoarse">🗣️ Rouquidão</button>
            <button class="btn" data-action="checkin" data-status="pain">⚠️ Dor</button>
          </div>
          <div style="height:10px"></div>
          <div style="color:rgba(233,236,246,.52);font-size:12px;line-height:1.35;">
            Na Parte 4 isso vira diário vocal e adapta as missões automaticamente.
          </div>
        </div>
      </div>
    `;
  }

  function viewProfile() {
    const st = store.get();
    const u = st.user;

    return `
      <div class="panel">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div>
            <div style="font-weight:900;font-size:16px;">Perfil</div>
            <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:3px;">
              Ajustes e estatísticas
            </div>
          </div>
          <button class="btn btnPrimary" data-action="openProfile">Editar</button>
        </div>

        <hr class="sep" />

        <div class="panel">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <div>
              <div style="font-weight:850;">${escapeHtml(u.avatar)} ${escapeHtml(u.name || "Aluno")}</div>
              <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:5px;">
                Objetivo: <b>${escapeHtml(u.goal)}</b> • Nível: <b>${escapeHtml(u.levelSelf)}</b> • ${u.minutesPerDay} min/dia
              </div>
            </div>
            <div style="font-size:22px;">👑</div>
          </div>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div style="font-weight:850;">Packs ativos</div>
          <div style="height:10px"></div>
          ${(store.get().packs.activePackIds || []).map(id => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);padding:10px 12px;border-radius:14px;margin-bottom:8px;">
              <div style="color:rgba(233,236,246,.78);font-size:13px;"><b>${escapeHtml(id)}</b></div>
              <div style="color:rgba(233,236,246,.52);font-size:12px;">ativo</div>
            </div>
          `).join("")}
          <div style="color:rgba(233,236,246,.52);font-size:12px;line-height:1.35;">
            Na Parte 6, você terá Admin completo para importar/ativar/desativar packs.
          </div>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div style="font-weight:850;">Dados</div>
          <div style="height:10px"></div>
          <button class="btn" data-action="resetApp">Resetar app (apagar dados)</button>
          <div style="height:10px"></div>
          <div style="color:rgba(233,236,246,.52);font-size:12px;line-height:1.35;">
            Reset apaga seu progresso local (localStorage). Use com cuidado.
          </div>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div style="font-weight:850;">Admin</div>
          <div style="height:10px"></div>
          <div style="color:rgba(233,236,246,.78);font-size:13px;line-height:1.4;">
            Status: <b>${isAdminEnabled() ? "ativo" : "inativo"}</b> •
            Senha padrão nesta fase: <code style="color:rgba(233,236,246,.78)">imvadmin</code>
          </div>
          <div style="height:10px"></div>
          <button class="btn" data-action="openAdmin">Abrir Admin</button>
        </div>
      </div>
    `;
  }

  function viewNotFound() {
    return `
      <div class="panel">
        <div style="font-weight:900;font-size:16px;">Página não encontrada</div>
        <div style="color:rgba(233,236,246,.72);margin-top:8px;line-height:1.45">
          Essa rota ainda não existe.
        </div>
        <div style="height:12px"></div>
        <button class="btn btnPrimary" data-action="goHome">Voltar ao Início</button>
      </div>
    `;
  }

  /* -----------------------------
     Placement teaser
  ----------------------------- */
  function openPlacementTeaser() {
    openModal({
      title: "Teste de classificação (Parte 5)",
      contentHtml: `
        <p style="margin:0;color:rgba(233,236,246,.78);line-height:1.45">
          Na Parte 5, o app terá placement completo:
          questionário + recomendações por objetivo + checkpoints e plano de 14 dias.
        </p>
      `,
      primaryText: "Ok",
      secondaryText: null,
      onPrimary: () => closeModal()
    });
  }

  /* -----------------------------
     Missions (demo)
  ----------------------------- */
  function completeDaily() {
    addXP(40, "Missão diária");
    toast("Missão concluída ✅");
  }

  function checkin(status) {
    store.set(s => {
      s.diary.lastCheckinDate = todayISO();
      s.diary.lastStatus = status;
    });
    if (status === "pain" || status === "hoarse") toast("Sugestão: dia leve + descanso");
    else toast("Check-in registrado");
  }

  function resetApp() {
    openModal({
      title: "Resetar app",
      contentHtml: `
        <p style="margin:0;color:rgba(233,236,246,.78);line-height:1.45">
          Isso vai apagar todo o progresso salvo neste dispositivo.
        </p>
      `,
      primaryText: "Apagar tudo",
      secondaryText: "Cancelar",
      onPrimary: () => {
        localStorage.removeItem(LS.STATE);
        localStorage.removeItem(LS.ADMIN);
        store.state = structuredClone(DEFAULT_STATE);
        persistState(store.state);
        closeModal();
        toast("Dados apagados");
        setHash("home");
        rerender();
        setTimeout(() => ensureProfileOrPrompt(), 350);
      }
    });
  }

  /* -----------------------------
     Router / Render
  ----------------------------- */
  const main = $("#main");

  async function render() {
    if (!main) return;

    const { route, query } = getRouteAndQuery();
    store.set(s => { s.progress.lastRoute = route; });

    updateTabbar(route);

    // carregamento
    main.innerHTML = `
      <div class="panel">
        <div style="font-weight:900;">Carregando…</div>
        <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:6px;">Preparando conteúdo</div>
      </div>
    `;

    let html = "";
    try {
      if (route === "home") html = await viewHome();
      else if (route === "path") html = await viewPath();
      else if (route === "lesson") html = await viewLesson(query);
      else if (route === "missions") html = viewMissions();
      else if (route === "library") html = await viewLibrary(query);
      else if (route === "article") html = await viewArticle(query);
      else if (route === "profile") html = viewProfile();
      else html = viewNotFound();
    } catch (e) {
      html = `
        <div class="panel">
          <div style="font-weight:900;">Erro ao renderizar</div>
          <div style="color:rgba(233,236,246,.72);margin-top:8px;line-height:1.45">${escapeHtml(String(e))}</div>
          <div style="height:12px"></div>
          <button class="btn btnPrimary" data-action="goHome">Voltar ao Início</button>
        </div>
      `;
    }

    main.innerHTML = html;
    bindMainHandlers();
  }

  function rerender() { render(); }

  function updateTabbar(route) {
    // marcar tab ativa; rotas lesson/article ficam sob trilha/biblioteca
    const active = (route === "lesson") ? "path" : (route === "article") ? "library" : route;
    $$(".tabbar__item").forEach(btn => {
      const r = btn.getAttribute("data-route");
      btn.classList.toggle("is-active", r === active);
    });
  }

  function bindMainHandlers() {
    // cards navegáveis
    $$(".card").forEach(card => {
      const go = () => {
        const r = card.getAttribute("data-route");
        const packId = card.getAttribute("data-pack") || "";
        const lessonId = card.getAttribute("data-lesson") || "";
        const articleId = card.getAttribute("data-article") || "";

        if (r === "lesson") setHash("lesson", { pack: packId, lesson: lessonId });
        else if (r === "article") setHash("article", { pack: packId, article: articleId });
        else if (r) setHash(r);
      };
      card.addEventListener("click", go);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
      });
    });

    // ações
    $$("[data-action]").forEach(el => {
      el.addEventListener("click", async () => {
        const act = el.getAttribute("data-action");
        if (!act) return;

        switch (act) {
          case "startDaily":
          case "jumpToDaily":
            setHash("missions");
            break;

          case "openPlacement":
            openPlacementTeaser();
            break;

          case "openProfile":
            openProfileEditor();
            break;

          case "openAdmin":
            openAdminGate();
            break;

          case "completeDaily":
            completeDaily();
            break;

          case "checkin":
            checkin(el.getAttribute("data-status") || "ok");
            break;

          case "openLesson": {
            const packId = el.getAttribute("data-pack") || "base";
            const lessonId = el.getAttribute("data-lesson") || "";
            setHash("lesson", { pack: packId, lesson: lessonId });
            break;
          }

          case "completeLesson": {
            const packId = el.getAttribute("data-pack") || "base";
            const lessonId = el.getAttribute("data-lesson") || "";
            if (!lessonId) return;

            const st = store.get();
            if (isLessonCompleted(st, packId, lessonId)) {
              toast("Já concluída");
              return;
            }
            markLessonCompleted(packId, lessonId);
            addXP(25, "Lição concluída");
            toast("Lição concluída ✅");
            rerender();
            break;
          }

          case "goHome":
            setHash("home");
            break;

          case "goPath":
            setHash("path");
            break;

          case "goLibrary":
            setHash("library");
            break;

          case "resetApp":
            resetApp();
            break;

          default:
            toast("Ação não implementada");
        }
      });
    });

    // busca biblioteca
    const libSearch = $("#libSearch");
    if (libSearch) {
      libSearch.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const v = (libSearch.value || "").trim();
          setHash("library", { q: v });
        }
      });
      libSearch.addEventListener("change", () => {
        const v = (libSearch.value || "").trim();
        setHash("library", { q: v });
      });
    }
  }

  /* -----------------------------
     Global handlers (topbar/tabbar)
  ----------------------------- */
  function bindGlobalHandlers() {
    $$(".tabbar__item").forEach(btn => {
      btn.addEventListener("click", () => {
        const r = btn.getAttribute("data-route");
        if (r) setHash(r);
      });
    });

    $(".brand")?.addEventListener("click", () => setHash("home"));
    $("#btnInstall")?.addEventListener("click", promptInstall);
    $("#btnAdmin")?.addEventListener("click", openAdminGate);
  }

  /* -----------------------------
     Boot
  ----------------------------- */
  async function boot() {
    bindGlobalHandlers();

    if (!location.hash) setHash("home");

    // pré-carregar index/manifest base (suave)
    try {
      await loadPacksIndex();
      await loadPackManifest("base");
    } catch (e) {
      console.warn(e);
      toast("Aviso: packs não carregaram");
    }

    await render();
    setTimeout(() => ensureProfileOrPrompt(), 300);

    window.addEventListener("hashchange", () => render());
    store.subscribe(() => {
      // re-render leve
      render();
    });
  }

  boot();
})();