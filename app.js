// ===== INÍCIO app.js (PARTE 5 – PLACEMENT) — BLOCO 1/4 =====
/* =========================================================
   IMVpedia Voice — app.js (Parte 5/6)
   TESTE DE CLASSIFICAÇÃO VOCAL (PLACEMENT)
   ---------------------------------------------------------
   - Fluxo guiado estilo Duolingo
   - Questionário vocal seguro (sem áudio)
   - Classificação automática (iniciante/intermediário/avançado)
   - Recomenda trilha, intensidade e minutos
   - Gera plano inicial de 14 dias
   - Integra com perfil, missões e home
========================================================= */

(() => {
  "use strict";

  /* =============================
     UTILIDADES BÁSICAS
  ============================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  const todayISO = () => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  };

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
    location.hash = qs ? `${base}?${qs}` : base;
  }

  function getRouteAndQuery() {
    const h = location.hash || "#/home";
    if (!h.startsWith("#/")) return { route: "home", query: {} };
    const [path, qs] = h.slice(2).split("?");
    return {
      route: path || "home",
      query: Object.fromEntries(new URLSearchParams(qs || ""))
    };
  }

  function bottomSpacer() {
    return `<div style="height:100px"></div>`;
  }

  /* =============================
     STORAGE / STATE
  ============================= */
  const LS = {
    STATE: "imv_voice_state_v4"
  };

  const DEFAULT_STATE = {
    user: {
      name: "",
      avatar: "🎤",
      goal: "Misto",
      levelSelf: "Iniciante",
      levelReal: null,
      minutesPerDay: 10,
      placementDone: false,
      recommendedPath: null
    },
    placement: {
      answers: {},
      score: 0,
      result: null,
      plan14: []
    }
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(LS.STATE);
      if (!raw) return structuredClone(DEFAULT_STATE);
      return { ...structuredClone(DEFAULT_STATE), ...JSON.parse(raw) };
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  }

  const store = {
    state: loadState(),
    set(fn) {
      const next = structuredClone(this.state);
      fn(next);
      this.state = next;
      localStorage.setItem(LS.STATE, JSON.stringify(this.state));
    },
    get() {
      return this.state;
    }
  };

  /* =============================
     PLACEMENT – QUESTIONÁRIO
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
      Iniciante: [
        "Respiração funcional",
        "SOVT leve",
        "Afinação básica",
        "Consciência corporal"
      ],
      Intermediário: [
        "Coordenação ar-voz",
        "Ressonância",
        "Agilidade vocal",
        "Aplicação musical"
      ],
      Avançado: [
        "Eficiência vocal",
        "Extensão e dinâmica",
        "Estilo e interpretação",
        "Manutenção vocal"
      ]
    };

    const themes = base[level] || base.Iniciante;
    const plan = [];

    for (let i = 0; i < 14; i++) {
      plan.push({
        day: i + 1,
        focus: themes[i % themes.length],
        intensity: i % 4 === 0 ? "leve" : "moderada"
      });
    }
    return plan;
  }

  /* =============================
     VIEWS – PLACEMENT
  ============================= */

  function viewPlacementIntro() {
    return `
      <div class="panel">
        <div style="font-weight:900;font-size:18px;">Teste de Classificação Vocal</div>
        <p style="color:rgba(233,236,246,.78);line-height:1.45;margin-top:10px;">
          Este teste rápido ajuda o app a ajustar sua trilha, intensidade e missões.
        </p>
        <p style="color:rgba(233,236,246,.52);font-size:13px;">
          Não é um teste de talento, e sim de ponto de partida.
        </p>
        <div style="height:16px"></div>
        <button class="btn btnPrimary" data-action="startPlacement">Começar</button>
      </div>
      ${bottomSpacer()}
    `;
  }

  function viewPlacementQuestion(qIndex) {
    const q = PLACEMENT_QUESTIONS[qIndex];
    if (!q) return "";

    return `
      <div class="panel">
        <div style="font-size:12px;color:rgba(233,236,246,.52);">
          Pergunta ${qIndex + 1} de ${PLACEMENT_QUESTIONS.length}
        </div>
        <div style="font-weight:900;font-size:17px;margin-top:6px;">
          ${escapeHtml(q.title)}
        </div>
        <p style="color:rgba(233,236,246,.78);line-height:1.45;">
          ${escapeHtml(q.question)}
        </p>

        <div style="margin-top:14px;display:grid;gap:10px;">
          ${q.options.map((o, idx) => `
            <button class="btn" data-action="answer"
                    data-q="${qIndex}"
                    data-score="${o.score}">
              ${escapeHtml(o.label)}
            </button>
          `).join("")}
        </div>
      </div>
      ${bottomSpacer()}
    `;
  }

  // ===== FIM app.js (PARTE 5 – PLACEMENT) — BLOCO 1/4 =====
// ===== INÍCIO app.js (PARTE 5 – PLACEMENT) — BLOCO 2/4 =====

  function viewPlacementResult(result, score, plan14) {
    const st = store.get();
    const goal = st.user.goal || "Misto";

    const tipsByLevel = {
      Iniciante: [
        "Priorize conforto e consistência (5–12 min/dia).",
        "Use SOVT (lip trill/humming/canudo) para aquecer.",
        "Evite volume alto: qualidade > força.",
        "Se houver dor, pare e reduza carga."
      ],
      Intermediário: [
        "Trabalhe transições de registro (leve, sem empurrar).",
        "Inclua afinação aplicada (notas longas e ataques limpos).",
        "Aumente repertório gradualmente (trechos curtos).",
        "Mantenha 1–2 dias mais leves por semana."
      ],
      Avançado: [
        "Otimize eficiência (menos esforço, mais resultado).",
        "Trabalhe dinâmica e resistência sem apertar.",
        "Refine estilo e interpretação com intenção clara.",
        "Monitore sinais de fadiga e ajuste o treino."
      ]
    };

    const rec = recommendTrack(goal, result);

    return `
      <div class="panel">
        <div style="font-size:12px;color:rgba(233,236,246,.52);">Resultado do teste</div>
        <div style="font-weight:950;font-size:22px;margin-top:6px;">
          ${escapeHtml(result)}
        </div>

        <div style="height:10px"></div>

        <div class="panel" style="background:rgba(255,255,255,.03);">
          <div style="font-weight:900;">Recomendação</div>
          <div style="height:8px"></div>
          <div style="color:rgba(233,236,246,.78);line-height:1.45;">
            Objetivo: <b>${escapeHtml(goal)}</b><br/>
            Trilha sugerida: <b>${escapeHtml(rec.pathTitle)}</b><br/>
            Intensidade padrão: <b>${escapeHtml(rec.intensity)}</b><br/>
            Minutos sugeridos: <b>${escapeHtml(String(rec.minutes))} min/dia</b>
          </div>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div style="font-weight:900;">Dicas rápidas</div>
          <div style="height:8px"></div>
          <div style="color:rgba(233,236,246,.78);line-height:1.5;">
            ${(tipsByLevel[result] || tipsByLevel.Iniciante).map(t => `• ${escapeHtml(t)}`).join("<br/>")}
          </div>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div style="font-weight:900;">Plano inicial (14 dias)</div>
          <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:6px;">
            Alterna dias leves e moderados para criar hábito e proteger a voz.
          </div>
          <div style="height:10px"></div>
          <div style="display:grid;gap:8px;">
            ${plan14.map(p => `
              <div style="border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);padding:10px 12px;border-radius:14px;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                  <div style="font-weight:850;">Dia ${p.day}: ${escapeHtml(p.focus)}</div>
                  <div style="color:rgba(233,236,246,.52);font-size:12px;">
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
          <button class="btn btnPrimary" data-action="savePlacement">Salvar e continuar</button>
        </div>
      </div>
      ${bottomSpacer()}
    `;
  }

  function recommendTrack(goal, level) {
    // Regras simples e coerentes; depois podemos refinar por packs.
    // goal: Popular / Erudito / Coral / Misto
    // level: Iniciante / Intermediário / Avançado

    let minutes = 10;
    let intensity = "moderada";

    if (level === "Iniciante") { minutes = 10; intensity = "moderada"; }
    if (level === "Intermediário") { minutes = 15; intensity = "moderada"; }
    if (level === "Avançado") { minutes = 20; intensity = "moderada"; }

    // Coral tende a exigir manutenção leve/regular para blend e precisão
    if (goal === "Coral") { minutes = clamp(minutes, 8, 18); }

    // Erudito: mais controle e consistência, mas sem exagerar de início
    if (goal === "Erudito" && level === "Iniciante") { minutes = 12; }

    // Popular: aplicação e resistência (quando intermediário/avançado)
    if (goal === "Popular" && level === "Avançado") { minutes = 22; }

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

// ===== FIM app.js (PARTE 5 – PLACEMENT) — BLOCO 2/4 =====
// ===== INÍCIO app.js (PARTE 5 – PLACEMENT) — BLOCO 3/4 =====

  /* =============================
     UI BASE (sem depender do resto)
     - Mantém seu visual atual (CSS do projeto)
     - Cria uma Home simples com CTA do Placement
  ============================= */

  function viewHome() {
    const st = store.get();
    const name = st.user.name?.trim() || "Aluno";
    const goal = st.user.goal || "Misto";
    const done = !!st.user.placementDone;

    const badge = done
      ? `<span style="font-size:11px;color:rgba(233,236,246,.52);border:1px solid rgba(56,211,159,.25);padding:6px 10px;border-radius:999px;background:rgba(56,211,159,.06);">Placement feito</span>`
      : `<span style="font-size:11px;color:rgba(233,236,246,.52);border:1px solid rgba(255,255,255,.10);padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.03);">Placement pendente</span>`;

    const levelLine = done
      ? `Nível real: <b>${escapeHtml(st.user.levelReal || "-")}</b> • Plano 14 dias pronto`
      : `Faça o teste para liberar recomendação e plano inicial`;

    return `
      <div class="hero">
        <div class="hero__kicker">Bem-vindo(a), ${escapeHtml(name)} • Objetivo: ${escapeHtml(goal)} ${badge}</div>
        <div class="hero__title">IMVpedia Voice</div>
        <p class="hero__desc">
          Treino vocal guiado com missões e progressão. ${levelLine}.
        </p>
        <div class="hero__actions">
          <button class="btn btnPrimary" data-action="goPlacement">${done ? "Ver/Refazer Placement" : "Fazer Placement"}</button>
          <button class="btn" data-action="editProfile">Editar Perfil</button>
        </div>
      </div>

      <div class="section">
        <div class="section__head">
          <div>
            <div class="section__title">Seu perfil</div>
            <div class="section__sub">Configurações rápidas</div>
          </div>
        </div>

        <div class="grid grid--2">
          <div class="kpi">
            <div>
              <div class="kpi__label">Objetivo</div>
              <div class="kpi__value" style="font-size:18px;">${escapeHtml(goal)}</div>
            </div>
            <div style="font-size:18px;">🎯</div>
          </div>

          <div class="kpi">
            <div>
              <div class="kpi__label">Minutos/dia</div>
              <div class="kpi__value" style="font-size:18px;">${st.user.minutesPerDay || 10}</div>
            </div>
            <div style="font-size:18px;">⏱️</div>
          </div>

          <div class="kpi">
            <div>
              <div class="kpi__label">Nível (auto)</div>
              <div class="kpi__value" style="font-size:18px;">${escapeHtml(st.user.levelReal || "—")}</div>
            </div>
            <div style="font-size:18px;">🏅</div>
          </div>

          <div class="kpi">
            <div>
              <div class="kpi__label">Placement</div>
              <div class="kpi__value" style="font-size:18px;">${done ? "Concluído" : "Pendente"}</div>
            </div>
            <div style="font-size:18px;">🧪</div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div style="font-weight:900;">Plano 14 dias</div>
        <div style="color:rgba(233,236,246,.52);font-size:12px;margin-top:6px;">
          ${(st.placement.plan14?.length ? "Gerado pelo placement." : "Faça o placement para gerar automaticamente.")}
        </div>
        <div style="height:10px"></div>

        ${st.placement.plan14?.length ? `
          <div style="display:grid;gap:8px;">
            ${st.placement.plan14.slice(0, 6).map(p => `
              <div style="border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);padding:10px 12px;border-radius:14px;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                  <div style="font-weight:850;">Dia ${p.day}: ${escapeHtml(p.focus)}</div>
                  <div style="color:rgba(233,236,246,.52);font-size:12px;">${p.intensity === "leve" ? "Leve" : "Moderado"}</div>
                </div>
              </div>
            `).join("")}
          </div>
          <div style="height:10px"></div>
          <button class="btn" data-action="goPlacement">Ver plano completo</button>
        ` : `
          <button class="btn btnPrimary" data-action="goPlacement">Gerar plano (Placement)</button>
        `}
      </div>

      ${bottomSpacer()}
    `;
  }

  function openProfileEditor() {
    const st = store.get();
    const u = st.user;

    const content = `
      <label style="display:block;font-size:12px;color:rgba(233,236,246,.52);margin-bottom:6px;">Nome</label>
      <input id="pfName" class="input" type="text" value="${escapeHtml(u.name || "")}" />

      <div style="height:10px"></div>
      <div class="grid grid--2">
        <div>
          <label style="display:block;font-size:12px;color:rgba(233,236,246,.52);margin-bottom:6px;">Objetivo</label>
          <select id="pfGoal" class="input">
            ${["Popular","Erudito","Coral","Misto"].map(x => `<option ${x===u.goal?"selected":""}>${x}</option>`).join("")}
          </select>
        </div>
        <div>
          <label style="display:block;font-size:12px;color:rgba(233,236,246,.52);margin-bottom:6px;">Minutos/dia</label>
          <input id="pfMin" class="input" type="number" min="5" max="60" step="5" value="${u.minutesPerDay || 10}" />
        </div>
      </div>

      <div style="height:10px"></div>
      <div style="color:rgba(233,236,246,.52);font-size:12px;line-height:1.35;">
        Dica: depois do placement, o app sugere minutos ideais conforme seu nível.
      </div>
    `;

    openModal({
      title: "Editar Perfil",
      contentHtml: content,
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
     MODAL SIMPLES (mesma base)
  ============================= */
  let modalEl = null;

  function openModal({ title, contentHtml, primaryText, secondaryText, onPrimary, onSecondary }) {
    closeModal();
    modalEl = document.createElement("div");
    modalEl.style.position = "fixed";
    modalEl.style.inset = "0";
    modalEl.style.zIndex = "200";
    modalEl.style.background = "rgba(0,0,0,.55)";
    modalEl.style.backdropFilter = "blur(10px)";
    modalEl.innerHTML = `
      <div style="max-width:520px;margin:10vh auto;padding:0 14px;">
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

  /* =============================
     ROUTER
  ============================= */
  const main = $("#main");

  function viewPlacementRouter(query) {
    // query.step: intro | q0..qN | result
    const step = query.step || "intro";
    if (step === "intro") return viewPlacementIntro();

    if (step.startsWith("q")) {
      const idx = parseInt(step.slice(1), 10);
      return viewPlacementQuestion(isNaN(idx) ? 0 : idx);
    }

    if (step === "result") {
      const { score, result, plan14 } = runPlacementAndBuildResult();
      return viewPlacementResult(result, score, plan14);
    }

    return viewPlacementIntro();
  }

  function render() {
    const { route, query } = getRouteAndQuery();

    if (!main) return;

    try {
      if (route === "home") {
        main.innerHTML = viewHome();
      } else if (route === "placement") {
        main.innerHTML = viewPlacementRouter(query);
      } else {
        main.innerHTML = `
          <div class="panel">
            <div style="font-weight:900;">Página não encontrada</div>
            <div style="height:10px"></div>
            <button class="btn btnPrimary" data-action="goHome">Voltar</button>
          </div>
          ${bottomSpacer()}
        `;
      }
    } catch (e) {
      main.innerHTML = `
        <div class="panel">
          <div style="font-weight:900;">Erro</div>
          <div style="color:rgba(233,236,246,.72);margin-top:8px;line-height:1.45">
            ${escapeHtml(String(e))}
          </div>
        </div>
        ${bottomSpacer()}
      `;
    }

    bindHandlers();
  }

  /* =============================
     AÇÕES / EVENTOS
  ============================= */
  function bindHandlers() {
    $$("[data-action]").forEach(el => {
      el.addEventListener("click", () => {
        const act = el.getAttribute("data-action");

        if (act === "goHome") setHash("home");
        if (act === "goPlacement") {
          // Se já fez, abre resultado; senão, intro
          const st = store.get();
          setHash("placement", { step: st.user.placementDone ? "result" : "intro" });
        }
        if (act === "editProfile") openProfileEditor();

        if (act === "startPlacement") {
          store.set(s => { s.placement.answers = {}; s.placement.score = 0; s.placement.result = null; s.placement.plan14 = []; });
          setHash("placement", { step: "q0" });
        }

        if (act === "restartPlacement") {
          store.set(s => { s.placement.answers = {}; s.placement.score = 0; s.placement.result = null; s.placement.plan14 = []; });
          setHash("placement", { step: "q0" });
        }

        if (act === "savePlacement") {
          const { score, result, plan14 } = runPlacementAndBuildResult();
          const st = store.get();
          const rec = recommendTrack(st.user.goal || "Misto", result);

          store.set(s => {
            s.placement.score = score;
            s.placement.result = result;
            s.placement.plan14 = plan14;

            s.user.levelReal = result;
            s.user.placementDone = true;
            s.user.recommendedPath = rec.pathTitle;

            // Sugere minutos e salva (sem forçar demais)
            s.user.minutesPerDay = clamp(rec.minutes, 5, 60);
          });

          setHash("home");
        }

        if (act === "answer") {
          const qIndex = parseInt(el.getAttribute("data-q") || "0", 10);
          const score = parseInt(el.getAttribute("data-score") || "0", 10);

          const q = PLACEMENT_QUESTIONS[qIndex];
          if (!q) return;

          store.set(s => {
            s.placement.answers[q.id] = score;
          });

          const next = qIndex + 1;
          if (next >= PLACEMENT_QUESTIONS.length) {
            setHash("placement", { step: "result" });
          } else {
            setHash("placement", { step: `q${next}` });
          }
        }
      });
    });
  }

// ===== FIM app.js (PARTE 5 – PLACEMENT) — BLOCO 3/4 =====
// ===== INÍCIO app.js (PARTE 5 – PLACEMENT) — BLOCO 4/4 =====

  /* =============================
     BOOT
  ============================= */
  function ensureProfile() {
    const st = store.get();
    if (st.user.name?.trim()) return;

    // Perfil mínimo automático para não quebrar UX
    store.set(s => {
      if (!s.user.name) s.user.name = "Aluno";
      if (!s.user.goal) s.user.goal = "Misto";
      if (!s.user.minutesPerDay) s.user.minutesPerDay = 10;
      if (!("placementDone" in s.user)) s.user.placementDone = false;
    });
  }

  function bindGlobal() {
    window.addEventListener("hashchange", () => render());
  }

  function boot() {
    ensureProfile();

    if (!location.hash) setHash("home");

    bindGlobal();
    render();

    // Se for primeira vez e placement não feito, sugere direto
    const st = store.get();
    if (!st.user.placementDone) {
      setTimeout(() => {
        // só sugere se ainda estiver no home
        const { route } = getRouteAndQuery();
        if (route === "home") {
          openModal({
            title: "Começar pelo Placement?",
            contentHtml: `
              <p style="margin:0;color:rgba(233,236,246,.78);line-height:1.45">
                Para personalizar sua trilha e gerar um plano inicial de 14 dias,
                faça o teste de classificação vocal.
              </p>
            `,
            primaryText: "Fazer agora",
            secondaryText: "Depois",
            onPrimary: () => {
              closeModal();
              setHash("placement", { step: "intro" });
            }
          });
        }
      }, 450);
    }
  }

  boot();
})();

// ===== FIM app.js (PARTE 5 – PLACEMENT) — BLOCO 4/4 =====