/* =========================================================
   IMVpedia Voice — app.js (COMPLETO)
   Navegação + Conteúdo + Admin Generator
========================================================= */

const $view = document.getElementById("view");
const $toast = document.getElementById("toast");

/* =========================
   ESTADO GLOBAL
========================= */
const state = {
  user: {
    name: "Aluno",
    xp: 0,
    level: 1,
    streak: 0,
  },
  packs: [],
  customPacks: JSON.parse(localStorage.getItem("imv_custom_packs") || "[]"),
};

/* =========================
   UTIL
========================= */
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add("show");
  setTimeout(() => $toast.classList.remove("show"), 2200);
}

function saveCustomPacks() {
  localStorage.setItem("imv_custom_packs", JSON.stringify(state.customPacks));
}

function calcLevel(xp) {
  return Math.floor(xp / 50) + 1;
}

/* =========================
   DADOS BASE (vindos dos arquivos)
========================= */
function loadBasePacks() {
  const base = [];

  if (window.TRACKS) base.push(...TRACKS);
  if (window.LESSONS) base.push(...LESSONS);
  if (window.LIBRARY) base.push(...LIBRARY);

  state.packs = [...base, ...state.customPacks];
}

/* =========================
   RENDER HELPERS
========================= */
function setActiveNav(hash) {
  document.querySelectorAll(".navbtn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.nav === hash);
  });
}

function page(html) {
  $view.innerHTML = `<div class="page">${html}</div>`;
}

/* =========================
   PÁGINAS
========================= */
function renderHome() {
  const xpNext = 50 * state.user.level;

  page(`
    <section class="hero">
      <div class="heroTop">
        <div class="heroMeta">Olá, ${state.user.name} • XP ${state.user.xp} • Nível ${state.user.level}</div>
        <div class="heroStreak">🔥 ${state.user.streak} dia(s)</div>
      </div>

      <h1 class="heroTitle">IMVpedia Voice</h1>
      <p class="heroDesc">
        Trilha vocal guiada com técnica, saúde e repertório
        (popular, erudito e coral).
      </p>

      <div class="heroActions">
        <button class="btn btn--accent" onclick="go('#/path')">Trilha</button>
        <button class="btn" onclick="toast('Placement em breve')">Fazer placement</button>
        <button class="btn btn--ghost" onclick="go('#/profile')">Perfil</button>
      </div>

      <div class="progressWrap">
        <div class="progressLabel">Progresso do nível</div>
        <div class="progressBar">
          <div style="width:${(state.user.xp % 50) * 2}%"></div>
        </div>
        <div class="progressSub">
          ${state.user.xp % 50}/50 XP para o próximo nível
        </div>
      </div>
    </section>
  `);
}

function renderPath() {
  const tracks = state.packs.filter(p => p.type === "track");

  page(`
    <h2 class="h2">Trilha</h2>
    <div class="list">
      ${tracks.map(t => `
        <div class="item">
          <div class="itemLeft">
            <div class="iconCircle">🧭</div>
            <div class="itemText">
              <div class="itemTitle">${t.title}</div>
              <div class="itemSub">${t.subtitle || ""}</div>
            </div>
          </div>
          <div class="chev">›</div>
        </div>
      `).join("") || `<div class="empty">Nenhuma trilha ainda.</div>`}
    </div>
  `);
}

function renderLibrary() {
  const libs = state.packs.filter(p => p.type === "library");

  page(`
    <h2 class="h2">Biblioteca</h2>
    <div class="list">
      ${libs.map(l => `
        <div class="item">
          <div class="itemLeft">
            <div class="iconCircle">📚</div>
            <div class="itemText">
              <div class="itemTitle">${l.title}</div>
              <div class="itemSub">${l.category || ""}</div>
            </div>
          </div>
          <div class="chev">›</div>
        </div>
      `).join("") || `<div class="empty">Biblioteca vazia.</div>`}
    </div>
  `);
}

function renderMissions() {
  page(`
    <h2 class="h2">Missões</h2>
    <div class="card">
      <div class="card__body">
        <div class="card__title">Missão de demonstração</div>
        <p class="card__desc">
          Clique para ganhar XP e validar a gamificação.
        </p>
      </div>
      <div class="card__actions">
        <button class="btn btn--accent" onclick="completeMission()">Ganhar +10 XP</button>
      </div>
    </div>
  `);
}

function renderProfile() {
  page(`
    <h2 class="h2">Perfil</h2>
    <div class="card">
      <div class="card__body">
        <div class="card__title">🎤 ${state.user.name}</div>
        <p class="card__desc">Objetivo: Misto</p>
        <p class="card__desc">XP: ${state.user.xp}</p>
      </div>
      <div class="card__actions">
        <button class="btn" onclick="editName()">Editar nome</button>
        <button class="btn btn--accent" onclick="toast('Placement em breve')">Placement</button>
      </div>
    </div>
  `);
}

/* =========================
   ADMIN — GERADOR DE CONTEÚDO
========================= */
function renderAdminGenerator() {
  page(`
    <h2 class="h2">Admin • Gerador de Conteúdo</h2>

    <div class="card">
      <div class="card__body">
        <input id="gType" class="input" placeholder="Tipo (track / library)" />
        <input id="gTitle" class="input" placeholder="Título" />
        <input id="gSub" class="input" placeholder="Subtítulo / Categoria" />
        <textarea id="gText" class="input" placeholder="Texto / descrição"></textarea>
      </div>
      <div class="card__actions">
        <button class="btn btn--accent" onclick="generateJSON()">Gerar JSON</button>
      </div>
    </div>

    <pre id="jsonOut" class="card" style="padding:16px; white-space:pre-wrap;"></pre>

    <div class="small muted">
      Copie o JSON e cole em qualquer lugar (GitHub, WhatsApp, etc).
    </div>
  `);
}

function generateJSON() {
  const obj = {
    id: "custom_" + Date.now(),
    type: document.getElementById("gType").value,
    title: document.getElementById("gTitle").value,
    subtitle: document.getElementById("gSub").value,
    text: document.getElementById("gText").value,
  };
  document.getElementById("jsonOut").textContent =
    JSON.stringify(obj, null, 2);
}

/* =========================
   AÇÕES
========================= */
function completeMission() {
  state.user.xp += 10;
  state.user.level = calcLevel(state.user.xp);
  toast("+10 XP 🎉");
  renderMissions();
}

function editName() {
  const n = prompt("Seu nome:", state.user.name);
  if (n) {
    state.user.name = n;
    renderProfile();
  }
}

/* =========================
   ROTAS
========================= */
function go(hash) {
  location.hash = hash;
}

function router() {
  const hash = location.hash || "#/home";
  setActiveNav(hash);

  switch (hash) {
    case "#/home": renderHome(); break;
    case "#/path": renderPath(); break;
    case "#/missions": renderMissions(); break;
    case "#/library": renderLibrary(); break;
    case "#/profile": renderProfile(); break;
    case "#/admin":
    case "#/admin-generator": renderAdminGenerator(); break;
    default: renderHome();
  }
}

/* =========================
   INIT
========================= */
loadBasePacks();
window.addEventListener("hashchange", router);
router();

/* Admin shortcut */
document.getElementById("adminBtn").onclick = () => go("#/admin-generator");
