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
    try { if (window.GlassSelect) window.GlassSelect.setActive(ativo); } catch (e) {}
    if (!ativo) limpar();
  }

  // Onda líquida ao pressionar as teclas do PIN (delegação: vale para os dois pads).
  document.addEventListener('pointerdown', function (e) {
    if (!ativo) return;
    var k = e.target && e.target.closest ? e.target.closest('.pin-key') : null;
    if (!k) return;
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      var r = k.getBoundingClientRect();
      var size = Math.max(r.width, r.height) * 1.35;
      var s = document.createElement('span');
      s.className = 'pin-ripple';
      s.style.width = size + 'px';
      s.style.height = size + 'px';
      s.style.left = (e.clientX - r.left - size / 2) + 'px';
      s.style.top = (e.clientY - r.top - size / 2) + 'px';
      k.appendChild(s);
      setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 650);
    } catch (err) {}
  }, { passive: true });

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
