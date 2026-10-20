/* ============================================================================
   refino.js — microinterações do acabamento v2
   - ripple nos botões
   - "pop" nos contadores da navegação
   - atalhos: Ctrl+K (busca), Ctrl+Enter (enviar IA), Esc (limpar busca)
   ============================================================================ */
(function(){
  var reduzido = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- ripple ---------- */
  var SEL = '.btn, .pill, .view-toggle button';
  document.addEventListener('pointerdown', function(e){
    if(reduzido) return;
    var el = e.target && e.target.closest && e.target.closest(SEL);
    if(!el) return;
    var r = el.getBoundingClientRect();
    var d = Math.max(r.width, r.height) * 1.6;
    var s = document.createElement('span');
    s.className = 'sn-ripple';
    s.style.width = s.style.height = d + 'px';
    s.style.left = (e.clientX - r.left - d/2) + 'px';
    s.style.top  = (e.clientY - r.top  - d/2) + 'px';
    el.appendChild(s);
    setTimeout(function(){ try{ s.remove(); }catch(_){} }, 620);
  }, true);

  /* ---------- contadores com "pop" ---------- */
  function observarContador(el){
    var anterior = el.textContent;
    var mo = new MutationObserver(function(){
      if(el.textContent === anterior) return;
      anterior = el.textContent;
      el.classList.remove('pop');
      void el.offsetWidth; // reinicia a animação
      el.classList.add('pop');
      setTimeout(function(){ el.classList.remove('pop'); }, 260);
    });
    mo.observe(el, { childList:true, characterData:true, subtree:true });
  }
  function ligarContadores(){
    document.querySelectorAll('.nav-item .cnt').forEach(function(el){
      if(el._snObs) return;
      el._snObs = true;
      observarContador(el);
    });
  }

  /* ---------- atalhos ---------- */
  document.addEventListener('keydown', function(e){
    var ctrl = e.ctrlKey || e.metaKey;
    var k = (e.key || '').toLowerCase();
    if(ctrl && k === 'k'){
      e.preventDefault();
      var b = document.querySelector('#busca');
      if(b){ b.focus(); if(b.select) b.select(); }
      return;
    }
    if(ctrl && e.key === 'Enter'){
      var ia = document.querySelector('#iaInput');
      if(ia && document.activeElement === ia){
        e.preventDefault();
        var btn = document.querySelector('#btnIaEnviar');
        if(btn) btn.click();
      }
      return;
    }
    if(e.key === 'Escape'){
      var busca = document.querySelector('#busca');
      if(busca && document.activeElement === busca){
        busca.value = '';
        busca.dispatchEvent(new Event('input', { bubbles:true }));
        busca.blur();
      }
    }
  });

  function iniciar(){
    ligarContadores();
    // Os contadores são recriados pelos renders? Reobserva periodicamente
    // (custo desprezível: só adiciona observadores que ainda não existem).
    setInterval(ligarContadores, 2500);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
