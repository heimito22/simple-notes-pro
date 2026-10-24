/* Select de vidro para o modo Liquid Glass.
   O popup nativo do <select> no Windows não aceita backdrop/blur; este componente
   troca a lista por um menu de vidro, mantendo o <select> original escondido
   (os listeners de change do app continuam funcionando). */
(function () {
  var itens = [];
  var aberto = null;

  function criar(sel) {
    if (!sel || sel.dataset.glassSelect === '1') return;
    sel.dataset.glassSelect = '1';

    var wrap = document.createElement('span');
    wrap.className = 'glass-select';
    if (sel.style.width) wrap.style.width = sel.style.width;
    if (sel.style.maxWidth) wrap.style.maxWidth = sel.style.maxWidth;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'glass-select-btn';
    btn.setAttribute('role', 'combobox');
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');

    var rotulo = document.createElement('span');
    rotulo.className = 'rotulo';
    var chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = '⌄';
    btn.appendChild(rotulo);
    btn.appendChild(chev);
    wrap.appendChild(btn);

    sel.parentNode.insertBefore(wrap, sel);
    var displayOriginal = sel.style.display;
    sel.style.display = 'none';

    var menu = document.createElement('div');
    menu.className = 'glass-select-menu';
    menu.setAttribute('role', 'listbox');
    document.body.appendChild(menu);

    function atualizarRotulo() {
      var o = sel.options[sel.selectedIndex];
      rotulo.textContent = o ? o.text : '';
      btn.title = o ? o.text : '';
    }

    function fechar() {
      menu.classList.remove('aberto');
      btn.setAttribute('aria-expanded', 'false');
      if (aberto && aberto.menu === menu) aberto = null;
    }

    function preencher() {
      menu.innerHTML = '';
      for (var i = 0; i < sel.options.length; i++) {
        var o = sel.options[i];
        if (o.disabled) continue;
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = o.text;
        b.setAttribute('role', 'option');
        b.dataset.valor = o.value;
        b.setAttribute('aria-selected', o.selected ? 'true' : 'false');
        if (o.selected) b.classList.add('sel');
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          var v = this.dataset.valor;
          if (sel.value !== v) {
            sel.value = v;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
          atualizarRotulo();
          fechar();
          try { btn.focus(); } catch (err) {}
        });
        menu.appendChild(b);
      }
    }

    function abrir() {
      if (aberto && aberto.menu !== menu) aberto.fechar();
      preencher();
      var r = btn.getBoundingClientRect();
      var mw = Math.max(240, Math.round(r.width));
      var left = Math.round(r.left);
      if (left + mw > window.innerWidth - 8) left = Math.max(8, Math.round(r.right) - mw);
      menu.style.left = left + 'px';
      menu.style.width = mw + 'px';
      menu.style.top = Math.round(r.bottom + 6) + 'px';
      menu.classList.add('aberto');
      btn.setAttribute('aria-expanded', 'true');
      var mh = menu.offsetHeight;
      if (r.bottom + 6 + mh > window.innerHeight - 8) {
        menu.style.top = Math.max(8, Math.round(r.top - mh - 6)) + 'px';
      }
      aberto = { menu: menu, fechar: fechar };
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu.classList.contains('aberto')) fechar(); else abrir();
    });
    sel.addEventListener('change', atualizarRotulo);
    try { new MutationObserver(atualizarRotulo).observe(sel, { childList: true, subtree: true }); } catch (e) {}

    itens.push({ sel: sel, wrap: wrap, btn: btn, menu: menu, rotulo: atualizarRotulo, displayOriginal: displayOriginal });
    atualizarRotulo();
  }

  function init() {
    var sels = document.querySelectorAll('select.config-select');
    for (var i = 0; i < sels.length; i++) criar(sels[i]);
  }

  function destroy() {
    if (aberto) { try { aberto.fechar(); } catch (e) {} }
    itens.forEach(function (it) {
      try {
        it.sel.style.display = it.displayOriginal || '';
        delete it.sel.dataset.glassSelect;
        if (it.wrap.parentNode) it.wrap.parentNode.removeChild(it.wrap);
        if (it.menu.parentNode) it.menu.parentNode.removeChild(it.menu);
      } catch (e) {}
    });
    itens = [];
  }

  function setActive(on) {
    if (on) init(); else destroy();
  }

  function refresh() {
    itens.forEach(function (it) { try { it.rotulo(); } catch (e) {} });
  }

  document.addEventListener('click', function (e) {
    if (!aberto) return;
    if (aberto.menu.contains(e.target)) return;
    if (e.target && e.target.closest && e.target.closest('.glass-select')) return;
    aberto.fechar();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && aberto) { aberto.fechar(); }
  });
  window.addEventListener('resize', function () { if (aberto) aberto.fechar(); });
  window.addEventListener('scroll', function () { if (aberto) aberto.fechar(); }, true);

  window.GlassSelect = { setActive: setActive, refresh: refresh, init: init, destroy: destroy };
})();
