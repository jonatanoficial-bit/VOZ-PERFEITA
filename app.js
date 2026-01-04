(() => {
  'use strict';

  const view = document.getElementById('view');

  function route() {
    const hash = location.hash.replace('#/', '') || 'home';
    render(hash);
  }

  function render(route) {
    switch (route) {
      case 'home':
        view.innerHTML = '<h2>Início</h2><p>Missão do dia visível aqui.</p>';
        break;
      case 'path':
        view.innerHTML = '<h2>Trilha</h2><p>Lista de trilhas.</p>';
        break;
      case 'missions':
        view.innerHTML = '<h2>Missões</h2><p>Missões diárias e semanais.</p>';
        break;
      case 'library':
        view.innerHTML = '<h2>Biblioteca</h2><p>Conteúdos teóricos.</p>';
        break;
      case 'profile':
        view.innerHTML = '<h2>Perfil</h2><p>Dados do aluno.</p>';
        break;
      default:
        view.innerHTML = '<h2>404</h2>';
    }
  }

  document.querySelectorAll('.tabbar button').forEach(btn => {
    btn.addEventListener('click', () => {
      location.hash = '#/' + btn.dataset.route;
    });
  });

  window.addEventListener('hashchange', route);
  route();
})();