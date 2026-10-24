/* Liquid Glass (beta) — ativação e reflexo especular que segue o mouse. */
(function () {
  var ativo = false;

  function limpar() {
    var els = document.querySelectorAll('.card, .editor-toolbar, .modal-card, .config-group, .nav-item.ativo');
    for (var i = 0; i < els.length; i++) {
      els[i].style.removeProperty('--mx');
      els[i].style.removeProperty('--my');
    }
  }

  function aplicar(on) {
    ativo = !!on;
    document.documentElement.classList.toggle('glass', ativo);
    if (!ativo) limpar();
  }

  function mover(e) {
    if (!ativo) return;
    var t = e.target;
    var alvo = t && t.closest ? t.closest('.card, .editor-toolbar, .modal-card, .config-group, .nav-item.ativo') : null;
    if (!alvo) return;
    var r = alvo.getBoundingClientRect();
    alvo.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    alvo.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }

  document.addEventListener('pointermove', mover, { passive: true });
  window.LiquidGlass = { aplicar: aplicar, estaAtivo: function () { return ativo; } };
})();
