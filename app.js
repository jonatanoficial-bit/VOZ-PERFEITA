/* =========================================================
   IMVpedia Voice — app.js (Parte 2/6)
   - Router (hash)
   - Store (localStorage)
   - UI Home Netflix-like + Tabs
   - Perfil simples (onboarding rápido)
   - Toasts
   - PWA install prompt
   - Admin gate (modo admin placeholder — editor vem na Parte 6)
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

  function setHash(route) {
    const r = route.startsWith("#/") ? route : `#/${route}`;
    if (location.hash !== r) location.hash = r;
  }

  function getRoute() {
    const h = (location.hash || "#/home").trim();
    if (!h.startsWith("#/")) return "home";
    const r = h.slice(2).split("?")[0].trim();
    return r || "home";
  }

  /* -----------------------------
     Storage / State
  ----------------------------- */
  const LS = {
    STATE: "imv_voice_state_v1",
    ADMIN: "imv_voice_admin_v1"
  };

  const DEFAULT_STATE = {
    meta: {
      createdAt: new Date().toISOString(),
      lastOpenAt: new Date().toISOString(),
      appVersion: "1.0.0",
      contentVersion: "base"
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
    progress: {
      // Parte 3: trilhas e lições por pack
      lastRoute: "home",
      continueHint: null
    },
    diary: {
      // Parte 4: diário vocal completo
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

    // Merge defensivo para upgrades
    return deepMerge(structuredClone(DEFAULT_STATE), parsed);
  }

  function persistState(state) {
    try {
      state.meta.lastOpenAt = new Date().toISOString();
      localStorage.setItem(LS.STATE, JSON.stringify(state));
    } catch {
      // Sem crash
    }
  }

  function deepMerge(target, source) {
    if (!source || typeof source !== "object") return target;
    for (const k of Object.keys(source)) {
      const sv = source[k];
      const tv = target[k];
      if (Array.isArray(sv)) target[k] = sv.slice();
      else if (sv && typeof sv === "object" && tv && typeof tv === "object" && !Array.isArray(tv)) {
        target[k] = deepMerge(tv, sv);
      } else {
        target[k] = sv;
      }
    }
    return target;
  }

  /* -----------------------------
     Gamification (base)
  ----------------------------- */
  function computeLevelFromXP(xp) {
    // curva simples: lvl1=0, lvl2=100, lvl3=250, lvl4=450...
    // formula: threshold = 50*l*(l-1)
    // resolve l approx: l ~ floor((1+sqrt(1+xp/12.5))/2) etc.
    // aqui usamos loop (xp baixo/medio)
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

    toast(`+${amt} XP ${reason ? `• ${reason}` : ""}`.trim());
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

    // diferença em dias (sem timezone complexa: ISO local já é suficiente p/ hábito)
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

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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
        } else {
          toast("Senha incorreta");
        }
      }
    });
  }

  /* -----------------------------
     Modal (leve, sem CSS extra)
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
     Onboarding rápido (perfil)
  ----------------------------- */
  function ensureProfileOrPrompt() {
    const st = store.get();
    if (st.user?.name?.trim()) return;

    openModal({
      title: "Criar Perfil",
      contentHtml: `
        <p style="margin:0;color:rgba(233,236,246,.72);line-height:1.35">
          Configure seu perfil para personalizar missões e trilhas. Leva menos de 1 minuto.
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

  /* -----------------------------
     Sample Content (placeholder)
     (Parte 3: vira packs reais)
  ----------------------------- */
  const SAMPLE_ROWS = {
    continue: [
      { id: "c1", title: "Continue: Fundamentos — Respiração", meta: "5–8 min • Técnica", route: "path" },
      { id: "c2", title: "Aquecimento rápido (SOVT)", meta: "3–5 min • Saúde vocal", route: "missions" }
    ],
    recommended: [
      { id: "r1", title: "Fundamentos 1", meta: "Apoio • Ressonância • Afinação", route: "path" },
      { id: "r2", title: "Coral 1", meta: "Blend • Vogais unificadas • Dicção", route: "path" },
      { id: "r3", title: "Erudito 1", meta: "Legato • Vogais • Linha", route: "path" }
    ],
    quickTools: [
      { id: "t1", title: "Timer de prática", meta: "Comece 5–10 min agora", route: "missions" },
      { id: "t2", title: "Metrônomo", meta: "Base (Parte 3/4)", route: "library" },
      { id: "t3", title: "Drone", meta: "Base (Parte 3/4)", route: "library" }
    ]
  };

  /* -----------------------------
     Views
  ----------------------------- */
  function viewHome() {
    const st = store.get();
    const name = st.user?.name?.trim() || "Aluno";
    const goal = st.user?.goal || "Misto";
    const minutes = st.user?.minutesPerDay || 10;

    const adminBadge = isAdminEnabled()
      ? `<span style="font-size:11px;color:rgba(233,236,246,.52);border:1px solid rgba(255,255,255,.10);padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.03);">Admin</span>`
      : "";

    return `
      <div class="hero">
        <div class="hero__kicker">Bem-vindo(a), ${escapeHtml(name)} • Objetivo: ${escapeHtml(goal)} ${adminBadge}</div>
        <div class="hero__title">Treino vocal completo — com segurança e progresso</div>
        <p class="hero__desc">
          Hoje: ${minutes} min. Faça a missão diária, ganhe XP e mantenha seu streak.
          (Na Parte 3, as lições vão carregar por Packs/DLC.)
        </p>
        <div class="hero__actions">
          <button class="btn btnPrimary" data-action="startDaily">Missão de hoje</button>
          <button class="btn" data-action="openPlacement">Teste de classificação</button>
          <button class="btn" data-action="openProfile">Editar perfil</button>
        </div>
      </div>

      ${renderKpis(st)}

      ${renderSection("Continue", "Retome de onde parou", SAMPLE_ROWS.continue)}
      ${renderSection("Recomendado", "Trilhas sugeridas para você", SAMPLE_ROWS.recommended)}
      ${renderSection("Ferramentas rápidas", "Atalhos úteis", SAMPLE_ROWS.quickTools)}
    `;
  }

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
      <div class="card" role="button" tabindex="0" data-route="${escapeHtml(it.route)}" data-id="${escapeHtml(it.id)}">
        <div class="card__body">
          <div class="card__title">${escapeHtml(it.title)}</div>
          <div class="card__meta">${escapeHtml(it.meta)}</div>
        </div>
      </div>
    `;
  }

  function viewPath() {
    const st = store.get();
    const goal = st.user?.goal || "Misto";

    return `
      <div class="panel">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div>
            <div style="font-weight:860;font-size:16px;">Trilha</div>
            <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:3px;">
              Objetivo atual: <b>${escapeHtml(goal)}</b> • (Packs entram na Parte 3)
            </div>
          </div>
          <button class="btn btnPrimary" data-action="jumpToDaily">Missão</button>
        </div>

        <hr class="sep" />

        <p style="margin:0;color:rgba(233,236,246,.72);line-height:1.45">
          Aqui vai aparecer a trilha completa (Capítulos → Unidades → Lições), carregada por pacotes.
          Nesta Parte 2, deixamos a navegação pronta e a base do app sólida.
        </p>

        <div style="height:12px"></div>

        <div class="grid grid--2">
          <div class="panel">
            <div style="font-weight:820;">Fundamentos 1</div>
            <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:6px;">Respiração • Apoio • SOVT • Afinação</div>
            <div style="height:10px"></div>
            <button class="btn" data-action="mockLesson">Abrir (demo)</button>
          </div>

          <div class="panel">
            <div style="font-weight:820;">Coral 1</div>
            <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:6px;">Blend • Vogais unificadas • Dicção coletiva</div>
            <div style="height:10px"></div>
            <button class="btn" data-action="mockLesson">Abrir (demo)</button>
          </div>
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
            <div style="font-weight:860;font-size:16px;">Missões</div>
            <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:3px;">
              Missão do dia • ${mins} min (ajusta no perfil)
            </div>
          </div>
          <button class="btn btnPrimary" data-action="completeDaily">Concluir</button>
        </div>

        <hr class="sep" />

        <div class="panel">
          <div style="font-weight:820;">Missão de hoje (demo)</div>
          <div style="color:rgba(233,236,246,.72);font-size:13px;line-height:1.45;margin-top:8px;">
            <ol style="margin:0 0 0 18px;padding:0;">
              <li><b>Aquecimento SOVT</b> (2–3 min): lip trill ou humming leve.</li>
              <li><b>Foco técnico</b> (5 min): vogais em 5 notas, volume confortável.</li>
              <li><b>Aplicação musical</b> (2–3 min): cante um trecho fácil com atenção ao fluxo de ar.</li>
            </ol>
            <div style="height:10px"></div>
            <div style="color:rgba(233,236,246,.52);font-size:12px;">
              Pare se houver dor/rouquidão. Hidrate e reduza a carga.
            </div>
          </div>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div style="font-weight:820;">Check-in vocal (rápido)</div>
          <div style="height:10px"></div>
          <div class="grid grid--2">
            <button class="btn" data-action="checkin" data-status="ok">✅ Sem desconforto</button>
            <button class="btn" data-action="checkin" data-status="tired">😮‍💨 Cansado</button>
            <button class="btn" data-action="checkin" data-status="hoarse">🗣️ Rouquidão</button>
            <button class="btn" data-action="checkin" data-status="pain">⚠️ Dor</button>
          </div>
          <div style="height:10px"></div>
          <div style="color:rgba(233,236,246,.52);font-size:12px;line-height:1.35;">
            (Na Parte 4 isso vira diário vocal e adapta as missões automaticamente.)
          </div>
        </div>
      </div>
    `;
  }

  function viewLibrary() {
    return `
      <div class="panel">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div>
            <div style="font-weight:860;font-size:16px;">Biblioteca</div>
            <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:3px;">
              Enciclopédia vocal • (Packs entram na Parte 3)
            </div>
          </div>
          <button class="btn" data-action="searchHint">Buscar</button>
        </div>

        <hr class="sep" />

        <div class="grid">
          <div class="panel">
            <div style="font-weight:820;">Apoio vocal</div>
            <div style="color:rgba(233,236,246,.72);font-size:13px;line-height:1.45;margin-top:8px;">
              Apoio é coordenação de respiração + estabilidade corporal + controle de fluxo/pressão.
              No app, vamos tratar “apoio” de forma prática (sem mitos) com exercícios progressivos.
            </div>
          </div>

          <div class="panel">
            <div style="font-weight:820;">Fisiologia vocal</div>
            <div style="color:rgba(233,236,246,.72);font-size:13px;line-height:1.45;margin-top:8px;">
              Fonte (pregas vocais) + filtro (trato vocal). A voz é coordenação, não força.
              (Na Parte 3, você terá artigos completos em Markdown com imagens opcionais.)
            </div>
          </div>

          <div class="panel">
            <div style="font-weight:820;">SOVT (Semi-Occluded Vocal Tract)</div>
            <div style="color:rgba(233,236,246,.72);font-size:13px;line-height:1.45;margin-top:8px;">
              Exercícios como lip trill e humming ajudam eficiência e aquecimento.
              O app terá rotinas por objetivo e sinais de alerta.
            </div>
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
            <div style="font-weight:860;font-size:16px;">Perfil</div>
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
              <div style="font-weight:820;">${escapeHtml(u.avatar)} ${escapeHtml(u.name || "Aluno")}</div>
              <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:5px;">
                Objetivo: <b>${escapeHtml(u.goal)}</b> • Nível: <b>${escapeHtml(u.levelSelf)}</b> • ${u.minutesPerDay} min/dia
              </div>
            </div>
            <div style="font-size:22px;">👑</div>
          </div>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div style="font-weight:820;">Dados</div>
          <div style="height:10px"></div>
          <button class="btn" data-action="resetApp">Resetar app (apagar dados)</button>
          <div style="height:10px"></div>
          <div style="color:rgba(233,236,246,.52);font-size:12px;line-height:1.35;">
            Reset apaga seu progresso local (localStorage). Use com cuidado.
          </div>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div style="font-weight:820;">Admin</div>
          <div style="height:10px"></div>
          <div style="color:rgba(233,236,246,.72);font-size:13px;line-height:1.4;">
            Status: <b>${isAdminEnabled() ? "ativo" : "inativo"}</b> •
            Senha padrão nesta fase: <code style="color:rgba(233,236,246,.72)">imvadmin</code>
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
        <div style="font-weight:860;font-size:16px;">Página não encontrada</div>
        <div style="color:rgba(233,236,246,.72);margin-top:8px;line-height:1.45">
          Essa rota ainda não existe.
        </div>
        <div style="height:12px"></div>
        <button class="btn btnPrimary" data-action="goHome">Voltar ao Início</button>
      </div>
    `;
  }

  /* -----------------------------
     Actions
  ----------------------------- */
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

  function openPlacementTeaser() {
    openModal({
      title: "Teste de classificação (em breve)",
      contentHtml: `
        <p style="margin:0;color:rgba(233,236,246,.72);line-height:1.45">
          Na Parte 5, o app vai ter um placement completo:
          questionário + recomendações de trilhas + checkpoints.
        </p>
        <div style="height:10px"></div>
        <p style="margin:0;color:rgba(233,236,246,.52);font-size:12px;line-height:1.35">
          Por enquanto, ajuste objetivo e nível no Perfil.
        </p>
      `,
      primaryText: "Ok",
      secondaryText: null,
      onPrimary: () => closeModal()
    });
  }

  function openMockLesson() {
    openModal({
      title: "Lição (demo)",
      contentHtml: `
        <p style="margin:0;color:rgba(233,236,246,.72);line-height:1.45">
          <b>Respiração funcional para canto</b><br/>
          Objetivo: reduzir excesso de ar e estabilizar fluxo.
        </p>
        <div style="height:10px"></div>
        <ul style="margin:0 0 0 18px;color:rgba(233,236,246,.72);line-height:1.45;">
          <li>Inspire silencioso, sem elevar ombros.</li>
          <li>Expire em “sss” 8–12s, sem “apertar” garganta.</li>
          <li>Faça 3 séries, confortável.</li>
        </ul>
        <div style="height:10px"></div>
        <div style="color:rgba(233,236,246,.52);font-size:12px;line-height:1.35">
          Na Parte 3, isso vira conteúdo completo em Markdown, com trilha, pré-requisitos e imagens opcionais.
        </div>
      `,
      primaryText: "Concluir (ganhar XP)",
      secondaryText: "Fechar",
      onPrimary: () => {
        addXP(20, "Lição concluída");
        closeModal();
      }
    });
  }

  function completeDaily() {
    addXP(40, "Missão diária");
    toast("Missão concluída ✅");
  }

  function checkin(status) {
    const map = {
      ok: "Sem desconforto",
      tired: "Cansado",
      hoarse: "Rouquidão",
      pain: "Dor"
    };
    store.set(s => {
      s.diary.lastCheckinDate = todayISO();
      s.diary.lastStatus = status;
    });

    if (status === "pain" || status === "hoarse") {
      toast("Sugestão: dia leve + descanso");
    } else {
      toast(`Check-in: ${map[status] || status}`);
    }
  }

  function resetApp() {
    openModal({
      title: "Resetar app",
      contentHtml: `
        <p style="margin:0;color:rgba(233,236,246,.72);line-height:1.45">
          Isso vai apagar todo o progresso salvo neste dispositivo.
        </p>
        <div style="height:10px"></div>
        <p style="margin:0;color:rgba(233,236,246,.52);font-size:12px;line-height:1.35">
          Essa ação não pode ser desfeita.
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

  function render(route) {
    if (!main) return;

    // manter referência do último lugar
    store.set(s => { s.progress.lastRoute = route; });

    let html = "";
    switch (route) {
      case "home": html = viewHome(); break;
      case "path": html = viewPath(); break;
      case "missions": html = viewMissions(); break;
      case "library": html = viewLibrary(); break;
      case "profile": html = viewProfile(); break;
      default: html = viewNotFound(); break;
    }

    main.innerHTML = html;

    // aplicar estado nos tabs
    updateTabbar(route);

    // bind handlers dentro do main
    bindMainHandlers();
  }

  function rerender() {
    render(getRoute());
  }

  function updateTabbar(route) {
    $$(".tabbar__item").forEach(btn => {
      const r = btn.getAttribute("data-route");
      btn.classList.toggle("is-active", r === route);
    });
  }

  function bindMainHandlers() {
    // Cards que navegam
    $$(".card").forEach(card => {
      const go = () => {
        const r = card.getAttribute("data-route");
        if (r) setHash(r);
      };
      card.addEventListener("click", go);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
      });
    });

    // Actions
    $$("[data-action]").forEach(el => {
      el.addEventListener("click", () => {
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

          case "completeDaily":
            completeDaily();
            break;

          case "mockLesson":
            openMockLesson();
            break;

          case "checkin":
            checkin(el.getAttribute("data-status") || "ok");
            break;

          case "searchHint":
            toast("Busca completa entra na Parte 3/4");
            break;

          case "openAdmin":
            openAdminGate();
            break;

          case "resetApp":
            resetApp();
            break;

          case "goHome":
            setHash("home");
            break;

          default:
            toast("Ação ainda não implementada");
        }
      });
    });
  }

  /* -----------------------------
     Global handlers (topbar/tabbar)
  ----------------------------- */
  function bindGlobalHandlers() {
    // Tabs
    $$(".tabbar__item").forEach(btn => {
      btn.addEventListener("click", () => {
        const r = btn.getAttribute("data-route");
        if (r) setHash(r);
      });
    });

    // Brand click
    $(".brand")?.addEventListener("click", () => setHash("home"));

    // Install
    $("#btnInstall")?.addEventListener("click", promptInstall);

    // Admin
    $("#btnAdmin")?.addEventListener("click", openAdminGate);
  }

  /* -----------------------------
     Boot
  ----------------------------- */
  function boot() {
    bindGlobalHandlers();

    // Render inicial
    if (!location.hash) setHash("home");
    render(getRoute());

    // Perfil (se vazio)
    setTimeout(() => ensureProfileOrPrompt(), 300);

    // Re-render on route
    window.addEventListener("hashchange", () => render(getRoute()));

    // Re-render se store mudar (ex.: xp)
    store.subscribe(() => {
      // evita loops quando modal aberto: render principal ainda ok
      rerender();
    });
  }

  boot();
})();