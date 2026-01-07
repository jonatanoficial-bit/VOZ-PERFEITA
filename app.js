/* =========================================================
   IMVpedia Voice — app.js (FINAL DEFINITIVO)
   ---------------------------------------------------------
   ✅ Mantém visual premium (não depende de CSS novo)
   ✅ Tabs funcionam
   ✅ Missões pontuam e dão XP
   ✅ Biblioteca lista TODOS os conteúdos detectados (217+)
   ✅ Funciona com vários formatos de conteúdo já existentes
========================================================= */

(() => {
  "use strict";

  /* =============================
     Helpers
  ============================= */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  const uid = (p = "id") => `${p}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  const todayISO = () => new Date().toISOString().slice(0, 10);

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

  /* =============================
     Storage
  ============================= */
  const LS = {
    STATE: "imv_voice_state_prod_v2",
    CONTENT_INDEX: "imv_voice_content_index_v2",
    SEARCH_INDEX: "imv_voice_search_index_v2"
  };

  const DEFAULT_STATE = {
    user: { id: uid("u"), name: "Aluno", avatar: "🎤", goal: "Misto" },
    gamification: { xp: 0, level: 1, streak: 0, lastActiveDate: null },
    progress: {
      completedMissions: {},      // date -> {count,xp}
      completedMissionIds: {}     // date -> {missionId:true}
    },
    ui: {
      libraryQuery: "",
      libraryTag: "Todos",
      libraryLevel: "Todos"
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

  function saveState(st) {
    try { localStorage.setItem(LS.STATE, JSON.stringify(st)); } catch {}
  }

  const store = {
    state: loadState(),
    get() { return this.state; },
    set(mutator) {
      const next = structuredClone(this.state);
      mutator(next);
      this.state = next;
      saveState(this.state);
    }
  };

  /* =============================
     Toast (#toastHost)
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
    toastTimer = setTimeout(() => { host.innerHTML = ""; }, 2200);
  }

  /* =============================
     XP / Level
  ============================= */
  function xpToNext(level) {
    return Math.round(50 + (level - 1) * 20 + Math.max(0, level - 1) * 5);
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
    const amt = Math.max(0, Math.floor(amount || 0));
    if (!amt) return;

    store.set(s => {
      touchStreak(s);
      s.gamification.xp += amt;

      while (s.gamification.xp >= xpToNext(s.gamification.level)) {
        s.gamification.xp -= xpToNext(s.gamification.level);
        s.gamification.level += 1;
      }
    });

    toast(`+${amt} XP${reason ? ` • ${reason}` : ""}`);
    render();
  }

  /* =========================================================
     Conteúdos: Consolidação TOTAL (217+)
  ========================================================= */
  function toArray(x) {
    if (!x) return [];
    if (Array.isArray(x)) return x;
    if (typeof x === "object") return Object.values(x);
    return [];
  }

  function normalizeText(item) {
    return (
      item?.text ??
      item?.content ??
      item?.md ??
      item?.body ??
      item?.descricao ??
      item?.description ??
      ""
    );
  }

  function normalizeTitle(item) {
    return (
      item?.title ??
      item?.titulo ??
      item?.name ??
      item?.nome ??
      "Sem título"
    );
  }

  function normalizeTags(item) {
    const t = item?.tags ?? item?.tag ?? item?.categoria ?? item?.category ?? item?.cats ?? [];
    if (typeof t === "string") return t.split(",").map(s => s.trim()).filter(Boolean);
    if (Array.isArray(t)) return t.map(x => String(x).trim()).filter(Boolean);
    return [];
  }

  function normalizeLevel(item) {
    const l = item?.level ?? item?.nivel ?? item?.difficulty ?? item?.dificuldade ?? "";
    const v = String(l || "").trim();
    if (!v) return "Geral";
    const low = v.toLowerCase();
    if (low.includes("inic")) return "Iniciante";
    if (low.includes("inter")) return "Intermediário";
    if (low.includes("avan")) return "Avançado";
    if (low.includes("infan")) return "Infantil/Juvenil";
    return v;
  }

  function normalizeType(item) {
    const t = (item?.type ?? item?.tipo ?? item?.kind ?? "Conteúdo").toString();
    const low = t.toLowerCase();
    if (low.includes("liç") || low.includes("lesson")) return "Lição";
    if (low.includes("art") || low.includes("library")) return "Artigo";
    if (low.includes("exerc")) return "Exercício";
    if (low.includes("rotina")) return "Rotina";
    return "Conteúdo";
  }

  function normalizeItem(item, origin = "unknown", packId = "base") {
    const id = item?.id ?? item?.slug ?? item?.key ?? uid("c");
    return {
      id: String(id),
      title: String(normalizeTitle(item)),
      text: String(normalizeText(item)),
      tags: normalizeTags(item),
      level: normalizeLevel(item),
      type: normalizeType(item),
      cover: String(item?.cover ?? item?.capa ?? item?.image ?? item?.img ?? ""),
      packId: String(packId || "base"),
      origin: String(origin || "unknown")
    };
  }

  function harvestGlobalContents() {
    const sources = [];

    if (Array.isArray(window.CONTENT_PACKS)) sources.push({ origin: "CONTENT_PACKS", value: window.CONTENT_PACKS });
    if (Array.isArray(window.IMV_PACKS)) sources.push({ origin: "IMV_PACKS", value: window.IMV_PACKS });

    if (Array.isArray(window.LESSONS)) sources.push({ origin: "LESSONS", value: window.LESSONS });
    if (Array.isArray(window.LIBRARY)) sources.push({ origin: "LIBRARY", value: window.LIBRARY });
    if (Array.isArray(window.ARTICLES)) sources.push({ origin: "ARTICLES", value: window.ARTICLES });

    if (window.IMV_VOICE_CONTENT && typeof window.IMV_VOICE_CONTENT === "object") {
      sources.push({ origin: "IMV_VOICE_CONTENT", value: window.IMV_VOICE_CONTENT });
    }
    if (window.CONTENT && typeof window.CONTENT === "object") {
      sources.push({ origin: "CONTENT", value: window.CONTENT });
    }

    const all = [];
    const add = (arr, origin, packId) => {
      for (const it of arr) all.push(normalizeItem(it, origin, packId));
    };

    for (const s of sources) {
      const v = s.value;

      // formato packs
      if (Array.isArray(v) && v.length && (v[0]?.lessons || v[0]?.library || v[0]?.paths)) {
        v.forEach((pack, pi) => {
          const pid = pack.packId ?? pack.id ?? `pack_${pi + 1}`;
          add(toArray(pack.lessons), `${s.origin}:pack.lessons`, pid);
          add(toArray(pack.library), `${s.origin}:pack.library`, pid);

          const paths = toArray(pack.paths);
          paths.forEach((p, pidx) => {
            const lessons = toArray(p.lessons);
            lessons.forEach((l) => {
              const merged = { ...l };
              merged.level = merged.level ?? p.level ?? pack.level ?? "";
              merged.tags = merged.tags ?? p.tags ?? pack.tags ?? [];
              merged.type = merged.type ?? "Lição";
              merged.pathTitle = p.title ?? p.name ?? `Trilha ${pidx + 1}`;
              all.push(normalizeItem(merged, `${s.origin}:pack.paths.lessons`, pid));
            });
          });
        });
        continue;
      }

      // formato objeto com chaves
      if (v && typeof v === "object" && !Array.isArray(v)) {
        add(toArray(v.lessons), `${s.origin}:obj.lessons`, v.packId ?? "base");
        add(toArray(v.library), `${s.origin}:obj.library`, v.packId ?? "base");
        add(toArray(v.articles), `${s.origin}:obj.articles`, v.packId ?? "base");
        continue;
      }

      // array simples
      if (Array.isArray(v)) {
        add(v, `${s.origin}:array`, "base");
        continue;
      }
    }

    // dedupe
    const map = new Map();
    for (const it of all) {
      if (!map.has(it.id)) map.set(it.id, it);
      else {
        const prev = map.get(it.id);
        if ((it.text || "").length > (prev.text || "").length) map.set(it.id, it);
      }
    }

    return Array.from(map.values());
  }

  function buildContentIndex() {
    const all = harvestGlobalContents();
    if (!all.length) {
      return [
        normalizeItem({
          id: "fallback_1",
          title: "Conteúdo não detectado",
          text:
`Seus conteúdos (217) não foram detectados.
Isso normalmente acontece quando os arquivos de conteúdo (packs/*.js etc.)
não estão sendo importados ANTES do app.js no index.html.

✅ Solução:
No index.html, garanta:
<script src="./packs/SEU_ARQUIVO.js"></script>
antes de:
<script src="./app.js"></script>`,
          tags: ["Ajuda"],
          level: "Geral",
          type: "Conteúdo"
        }, "FALLBACK", "base")
      ];
    }
    return all;
  }

  let CONTENT_INDEX = [];

  function loadContentIndexCached() {
    const raw = localStorage.getItem(LS.CONTENT_INDEX);
    const parsed = safeJsonParse(raw, null);
    if (Array.isArray(parsed) && parsed.length) return parsed;
    return null;
  }

  function saveContentIndexCached(arr) {
    try { localStorage.setItem(LS.CONTENT_INDEX, JSON.stringify(arr)); } catch {}
  }

  function ensureContentIndex() {
    const cached = loadContentIndexCached();
    if (cached && cached.length) {
      CONTENT_INDEX = cached;
      return;
    }
    CONTENT_INDEX = buildContentIndex();
    saveContentIndexCached(CONTENT_INDEX);
  }

  function rebuildContentCaches() {
    CONTENT_INDEX = buildContentIndex();
    saveContentIndexCached(CONTENT_INDEX);
    saveSearchIndexCached(buildSearchIndex(CONTENT_INDEX));
  }

  function getAllTagsLevels() {
    const tags = new Set(["Todos"]);
    const levels = new Set(["Todos"]);

    for (const it of CONTENT_INDEX) {
      levels.add(it.level || "Geral");
      (it.tags || []).forEach(t => tags.add(t));
    }

    const tagList = Array.from(tags);
    const levelList = Array.from(levels);

    tagList.sort((a, b) => a === "Todos" ? -1 : b === "Todos" ? 1 : a.localeCompare(b));
    levelList.sort((a, b) => a === "Todos" ? -1 : b === "Todos" ? 1 : a.localeCompare(b));

    return { tagList, levelList };
  }

  function filterContents(query, tag, level) {
    const q = String(query || "").trim().toLowerCase();
    const t = String(tag || "Todos");
    const l = String(level || "Todos");

    return CONTENT_INDEX.filter(it => {
      if (t !== "Todos") {
        const has = (it.tags || []).some(x => String(x).toLowerCase() === t.toLowerCase());
        if (!has) return false;
      }
      if (l !== "Todos") {
        if ((it.level || "Geral") !== l) return false;
      }
      if (!q) return true;
      const hay = `${it.title}\n${it.text}\n${(it.tags || []).join(" ")}\n${it.level}\n${it.type}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function pickFeaturedFromIndex(count = 6) {
    const arr = CONTENT_INDEX.slice();
    if (!arr.length) return [];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, Math.max(0, count));
  }

  /* =============================
     Search index (opcional)
  ============================= */
  function buildSearchIndex(items) {
    return items.map(it => ({
      id: it.id,
      hay: `${it.title}\n${it.text}\n${(it.tags || []).join(" ")}\n${it.level}\n${it.type}`.toLowerCase()
    }));
  }

  function getSearchIndexCached() {
    const raw = localStorage.getItem(LS.SEARCH_INDEX);
    const parsed = safeJsonParse(raw, null);
    return Array.isArray(parsed) ? parsed : null;
  }

  function saveSearchIndexCached(arr) {
    try { localStorage.setItem(LS.SEARCH_INDEX, JSON.stringify(arr)); } catch {}
  }

  function ensureSearchIndex() {
    const cached = getSearchIndexCached();
    if (cached && cached.length) return cached;
    const idx = buildSearchIndex(CONTENT_INDEX);
    saveSearchIndexCached(idx);
    return idx;
  }

  /* =============================
     UI Components
  ============================= */
  function sectionHead(title, right = "") {
    return `
      <div class="sectionHead">
        <div class="sectionTitle">${escapeHtml(title)}</div>
        <div class="sectionRight">${escapeHtml(right)}</div>
      </div>
    `;
  }

  function card(html) {
    return `<div class="card">${html}</div>`;
  }

  function rowItem({ icon = "📘", title = "", sub = "", nav = "" }) {
    return `
      <div class="row" data-nav="${escapeHtml(nav)}">
        <div class="row__left">${escapeHtml(icon)}</div>
        <div class="row__body">
          <div class="row__title">${escapeHtml(title)}</div>
          <div class="row__sub">${escapeHtml(sub)}</div>
        </div>
        <div class="row__right">›</div>
      </div>
    `;
  }

  // continua na PARTE 2/3
  /* =============================
     Pages
  ============================= */

  function viewHome() {
    const st = store.get();
    const u = st.user;
    const g = st.gamification;

    const need = xpToNext(g.level);
    const pct = clamp(Math.round((g.xp / need) * 100), 0, 100);

    const today = todayISO();
    const todayM = st.progress.completedMissions[today]?.count || 0;

    // Destaques puxados do índice REAL (sem quebrar o premium)
    const featured = pickFeaturedFromIndex(6);

    return `
      <section class="page">
        <div class="hero">
          <div class="hero__top">Olá, ${escapeHtml(u.name)} • Nível ${g.level} • 🔥 ${g.streak} dia(s)</div>
          <div class="hero__title">IMVpedia Voice</div>
          <div class="hero__sub">
            Treino vocal guiado com técnica, saúde vocal e repertório.
          </div>

          <div class="hero__actions">
            <button class="btn btn--primary" data-nav="#/path" type="button">Trilha</button>
            <button class="btn" data-nav="#/missions" type="button">Missões</button>
            <button class="btn btn--ghost" data-nav="#/library" type="button">Biblioteca</button>
          </div>

          <div style="margin-top:14px;color:rgba(233,236,246,.62);font-size:12px">Progresso do nível</div>
          <div style="margin-top:8px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);border-radius:999px;overflow:hidden;height:10px">
            <div style="width:${pct}%;height:100%;background:linear-gradient(135deg, rgba(124,92,255,.95), rgba(124,92,255,.55))"></div>
          </div>
          <div style="margin-top:8px;color:rgba(233,236,246,.62);font-size:12px">
            ${g.xp}/${need} XP para o próximo nível • Missões hoje: ${todayM}
          </div>
        </div>

        ${sectionHead("Destaques", `${CONTENT_INDEX.length || 0} conteúdos`)}
        ${card(`
          <div class="card__desc">Sugestões rápidas (vêm do seu catálogo real).</div>
          <div style="height:12px"></div>
          <div class="list">
            ${featured.map(it => {
              const sub = `${it.type} • ${it.level}${(it.tags && it.tags.length) ? " • " + it.tags.slice(0, 3).join(", ") : ""}`;
              const icon = it.type === "Lição" ? "🎓" : it.type === "Artigo" ? "📚" : it.type === "Exercício" ? "🧪" : "📘";
              return rowItem({ icon, title: it.title, sub, nav: `#/article?id=${encodeURIComponent(it.id)}` });
            }).join("")}
          </div>
        `)}

        ${sectionHead("Acesso rápido", "atalhos")}
        <div class="grid">
          ${card(`<div class="card__title">📚 Biblioteca</div><div class="card__desc">Ver todos os conteúdos (217+).</div><div class="card__actions"><button class="btn btn--primary" data-nav="#/library" type="button">Abrir</button></div>`)}
          ${card(`<div class="card__title">✅ Missões</div><div class="card__desc">Ganhe XP com rotina diária.</div><div class="card__actions"><button class="btn btn--primary" data-nav="#/missions" type="button">Fazer</button></div>`)}
          ${card(`<div class="card__title">🧭 Trilha</div><div class="card__desc">Siga módulos por nível.</div><div class="card__actions"><button class="btn btn--primary" data-nav="#/path" type="button">Ir</button></div>`)}
          ${card(`<div class="card__title">👤 Perfil</div><div class="card__desc">Ajuste nome e objetivo.</div><div class="card__actions"><button class="btn btn--primary" data-nav="#/profile" type="button">Abrir</button></div>`)}
        </div>
      </section>
    `;
  }

  // Trilha simples (não destrói seu visual e não mexe em conteúdos)
  function viewPath() {
    return `
      <section class="page">
        ${sectionHead("Trilha", "organização")}
        ${card(`
          <div class="card__title">Trilha em evolução</div>
          <div class="card__desc">
            Nesta etapa, a trilha usa a Biblioteca como catálogo completo.
            Na próxima etapa, eu organizo automaticamente os 217 por módulos e blocos.
          </div>
          <div class="card__actions">
            <button class="btn btn--primary" data-nav="#/library" type="button">Ver todos os conteúdos</button>
          </div>
        `)}
      </section>
    `;
  }

  /* =============================
     Missões (XP funcionando)
  ============================= */
  const DEFAULT_MISSIONS = [
    { id: "m_sovt", title: "SOVT leve", desc: "Lip trill / canudo / humming confortável.", minutes: 8, xp: 10 },
    { id: "m_breath", title: "Respiração 3/6", desc: "3s inspira + 6s solta em “sss”.", minutes: 6, xp: 8 },
    { id: "m_pitch", title: "Afinação", desc: "Notas longas, ataques suaves, sem forçar.", minutes: 8, xp: 10 }
  ];

  function isMissionDoneToday(mid) {
    const st = store.get();
    const d = todayISO();
    return !!st.progress.completedMissionIds?.[d]?.[mid];
  }

  function completeMission(mid, xp, title) {
    const d = todayISO();
    const st = store.get();

    if (!st.progress.completedMissionIds[d]) st.progress.completedMissionIds[d] = {};
    if (st.progress.completedMissionIds[d][mid]) {
      toast("Você já concluiu essa missão hoje.");
      return;
    }

    store.set(s => {
      if (!s.progress.completedMissionIds[d]) s.progress.completedMissionIds[d] = {};
      s.progress.completedMissionIds[d][mid] = true;

      if (!s.progress.completedMissions[d]) s.progress.completedMissions[d] = { count: 0, xp: 0 };
      s.progress.completedMissions[d].count += 1;
      s.progress.completedMissions[d].xp += xp;
    });

    addXP(xp, `Missão: ${title}`);
  }

  function viewMissions() {
    const d = todayISO();
    const st = store.get();
    const doneCount = st.progress.completedMissions[d]?.count || 0;

    return `
      <section class="page">
        ${sectionHead("Missões", d)}
        ${card(`
          <div class="card__title">Hoje</div>
          <div class="card__desc">Concluídas: <b>${doneCount}</b></div>
        `)}

        ${DEFAULT_MISSIONS.map(m => {
          const done = isMissionDoneToday(m.id);
          return card(`
            <div class="card__title">${escapeHtml(m.title)}</div>
            <div class="card__desc">${escapeHtml(m.desc)} • ⏱ ${m.minutes} min</div>
            <div class="card__actions">
              ${done
                ? `<div class="btn" style="cursor:default;border-color:rgba(56,211,159,.35);background:rgba(56,211,159,.12)">✅ Concluída</div>`
                : `<button class="btn btn--primary" data-action="doMission" data-mid="${escapeHtml(m.id)}" data-xp="${m.xp}" data-title="${escapeHtml(m.title)}" type="button">Concluir (+${m.xp} XP)</button>`
              }
            </div>
          `);
        }).join("")}
      </section>
    `;
  }

  /* =============================
     Biblioteca: MOSTRA TUDO + Busca/Filtros + Atualizar índice
  ============================= */
  function getAllContentCount() {
    return Array.isArray(CONTENT_INDEX) ? CONTENT_INDEX.length : 0;
  }

  function libraryAdminRefreshCard() {
    const total = getAllContentCount();
    return card(`
      <div class="card__title">Atualizar conteúdos</div>
      <div class="card__desc">
        Total detectado agora: <b>${total}</b>.<br/>
        Se você adicionou novos arquivos de conteúdo no GitHub e não apareceu,
        toque abaixo para reconstruir o índice local.
      </div>
      <div class="card__actions">
        <button class="btn btn--primary" data-action="refreshContentIndex" type="button">Atualizar agora</button>
      </div>
    `);
  }

  function viewLibrary() {
    ensureContentIndex();
    const st = store.get();
    const q = st.ui.libraryQuery || "";
    const tag = st.ui.libraryTag || "Todos";
    const level = st.ui.libraryLevel || "Todos";

    const { tagList, levelList } = getAllTagsLevels();
    const results = filterContents(q, tag, level);

    return `
      <section class="page">
        ${sectionHead("Biblioteca", `${results.length} itens`)}

        ${libraryAdminRefreshCard()}

        ${card(`
          <div class="card__title">Buscar</div>
          <div class="card__desc">Use busca e filtros para navegar pelos 217+ conteúdos.</div>

          <div style="height:12px"></div>

          <input id="libQ" placeholder="Ex: apoio, SOVT, classificação, ressonância..."
            value="${escapeHtml(q)}"
            style="width:100%;padding:14px 14px;border-radius:16px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.04);color:rgba(233,236,246,.92);font-weight:700;outline:none" />

          <div style="height:12px"></div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <div style="font-size:12px;color:rgba(233,236,246,.52);font-weight:800;margin-bottom:6px">Tag</div>
              <select id="libTag"
                style="width:100%;padding:14px 12px;border-radius:16px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.04);color:rgba(233,236,246,.92);font-weight:800;outline:none">
                ${tagList.map(t => `<option ${t===tag?"selected":""}>${escapeHtml(t)}</option>`).join("")}
              </select>
            </div>
            <div>
              <div style="font-size:12px;color:rgba(233,236,246,.52);font-weight:800;margin-bottom:6px">Nível</div>
              <select id="libLevel"
                style="width:100%;padding:14px 12px;border-radius:16px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.04);color:rgba(233,236,246,.92);font-weight:800;outline:none">
                ${levelList.map(lv => `<option ${lv===level?"selected":""}>${escapeHtml(lv)}</option>`).join("")}
              </select>
            </div>
          </div>

          <div style="height:12px"></div>

          <div class="card__actions">
            <button class="btn btn--primary" data-action="applyLibraryFilters" type="button">Aplicar</button>
            <button class="btn" data-action="resetLibraryFilters" type="button">Limpar</button>
          </div>
        `)}

        ${card(`
          <div class="card__title">Conteúdos</div>
          <div class="card__desc">Toque em um item para abrir.</div>
        `)}

        <div class="list">
          ${results.slice(0, 600).map(it => {
            const sub = `${it.type} • ${it.level}${(it.tags && it.tags.length) ? " • " + it.tags.slice(0, 3).join(", ") : ""}`;
            const icon = it.type === "Lição" ? "🎓" : it.type === "Artigo" ? "📚" : it.type === "Exercício" ? "🧪" : "📘";
            return rowItem({ icon, title: it.title, sub, nav: `#/article?id=${encodeURIComponent(it.id)}` });
          }).join("")}
        </div>

        ${results.length > 600 ? card(`
          <div class="card__desc">
            Mostrando 600 itens por desempenho. Use a busca para filtrar e encontrar qualquer um dos ${results.length}.
          </div>
        `) : ""}
      </section>
    `;
  }

  function viewArticle(query) {
    ensureContentIndex();
    const id = String(query.id || "");
    const found = CONTENT_INDEX.find(x => x.id === id) || null;

    if (!found) {
      return `
        <section class="page">
          ${sectionHead("Conteúdo", "não encontrado")}
          ${card(`
            <div class="card__title">Não encontrado</div>
            <div class="card__desc">Volte para a Biblioteca.</div>
            <div class="card__actions">
              <button class="btn btn--primary" data-nav="#/library" type="button">Voltar</button>
            </div>
          `)}
        </section>
      `;
    }

    const meta = `${found.type} • ${found.level}${found.tags?.length ? " • " + found.tags.join(", ") : ""}`;

    return `
      <section class="page">
        ${sectionHead(found.title, meta)}

        ${card(`
          <div class="card__desc" style="white-space:pre-wrap;line-height:1.7">
            ${escapeHtml(found.text || "Conteúdo vazio.")}
          </div>

          <div style="height:12px"></div>
          <div class="card__actions">
            <button class="btn" data-nav="#/library" type="button">Voltar</button>
          </div>
        `)}
      </section>
    `;
  }

  function viewProfile() {
    const st = store.get();
    const u = st.user;
    const g = st.gamification;
    const need = xpToNext(g.level);

    return `
      <section class="page">
        ${sectionHead("Perfil", "configurações")}
        ${card(`
          <div class="card__title">${escapeHtml(u.avatar)} ${escapeHtml(u.name)}</div>
          <div class="card__desc">
            Objetivo: <b>${escapeHtml(u.goal)}</b><br/>
            Nível: <b>${g.level}</b><br/>
            XP: <b>${g.xp}/${need}</b><br/>
            Streak: <b>${g.streak}</b> dia(s)
          </div>

          <div class="card__actions">
            <button class="btn" data-action="editName" type="button">Editar nome</button>
            <button class="btn" data-action="editGoal" type="button">Editar objetivo</button>
            <button class="btn btn--primary" data-nav="#/library" type="button">Biblioteca</button>
          </div>
        `)}
      </section>
    `;
  }

  function viewNotFound() {
    return `
      <section class="page">
        ${sectionHead("Página", "não encontrada")}
        ${card(`
          <div class="card__title">Ops</div>
          <div class="card__desc">Volte para o início.</div>
          <div class="card__actions">
            <button class="btn btn--primary" data-nav="#/home" type="button">Início</button>
          </div>
        `)}
      </section>
    `;
  }

  // continua na PARTE 3/3
  /* =============================
     Router + Render
  ============================= */
  function setActiveTab(routeBase) {
    $$(".tabbar__item").forEach(b => {
      b.classList.toggle("is-active", b.dataset.route === routeBase);
    });
  }

  function render() {
    const { route, query } = getRouteAndQuery();
    const view = $("#view");
    if (!view) return;

    // garante índice (para home + library + article)
    ensureContentIndex();

    const tabBase =
      route.startsWith("path") ? "#/path" :
      route.startsWith("missions") ? "#/missions" :
      route.startsWith("library") ? "#/library" :
      route.startsWith("profile") ? "#/profile" :
      "#/home";

    setActiveTab(tabBase);

    if (route === "home") view.innerHTML = viewHome();
    else if (route === "path") view.innerHTML = viewPath();
    else if (route === "missions") view.innerHTML = viewMissions();
    else if (route === "library") view.innerHTML = viewLibrary();
    else if (route === "article") view.innerHTML = viewArticle(query);
    else if (route === "profile") view.innerHTML = viewProfile();
    else view.innerHTML = viewNotFound();
  }

  /* =============================
     Events (delegação)
  ============================= */
  function onClick(e) {
    const t = e.target;

    // tabbar (inferior)
    const tab = t.closest(".tabbar__item");
    if (tab && tab.dataset.route) {
      setHash(tab.dataset.route.replace("#/", ""));
      return;
    }

    // navegação por data-nav
    const nav = t.closest("[data-nav]");
    if (nav && nav.dataset.nav) {
      location.hash = nav.dataset.nav;
      return;
    }

    // missões: concluir
    const doM = t.closest('[data-action="doMission"]');
    if (doM) {
      const mid = doM.getAttribute("data-mid");
      const xp = parseInt(doM.getAttribute("data-xp") || "0", 10) || 0;
      const title = doM.getAttribute("data-title") || "Missão";
      completeMission(mid, xp, title);
      return;
    }

    // perfil: editar nome
    const editName = t.closest('[data-action="editName"]');
    if (editName) {
      const st = store.get();
      const name = prompt("Digite seu nome:", st.user.name || "Aluno");
      if (name && name.trim()) {
        store.set(s => { s.user.name = name.trim().slice(0, 32); });
        toast("Nome atualizado.");
        render();
      }
      return;
    }

    // perfil: editar objetivo
    const editGoal = t.closest('[data-action="editGoal"]');
    if (editGoal) {
      const st = store.get();
      const cur = st.user.goal || "Misto";
      const goal = prompt("Objetivo (Popular / Erudito / Coral / Misto):", cur);
      if (goal && goal.trim()) {
        store.set(s => { s.user.goal = goal.trim().slice(0, 24); });
        toast("Objetivo atualizado.");
        render();
      }
      return;
    }

    // biblioteca: aplicar filtros
    const apply = t.closest('[data-action="applyLibraryFilters"]');
    if (apply) {
      const q = ($("#libQ")?.value || "").trim();
      const tag = ($("#libTag")?.value || "Todos").trim();
      const level = ($("#libLevel")?.value || "Todos").trim();

      store.set(s => {
        s.ui.libraryQuery = q;
        s.ui.libraryTag = tag;
        s.ui.libraryLevel = level;
      });

      render();
      return;
    }

    // biblioteca: reset
    const reset = t.closest('[data-action="resetLibraryFilters"]');
    if (reset) {
      store.set(s => {
        s.ui.libraryQuery = "";
        s.ui.libraryTag = "Todos";
        s.ui.libraryLevel = "Todos";
      });
      render();
      return;
    }

    // biblioteca: atualizar índice (pega novos scripts/novos conteúdos)
    const refresh = t.closest('[data-action="refreshContentIndex"]');
    if (refresh) {
      rebuildContentCaches();
      toast(`Conteúdos atualizados: ${CONTENT_INDEX.length}`);
      render();
      return;
    }
  }

  function onKeydown(e) {
    // Enter aplica filtros se estiver no input
    if (e.key === "Enter" && (document.activeElement?.id === "libQ")) {
      const btn = document.querySelector('[data-action="applyLibraryFilters"]');
      if (btn) btn.click();
    }
  }

  /* =============================
     Init
  ============================= */
  function init() {
    ensureContentIndex();

    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("hashchange", render);

    if (!location.hash) location.hash = "#/home";
    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
