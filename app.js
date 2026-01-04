(() => {
  "use strict";

  const view = document.getElementById("view");

  const VALID_ROUTES = new Set(["home", "path", "missions", "library", "profile"]);

  function normalizeRoute(raw) {
    // raw vem tipo: "#/home", "#/p", "#/h", "#/missions?x=1"
    let r = String(raw || "").trim();

    // remove # e /
    if (r.startsWith("#")) r = r.slice(1);
    if (r.startsWith("/")) r = r.slice(1);

    // remove querystring
    if (r.includes("?")) r = r.split("?")[0];

    // rotas curtas comuns (caso seu app antigo usava isso)
    if (r === "h") r = "home";
    if (r === "p") r = "profile";
    if (r === "t") r = "path";
    if (r === "m") r = "missions";
    if (r === "b") r = "library";

    // rota vazia -> home
    if (!r) r = "home";

    // se não for válida -> home
    if (!VALID_ROUTES.has(r)) r = "home";

    return r;
  }

  function setRoute(route) {
    const r = normalizeRoute(route);
    const desired = `#/${r}`;
    if (location.hash !== desired) location.hash = desired;
    else render(r);
  }

  function routeFromHash() {
    const r = normalizeRoute(location.hash);
    const desired = `#/${r}`;

    // se está numa rota inválida, força corrigir o hash e sai
    if (location.hash !== desired) {
      location.hash = desired;
      return;
    }

    render(r);
  }

  function render(route) {
    // destaque no botão ativo
    document.querySelectorAll(".tabbar button").forEach((btn) => {
      const isActive = btn.dataset.route === route;
      btn.setAttribute("aria-current", isActive ? "page" : "false");
      btn.classList.toggle("isActive", isActive);
    });

    switch (route) {
      case "home":
        view.innerHTML = `
          <div class="panel">
            <h2 style="margin:0 0 8px">Início</h2>
            <p style="margin:0;color:rgba(233,236,246,.75)">
              Você está no Início. Agora os botões da barra inferior funcionam sempre.
            </p>
          </div>
        `;
        break;

      case "path":
        view.innerHTML = `
          <div class="panel">
            <h2 style="margin:0 0 8px">Trilha</h2>
            <p style="margin:0;color:rgba(233,236,246,.75)">
              Aqui vai a lista de trilhas/paths (Popular, Erudito, Coral, Misto).
            </p>
          </div>
        `;
        break;

      case "missions":
        view.innerHTML = `
          <div class="panel">
            <h2 style="margin:0 0 8px">Missões</h2>
            <p style="margin:0;color:rgba(233,236,246,.75)">
              Aqui ficam as missões diárias e desafios semanais.
            </p>
          </div>
        `;
        break;

      case "library":
        view.innerHTML = `
          <div class="panel">
            <h2 style="margin:0 0 8px">Biblioteca</h2>
            <p style="margin:0;color:rgba(233,236,246,.75)">
              Aqui fica a biblioteca (fisiologia vocal, apoio, SOVT, repertório, etc.).
            </p>
          </div>
        `;
        break;

      case "profile":
        view.innerHTML = `
          <div class="panel">
            <h2 style="margin:0 0 8px">Perfil</h2>
            <p style="margin:0;color:rgba(233,236,246,.75)">
              Aqui ficam dados do aluno, objetivo, minutos/dia, placement e progresso.
            </p>
          </div>
        `;
        break;

      default:
        // não deve acontecer mais, mas fica como segurança
        setRoute("home");
        break;
    }
  }

  // Clique nos botões da tabbar
  document.querySelectorAll(".tabbar button").forEach((btn) => {
    btn.addEventListener("click", () => {
      setRoute(btn.dataset.route);
    });
  });

  // Admin (se existir no futuro, por enquanto só evita erro)
  const adminBtn = document.getElementById("adminBtn");
  if (adminBtn) {
    adminBtn.addEventListener("click", () => {
      // Por enquanto só demonstra que o clique funciona.
      // Depois plugamos seu admin completo aqui.
      alert("Admin (em breve): editor de packs e conteúdos.");
    });
  }

  // Escuta mudanças de rota
  window.addEventListener("hashchange", routeFromHash);

  // Boot
  if (!location.hash || location.hash === "#") {
    location.hash = "#/home";
  } else {
    routeFromHash();
  }
})();