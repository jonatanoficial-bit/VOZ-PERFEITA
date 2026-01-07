/* IMVpedia Voice — app.js (single file, premium UI + XP + Missões persistentes)
   Rotas: #/home #/path #/missions #/library #/profile
*/

(() => {
  "use strict";

  // ===== Utils =====
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const nowISODate = () => new Date().toISOString().slice(0, 10);

  function safeJSONParse(str, fallback) {
    try { return JSON.parse(str); } catch { return fallback; }
  }

  function uid(prefix = "id") {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }

  // ===== Storage Keys =====
  const K = {
    USER: "imv_voice_user_v1",
    PROGRESS: "imv_voice_progress_v2",
    MISSIONS: "imv_voice_missions_v2",
  };

  // ===== Default Data =====
  const DEFAULT_USER = {
    name: "Aluno",
    goal: "Misto",
  };

  // XP/Level model
  function xpToNext(level) {
    // simples e escalável
    // lvl1: 50, lvl2: 70, lvl3: 95...
    return Math.round(50 + (level - 1) * 20 + Math.max(0, level - 1) * 5);
  }

  const DEFAULT_PROGRESS = {
    xp: 0,
    level: 1,
    streakDays: 0,
    lastActiveDate: null,
    totalCompletedMissions: 0,
    completedMissionIds: [], // histórico (capado)
  };

  // Missões padrão (o app escolhe 2-3 por dia)
  const MISSION_POOL = [
    {
      id: "breath_36",
      tag: "técnica",
      title: "Respiração 3/6",
      desc: 'Respire 3s e solte 6s em "sss" por 5 minutos.',
      minutes: 5,
      xp: 10,
    },
    {
      id: "sovt_light",
      tag: "saúde",
      title: "SOVT leve",
      desc: "Lip trill / canudo / humming em região confortável.",
      minutes: 6,
      xp: 9,
    },
    {
      id: "sirene_suave",
      tag: "técnica",
      title: "Sirene suave",
      desc: "Glissando leve (subindo/descendo) sem apertar a laringe.",
      minutes: 4,
      xp: 8,
    },
    {
      id: "articulacao",
      tag: "repertório",
      title: "Articulação clara",
      desc: "Leia um trecho cantando em vogais + consoantes sem travar.",
      minutes: 7,
      xp: 10,
    },
    {
      id: "postura",
      tag: "saúde",
      title: "Postura & relaxamento",
      desc: "Alongue pescoço/ombros e solte tensão (sem elevar ombros).",
      minutes: 5,
      xp: 7,
    },
  ];

  // ===== State =====
  const state = {
    user: loadUser(),
    progress: loadProgress(),
    missions: loadMissions(),
  };

  function loadUser() {
    const saved = safeJSONParse(localStorage.getItem(K.USER), null);
    return saved && typeof saved === "object" ? { ...DEFAULT_USER, ...saved } : { ...DEFAULT_USER };
  }

  function loadProgress() {
    const saved = safeJSONParse(localStorage.getItem(K.PROGRESS), null);
    const merged = saved && typeof saved === "object" ? { ...DEFAULT_PROGRESS, ...saved } : { ...DEFAULT_PROGRESS };
    // sane
    if (!Array.isArray(merged.completedMissionIds)) merged.completedMissionIds = [];
    return merged;
  }

  function loadMissions() {
    const saved = safeJSONParse(localStorage.getItem(K.MISSIONS), null);
    if (!saved || typeof saved !== "object") {
      return generateDailyMissions();
    }
    // se for outro dia, gera novo
    if (saved.date !== nowISODate()) return generateDailyMissions();
    if (!Array.isArray(saved.items)) return generateDailyMissions();
    return saved;
  }

  function saveAll() {
    localStorage.setItem(K.USER, JSON.stringify(state.user));
    localStorage.setItem(K.PROGRESS, JSON.stringify(state.progress));
    localStorage.setItem(K.MISSIONS, JSON.stringify(state.missions));
  }

  // ===== Mission Generation =====
  function generateDailyMissions() {
    const date = nowISODate();
    // escolhe 2 missões determinísticas pelo dia (para não ficar trocando sozinho)
    const seed = Array.from(date).reduce((a, c) => a + c.charCodeAt(0), 0);
    const pool = [...MISSION_POOL];

    function pick(n) {
      const picked = [];
      let s = seed;
      for (let i = 0; i < n; i++) {
        s = (s * 9301 + 49297) % 233280;
        const idx = s % pool.length;
        picked.push(pool.splice(idx, 1)[0]);
      }
      return picked;
    }

    const items = pick(2);
    return { date, items };
  }

  // ===== UI Helpers =====
  function setActiveTab(route) {
    $$(".tabbar__item").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.route === route);
    });
  }

  function toast(msg) {
    const host = $("#toastHost");
    if (!host) return;

    host.innerHTML = `
      <div class="toast" role="status" aria-live="polite">
        <div class="toast__dot"></div>
        <div class="toast__msg">${escapeHTML(msg)}</div>
      </div>
    `;

    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(() => {
      if (host) host.innerHTML = "";
    }, 1800);
  }

  function escapeHTML(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  // ===== Progress / XP =====
  function markActiveToday() {
    const today = nowISODate();
    const last = state.progress.lastActiveDate;

    if (!last) {
      state.progress.streakDays = 1;
      state.progress.lastActiveDate = today;
      return;
    }

    if (last === today) return;

    const lastDate = new Date(last + "T00:00:00");
    const todayDate = new Date(today + "T00:00:00");
    const diffDays = Math.round((todayDate - lastDate) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) state.progress.streakDays += 1;
    else state.progress.streakDays = 1;

    state.progress.lastActiveDate = today;
  }

  function awardXP(xp, reason = "Progresso") {
    const p = state.progress;
    markActiveToday();

    p.xp += xp;

    // sobe níveis
    while (true) {
      const need = xpToNext(p.level);
      if (p.xp >= need) {
        p.xp -= need;
        p.level += 1;
        toast(`🎉 Subiu para o nível ${p.level}!`);
      } else break;
    }

    saveAll();
    toast(`✨ +${xp} XP • ${reason}`);
    // atualiza tela atual
    render();
  }

  // ===== Missions =====
  function isMissionCompleted(missionId) {
    return state.progress.completedMissionIds.includes(missionId + "@" + state.missions.date);
  }

  function completeMission(m) {
    const key = m.id + "@" + state.missions.date;
    if (state.progress.completedMissionIds.includes(key)) {
      toast("Você já concluiu essa missão hoje.");
      return;
    }

    state.progress.completedMissionIds.push(key);
    state.progress.totalCompletedMissions += 1;

    // limita histórico (não explode storage)
    if (state.progress.completedMissionIds.length > 500) {
      state.progress.completedMissionIds = state.progress.completedMissionIds.slice(-400);
    }

    saveAll();
    awardXP(m.xp, `Missão: ${m.title}`);
  }

  // ===== Content (Trilha / Biblioteca) =====
  // Mantive simples aqui; você pode expandir com seus JSONs depois.
  const PATH_MODULES = [
    { title: "Fundamentos", sub: "Base • 2 lições", icon: "🧭", route: "#/path/fundamentos" },
  ];

  const LIBRARY_ITEMS = [
    { title: "Fisiologia vocal", sub: "Saúde • Base", icon: "📚", route: "#/library/fisio" },
  ];

  // ===== Router =====
  function route() {
    const h = (location.hash || "#/home").trim();
    // normaliza (#/h vira #/home)
    if (h === "#/" || h === "#") return "#/home";
    if (h === "#/h") return "#/home";
    return h;
  }

  function render() {
    const r = route();
    const view = $("#view");
    if (!view) return;

    // tabs principais
    const topRoute = r.startsWith("#/path") ? "#/path"
      : r.startsWith("#/missions") ? "#/missions"
      : r.startsWith("#/library") ? "#/library"
      : r.startsWith("#/profile") ? "#/profile"
      : "#/home";

    setActiveTab(topRoute);

    if (r === "#/home") view.innerHTML = renderHome();
    else if (r === "#/path") view.innerHTML = renderPath();
    else if (r.startsWith("#/path/")) view.innerHTML = renderPathDetail(r);
    else if (r === "#/missions") view.innerHTML = renderMissions();
    else if (r === "#/library") view.innerHTML = renderLibrary();
    else if (r.startsWith("#/library/")) view.innerHTML = renderLibraryDetail(r);
    else if (r === "#/profile") view.innerHTML = renderProfile();
    else view.innerHTML = renderNotFound();
  }

  // ===== Pages =====
  function renderHome() {
    const u = state.user;
    const p = state.progress;
    const need = xpToNext(p.level);
    const pct = clamp(Math.round((p.xp / need) * 100), 0, 100);

    // missões do dia: mostra 1 card destaque
    const m = state.missions.items[0];

    return `
      <section class="page">
        <div class="hero">
          <div class="hero__top">Olá, ${escapeHTML(u.name)} • XP ${p.xp} • Nível ${p.level} <span style="float:right">🔥 ${p.streakDays} dia(s)</span></div>
          <div class="hero__title">IMVpedia Voice</div>
          <div class="hero__sub">Trilha vocal guiada com técnica, saúde e repertório (popular, erudito e coral).</div>

          <div class="hero__actions">
            <button class="btn btn--primary" data-nav="#/path" type="button">Trilha</button>
            <button class="btn" data-nav="#/missions" type="button">Fazer missões</button>
            <button class="btn btn--ghost" data-nav="#/profile" type="button">Perfil</button>
          </div>

          <div style="margin-top:14px;color:rgba(233,236,246,.62);font-size:12px">Progresso do nível</div>
          <div style="margin-top:8px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);border-radius:999px;overflow:hidden;height:10px">
            <div style="width:${pct}%;height:100%;background:linear-gradient(135deg, rgba(124,92,255,.95), rgba(124,92,255,.55))"></div>
          </div>
          <div style="margin-top:8px;color:rgba(233,236,246,.62);font-size:12px">${p.xp}/${need} XP para o próximo nível</div>
        </div>

        <div class="sectionHead">
          <div class="sectionTitle">Missão do dia</div>
          <div class="sectionRight">${escapeHTML(state.missions.date)} • ${escapeHTML(m.tag)}</div>
        </div>

        <div class="card">
          <div class="card__title">${escapeHTML(m.title)}</div>
          <div class="card__desc">${escapeHTML(m.desc)}</div>
          <div class="card__actions">
            <div class="btn" style="cursor:default;opacity:.9">⏱ ${m.minutes} min</div>
            ${
              isMissionCompleted(m.id)
                ? `<div class="btn" style="cursor:default;border-color:rgba(56,211,159,.35);background:rgba(56,211,159,.12)">✅ Concluída</div>`
                : `<button class="btn btn--primary" data-mission="${escapeHTML(m.id)}" type="button">✨ +${m.xp} XP</button>`
            }
          </div>
        </div>

        <div class="sectionHead">
          <div class="sectionTitle">Semana</div>
          <div class="sectionRight">progresso semanal</div>
        </div>

        <div class="grid">
          ${renderMiniCard("🏠", "Rotina", "Pequenos hábitos diários")}
          ${renderMiniCard("🧭", "Trilha", "Evolução por módulos")}
          ${renderMiniCard("✅", "Missões", "XP e consistência")}
          ${renderMiniCard("📚", "Biblioteca", "Referências rápidas")}
        </div>
      </section>
    `;
  }

  function renderMiniCard(icon, title, desc) {
    return `
      <div class="card" style="margin-bottom:0">
        <div class="card__title">${icon} ${escapeHTML(title)}</div>
        <div class="card__desc">${escapeHTML(desc)}</div>
      </div>
    `;
  }

  function renderPath() {
    return `
      <section class="page">
        <div class="sectionHead">
          <div class="sectionTitle">Trilha</div>
          <div class="sectionRight">módulos</div>
        </div>

        <div class="list">
          ${PATH_MODULES.map(m => `
            <div class="row" data-nav="${m.route}">
              <div class="row__left">${escapeHTML(m.icon)}</div>
              <div class="row__body">
                <div class="row__title">${escapeHTML(m.title)}</div>
                <div class="row__sub">${escapeHTML(m.sub)}</div>
              </div>
              <div class="row__right">›</div>
            </div>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderPathDetail(r) {
    // exemplo simples
    const title = r.split("/").pop() || "módulo";
    return `
      <section class="page">
        <div class="sectionHead">
          <div class="sectionTitle">Trilha</div>
          <div class="sectionRight">${escapeHTML(title)}</div>
        </div>

        <div class="card">
          <div class="card__title">Fundamentos (demo)</div>
          <div class="card__desc">Aqui entram suas lições JSON (iniciante ao avançado). Você já pode expandir isso com seus imports.</div>
          <div class="card__actions">
            <button class="btn" data-nav="#/path" type="button">Voltar</button>
            <button class="btn btn--primary" data-nav="#/missions" type="button">Fazer missão</button>
          </div>
        </div>
      </section>
    `;
  }

  function renderMissions() {
    // garante missão do dia correta
    if (state.missions.date !== nowISODate()) {
      state.missions = generateDailyMissions();
      saveAll();
    }

    const items = state.missions.items;

    return `
      <section class="page">
        <div class="sectionHead">
          <div class="sectionTitle">Missões</div>
          <div class="sectionRight">${escapeHTML(state.missions.date)}</div>
        </div>

        ${items.map(m => {
          const done = isMissionCompleted(m.id);
          return `
            <div class="card">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;color:rgba(233,236,246,.62);font-size:12px">
                <span style="display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.08);padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.03)">✅ ${escapeHTML(m.tag)}</span>
              </div>

              <div class="card__title">${escapeHTML(m.title)}</div>
              <div class="card__desc">${escapeHTML(m.desc)}</div>

              <div class="card__actions">
                <div class="btn" style="cursor:default;opacity:.9">⏱ ${m.minutes} min</div>

                ${
                  done
                    ? `<div class="btn" style="cursor:default;border-color:rgba(56,211,159,.35);background:rgba(56,211,159,.12)">✅ Concluída</div>`
                    : `<button class="btn btn--primary" data-mission="${escapeHTML(m.id)}" type="button">Concluir (+${m.xp} XP)</button>`
                }
              </div>
            </div>
          `;
        }).join("")}
      </section>
    `;
  }

  function renderLibrary() {
    return `
      <section class="page">
        <div class="sectionHead">
          <div class="sectionTitle">Biblioteca</div>
          <div class="sectionRight">atalhos</div>
        </div>

        <div class="list">
          ${LIBRARY_ITEMS.map(i => `
            <div class="row" data-nav="${i.route}">
              <div class="row__left">${escapeHTML(i.icon)}</div>
              <div class="row__body">
                <div class="row__title">${escapeHTML(i.title)}</div>
                <div class="row__sub">${escapeHTML(i.sub)}</div>
              </div>
              <div class="row__right">›</div>
            </div>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderLibraryDetail(r) {
    const slug = r.split("/").pop() || "item";
    return `
      <section class="page">
        <div class="sectionHead">
          <div class="sectionTitle">Biblioteca</div>
          <div class="sectionRight">${escapeHTML(slug)}</div>
        </div>

        <div class="card markdown">
          <h2>Fisiologia vocal (demo)</h2>
          <p>Conteúdo de referência entra aqui. Você pode colar textos grandes, e depois expandir via JSON.</p>
          <div class="card__actions">
            <button class="btn" data-nav="#/library" type="button">Voltar</button>
          </div>
        </div>
      </section>
    `;
  }

  function renderProfile() {
    const u = state.user;
    const p = state.progress;
    return `
      <section class="page">
        <div class="sectionHead">
          <div class="sectionTitle">Perfil</div>
          <div class="sectionRight">config</div>
        </div>

        <div class="card">
          <div class="card__title">🎤 ${escapeHTML(u.name)}</div>
          <div class="card__desc">Objetivo: <b>${escapeHTML(u.goal)}</b><br/>Nível: <b>${p.level}</b><br/>Streak: <b>${p.streakDays}</b> dia(s)<br/>Missões concluídas: <b>${p.totalCompletedMissions}</b></div>

          <div class="card__actions">
            <button class="btn" id="editNameBtn" type="button">Editar nome</button>
            <button class="btn btn--primary" data-nav="#/path" type="button">Trilha</button>
          </div>
        </div>

        <div class="card">
          <div class="card__title">Dados</div>
          <div class="card__desc">Se algo der errado, você pode “resetar” o progresso aqui.</div>
          <div class="card__actions">
            <button class="btn" id="resetBtn" type="button">Resetar progresso</button>
          </div>
        </div>
      </section>
    `;
  }

  function renderNotFound() {
    return `
      <section class="page">
        <div class="card">
          <div class="card__title">Página não encontrada</div>
          <div class="card__desc">Volte para o início.</div>
          <div class="card__actions">
            <button class="btn btn--primary" data-nav="#/home" type="button">Início</button>
          </div>
        </div>
      </section>
    `;
  }

  // ===== Events (delegação robusta) =====
  function onClick(e) {
    const t = e.target;

    // navegação por data-nav
    const nav = t.closest("[data-nav]");
    if (nav && nav.dataset.nav) {
      location.hash = nav.dataset.nav;
      return;
    }

    // tabs
    const tab = t.closest(".tabbar__item");
    if (tab && tab.dataset.route) {
      location.hash = tab.dataset.route;
      return;
    }

    // concluir missão
    const mBtn = t.closest("[data-mission]");
    if (mBtn && mBtn.dataset.mission) {
      const id = mBtn.dataset.mission;
      const m = state.missions.items.find(x => x.id === id);
      if (!m) {
        toast("Missão não encontrada.");
        return;
      }
      completeMission(m);
      return;
    }

    // editar nome
    if (t.closest("#editNameBtn")) {
      const name = prompt("Digite seu nome:", state.user.name || "Aluno");
      if (name && name.trim()) {
        state.user.name = name.trim().slice(0, 32);
        saveAll();
        toast("Nome atualizado.");
        render();
      }
      return;
    }

    // reset
    if (t.closest("#resetBtn")) {
      const ok = confirm("Resetar progresso? (XP, nível e missões concluídas)");
      if (ok) {
        state.progress = { ...DEFAULT_PROGRESS };
        state.missions = generateDailyMissions();
        saveAll();
        toast("Progresso resetado.");
        render();
      }
      return;
    }

    // admin
    if (t.closest("#adminBtn")) {
      // você pode trocar isso por sua rota admin depois
      toast("Admin (em breve): gerador de conteúdo.");
      return;
    }
  }

  function onHashChange() {
    render();
  }

  function init() {
    // garante rota inicial
    if (!location.hash) location.hash = "#/home";

    // garante missões do dia
    if (state.missions.date !== nowISODate()) {
      state.missions = generateDailyMissions();
      saveAll();
    }

    document.addEventListener("click", onClick, { passive: true });
    window.addEventListener("hashchange", onHashChange);

    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
