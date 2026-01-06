(() => {
  "use strict";

  /* ---------------------------
    Helpers
  ----------------------------*/
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  function escapeHtml(str){
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmtDateISO(d){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const da = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${da}`;
  }

  function addDays(date, days){
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function startOfDay(d){
    const x = new Date(d);
    x.setHours(0,0,0,0);
    return x;
  }

  function seededPick(arr, seedStr){
    let h = 2166136261;
    for (let i=0;i<seedStr.length;i++){
      h ^= seedStr.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % arr.length;
    return arr[idx];
  }

  function levelFromXP(xp){
    let lvl = 1;
    let need = 50;
    let cur = xp;
    while (cur >= need){
      cur -= need;
      lvl++;
      need = Math.floor(need * 1.35);
      need = clamp(need, 50, 9999);
    }
    return { level: lvl, cur, need };
  }

  function mdToHtml(md){
    let s = String(md || "");
    s = escapeHtml(s);

    s = s.replace(/^### (.*)$/gm, "<h3>$1</h3>");
    s = s.replace(/^## (.*)$/gm, "<h2>$1</h2>");
    s = s.replace(/^# (.*)$/gm, "<h1>$1</h1>");

    s = s.replace(/^\> (.*)$/gm, "<blockquote>$1</blockquote>");
    s = s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

    s = s.replace(/^\- (.*)$/gm, "<li>$1</li>");
    s = s.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);

    s = s.replace(/\n{2,}/g, "</p><p>");
    s = `<p>${s}</p>`;
    s = s.replace(/<p>\s*<\/p>/g, "");
    s = s.replace(/<p>(<h[1-3]>)/g, "$1");
    s = s.replace(/(<\/h[1-3]>)<\/p>/g, "$1");
    s = s.replace(/<p>(<ul>)/g, "$1");
    s = s.replace(/(<\/ul>)<\/p>/g, "$1");
    s = s.replace(/<p>(<blockquote>)/g, "$1");
    s = s.replace(/(<\/blockquote>)<\/p>/g, "$1");
    return s;
  }

  /* ---------------------------
    Storage / State
  ----------------------------*/
  const STORAGE_KEY = "imvpedia_voice_state_v3";

  function loadState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    }catch(_){ return null; }
  }

  function saveState(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  const state = loadState() || {
    userName: "Aluno",
    goal: "Misto",
    xp: 0,
    placementDone: false,
    placementResult: null,

    activePacks: ["base"],

    todayMission: null,
    missionHistory: [],
    streak: 0,
    lastCompleteISO: null
  };

  /* ---------------------------
    Packs / Manifest loader
  ----------------------------*/
  async function fetchJson(url){
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Falha ao carregar ${url}`);
    return await res.json();
  }

  async function getActiveManifests(){
    const ids = Array.from(new Set(state.activePacks || ["base"]));
    if (!ids.includes("base")) ids.unshift("base");
    state.activePacks = ids;
    saveState();

    const manifests = [];
    for (const id of ids){
      const url = `./packs/${id}/manifest.json`;
      const data = await fetchJson(url);
      manifests.push(data);
    }
    return manifests;
  }

  function flattenPaths(manifests){
    const out = [];
    for (const m of manifests){
      for (const p of (m.paths || [])){
        out.push({ ...p, packId: m.id, packName: m.name });
      }
    }
    return out;
  }

  function flattenLibrary(manifests){
    const out = [];
    for (const m of manifests){
      for (const it of (m.library || [])){
        out.push({ ...it, packId: m.id, packName: m.name });
      }
    }
    return out;
  }

  function flattenMissionTemplates(manifests){
    const out = [];
    for (const m of manifests){
      const t = m?.missions?.templates || [];
      for (const x of t) out.push({ ...x, packId: m.id });
    }
    return out;
  }

  /* ---------------------------
    Daily Mission
  ----------------------------*/
  function ensureTodayMission(templates){
    const todayISO = fmtDateISO(new Date());
    if (state.todayMission && state.todayMission.dateISO === todayISO) return;
    const pick = seededPick(templates, `mission:${todayISO}:${state.userName}:${state.goal}`);
    state.todayMission = { dateISO: todayISO, ...pick };
    saveState();
  }

  function weekStats(){
    const today = startOfDay(new Date());
    const from = startOfDay(addDays(today, -6));
    const isoFrom = fmtDateISO(from);

    const hist = (state.missionHistory || []).filter(x => x.dateISO >= isoFrom);
    const dates = new Set(hist.map(x => x.dateISO));
    const done = dates.size;
    return { done, total: 7 };
  }

  function completeTodayMission(){
    if (!state.todayMission) return;

    const todayISO = state.todayMission.dateISO;
    const already = (state.missionHistory || []).some(x => x.dateISO === todayISO);

    if (!already){
      state.missionHistory.unshift({
        dateISO: todayISO,
        title: state.todayMission.title,
        tag: state.todayMission.tag,
        xp: state.todayMission.xp,
        minutes: state.todayMission.minutes
      });

      state.xp += Number(state.todayMission.xp || 0);

      if (state.lastCompleteISO){
        const last = startOfDay(new Date(state.lastCompleteISO + "T00:00:00"));
        const today = startOfDay(new Date(todayISO + "T00:00:00"));
        const diffDays = Math.round((today - last) / (1000*60*60*24));
        if (diffDays === 1) state.streak += 1;
        else if (diffDays > 1) state.streak = 1;
      } else {
        state.streak = 1;
      }
      state.lastCompleteISO = todayISO;
    }

    saveState();
    render();
  }

  function swapTodayMission(templates){
    if (!state.todayMission) return;
    if (templates.length <= 1) return;

    const todayISO = state.todayMission.dateISO;
    const currentId = state.todayMission.id;
    const candidates = templates.filter(t => t.id !== currentId);
    const pick = seededPick(candidates, `swap:${todayISO}:${Date.now()}`);
    state.todayMission = { dateISO: todayISO, ...pick };
    saveState();
    render();
  }

  /* ---------------------------
    Router
  ----------------------------*/
  const ROUTES = {
    home: "#/home",
    path: "#/path",
    missions: "#/missions",
    library: "#/library",
    profile: "#/profile"
  };

  function getHash(){ return location.hash || ROUTES.home; }
  function setHash(h){ location.hash = h; }

  function parseRoute(){
    const h = getHash();
    const [path, qs] = h.split("?");
    const seg = path.replace("#/","") || "home";
    const params = new URLSearchParams(qs || "");
    return { seg, params };
  }

  /* ---------------------------
    UI shell
  ----------------------------*/
  function Topbar(){
    return `
      <div class="topbar">
        <div class="inner safe container">
          <div class="brand">
            <span class="brandDot"></span>
            <span>IMVpedia Voice</span>
          </div>
          <button class="pillBtn" id="btnAdmin">Admin</button>
        </div>
      </div>
    `;
  }

  function Tabbar(active){
    const mk = (id, label, ico) => {
      const on = active === id ? "tab tabActive" : "tab";
      return `
        <a class="${on}" href="${ROUTES[id]}">
          <div class="ico">${ico}</div>
          <div>${label}</div>
        </a>
      `;
    };

    return `
      <div class="tabbar">
        <div class="inner safe container">
          ${mk("home","Início","🏠")}
          ${mk("path","Trilha","🧭")}
          ${mk("missions","Missões","✅")}
          ${mk("library","Biblioteca","📚")}
          ${mk("profile","Perfil","👤")}
        </div>
      </div>
    `;
  }

  function Modal({title, bodyHtml, actionsHtml}){
    return `
      <div class="modalBack" id="modalBack">
        <div class="modal">
          <div class="modalHeader">
            <div class="modalTitle">${escapeHtml(title)}</div>
            <button class="pillBtn" id="modalClose">Fechar</button>
          </div>
          <div class="modalBody">
            ${bodyHtml || ""}
            ${actionsHtml ? `<hr class="sep">${actionsHtml}` : ""}
          </div>
        </div>
      </div>
    `;
  }

  /* ---------------------------
    Screens (Parte 2/3 continua)
  ----------------------------*/
async function renderHome(manifests){
    const templates = flattenMissionTemplates(manifests);
    ensureTodayMission(templates);

    const lvl = levelFromXP(state.xp);
    const wk = weekStats();
    const hasDoneToday = (state.missionHistory || []).some(x => x.dateISO === state.todayMission.dateISO);

    const packs = manifests.map(m => ({
      id: m.id,
      name: m.name,
      desc: m.desc || ""
    }));

    const progressPct = Math.round((lvl.cur / Math.max(1,lvl.need)) * 100);

    return `
      <div class="container safe">
        <div class="card hero glow">
          <div class="cardInner">
            <div class="heroTop">
              <div class="kicker">Olá, ${escapeHtml(state.userName)} • XP ${state.xp} • Nível ${lvl.level}</div>
              <div class="kicker">🔥 ${state.streak || 0} dia(s)</div>
            </div>

            <div class="heroTitle">IMVpedia Voice</div>
            <p class="heroDesc">Trilha vocal guiada com técnica, saúde e repertório (popular, erudito e coral).</p>

            <div style="margin-top:12px" class="row">
              <a class="btn btnPrimary" href="${ROUTES.path}">Trilha</a>
              <a class="btn" href="#/placement">${state.placementDone ? "Refazer placement" : "Fazer placement"}</a>
              <a class="btn" href="${ROUTES.profile}">Perfil</a>
            </div>

            <div style="margin-top:14px">
              <div class="small" style="margin-bottom:8px">Progresso do nível</div>
              <div class="progress"><div style="width:${progressPct}%"></div></div>
              <div class="small" style="margin-top:8px">${lvl.cur}/${lvl.need} XP para o próximo nível</div>
            </div>
          </div>
        </div>

        <div class="sectionRow">
          <div class="h2" style="margin:18px 0 0">Missão do dia</div>
          <div class="muted">${state.todayMission.dateISO} • ${escapeHtml(state.todayMission.tag || "")}</div>
        </div>

        <div class="card">
          <div class="cardInner">
            <div class="h2" style="margin:0">${escapeHtml(state.todayMission.title)}</div>
            <p class="sub">${escapeHtml(state.todayMission.desc || "")}</p>

            <div class="missionMeta">
              <div class="chip">⏱️ ${Number(state.todayMission.minutes || 0)} min</div>
              <div class="chip xpChip">✨ +${Number(state.todayMission.xp || 0)} XP</div>
            </div>

            <div class="missionActions">
              <button class="btn" id="btnSwapMission">Trocar</button>
              <button class="btn btnPrimary" id="btnCompleteMission" ${hasDoneToday ? "disabled" : ""}>
                ${hasDoneToday ? "Concluída" : "Concluir"}
              </button>
            </div>
          </div>
        </div>

        <div class="sectionRow">
          <div class="h2" style="margin:18px 0 0">Semana</div>
          <div class="muted">progresso semanal</div>
        </div>

        <div class="card">
          <div class="cardInner">
            <div class="small" style="margin-bottom:10px">Missões concluídas: <b>${wk.done}</b>/${wk.total}</div>
            <div class="progress"><div style="width:${Math.round((wk.done/wk.total)*100)}%"></div></div>
            <div class="small" style="margin-top:10px">Diário vocal: <b>em breve</b></div>
          </div>
        </div>

        <div class="sectionRow">
          <div class="h2" style="margin:18px 0 0">Packs</div>
          <a class="pillBtn" href="#/admin">Gerenciar packs</a>
        </div>

        <div class="grid">
          ${packs.map(p => `
            <div class="packCard">
              <div class="packTop">♪</div>
              <div class="packBody">
                <div class="packName">${escapeHtml(p.id === "base" ? "Base" : p.name)}</div>
                <div class="packDesc">${escapeHtml(p.desc || "")}</div>
              </div>
            </div>
          `).join("")}
        </div>

        <div style="height:8px"></div>
      </div>
    `;
  }

  async function renderPath(manifests){
    const paths = flattenPaths(manifests);
    return `
      <div class="container safe">
        <div class="h2">Trilha</div>
        <div class="list" style="margin-top:10px">
          ${paths.map(p => `
            <a class="item" href="#/pathview?pid=${encodeURIComponent(p.id)}">
              <div class="itemLeft">
                <div class="iconBadge">${escapeHtml(p.icon || "🧭")}</div>
                <div style="min-width:0">
                  <p class="itemTitle">${escapeHtml(p.title)}</p>
                  <p class="itemSub">${escapeHtml(p.subtitle || (p.tag ? (p.tag + " • ") : "") + (p.packId === "base" ? "Base — Voz Perfeita" : p.packName))}</p>
                </div>
              </div>
              <div class="chev">›</div>
            </a>
          `).join("")}
        </div>
      </div>
    `;
  }

  async function renderPathView(manifests, params){
    const pid = params.get("pid");
    const paths = flattenPaths(manifests);
    const p = paths.find(x => x.id === pid);
    if (!p) return `<div class="container safe"><div class="h2">Trilha</div><p class="sub">Trilha não encontrada.</p></div>`;

    const lessons = p.lessons || [];
    return `
      <div class="container safe">
        <div class="sectionRow">
          <div>
            <div class="h2" style="margin:0">${escapeHtml(p.title)}</div>
            <div class="sub">${escapeHtml(p.subtitle || "")}</div>
          </div>
          <a class="pillBtn" href="${ROUTES.path}">Voltar</a>
        </div>

        <div class="list" style="margin-top:10px">
          ${lessons.map(ls => `
            <a class="item" href="#/lesson?pid=${encodeURIComponent(p.id)}&lid=${encodeURIComponent(ls.id)}">
              <div class="itemLeft">
                <div class="iconBadge">📘</div>
                <div style="min-width:0">
                  <p class="itemTitle">${escapeHtml(ls.title)}</p>
                  <p class="itemSub">${escapeHtml((ls.tag || "Lição") + " • " + (p.packId === "base" ? "Base — Voz Perfeita" : p.packName))}</p>
                </div>
              </div>
              <div class="chev">›</div>
            </a>
          `).join("")}
        </div>
      </div>
    `;
  }

  async function renderLesson(manifests, params){
    const pid = params.get("pid");
    const lid = params.get("lid");

    const paths = flattenPaths(manifests);
    const p = paths.find(x => x.id === pid);
    const ls = p?.lessons?.find(x => x.id === lid);

    if (!p || !ls){
      return `<div class="container safe"><div class="h2">Lição</div><p class="sub">Conteúdo não encontrado.</p></div>`;
    }

    return `
      <div class="container safe">
        <div class="sectionRow">
          <div>
            <div class="h2" style="margin:0">${escapeHtml(ls.title)}</div>
            <div class="sub">${escapeHtml(ls.tag || "")} • ${escapeHtml(p.title)}</div>
          </div>
          <a class="pillBtn" href="#/pathview?pid=${encodeURIComponent(p.id)}">Voltar</a>
        </div>

        <div class="card">
          <div class="cardInner" style="line-height:1.55">
            ${mdToHtml(ls.md || "")}
          </div>
        </div>
      </div>
    `;
  }

  async function renderMissions(manifests){
    const templates = flattenMissionTemplates(manifests);
    ensureTodayMission(templates);

    const hasDoneToday = (state.missionHistory || []).some(x => x.dateISO === state.todayMission.dateISO);
    const history = (state.missionHistory || []).slice(0, 14);

    return `
      <div class="container safe">
        <div class="h2">Missões</div>

        <div class="card" style="margin-top:10px">
          <div class="cardInner">
            <div class="h2" style="margin:0">Missão do dia</div>
            <div class="sub">${escapeHtml(state.todayMission.dateISO)} • ${escapeHtml(state.todayMission.tag || "")}</div>

            <div style="margin-top:12px; font-weight:900; font-size:18px">
              ${escapeHtml(state.todayMission.title)}
            </div>
            <p class="sub">${escapeHtml(state.todayMission.desc || "")}</p>

            <div class="missionMeta">
              <div class="chip">⏱️ ${Number(state.todayMission.minutes || 0)} min</div>
              <div class="chip xpChip">✨ +${Number(state.todayMission.xp || 0)} XP</div>
            </div>

            <div class="missionActions">
              <button class="btn" id="btnSwapMission">Trocar</button>
              <button class="btn btnPrimary" id="btnCompleteMission" ${hasDoneToday ? "disabled" : ""}>
                ${hasDoneToday ? "Concluída" : "Concluir"}
              </button>
            </div>
          </div>
        </div>

        <div class="sectionRow">
          <div class="h2" style="margin:18px 0 0">Histórico</div>
          <div class="muted">últimos ${history.length}</div>
        </div>

        <div class="card">
          <div class="cardInner">
            ${history.length ? `
              <div class="list">
                ${history.map(h => `
                  <div class="item">
                    <div class="itemLeft">
                      <div class="iconBadge">✅</div>
                      <div style="min-width:0">
                        <p class="itemTitle">${escapeHtml(h.title)}</p>
                        <p class="itemSub">${escapeHtml(h.dateISO)} • ${escapeHtml(h.tag || "")} • ${h.minutes} min</p>
                      </div>
                    </div>
                    <div class="chip xpChip">+${h.xp} XP</div>
                  </div>
                `).join("")}
              </div>
            ` : `<div class="sub">Nenhuma missão concluída ainda.</div>`}
          </div>
        </div>
      </div>
    `;
  }

  async function renderLibrary(manifests){
    const items = flattenLibrary(manifests);

    return `
      <div class="container safe">
        <div class="h2">Biblioteca</div>

        <div class="list" style="margin-top:10px">
          ${items.map(it => `
            <a class="item" href="#/article?id=${encodeURIComponent(it.id)}">
              <div class="itemLeft">
                <div class="iconBadge">📚</div>
                <div style="min-width:0">
                  <p class="itemTitle">${escapeHtml(it.title)}</p>
                  <p class="itemSub">${escapeHtml((it.tag || "Conteúdo") + " • " + (it.packId === "base" ? "Base" : it.packName))}</p>
                </div>
              </div>
              <div class="chev">›</div>
            </a>
          `).join("")}
        </div>
      </div>
    `;
  }

  async function renderArticle(manifests, params){
    const id = params.get("id");
    const items = flattenLibrary(manifests);
    const it = items.find(x => x.id === id);
    if (!it){
      return `<div class="container safe"><div class="h2">Biblioteca</div><p class="sub">Artigo não encontrado.</p></div>`;
    }

    return `
      <div class="container safe">
        <div class="sectionRow">
          <div>
            <div class="h2" style="margin:0">${escapeHtml(it.title)}</div>
            <div class="sub">${escapeHtml(it.tag || "")} • ${(it.packId === "base" ? "Base — Voz Perfeita" : escapeHtml(it.packName))}</div>
          </div>
          <a class="pillBtn" href="${ROUTES.library}">Voltar</a>
        </div>

        <div class="card">
          <div class="cardInner" style="line-height:1.55">
            ${mdToHtml(it.md || "")}
          </div>
        </div>
      </div>
    `;
  }

  /* ---------------------------
    Profile + Placement + Admin (Parte 3/3 continua)
  ----------------------------*/
function PlacementIntro(){
    return `
      <div class="container safe">
        <div class="card glow">
          <div class="cardInner">
            <div class="h2" style="margin:0">Teste de Classificação Vocal</div>
            <p class="sub">Rápido, sem áudio. Ajusta sua trilha, intensidade e missões.</p>

            <div style="margin-top:12px" class="row">
              <button class="btn btnPrimary" id="plStart">Começar</button>
              <a class="btn" href="${ROUTES.home}">Voltar</a>
            </div>

            <p class="small" style="margin-top:12px">
              Não mede talento — apenas ponto de partida.
            </p>
          </div>
        </div>
      </div>
    `;
  }

  const PL_QUESTIONS = [
    {
      id: "experience",
      title: "Experiência",
      q: "Há quanto tempo você canta com alguma regularidade?",
      opts: [
        ["Nunca estudei canto", 0],
        ["Menos de 1 ano", 1],
        ["1 a 3 anos", 2],
        ["Mais de 3 anos", 3]
      ]
    },
    {
      id: "technique",
      title: "Técnica",
      q: "Você já estudou técnica vocal formalmente?",
      opts: [
        ["Nunca", 0],
        ["Pouco / vídeos soltos", 1],
        ["Com professor ou método", 2],
        ["Estudo contínuo e aplicado", 3]
      ]
    },
    {
      id: "health",
      title: "Saúde vocal",
      q: "Com que frequência você sente rouquidão ou cansaço?",
      opts: [
        ["Quase sempre", 0],
        ["Às vezes", 1],
        ["Raramente", 2],
        ["Quase nunca", 3]
      ]
    },
    {
      id: "range",
      title: "Conforto",
      q: "Sua voz se mantém confortável em notas médias e agudas?",
      opts: [
        ["Não, forço ou evito", 0],
        ["Às vezes", 1],
        ["Sim, com controle", 2],
        ["Sim, com facilidade", 3]
      ]
    },
    {
      id: "musical",
      title: "Musicalidade",
      q: "Você consegue repetir melodias ou ler cifras/partitura?",
      opts: [
        ["Tenho muita dificuldade", 0],
        ["Consigo com ajuda", 1],
        ["Consigo bem", 2],
        ["Com facilidade", 3]
      ]
    }
  ];

  function placementLevel(score){
    if (score <= 4) return "Iniciante";
    if (score <= 9) return "Intermediário";
    return "Avançado";
  }

  function placementPlan14(level){
    const base = {
      "Iniciante": ["Respiração funcional", "SOVT leve", "Afinação básica", "Consciência corporal"],
      "Intermediário": ["Coordenação ar-voz", "Ressonância", "Agilidade vocal", "Aplicação musical"],
      "Avançado": ["Eficiência vocal", "Extensão e dinâmica", "Estilo e interpretação", "Manutenção vocal"]
    };
    const themes = base[level] || base["Iniciante"];
    const plan = [];
    for (let i=0;i<14;i++){
      plan.push({
        day: i+1,
        focus: themes[i % themes.length],
        intensity: (i % 4 === 0) ? "Leve" : "Moderado"
      });
    }
    return plan;
  }

  function PlacementQuestion(step, answers){
    const q = PL_QUESTIONS[step];
    if (!q) return "";
    return `
      <div class="container safe">
        <div class="card">
          <div class="cardInner">
            <div class="kicker">Pergunta ${step+1} de ${PL_QUESTIONS.length}</div>
            <div class="h2" style="margin-top:8px">${escapeHtml(q.title)}</div>
            <p class="sub">${escapeHtml(q.q)}</p>

            <div class="list" style="margin-top:12px">
              ${q.opts.map(([label,val]) => `
                <button class="item" data-pl-ans="1" data-step="${step}" data-val="${val}">
                  <div class="itemLeft">
                    <div class="iconBadge">🧪</div>
                    <div style="min-width:0">
                      <p class="itemTitle">${escapeHtml(label)}</p>
                      <p class="itemSub">Escolher</p>
                    </div>
                  </div>
                  <div class="chev">›</div>
                </button>
              `).join("")}
            </div>

            <div style="margin-top:12px" class="row">
              <button class="btn" id="plBack" ${step===0?"disabled":""}>Voltar</button>
              <button class="btn btnPrimary" id="plCancel">Cancelar</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function PlacementResult(score){
    const level = placementLevel(score);
    const plan = placementPlan14(level);
    state.placementDone = true;
    state.placementResult = level;
    saveState();

    return `
      <div class="container safe">
        <div class="card glow">
          <div class="cardInner">
            <div class="kicker">Resultado</div>
            <div class="heroTitle" style="font-size:28px;margin:10px 0 6px">${escapeHtml(level)}</div>
            <p class="sub">Plano inicial de 14 dias criado para construir hábito e proteger a voz.</p>

            <div class="card" style="margin-top:12px">
              <div class="cardInner">
                <div class="h2" style="margin:0">Plano 14 dias</div>
                <div class="small" style="margin-top:6px">Dias leves e moderados alternados.</div>
                <div style="height:10px"></div>
                <div class="list">
                  ${plan.map(p => `
                    <div class="item">
                      <div class="itemLeft">
                        <div class="iconBadge">📅</div>
                        <div style="min-width:0">
                          <p class="itemTitle">Dia ${p.day}: ${escapeHtml(p.focus)}</p>
                          <p class="itemSub">${escapeHtml(p.intensity)}</p>
                        </div>
                      </div>
                      <div class="chip">${escapeHtml(p.intensity)}</div>
                    </div>
                  `).join("")}
                </div>
              </div>
            </div>

            <div class="row" style="margin-top:12px">
              <a class="btn" href="#/placement">Refazer</a>
              <a class="btn btnPrimary" href="${ROUTES.home}">Ir para o início</a>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  async function renderProfile(){
    const lvl = levelFromXP(state.xp);

    const body = `
      <div class="card glow">
        <div class="cardInner">
          <div class="h2" style="margin:0">Perfil</div>
          <p class="sub">Ajuste seu objetivo, nome e confira progresso.</p>

          <div class="grid" style="margin-top:12px">
            <div class="card">
              <div class="cardInner">
                <div class="kicker">Nível</div>
                <div style="font-weight:900;font-size:24px;margin-top:6px">${lvl.level}</div>
                <div class="small">${lvl.cur}/${lvl.need} XP</div>
              </div>
            </div>
            <div class="card">
              <div class="cardInner">
                <div class="kicker">Sequência</div>
                <div style="font-weight:900;font-size:24px;margin-top:6px">🔥 ${state.streak || 0}</div>
                <div class="small">dias consecutivos</div>
              </div>
            </div>
            <div class="card">
              <div class="cardInner">
                <div class="kicker">Objetivo</div>
                <div style="font-weight:900;font-size:18px;margin-top:6px">${escapeHtml(state.goal)}</div>
                <div class="small">Popular / Erudito / Coral / Misto</div>
              </div>
            </div>
            <div class="card">
              <div class="cardInner">
                <div class="kicker">Placement</div>
                <div style="font-weight:900;font-size:18px;margin-top:6px">${escapeHtml(state.placementResult || "Pendente")}</div>
                <div class="small">${state.placementDone ? "concluído" : "faça para personalizar"}</div>
              </div>
            </div>
          </div>

          <div class="row" style="margin-top:12px">
            <button class="btn" id="btnEditProfile">Editar</button>
            <a class="btn" href="#/placement">${state.placementDone ? "Refazer placement" : "Fazer placement"}</a>
          </div>
        </div>
      </div>
    `;

    return `<div class="container safe">${body}</div>`;
  }

  function openProfileModal(){
    const bodyHtml = `
      <div class="small" style="margin-bottom:8px">Nome</div>
      <input class="input" id="pfName" value="${escapeHtml(state.userName)}" />

      <div style="height:10px"></div>
      <div class="small" style="margin-bottom:8px">Objetivo</div>
      <select class="input" id="pfGoal">
        ${["Popular","Erudito","Coral","Misto"].map(g => `
          <option value="${g}" ${state.goal===g?"selected":""}>${g}</option>
        `).join("")}
      </select>

      <div class="small" style="margin-top:10px">
        Dica: o placement ajuda a definir intensidade e progressão.
      </div>
    `;

    const actionsHtml = `
      <div class="row">
        <button class="btn" id="pfCancel">Cancelar</button>
        <button class="btn btnPrimary" id="pfSave">Salvar</button>
      </div>
    `;

    $("#app").insertAdjacentHTML("beforeend", Modal({ title:"Editar Perfil", bodyHtml, actionsHtml }));
    $("#modalClose").addEventListener("click", closeModal);
    $("#modalBack").addEventListener("click", (e)=>{ if(e.target.id==="modalBack") closeModal(); });

    $("#pfCancel").addEventListener("click", closeModal);
    $("#pfSave").addEventListener("click", ()=>{
      state.userName = ($("#pfName").value || "Aluno").trim() || "Aluno";
      state.goal = ($("#pfGoal").value || "Misto").trim() || "Misto";
      saveState();
      closeModal();
      render();
    });
  }

  function closeModal(){
    const m = $("#modalBack");
    if (m) m.remove();
  }

  async function renderAdmin(){
    return `
      <div class="container safe">
        <div class="card">
          <div class="cardInner">
            <div class="h2" style="margin:0">Admin (em breve)</div>
            <p class="sub">Nesta versão: pack base + navegação + missões + biblioteca.</p>
            <p class="small">O editor de packs volta na próxima etapa sem quebrar o visual premium.</p>
            <div style="margin-top:12px" class="row">
              <a class="btn btnPrimary" href="${ROUTES.home}">Voltar</a>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* ---------------------------
    Render + Events
  ----------------------------*/
  async function render(){
    const app = $("#app");
    if (!app) return;

    let manifests = [];
    try{
      manifests = await getActiveManifests();
    }catch(err){
      app.innerHTML = `
        <div class="container safe" style="padding-top:90px">
          <div class="card">
            <div class="cardInner">
              <div class="h2" style="margin:0">Erro ao carregar conteúdo</div>
              <p class="sub">Confira se existe: <b>packs/base/manifest.json</b>.</p>
              <p class="small">${escapeHtml(err?.message || String(err))}</p>
            </div>
          </div>
        </div>
      `;
      return;
    }

    const { seg, params } = parseRoute();

    let viewHtml = "";
    if (seg === "home") viewHtml = await renderHome(manifests);
    else if (seg === "path") viewHtml = await renderPath(manifests);
    else if (seg === "pathview") viewHtml = await renderPathView(manifests, params);
    else if (seg === "lesson") viewHtml = await renderLesson(manifests, params);
    else if (seg === "missions") viewHtml = await renderMissions(manifests);
    else if (seg === "library") viewHtml = await renderLibrary(manifests);
    else if (seg === "article") viewHtml = await renderArticle(manifests, params);
    else if (seg === "profile") viewHtml = await renderProfile();
    else if (seg === "admin") viewHtml = await renderAdmin();
    else if (seg === "placement") {
      // placement flow controller stored in window temp
      if (!window.__pl) window.__pl = { step: -1, answers: {}, score: 0 };
      if (window.__pl.step < 0) viewHtml = PlacementIntro();
      else viewHtml = PlacementQuestion(window.__pl.step, window.__pl.answers);
    }
    else viewHtml = await renderHome(manifests);

    app.innerHTML = `
      ${Topbar()}
      <div class="app">
        <div class="container">${viewHtml}</div>
      </div>
      ${Tabbar(seg)}
    `;

    bindEvents(manifests);
  }

  function bindEvents(manifests){
    // Admin button
    const btnAdmin = $("#btnAdmin");
    if (btnAdmin) btnAdmin.addEventListener("click", ()=> location.hash = "#/admin");

    // Mission buttons
    const templates = flattenMissionTemplates(manifests);
    const btnSwap = $("#btnSwapMission");
    const btnComplete = $("#btnCompleteMission");
    if (btnSwap) btnSwap.addEventListener("click", ()=> swapTodayMission(templates));
    if (btnComplete) btnComplete.addEventListener("click", ()=> completeTodayMission());

    // Profile modal
    const btnEdit = $("#btnEditProfile");
    if (btnEdit) btnEdit.addEventListener("click", openProfileModal);

    // Placement
    const plStart = $("#plStart");
    if (plStart) plStart.addEventListener("click", ()=>{
      window.__pl = { step: 0, answers: {}, score: 0 };
      location.hash = "#/placement";
      render();
    });

    const plBack = $("#plBack");
    if (plBack) plBack.addEventListener("click", ()=>{
      if (!window.__pl) return;
      window.__pl.step = Math.max(0, window.__pl.step - 1);
      render();
    });

    const plCancel = $("#plCancel");
    if (plCancel) plCancel.addEventListener("click", ()=>{
      window.__pl = { step: -1, answers: {}, score: 0 };
      location.hash = "#/placement";
      render();
    });

    // placement answer buttons
    $$("[data-pl-ans='1']").forEach(btn => {
      btn.addEventListener("click", ()=>{
        const step = Number(btn.getAttribute("data-step") || 0);
        const val = Number(btn.getAttribute("data-val") || 0);
        if (!window.__pl) window.__pl = { step: 0, answers: {}, score: 0 };
        window.__pl.answers[step] = val;

        if (step >= PL_QUESTIONS.length - 1){
          const score = Object.values(window.__pl.answers).reduce((a,b)=>a+Number(b||0),0);
          window.__pl.score = score;
          // render result page inline
          const app = $("#app");
          if (app){
            app.innerHTML = `
              ${Topbar()}
              <div class="app">
                ${PlacementResult(score)}
              </div>
              ${Tabbar("home")}
            `;
            // bind basic
            const btnAdmin2 = $("#btnAdmin");
            if (btnAdmin2) btnAdmin2.addEventListener("click", ()=> location.hash = "#/admin");
          }
          window.__pl = { step: -1, answers: {}, score: 0 };
          return;
        }

        window.__pl.step = step + 1;
        render();
      });
    });
  }

  window.addEventListener("hashchange", render);

  if (!location.hash) location.hash = "#/home";
  render();

})();
