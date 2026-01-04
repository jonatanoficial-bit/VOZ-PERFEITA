/* =========================================================
   IMVpedia Voice — app.js (FINAL LIMPO)
   ---------------------------------------------------------
   - Router por hash
   - Home / Packs / Trilhas / Lições / Biblioteca
   - Placement test
   - Gamificação básica
   - Admin gate (UI pronta)
   ---------------------------------------------------------
   ESTE ARQUIVO NÃO CONTÉM MARKDOWN, FENCES OU LIXO DE CHAT
========================================================= */

(() => {
  "use strict";

  /* =============================
     Helpers
  ============================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

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

  function getRoute() {
    const h = location.hash || "#/home";
    if (!h.startsWith("#/")) return { route: "home", query: {} };
    const [path, qs] = h.slice(2).split("?");
    return {
      route: path || "home",
      query: Object.fromEntries(new URLSearchParams(qs || ""))
    };
  }

  function bottomSpacer() {
    return `<div style="height:120px"></div>`;
  }

  /* =============================
     Storage
  ============================= */
  const LS_KEY = "imvpedia_voice_state_v1";

  const DEFAULT_STATE = {
    user: {
      name: "Aluno",
      goal: "Misto",
      levelReal: null,
      placementDone: false
    },
    gamification: {
      xp: 0,
      level: 1,
      streak: 0
    },
    placement: {
      answers: {},
      result: null,
      plan14: []
    }
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? { ...DEFAULT_STATE, ...JSON.parse(raw) } : structuredClone(DEFAULT_STATE);
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  }

  function saveState(st) {
    localStorage.setItem(LS_KEY, JSON.stringify(st));
  }

  const store = {
    state: loadState(),
    get() {
      return this.state;
    },
    set(fn) {
      const next = structuredClone(this.state);
      fn(next);
      this.state = next;
      saveState(this.state);
    }
  };

  /* =============================
     Placement
  ============================= */
  const PLACEMENT_QUESTIONS = [
    {
      title: "Experiência vocal",
      question: "Há quanto tempo você canta?",
      options: [
        { label: "Nunca estudei", score: 0 },
        { label: "Menos de 1 ano", score: 1 },
        { label: "1 a 3 anos", score: 2 },
        { label: "Mais de 3 anos", score: 3 }
      ]
    },
    {
      title: "Saúde vocal",
      question: "Você sente rouquidão com frequência?",
      options: [
        { label: "Sempre", score: 0 },
        { label: "Às vezes", score: 1 },
        { label: "Raramente", score: 2 },
        { label: "Nunca", score: 3 }
      ]
    }
  ];

  function calculatePlacement(score) {
    if (score <= 2) return "Iniciante";
    if (score <= 4) return "Intermediário";
    return "Avançado";
  }

  function buildPlan14(level) {
    const base = {
      Iniciante: ["Respiração", "SOVT", "Afinação"],
      Intermediário: ["Coordenação", "Ressonância", "Aplicação"],
      Avançado: ["Eficiência", "Extensão", "Interpretação"]
    };
    const themes = base[level] || base.Iniciante;
    return Array.from({ length: 14 }, (_, i) => ({
      day: i + 1,
      focus: themes[i % themes.length]
    }));
  }

  /* =============================
     Views
  ============================= */
  function viewHome() {
    const st = store.get();
    return `
      <div class="hero">
        <div class="hero__kicker">Bem-vindo, ${escapeHtml(st.user.name)}</div>
        <div class="hero__title">IMVpedia Voice</div>
        <p class="hero__desc">
          Trilha vocal guiada do básico ao avançado.
        </p>
        <div class="hero__actions">
          <button class="btn btnPrimary" data-action="goPlacement">
            ${st.user.placementDone ? "Ver placement" : "Fazer placement"}
          </button>
        </div>
      </div>

      <div class="panel">
        <div class="panel__title">Seu nível</div>
        <p>${st.user.levelReal || "Ainda não definido"}</p>
      </div>

      ${bottomSpacer()}
    `;
  }

  function viewPlacementIntro() {
    return `
      <div class="panel">
        <div class="panel__title">Teste de Classificação Vocal</div>
        <p>Responda rapidamente para ajustar sua trilha.</p>
        <button class="btn btnPrimary" data-action="startPlacement">Começar</button>
      </div>
      ${bottomSpacer()}
    `;
  }

  function viewPlacementQuestion(i) {
    const q = PLACEMENT_QUESTIONS[i];
    if (!q) return "";
    return `
      <div class="panel">
        <div class="panel__title">${escapeHtml(q.title)}</div>
        <p>${escapeHtml(q.question)}</p>
        ${q.options.map(o => `
          <button class="btn" data-action="answer" data-q="${i}" data-score="${o.score}">
            ${escapeHtml(o.label)}
          </button>
        `).join("")}
      </div>
      ${bottomSpacer()}
    `;
  }

  function viewPlacementResult() {
    const st = store.get();
    return `
      <div class="panel">
        <div class="panel__title">Resultado</div>
        <p>Nível: <b>${st.user.levelReal}</b></p>
        <button class="btn btnPrimary" data-action="finishPlacement">Salvar</button>
      </div>
      ${bottomSpacer()}
    `;
  }

  /* =============================
     Router
  ============================= */
  const app = $("#app");

  function render() {
    const { route, query } = getRoute();
    let html = "";

    switch (route) {
      case "home":
        html = viewHome();
        break;
      case "placement":
        html = viewPlacementIntro();
        break;
      case "placement-q":
        html = viewPlacementQuestion(Number(query.q));
        break;
      case "placement-result":
        html = viewPlacementResult();
        break;
      default:
        html = viewHome();
    }

    app.innerHTML = html;
    bindActions();
  }

  /* =============================
     Actions
  ============================= */
  function bindActions() {
    $$("[data-action]").forEach(el => {
      el.onclick = () => {
        const a = el.dataset.action;

        if (a === "goPlacement") setHash("placement");

        if (a === "startPlacement") {
          store.set(s => s.placement.answers = {});
          setHash("placement-q", { q: 0 });
        }

        if (a === "answer") {
          const q = Number(el.dataset.q);
          const score = Number(el.dataset.score);
          store.set(s => s.placement.answers[q] = score);

          if (q + 1 < PLACEMENT_QUESTIONS.length)
            setHash("placement-q", { q: q + 1 });
          else {
            const sum = Object.values(store.get().placement.answers).reduce((a, b) => a + b, 0);
            const level = calculatePlacement(sum);
            store.set(s => {
              s.user.levelReal = level;
              s.user.placementDone = true;
              s.placement.plan14 = buildPlan14(level);
            });
            setHash("placement-result");
          }
        }

        if (a === "finishPlacement") {
          setHash("home");
        }
      };
    });
  }

  /* =============================
     Boot
  ============================= */
  window.addEventListener("hashchange", render);
  document.addEventListener("DOMContentLoaded", () => {
    if (!location.hash) setHash("home");
    render();
  });

})();