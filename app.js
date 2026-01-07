/* IMVpedia Voice — app.js (single-file SPA, offline-friendly)
   - Carrega conteúdo do pack via:
     ./packs/index.json
     ./packs/base/imports/content.json
   - Rotas:
     #/home, #/path, #/missions, #/library, #/profile, #/article?id=...
     #/admin, #/admin-generator, #/admin-export (simples)
*/

(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const view = $("#view");
  const toastHost = $("#toastHost");
  const adminBtn = $("#adminBtn");

  // -----------------------------
  // State (persistido)
  // -----------------------------
  const STORAGE_KEY = "imv_state_v1";

  const defaultState = {
    profile: {
      name: "Aluno",
      goal: "Misto"
    },
    xp: 0,
    streakDays: 0,
    lastCompletedDate: null, // yyyy-mm-dd
    completedMissionIds: {}, // { [yyyy-mm-dd]: { [missionId]: true } }
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(defaultState);
      const parsed = JSON.parse(raw);
      return deepMerge(structuredClone(defaultState), parsed);
    } catch {
      return structuredClone(defaultState);
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    // atualiza home se estiver visível
    updateHeaderXP();
  }

  function deepMerge(base, extra) {
    if (!extra || typeof extra !== "object") return base;
    for (const k of Object.keys(extra)) {
      const v = extra[k];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        if (!base[k] || typeof base[k] !== "object") base[k] = {};
        deepMerge(base[k], v);
      } else {
        base[k] = v;
      }
    }
    return base;
  }

  let state = loadState();

  // -----------------------------
  // Conteúdo (packs)
  // -----------------------------
  const contentDB = {
    packs: [],         // packs/index.json
    items: [],         // array geral de tudo (lessons, library, missions, tracks etc.)
    tracks: [],
    lessons: [],
    library: [],
    missions: [],
  };

  let contentReady = false;
  let contentError = null;

  function todayISO() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  async function safeFetchJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Falha ao carregar ${url} (${res.status})`);
    return await res.json();
  }

  function normalizeItems(items) {
    if (!Array.isArray(items)) return [];
    return items
      .filter(Boolean)
      .map((it, idx) => {
        const id = String(it.id || it._id || `${it.type || "item"}_${idx}_${Math.random().toString(16).slice(2)}`);
        return {
          id,
          type: String(it.type || "item"),
          title: String(it.title || "Sem título"),
          subtitle: it.subtitle ? String(it.subtitle) : "",
          level: it.level ? String(it.level) : "",
          tags: Array.isArray(it.tags) ? it.tags.map(String) : [],
          cover: it.cover ? String(it.cover) : "",
          text: it.text ? String(it.text) : "",
          minutes: Number.isFinite(+it.minutes) ? +it.minutes : null,
          xp: Number.isFinite(+it.xp) ? +it.xp : null,
          category: it.category ? String(it.category) : "",
          trackId: it.trackId ? String(it.trackId) : "",
          order: Number.isFinite(+it.order) ? +it.order : null,
          packId: it.packId ? String(it.packId) : "base",
          raw: it
        };
      });
  }

  function rebuildDB(all) {
    contentDB.items = all;

    contentDB.tracks = all.filter(i => i.type === "track");
    contentDB.lessons = all.filter(i => i.type === "lesson");
    contentDB.library = all.filter(i => i.type === "library");
    contentDB.missions = all.filter(i => i.type === "mission");
  }

  async function loadContent() {
    contentReady = false;
    contentError = null;

    try {
      const packsIndex = await safeFetchJSON("./packs/index.json");
      const packs = Array.isArray(packsIndex.packs) ? packsIndex.packs : [];
      contentDB.packs = packs;

      // carrega packs habilitados (por enquanto base)
      const enabled = packs.filter(p => p.enabledDefault !== false);
      const allItems = [];

      for (const p of enabled) {
        const pid = String(p.id || "base");
        // padrão do seu projeto: packs/<id>/imports/content.json
        const url = `./packs/${pid}/imports/content.json`;
        try {
          const data = await safeFetchJSON(url);
          const items = normalizeItems(data);
          for (const it of items) it.packId = pid;
          allItems.push(...items);
        } catch (e) {
          console.warn("Pack falhou:", pid, e);
        }
      }

      rebuildDB(allItems);
      contentReady = true;
    } catch (e) {
      contentError = e;
      contentReady = false;
    }
  }

  // -----------------------------
  // UI helpers (toast)
  // -----------------------------
  function toast(msg, kind = "ok") {
    const el = document.createElement("div");
    el.className = `toast toast--${kind}`;
    el.textContent = msg;
    toastHost.appendChild(el);

    requestAnimationFrame(() => el.classList.add("is-on"));
    setTimeout(() => {
      el.classList.remove("is-on");
      setTimeout(() => el.remove(), 300);
    }, 2600);
  }

  function escapeHTML(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function mdToHTML(md) {
    // simples e seguro (sem libs): títulos, negrito, itálico, listas e quebras
    const safe = escapeHTML(md || "");
    return safe
      .replace(/^### (.*)$/gm, "<h3>$1</h3>")
      .replace(/^## (.*)$/gm, "<h2>$1</h2>")
      .replace(/^# (.*)$/gm, "<h1>$1</h1>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/^\- (.*)$/gm, "<li>$1</li>")
      .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
      .replace(/\n{2,}/g, "</p><p>")
      .replace(/\n/g, "<br/>")
      .replace(/^/g, "<p>")
      .replace(/$/g, "</p>")
      .replaceAll("<p></p>", "");
  }

  function setActiveTab(hash) {
    const items = $$(".tabbar__item");
    for (const b of items) {
      const r = b.getAttribute("data-route");
      b.classList.toggle("is-active", r === hash);
    }
  }

  function parseRoute() {
    const raw = location.hash || "#/home";
    const [path, query] = raw.split("?");
    const params = new URLSearchParams(query || "");
    return { raw, path, params };
  }

  function setRoute(hash) {
    if (location.hash === hash) return;
    location.hash = hash;
  }

  // -----------------------------
  // XP / Level
  // -----------------------------
  function levelFromXP(xp) {
    const per = 50;
    const lvl = Math.floor((xp || 0) / per) + 1;
    const into = (xp || 0) % per;
    return { level: lvl, into, per };
  }

  function updateHeaderXP() {
    // atualiza textos que existirem na tela atual (sem quebrar se não existir)
    const xpEls = $$("[data-xp]");
    for (const el of xpEls) el.textContent = String(state.xp || 0);

    const lvlEls = $$("[data-level]");
    const info = levelFromXP(state.xp || 0);
    for (const el of lvlEls) el.textContent = String(info.level);

    const bar = $("[data-levelbar]");
    const barTxt = $("[data-levelbar-text]");
    if (bar) bar.style.width = `${Math.min(100, Math.round((info.into / info.per) * 100))}%`;
    if (barTxt) barTxt.textContent = `${info.into}/${info.per} XP para o próximo nível`;
  }
  // -----------------------------
  // Missões (concluir / streak)
  // -----------------------------
  function isMissionCompletedToday(missionId) {
    const day = todayISO();
    const map = state.completedMissionIds?.[day] || {};
    return !!map[missionId];
  }

  function markMissionCompleted(missionId) {
    const day = todayISO();
    if (!state.completedMissionIds) state.completedMissionIds = {};
    if (!state.completedMissionIds[day]) state.completedMissionIds[day] = {};
    state.completedMissionIds[day][missionId] = true;

    // streak simples: se completou algo hoje e ontem era o último dia, incrementa
    const last = state.lastCompletedDate;
    state.lastCompletedDate = day;

    if (!last) {
      state.streakDays = 1;
    } else {
      const dLast = new Date(last + "T00:00:00");
      const dToday = new Date(day + "T00:00:00");
      const diff = Math.round((dToday - dLast) / (1000 * 60 * 60 * 24));
      if (diff === 0) {
        // mesmo dia (mantém)
        state.streakDays = Math.max(1, state.streakDays || 1);
      } else if (diff === 1) {
        state.streakDays = (state.streakDays || 0) + 1;
      } else {
        state.streakDays = 1;
      }
    }
  }

  function gainXP(amount) {
    const add = Math.max(0, Number(amount) || 0);
    state.xp = (state.xp || 0) + add;
    saveState();
  }

  // -----------------------------
  // Render helpers (cards)
  // -----------------------------
  function cardHTML({ title, meta, body, actions }) {
    return `
      <section class="card">
        <div class="card__inner">
          ${title ? `<div class="card__title">${title}</div>` : ""}
          ${meta ? `<div class="card__meta">${meta}</div>` : ""}
          ${body ? `<div class="card__body">${body}</div>` : ""}
          ${actions ? `<div class="card__actions">${actions}</div>` : ""}
        </div>
      </section>
    `;
  }

  function pillHTML(text) {
    return `<span class="pill">${escapeHTML(text)}</span>`;
  }

  function smallBtn(text, attrs = "") {
    return `<button class="btn btn--soft" type="button" ${attrs}>${escapeHTML(text)}</button>`;
  }

  function primaryBtn(text, attrs = "") {
    return `<button class="btn btn--primary" type="button" ${attrs}>${escapeHTML(text)}</button>`;
  }

  function routeHeaderHTML(opts) {
    const left = opts?.left || "IMVpedia Voice";
    const right = opts?.right || "";
    return `
      <div class="routehead">
        <div>
          <div class="routehead__kicker">${escapeHTML(opts?.kicker || "")}</div>
          <div class="routehead__title">${escapeHTML(left)}</div>
        </div>
        <div class="routehead__right">${right}</div>
      </div>
    `;
  }

  // -----------------------------
  // Screens
  // -----------------------------
  function renderLoading() {
    view.innerHTML = `
      <div class="container">
        ${routeHeaderHTML({ left: "Carregando…" })}
        ${cardHTML({
          title: "Aguarde",
          meta: "Preparando conteúdo offline",
          body: "Se isso demorar, verifique se os arquivos packs/* foram enviados no GitHub."
        })}
      </div>
    `;
  }

  function renderContentNotDetected() {
    view.innerHTML = `
      <div class="container">
        ${routeHeaderHTML({ left: "Conteúdo não detectado", kicker: "Conteúdo • Geral • Ajuda" })}
        ${cardHTML({
          title: "Seus conteúdos (" + (contentDB.items?.length || 0) + ") não foram detectados.",
          meta: "Isso normalmente acontece quando a pasta packs não está no deploy (ou o caminho mudou).",
          body: `
            <div style="opacity:.92;line-height:1.55">
              Verifique no GitHub se existem estes arquivos:<br/>
              <code>packs/index.json</code><br/>
              <code>packs/base/imports/content.json</code><br/><br/>
              E se o site está abrindo na mesma pasta do projeto (GitHub Pages / Vercel).<br/><br/>
              <strong>Obs:</strong> isso NÃO depende de colocar 217 &lt;script&gt; no index. O app carrega via fetch.
            </div>
          `,
          actions: `<button class="btn btn--soft" type="button" data-action="go" data-to="#/home">Voltar</button>`
        })}
      </div>
    `;

    bindCommonActions();
  }

  function renderHome() {
    const info = levelFromXP(state.xp || 0);
    const streak = state.streakDays || 0;

    // Missão do dia (pega uma "mission" do conteúdo; se não tiver, gera fallback)
    const missions = contentDB.missions || [];
    const pick = missions.length
      ? missions[Math.abs(hashString(todayISO())) % missions.length]
      : {
          id: "fallback_mission_1",
          type: "mission",
          title: "Respiração 3/6",
          subtitle: "Respire 3s e solte 6s em \"sss\" por 5 minutos.",
          category: "técnica",
          minutes: 5,
          xp: 10
        };

    const completed = isMissionCompletedToday(pick.id);

    view.innerHTML = `
      <div class="container">
        <div class="hero">
          <div class="hero__kicker">
            Olá, <strong>${escapeHTML(state.profile.name || "Aluno")}</strong> • XP <span data-xp>${state.xp || 0}</span> • Nível <span data-level>${info.level}</span>
            <span class="hero__streak">🔥 ${streak} dia(s)</span>
          </div>
          <div class="hero__title">IMVpedia Voice</div>
          <div class="hero__subtitle">Trilha vocal completa (popular, erudito e coral) com técnica, saúde vocal e performance.</div>

          <div class="hero__quick">
            <button class="btn btn--soft" type="button" data-action="go" data-to="#/path">Trilha</button>
            <button class="btn btn--soft" type="button" data-action="go" data-to="#/missions">Missões</button>
            <button class="btn btn--soft" type="button" data-action="go" data-to="#/library">Biblioteca</button>
          </div>

          <div class="levelbar">
            <div class="levelbar__label">Progresso do nível</div>
            <div class="levelbar__track"><div class="levelbar__fill" data-levelbar></div></div>
            <div class="levelbar__text" data-levelbar-text>${info.into}/${info.per} XP para o próximo nível</div>
          </div>
        </div>

        <div class="sectionHead">
          <div class="sectionHead__title">Missão do dia</div>
          <div class="sectionHead__meta">${todayISO()} • ${escapeHTML(pick.category || "técnica")}</div>
        </div>

        ${cardHTML({
          title: escapeHTML(pick.title),
          meta: escapeHTML(pick.subtitle || ""),
          body: "",
          actions: `
            ${pick.minutes ? `<span class="pill">⏱ ${pick.minutes} min</span>` : ""}
            ${completed
              ? `<span class="pill">✅ Concluída hoje</span>`
              : `<button class="btn btn--primary" type="button" data-action="complete-mission" data-id="${escapeHTML(pick.id)}" data-xp="${pick.xp || 10}">✨ +${pick.xp || 10} XP</button>`
            }
          `
        })}

        <div class="sectionHead" style="margin-top:18px">
          <div class="sectionHead__title">Começar agora</div>
          <div class="sectionHead__meta">Rápido e seguro</div>
        </div>

        ${cardHTML({
          title: "Aquecimento SOVT (leve)",
          meta: "Rotina • 8–12 min",
          body: "Lip trill / canudo / humming em região confortável. Sem dor. Sem empurrar.",
          actions: `
            <button class="btn btn--soft" type="button" data-action="go" data-to="#/path">Abrir trilha</button>
            <button class="btn btn--soft" type="button" data-action="go" data-to="#/library">Ver referências</button>
          `
        })}
      </div>
    `;

    bindCommonActions();
    updateHeaderXP();
  }

  function renderPath() {
    // Agrupa por "track" se existir; senão lista lições
    const tracks = contentDB.tracks || [];
    const lessons = contentDB.lessons || [];

    let body = "";

    if (tracks.length) {
      const cards = tracks
        .sort((a,b)=> (a.order ?? 9999) - (b.order ?? 9999))
        .map(t => {
          const count = lessons.filter(l => l.trackId === t.id).length;
          return cardHTML({
            title: `🧭 ${escapeHTML(t.title)}`,
            meta: `${escapeHTML(t.level || "Base")} • ${count} lições`,
            body: t.subtitle ? escapeHTML(t.subtitle) : "",
            actions: `<button class="btn btn--soft" type="button" data-action="open-track" data-id="${escapeHTML(t.id)}">Abrir</button>`
          });
        }).join("");
      body = cards || "";
    } else {
      const cards = lessons.slice(0, 30).map(l => cardHTML({
        title: escapeHTML(l.title),
        meta: escapeHTML(l.level || "Básico"),
        body: l.subtitle ? escapeHTML(l.subtitle) : "",
        actions: `<button class="btn btn--soft" type="button" data-action="open-article" data-id="${escapeHTML(l.id)}">Abrir</button>`
      })).join("");
      body = cards || cardHTML({ title: "Sem trilhas/lessons", meta: "Adicione no content.json", body: "" });
    }

    view.innerHTML = `
      <div class="container">
        ${routeHeaderHTML({ left: "Trilha" })}
        ${body}
      </div>
    `;

    bindCommonActions();
  }
  function renderMissions() {
    const missions = (contentDB.missions || []).slice().sort((a,b)=> (a.order ?? 9999) - (b.order ?? 9999));

    const body = missions.length
      ? missions.map(m => {
          const done = isMissionCompletedToday(m.id);
          const xp = m.xp || 10;
          return cardHTML({
            title: `${m.category ? "✅ " + escapeHTML(m.category) : "✅ missão"}<div style="height:6px"></div>${escapeHTML(m.title)}`,
            meta: escapeHTML(m.subtitle || ""),
            body: "",
            actions: done
              ? `<span class="pill">✅ Concluída hoje</span>`
              : `<button class="btn btn--primary" type="button" data-action="complete-mission" data-id="${escapeHTML(m.id)}" data-xp="${xp}">Concluir (+${xp} XP)</button>`
          });
        }).join("")
      : cardHTML({
          title: "Missões",
          meta: "Nenhuma missão no conteúdo ainda",
          body: "Adicione itens type: \"mission\" em packs/base/imports/content.json",
          actions: ""
        });

    view.innerHTML = `
      <div class="container">
        ${routeHeaderHTML({ left: "Missões" })}
        ${body}
      </div>
    `;

    bindCommonActions();
  }

  function renderLibrary() {
    const lib = (contentDB.library || []).slice().sort((a,b)=> (a.order ?? 9999) - (b.order ?? 9999));

    const body = lib.length
      ? lib.map(x => cardHTML({
          title: `📚 ${escapeHTML(x.title)}`,
          meta: `${escapeHTML(x.category || "Saúde")} • ${escapeHTML(x.level || "Base")}`,
          body: x.subtitle ? escapeHTML(x.subtitle) : "",
          actions: `<button class="btn btn--soft" type="button" data-action="open-article" data-id="${escapeHTML(x.id)}">Abrir</button>`
        })).join("")
      : cardHTML({ title: "Biblioteca", meta: "Nenhum artigo encontrado", body: "" });

    view.innerHTML = `
      <div class="container">
        ${routeHeaderHTML({ left: "Biblioteca" })}
        ${body}
      </div>
    `;

    bindCommonActions();
  }

  function renderProfile() {
    const info = levelFromXP(state.xp || 0);

    view.innerHTML = `
      <div class="container">
        ${routeHeaderHTML({ left: "Perfil" })}

        ${cardHTML({
          title: `🎤 ${escapeHTML(state.profile.name || "Aluno")}`,
          meta: `Objetivo: <strong>${escapeHTML(state.profile.goal || "Misto")}</strong><br/>XP: <strong><span data-xp>${state.xp || 0}</span></strong> • Nível: <strong><span data-level>${info.level}</span></strong>`,
          body: "",
          actions: `
            <button class="btn btn--soft" type="button" data-action="edit-name">Editar nome</button>
            <button class="btn btn--primary" type="button" data-action="go" data-to="#/missions">Placement</button>
          `
        })}
      </div>
    `;

    bindCommonActions();
    updateHeaderXP();
  }

  function renderArticle(id) {
    const item = (contentDB.items || []).find(x => x.id === id);

    if (!item) {
      view.innerHTML = `
        <div class="container">
          ${routeHeaderHTML({ left: "Conteúdo não encontrado" })}
          ${cardHTML({
            title: "Esse item não existe (ou não foi carregado).",
            meta: "Dica: confirme se packs/base/imports/content.json foi publicado no GitHub.",
            body: "",
            actions: `<button class="btn btn--soft" type="button" data-action="go" data-to="#/library">Voltar</button>`
          })}
        </div>
      `;
      bindCommonActions();
      return;
    }

    view.innerHTML = `
      <div class="container">
        ${routeHeaderHTML({ left: item.title, kicker: `${escapeHTML(item.packId)} • ${escapeHTML(item.type)}` })}
        ${cardHTML({
          title: item.subtitle ? escapeHTML(item.subtitle) : "",
          meta: (item.tags || []).slice(0, 6).map(pillHTML).join(" "),
          body: `<div class="article">${mdToHTML(item.text || "")}</div>`,
          actions: `<button class="btn btn--soft" type="button" data-action="back">Voltar</button>`
        })}
      </div>
    `;

    bindCommonActions();
  }

  // -----------------------------
  // Admin (simples)
  // -----------------------------
  function renderAdmin() {
    view.innerHTML = `
      <div class="container">
        ${routeHeaderHTML({ left: "Admin", kicker: "Ferramentas" })}
        ${cardHTML({
          title: "Gerador de conteúdo (JSON)",
          meta: "Crie título + texto e exporte para colar no content.json",
          body: "Use isso para ganhar independência e gerar muito conteúdo sem programar.",
          actions: `
            <button class="btn btn--primary" type="button" data-action="go" data-to="#/admin-generator">Abrir gerador</button>
            <button class="btn btn--soft" type="button" data-action="go" data-to="#/admin-export">Ver export</button>
          `
        })}
      </div>
    `;
    bindCommonActions();
  }

  function renderAdminGenerator() {
    view.innerHTML = `
      <div class="container">
        ${routeHeaderHTML({ left: "Gerador", kicker: "Admin • Conteúdo" })}

        <section class="card">
          <div class="card__inner">
            <div class="card__title">Novo item</div>

            <div class="formGrid">
              <label class="field">
                <div class="field__label">Tipo</div>
                <select id="gType" class="field__input">
                  <option value="lesson">lesson</option>
                  <option value="library">library</option>
                  <option value="mission">mission</option>
                  <option value="track">track</option>
                </select>
              </label>

              <label class="field">
                <div class="field__label">Título</div>
                <input id="gTitle" class="field__input" placeholder="Ex: Canudo (straw phonation) — passo a passo" />
              </label>

              <label class="field">
                <div class="field__label">Categoria</div>
                <input id="gCategory" class="field__input" placeholder="Ex: técnica / saúde / repertório" />
              </label>

              <label class="field">
                <div class="field__label">Nível</div>
                <input id="gLevel" class="field__input" placeholder="Ex: Básico / Intermediário / Avançado" />
              </label>

              <label class="field">
                <div class="field__label">XP (só missão)</div>
                <input id="gXP" class="field__input" type="number" min="0" placeholder="10" />
              </label>

              <label class="field">
                <div class="field__label">Minutos (opcional)</div>
                <input id="gMin" class="field__input" type="number" min="0" placeholder="5" />
              </label>

              <label class="field field--full">
                <div class="field__label">Texto (Markdown simples)</div>
                <textarea id="gText" class="field__input" rows="10" placeholder="# Título&#10;&#10;Texto..."></textarea>
              </label>
            </div>

            <div class="card__actions">
              <button class="btn btn--primary" type="button" data-action="gen-json">Gerar JSON</button>
              <button class="btn btn--soft" type="button" data-action="go" data-to="#/admin-export">Ir para Export</button>
            </div>
          </div>
        </section>
      </div>
    `;
    bindCommonActions();
  }

  let lastGenerated = "";

  function renderAdminExport() {
    view.innerHTML = `
      <div class="container">
        ${routeHeaderHTML({ left: "Seu conteúdo custom (JSON)", kicker: "Admin • Export" })}
        <section class="card">
          <div class="card__inner">
            <div class="card__meta">Copie e cole NO ARQUIVO: <code>packs/base/imports/content.json</code> (no GitHub).<br/>Você pode colar como novos objetos no array, SEM apagar os existentes.</div>
            <textarea class="field__input" id="exportBox" rows="16" style="width:100%">${escapeHTML(lastGenerated || "")}</textarea>
            <div class="card__actions">
              <button class="btn btn--primary" type="button" data-action="copy-export">Copiar</button>
              <button class="btn btn--soft" type="button" data-action="go" data-to="#/admin-generator">Ir para Gerador</button>
            </div>
          </div>
        </section>
      </div>
    `;
    bindCommonActions();
  }

  // -----------------------------
  // Router render
  // -----------------------------
  function render() {
    const { path, params } = parseRoute();
    setActiveTab(path);

    if (!contentReady) {
      // se falhou ou veio vazio
      if (contentError) {
        console.warn(contentError);
        renderContentNotDetected();
        return;
      }
      renderLoading();
      return;
    }

    // conteúdo existe mas está vazio -> ajuda
    if (!contentDB.items || contentDB.items.length === 0) {
      renderContentNotDetected();
      return;
    }

    switch (path) {
      case "#/home": return renderHome();
      case "#/path": return renderPath();
      case "#/missions": return renderMissions();
      case "#/library": return renderLibrary();
      case "#/profile": return renderProfile();

      case "#/admin": return renderAdmin();
      case "#/admin-generator": return renderAdminGenerator();
      case "#/admin-export": return renderAdminExport();

      case "#/article": {
        const id = params.get("id") || "";
        return renderArticle(id);
      }

      default:
        return renderHome();
    }
  }

  // -----------------------------
  // Actions
  // -----------------------------
  function bindCommonActions() {
    // navegação geral
    $$("[data-action='go']").forEach(btn => {
      btn.onclick = () => setRoute(btn.getAttribute("data-to"));
    });

    $$("[data-action='back']").forEach(btn => {
      btn.onclick = () => history.back();
    });

    // abrir conteúdo
    $$("[data-action='open-article']").forEach(btn => {
      btn.onclick = () => setRoute(`#/article?id=${encodeURIComponent(btn.getAttribute("data-id") || "")}`);
    });

    // abrir track: aqui vamos filtrar lessons do track e mostrar uma lista rápida
    $$("[data-action='open-track']").forEach(btn => {
      btn.onclick = () => {
        const tid = btn.getAttribute("data-id");
        const track = (contentDB.tracks || []).find(t => t.id === tid);
        const lessons = (contentDB.lessons || []).filter(l => l.trackId === tid).sort((a,b)=> (a.order ?? 9999)-(b.order ?? 9999));

        view.innerHTML = `
          <div class="container">
            ${routeHeaderHTML({ left: track ? track.title : "Trilha", kicker: "Trilha • Aulas" })}
            ${lessons.length
              ? lessons.map(l => cardHTML({
                  title: escapeHTML(l.title),
                  meta: escapeHTML(l.level || "Base"),
                  body: l.subtitle ? escapeHTML(l.subtitle) : "",
                  actions: `<button class="btn btn--soft" type="button" data-action="open-article" data-id="${escapeHTML(l.id)}">Abrir</button>`
                })).join("")
              : cardHTML({ title: "Sem lições nessa trilha", meta: "", body: "" })
            }
            <div style="height:12px"></div>
            <button class="btn btn--soft" type="button" data-action="go" data-to="#/path">Voltar</button>
          </div>
        `;

        bindCommonActions();
      };
    });

    // concluir missão
    $$("[data-action='complete-mission']").forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-id");
        const xp = Number(btn.getAttribute("data-xp") || 10);

        if (!id) return;

        if (isMissionCompletedToday(id)) {
          toast("Você já concluiu essa missão hoje ✅", "warn");
          return;
        }

        markMissionCompleted(id);
        gainXP(xp);
        toast(`+${xp} XP! Missão concluída ✅`, "ok");

        // re-render pra atualizar botão + barra
        render();
      };
    });

    // profile edit
    $$("[data-action='edit-name']").forEach(btn => {
      btn.onclick = () => {
        const name = prompt("Seu nome:", state.profile.name || "Aluno");
        if (!name) return;
        state.profile.name = name.trim().slice(0, 24) || "Aluno";
        saveState();
        render();
      };
    });

    // generator
    $$("[data-action='gen-json']").forEach(btn => {
      btn.onclick = () => {
        const type = ($("#gType")?.value || "lesson").trim();
        const title = ($("#gTitle")?.value || "").trim();
        const category = ($("#gCategory")?.value || "").trim();
        const level = ($("#gLevel")?.value || "").trim();
        const xp = Number(($("#gXP")?.value || "").trim() || 0);
        const minutes = Number(($("#gMin")?.value || "").trim() || 0);
        const text = ($("#gText")?.value || "").trim();

        if (!title) {
          toast("Preencha pelo menos o TÍTULO.", "warn");
          return;
        }

        const id = `${type}_${slug(title)}_${Math.random().toString(16).slice(2, 6)}`.slice(0, 60);

        const obj = {
          id,
          type,
          title,
          category: category || undefined,
          level: level || undefined,
          xp: type === "mission" ? (xp || 10) : undefined,
          minutes: minutes ? minutes : undefined,
          text: text || undefined
        };

        // remove undefined
        Object.keys(obj).forEach(k => obj[k] === undefined && delete obj[k]);

        lastGenerated = JSON.stringify(obj, null, 2);
        toast("JSON gerado! Vá em Export para copiar.", "ok");
      };
    });

    $$("[data-action='copy-export']").forEach(btn => {
      btn.onclick = async () => {
        const box = $("#exportBox");
        if (!box) return;
        box.select();
        try {
          await navigator.clipboard.writeText(box.value);
          toast("Copiado ✅", "ok");
        } catch {
          document.execCommand("copy");
          toast("Copiado ✅", "ok");
        }
      };
    });
  }

  function slug(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
  }

  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return h;
  }

  // -----------------------------
  // Tabbar + Admin btn
  // -----------------------------
  $$(".tabbar__item").forEach(b => {
    b.addEventListener("click", () => {
      const r = b.getAttribute("data-route");
      if (r) setRoute(r);
    });
  });

  if (adminBtn) {
    adminBtn.addEventListener("click", () => {
      // atalho: se estiver em admin abre gerador
      const { path } = parseRoute();
      if (path.startsWith("#/admin")) setRoute("#/admin-generator");
      else setRoute("#/admin");
    });
  }

  // -----------------------------
  // Boot
  // -----------------------------
  window.addEventListener("hashchange", render);

  (async function boot() {
    renderLoading();
    await loadContent();

    // se conteúdo carregou, renderiza; se falhou, mostra ajuda
    render();
    updateHeaderXP();
  })();
})();
