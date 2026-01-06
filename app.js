(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const view = () => $("#view");

  const escapeHtml = (str) => String(str ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  const LS = {
    STATE: "imv_voice_state_full_v1",
    ADMIN: "imv_voice_admin_on_v1",
    CUSTOM_PACKS: "imv_voice_custom_packs_v1"
  };

  const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
  const safeJsonParse = (raw, fallback) => { try { return JSON.parse(raw); } catch { return fallback; } };

  const DEFAULT_STATE = {
    user: { id: uid(), name: "Aluno", avatar: "🎤", goal: "Misto", levelReal: null },
    gamification: { xp: 0, level: 1, streak: 0, lastActiveDate: null, badges: [] },
    packs: { activePackIds: ["base"] },
    progress: { completedMissions: {}, todayMission: null, completedLessons: {} },
    placement: { answers: {}, result: null, score: 0 }
  };

  const store = {
    state: (() => {
      const raw = localStorage.getItem(LS.STATE);
      if (!raw) return structuredClone(DEFAULT_STATE);
      const parsed = safeJsonParse(raw, null);
      return parsed && typeof parsed === "object"
        ? Object.assign(structuredClone(DEFAULT_STATE), parsed)
        : structuredClone(DEFAULT_STATE);
    })(),
    set(mut) {
      const next = structuredClone(this.state);
      mut(next);
      this.state = next;
      try { localStorage.setItem(LS.STATE, JSON.stringify(this.state)); } catch {}
    },
    get() { return this.state; }
  };

  /* Toast */
  let toastTimer = null;
  function toast(msg) {
    const host = $("#toastHost");
    if (!host) return;
    host.innerHTML = `<div class="toast"><div class="toast__dot"></div><div class="toast__msg">${escapeHtml(msg)}</div></div>`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=> host.innerHTML = "", 2200);
  }

  /* Router */
  function setHash(route, query = {}) {
    const base = route.startsWith("#/") ? route : `#/${route}`;
    const qs = new URLSearchParams(query).toString();
    location.hash = qs ? `${base}?${qs}` : base;
  }

  function getRouteAndQuery() {
    const h = (location.hash || "#/home").trim();
    if (!h.startsWith("#/")) return { route: "home", query: {} };
    const [path, qs] = h.slice(2).split("?");
    let route = path || "home";
    const query = Object.fromEntries(new URLSearchParams(qs || ""));
    return { route, query };
  }

  /* Packs */
  const cache = { index:null, manifests:new Map() };

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Falha ao carregar: ${url}`);
    return await res.json();
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
    if (!Array.isArray(m.paths)) m.paths = [];
    if (!Array.isArray(m.library)) m.library = [];
    if (!m.missions) m.missions = {};
    if (!Array.isArray(m.missions.templates)) m.missions.templates = [];
    return m;
  }

  async function loadPackIndex() {
    if (cache.index) return cache.index;
    let idx = { packs: [] };
    try { idx = await fetchJson("./packs/index.json"); } catch { idx = { packs: [] }; }
    if (!Array.isArray(idx.packs)) idx.packs = [];
    const custom = getCustomPacks().map(normalizeManifest).map(m => ({ id:m.id, title:m.title, desc:m.desc, isCustom:true }));
    cache.index = { packs: [...idx.packs, ...custom] };
    return cache.index;
  }

  async function loadManifest(packId) {
    if (cache.manifests.has(packId)) return cache.manifests.get(packId);
    const customs = getCustomPacks().map(normalizeManifest);
    const found = customs.find(p => p.id === packId);
    if (found) { cache.manifests.set(packId, found); return found; }
    const man = normalizeManifest(await fetchJson(`./packs/${encodeURIComponent(packId)}/manifest.json`));
    cache.manifests.set(packId, man);
    return man;
  }

  async function getActiveManifests() {
    const st = store.get();
    const ids = Array.isArray(st.packs.activePackIds) ? st.packs.activePackIds : ["base"];
    const out = [];
    for (const id of ids) { try { out.push(await loadManifest(id)); } catch {} }
    return out;
  }

  /* UI helpers */
  const bottomSpacer = () => `<div style="height:110px"></div>`;
  const sectionTitle = (t, right="") => `<div class="sectionHead"><div class="sectionTitle">${escapeHtml(t)}</div><div class="sectionRight">${right}</div></div>`;

  function btn(text, action, data={}, cls="btn") {
    const attrs = Object.entries(data).map(([k,v]) => `data-${k}="${escapeHtml(String(v))}"`).join(" ");
    return `<button class="${cls}" type="button" data-action="${escapeHtml(action)}" ${attrs}>${escapeHtml(text)}</button>`;
  }

  function rowItem({ icon="📘", title="", sub="", action="", data={} }) {
    const attrs = Object.entries(data).map(([k,v]) => `data-${k}="${escapeHtml(String(v))}"`).join(" ");
    return `<div class="row" role="button" tabindex="0" data-action="${escapeHtml(action)}" ${attrs}>
      <div class="row__left">${escapeHtml(icon)}</div>
      <div class="row__body"><div class="row__title">${escapeHtml(title)}</div><div class="row__sub">${escapeHtml(sub)}</div></div>
      <div class="row__right">›</div>
    </div>`;
  }

  function cardPack(p) {
    return `<div class="card card--pack" role="button" tabindex="0" data-action="openPack" data-pack="${escapeHtml(p.id)}">
      <div class="card__cover"><div class="card__fallback">♪</div></div>
      <div class="card__body">
        <div class="card__title">${escapeHtml(p.title || p.id)}</div>
        <div class="card__desc">${escapeHtml(p.desc || "")}</div>
      </div>
    </div>`;
  }

  function setActiveTab(route) {
    $$(".tabbar__item").forEach(b => b.classList.toggle("is-active", (b.dataset.route || "") === route));
  }

  /* Markdown (simple) */
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
      return x;
    };

    for (const raw of lines) {
      const line = raw.replace(/\r/g, "");
      if (!line.trim()) { flushUl(); out.push("<div style='height:10px'></div>"); continue; }
      if (line.startsWith("### ")) { flushUl(); out.push(`<h3>${inline(line.slice(4))}</h3>`); continue; }
      if (line.startsWith("## "))  { flushUl(); out.push(`<h2>${inline(line.slice(3))}</h2>`); continue; }
      if (line.startsWith("# "))   { flushUl(); out.push(`<h1>${inline(line.slice(2))}</h1>`); continue; }
      if (/^\s*-\s+/.test(line)) {
        if (!inUl) { out.push("<ul>"); inUl = true; }
        out.push(`<li>${inline(line.replace(/^\s*-\s+/, ""))}</li>`);
        continue;
      }
      flushUl();
      out.push(`<p>${inline(line)}</p>`);
    }
    flushUl();
    return out.join("\n");
  }

  /* Screens */
  async function renderHome() {
    const st = store.get();
    const idx = await loadPackIndex();
    const active = new Set(st.packs.activePackIds || ["base"]);
    const packs = (idx.packs || []).filter(p => active.has(p.id));

    view().innerHTML = `
      <div class="page">
        <div class="hero">
          <div class="hero__top">Olá, ${escapeHtml(st.user.name)} • XP ${escapeHtml(String(st.gamification.xp))}</div>
          <div class="hero__title">IMVpedia Voice</div>
          <div class="hero__sub">Treino vocal guiado com trilhas, missões e biblioteca.</div>
          <div class="hero__actions">
            ${btn("Trilha", "go", { route:"path" }, "btn btn--primary")}
            ${btn("Placement", "go", { route:"placement" }, "btn")}
          </div>
        </div>

        ${sectionTitle("Packs", btn("Gerenciar", "go", { route:"packs" }, "btn btn--ghost"))}
        <div class="grid">
          ${packs.length ? packs.map(cardPack).join("") : `<div class="empty">Nenhum pack ativo.</div>`}
        </div>
        ${bottomSpacer()}
      </div>
    `;
  }

  async function renderPath() {
    const { query } = getRouteAndQuery();
    const manifests = await getActiveManifests();

    if (query.packId && query.pathId) {
      const man = manifests.find(m => m.id === query.packId);
      const path = (man?.paths || []).find(p => p.id === query.pathId);
      const lessons = (path?.lessons || []);
      view().innerHTML = `
        <div class="page">
          ${sectionTitle(path?.title || "Trilha", btn("Voltar", "back", {}, "btn btn--ghost"))}
          <div class="card"><div class="card__desc">${escapeHtml(path?.desc || man?.title || "")}</div></div>
          <div class="list">
            ${lessons.length ? lessons.map(l => rowItem({
              icon:"🎵", title:l.title || l.id, sub:man?.title || query.packId,
              action:"openLesson", data:{ pack: query.packId, lesson: l.id }
            })).join("") : `<div class="empty">Sem lições neste path.</div>`}
          </div>
          ${bottomSpacer()}
        </div>
      `;
      return;
    }

    const all = [];
    for (const m of manifests) (m.paths || []).forEach(p => all.push({ packId:m.id, packTitle:m.title, ...p }));

    view().innerHTML = `
      <div class="page">
        ${sectionTitle("Trilha")}
        <div class="list">
          ${all.length ? all.map(p => rowItem({
            icon:"🧭", title:p.title || p.id,
            sub:`${p.packTitle || p.packId} • ${(p.lessons || []).length} lições`,
            action:"openPath", data:{ pack: p.packId, path: p.id }
          })).join("") : `<div class="empty">Nenhuma trilha encontrada.</div>`}
        </div>
        ${bottomSpacer()}
      </div>
    `;
  }

  async function renderMissions() {
    view().innerHTML = `
      <div class="page">
        ${sectionTitle("Missões")}
        <div class="card">
          <div class="card__title">Missão de demonstração</div>
          <div class="card__desc">Clique para ganhar XP e validar gamificação.</div>
          <div class="card__actions">
            ${btn("Ganhar +10 XP", "gainXp", { xp: 10 }, "btn btn--primary")}
          </div>
        </div>
        ${bottomSpacer()}
      </div>
    `;
  }

  async function renderLibrary() {
    const { query } = getRouteAndQuery();
    const manifests = await getActiveManifests();

    if (query.packId && query.articleId) {
      const man = manifests.find(m => m.id === query.packId);
      const art = (man?.library || []).find(a => a.id === query.articleId);
      const md = art?.md || "# Conteúdo em breve\n\nEste artigo será preenchido nos packs.";
      view().innerHTML = `
        <div class="page">
          ${sectionTitle(art?.title || "Artigo", btn("Voltar", "back", {}, "btn btn--ghost"))}
          <div class="card markdown">${mdToHtml(md)}</div>
          ${bottomSpacer()}
        </div>
      `;
      return;
    }

    const all = [];
    for (const m of manifests) (m.library || []).forEach(a => all.push({ packId:m.id, packTitle:m.title, ...a }));

    view().innerHTML = `
      <div class="page">
        ${sectionTitle("Biblioteca")}
        <div class="list">
          ${all.length ? all.map(a => rowItem({
            icon:"📚", title:a.title || a.id,
            sub:`${a.tag || "Geral"} • ${a.packTitle || a.packId}`,
            action:"openArticle", data:{ pack: a.packId, article: a.id }
          })).join("") : `<div class="empty">Nenhum artigo ainda. (Edite o manifest do pack base.)</div>`}
        </div>
        ${bottomSpacer()}
      </div>
    `;
  }

  async function renderProfile() {
    const st = store.get();
    view().innerHTML = `
      <div class="page">
        ${sectionTitle("Perfil")}
        <div class="card">
          <div class="card__title">${escapeHtml(st.user.avatar)} ${escapeHtml(st.user.name)}</div>
          <div class="card__desc">Objetivo: <b>${escapeHtml(st.user.goal)}</b><br/>XP: <b>${escapeHtml(String(st.gamification.xp))}</b></div>
          <div class="card__actions">
            ${btn("Editar nome", "editName", {}, "btn")}
            ${btn("Placement", "go", { route:"placement" }, "btn btn--primary")}
          </div>
        </div>
        ${bottomSpacer()}
      </div>
    `;
  }

  async function renderPacks() {
    const st = store.get();
    const idx = await loadPackIndex();
    const active = new Set(st.packs.activePackIds || ["base"]);

    view().innerHTML = `
      <div class="page">
        ${sectionTitle("Gerenciar packs", btn("Voltar", "back", {}, "btn btn--ghost"))}
        ${(idx.packs || []).map(p => `
          <div class="card">
            <div class="card__title">${escapeHtml(p.title || p.id)}</div>
            <div class="card__desc">${escapeHtml(p.desc || "")}</div>
            <div class="card__actions">
              ${btn("Abrir", "openPack", { pack: p.id }, "btn")}
              ${btn(active.has(p.id) ? "Desativar" : "Ativar", "togglePack", { pack: p.id }, active.has(p.id) ? "btn" : "btn btn--primary")}
            </div>
          </div>
        `).join("")}
        ${bottomSpacer()}
      </div>
    `;
  }

  async function renderPack(packId) {
    const man = await loadManifest(packId).catch(()=>null);
    if (!man) {
      view().innerHTML = `<div class="page">${sectionTitle("Pack", btn("Voltar","back",{}, "btn btn--ghost"))}<div class="empty">Pack não encontrado.</div>${bottomSpacer()}</div>`;
      return;
    }

    view().innerHTML = `
      <div class="page">
        ${sectionTitle(man.title || man.id, btn("Voltar","back",{}, "btn btn--ghost"))}
        <div class="card"><div class="card__desc">${escapeHtml(man.desc || "")}</div></div>

        ${sectionTitle("Trilhas")}
        <div class="list">
          ${(man.paths||[]).length ? (man.paths||[]).map(p => rowItem({
            icon:"🧭", title:p.title||p.id, sub:`${(p.lessons||[]).length} lições`,
            action:"openPath", data:{ pack: man.id, path: p.id }
          })).join("") : `<div class="empty">Sem trilhas neste pack.</div>`}
        </div>

        ${sectionTitle("Biblioteca")}
        <div class="list">
          ${(man.library||[]).length ? (man.library||[]).map(a => rowItem({
            icon:"📚", title:a.title||a.id, sub:`${a.tag || "Geral"}`,
            action:"openArticle", data:{ pack: man.id, article: a.id }
          })).join("") : `<div class="empty">Sem artigos neste pack.</div>`}
        </div>

        ${bottomSpacer()}
      </div>
    `;
  }

  async function renderLesson(packId, lessonId) {
    const man = await loadManifest(packId).catch(()=>null);
    const lesson = (man?.paths || []).flatMap(p => p.lessons || []).find(l => l.id === lessonId);
    const title = lesson?.title || "Lição";
    const md = lesson?.md || "# Conteúdo em breve\n\nEsta lição será preenchida no pack.";
    view().innerHTML = `
      <div class="page">
        ${sectionTitle(title, btn("Voltar","back",{}, "btn btn--ghost"))}
        <div class="card markdown">${mdToHtml(md)}</div>
        <div class="card"><div class="card__actions">
          ${btn("Marcar concluída (+15 XP)", "completeLesson", { pack: packId, lesson: lessonId }, "btn btn--primary")}
        </div></div>
        ${bottomSpacer()}
      </div>
    `;
  }

  const PLACEMENT_QUESTIONS = [
    { id:"experience", title:"Experiência vocal", q:"Há quanto tempo você canta com regularidade?", options:[["Nunca",0],["< 1 ano",1],["1–3 anos",2],["> 3 anos",3]] },
    { id:"technique", title:"Consciência técnica", q:"Você já estudou técnica vocal formalmente?", options:[["Nunca",0],["Pouco",1],["Com professor",2],["Estudo contínuo",3]] },
    { id:"health", title:"Saúde vocal", q:"Com que frequência sente rouquidão/cansaço?", options:[["Quase sempre",0],["Às vezes",1],["Raramente",2],["Quase nunca",3]] }
  ];
  const calcPlacement = (score) => score <= 3 ? "Iniciante" : (score <= 6 ? "Intermediário" : "Avançado");

  async function renderPlacement() {
    const st = store.get();
    const answers = st.placement.answers || {};

    const blocks = PLACEMENT_QUESTIONS.map(q => {
      const opts = q.options.map(([label,val]) => {
        const active = answers[q.id] === val ? "btn--primary" : "";
        return `<button class="btn ${active}" type="button" data-action="placeAnswer" data-q="${escapeHtml(q.id)}" data-v="${escapeHtml(String(val))}">${escapeHtml(label)}</button>`;
      }).join("");
      return `<div class="card">
        <div class="card__title">${escapeHtml(q.title)}</div>
        <div class="card__desc">${escapeHtml(q.q)}</div>
        <div class="card__actions">${opts}</div>
      </div>`;
    }).join("");

    view().innerHTML = `
      <div class="page">
        ${sectionTitle("Placement", btn("Voltar","back",{}, "btn btn--ghost"))}
        <div class="card"><div class="card__desc">Responda para ajustar sua trilha inicial. (Sem áudio)</div></div>
        ${blocks}
        <div class="card">
          <div class="card__actions">
            ${btn("Calcular e salvar", "placeFinish", {}, "btn btn--primary")}
          </div>
        </div>
        ${bottomSpacer()}
      </div>
    `;
  }

  async function renderAdmin() {
    const enabled = localStorage.getItem(LS.ADMIN) === "1";
    view().innerHTML = `
      <div class="page">
        ${sectionTitle("Admin", btn("Voltar","back",{}, "btn btn--ghost"))}
        <div class="card">
          <div class="card__title">Modo Admin</div>
          <div class="card__desc">${enabled ? "Ativo" : "Bloqueado"} • senha padrão: <b>imvadmin</b></div>
          <div class="card__actions">
            ${btn(enabled ? "Desativar" : "Ativar", "toggleAdmin", {}, enabled ? "btn" : "btn btn--primary")}
            ${btn("Exportar packs custom", "exportCustom", {}, "btn")}
          </div>
        </div>
        <div class="card">
          <div class="card__title">Criar pack custom</div>
          <div class="card__desc">Cria um pack vazio no LocalStorage (editável no código depois).</div>
          <div class="card__actions">${btn("Criar", "createCustomPack", {}, "btn btn--primary")}</div>
        </div>
        ${bottomSpacer()}
      </div>
    `;
  }

  async function render() {
    const { route, query } = getRouteAndQuery();
    setActiveTab(route);

    try {
      if (route === "home") return await renderHome();
      if (route === "path") return await renderPath();
      if (route === "missions") return await renderMissions();
      if (route === "library") return await renderLibrary();
      if (route === "profile") return await renderProfile();
      if (route === "packs") return await renderPacks();
      if (route === "pack") return await renderPack(query.id || "base");
      if (route === "lesson") return await renderLesson(query.packId || "base", query.lessonId || "");
      if (route === "placement") return await renderPlacement();
      if (route === "admin") return await renderAdmin();

      // fallback
      view().innerHTML = `<div class="page">${sectionTitle("404")}<div class="empty">Rota não encontrada: ${escapeHtml(route)}</div>${bottomSpacer()}</div>`;
    } catch (e) {
      console.error(e);
      view().innerHTML = `<div class="page">${sectionTitle("Erro")}<div class="card"><div class="card__desc">Falha ao renderizar: ${escapeHtml(String(e?.message || e))}</div></div>${bottomSpacer()}</div>`;
    }
  }

  /* Events */
  document.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-route]");
    if (tab) {
      setHash(tab.dataset.route || "home");
      return;
    }

    const act = e.target.closest("[data-action]");
    if (!act) return;

    const action = act.dataset.action;
    const d = act.dataset;

    if (action === "go") return setHash(d.route || "home");
    if (action === "back") {
      history.length > 1 ? history.back() : setHash("home");
      return;
    }

    if (action === "openPack") return setHash("pack", { id: d.pack || d.packId || "base" });
    if (action === "togglePack") {
      store.set(s => {
        const id = d.pack || "base";
        const arr = new Set(s.packs.activePackIds || ["base"]);
        if (arr.has(id)) arr.delete(id); else arr.add(id);
        if (!arr.size) arr.add("base");
        s.packs.activePackIds = Array.from(arr);
      });
      toast("Packs atualizados");
      cache.index = null; // refresh
      render();
      return;
    }

    if (action === "openPath") return setHash("path", { packId: d.pack, pathId: d.path });
    if (action === "openLesson") return setHash("lesson", { packId: d.pack, lessonId: d.lesson });
    if (action === "openArticle") return setHash("library", { packId: d.pack, articleId: d.article });

    if (action === "gainXp") {
      const xp = Math.max(0, parseInt(d.xp || "0", 10) || 0);
      store.set(s => { s.gamification.xp += xp; });
      toast(`+${xp} XP`);
      render();
      return;
    }

    if (action === "completeLesson") {
      store.set(s => {
        const key = `${d.pack}:${d.lesson}`;
        s.progress.completedLessons[key] = { at: new Date().toISOString() };
        s.gamification.xp += 15;
      });
      toast("Lição concluída +15 XP");
      render();
      return;
    }

    if (action === "editName") {
      const st = store.get();
      const name = prompt("Seu nome:", st.user.name || "Aluno");
      if (name && name.trim()) {
        store.set(s => { s.user.name = name.trim(); });
        toast("Nome atualizado");
        render();
      }
      return;
    }

    if (action === "placeAnswer") {
      const q = d.q;
      const v = parseInt(d.v || "0", 10) || 0;
      store.set(s => { s.placement.answers[q] = v; });
      render();
      return;
    }

    if (action === "placeFinish") {
      const st = store.get();
      const answers = st.placement.answers || {};
      const score = Object.values(answers).reduce((a,v)=> a + (Number(v)||0), 0);
      const result = calcPlacement(score);
      store.set(s => { s.placement.score = score; s.placement.result = result; s.user.levelReal = result; });
      toast(`Placement: ${result}`);
      setHash("profile");
      return;
    }

    if (action === "toggleAdmin") {
      const enabled = localStorage.getItem(LS.ADMIN) === "1";
      if (enabled) {
        localStorage.setItem(LS.ADMIN, "0");
        toast("Admin desativado");
        render();
        return;
      }
      const pwd = prompt("Senha Admin:");
      if ((pwd || "").trim() === "imvadmin") {
        localStorage.setItem(LS.ADMIN, "1");
        toast("Admin ativado");
        render();
      } else {
        toast("Senha incorreta");
      }
      return;
    }

    if (action === "exportCustom") {
      const custom = getCustomPacks();
      const blob = new Blob([JSON.stringify(custom, null, 2)], { type:"application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "imv_custom_packs.json";
      a.click();
      setTimeout(()=> URL.revokeObjectURL(a.href), 2000);
      toast("Exportado");
      return;
    }

    if (action === "createCustomPack") {
      const enabled = localStorage.getItem(LS.ADMIN) === "1";
      if (!enabled) { toast("Ative o Admin"); return; }
      const title = prompt("Título do pack:", "Meu Pack");
      if (!title) return;
      const raw = localStorage.getItem(LS.CUSTOM_PACKS);
      const arr = safeJsonParse(raw, []);
      const pack = normalizeManifest({
        id: "custom_" + uid(),
        title: title.trim(),
        desc: "Pack criado no Admin",
        paths: [],
        library: [],
        missions: { templates: [] }
      });
      arr.push(pack);
      localStorage.setItem(LS.CUSTOM_PACKS, JSON.stringify(arr));
      cache.index = null;
      toast("Pack custom criado");
      render();
      return;
    }
  });

  // Admin button
  $("#adminBtn")?.addEventListener("click", () => setHash("admin"));

  // Init
  window.addEventListener("hashchange", render);
  if (!location.hash || !location.hash.startsWith("#/")) setHash("home");
  render();
})();