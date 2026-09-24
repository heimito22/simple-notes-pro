/* ============================================================================
   movimento.js — Simple Notes Pro Desktop
   Sistema de animações fluidas (tipo celular) powered by GSAP.
   Cobertura TOTAL da UI: grid, listas, tarefas, config, pastas, editor,
   modais, toasts, alarme, botões (pressão delegada), chips e checks.
   Fallback para CSS puro se a lib não carregar.
   ============================================================================ */
(function (root) {
  var g = root.gsap || null;
  // prefers-reduced-motion NÃO desliga o sistema (o usuário quer as animações).
  // Só reduz o "peso" das animações contínuas (flutuar); as de entrada ficam.
  var reduzido = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function qs(sel) { return document.querySelector(sel); }
  function qsa(sel) { return document.querySelectorAll(sel); }

  var vazio = {
    grid: function(){}, viewIn: function(){}, editorIn: function(){}, modalIn: function(){},
    toast: function(){}, chip: function(){}, flutuar: function(){}, counter: function(){},
    stagger: function(){}, ligar: function(){}, alarmeIn: function(){}, entrada: function(){}
  };
  if (!g) { root.Movimento = vazio; return; }

  var easeBack = 'back.out(1.55)';   // overshoot charmoso
  var easeExpo = 'expo.out';          // muito fluido
  var easeSine = 'sine.out';          // macio

  /* ---------- Stagger genérico: qualquer lista entra em cascata ---------- */
  function stagger(containerSel, childSel, opts) {
    opts = opts || {};
    var container = qs(containerSel); if (!container) return;
    var els = container.querySelectorAll(childSel);
    if (!els.length) return;
    // anima sempre (elementos podem ter sido recriados no render);
    // forçamos o estado final para nunca deixar item invisível
    g.fromTo(els,
      { y: opts.y != null ? opts.y : 22, opacity: 0, scale: opts.scale != null ? opts.scale : 0.96 },
      {
        y: 0, opacity: 1, scale: 1,
        duration: opts.duration || 0.42,
        ease: easeBack,
        stagger: { each: opts.each || 0.035, from: 'start' },
        overwrite: 'auto',
        clearProps: 'y,opacity,scale',
        force3D: true
      }
    );
  }

  /** Grid: cards sobem com mola (tipo celular) */
  function grid(sel) { stagger(sel || '#grid', '.card', { y: 24, each: 0.035 }); }

  /** View: tela entra suave */
  function viewIn(sel, dir) {
    var el = qs(sel); if (!el) return;
    dir = dir || 'up';
    g.from(el, {
      y: dir === 'up' ? 18 : -18, opacity: 0,
      duration: 0.34, ease: easeExpo, clearProps: 'y,opacity', force3D: true
    });
  }

  /** Editor: desliza da direita */
  function editorIn(sel) {
    var el = qs(sel || '.editor'); if (!el) return;
    g.from(el, { x: 60, opacity: 0, duration: 0.34, ease: easeExpo, clearProps: 'x,opacity', force3D: true });
  }

  /** Modais: sheet saltitante */
  function modalIn(sel) {
    var el = qs(sel || '.modal-card'); if (!el) return;
    g.from(el, { y: 22, opacity: 0, scale: 0.96, duration: 0.34, ease: easeBack, clearProps: 'y,opacity,scale', force3D: true });
  }

  /** Toast: sobe com pulinho */
  function toast(sel) {
    var el = qs(sel || '#toast'); if (!el) return;
    g.from(el, { y: 16, opacity: 0, scale: 0.92, duration: 0.36, ease: easeBack, clearProps: 'y,opacity,scale', force3D: true });
  }

  /** Alarme: cai do topo com mola (igual banner do celular) */
  function alarmeIn(sel) {
    var el = qs(sel || '#alarmToast'); if (!el) return;
    g.from(el, { y: -70, opacity: 0, scale: 0.94, duration: 0.5, ease: easeBack, clearProps: 'y,opacity,scale', force3D: true });
  }

  /** Chips / pills em cascata */
  function chip(sel) { stagger(sel, null, { y: 18, each: 0.04, scale: 0.92, duration: 0.3 }); }

  /** Flutuador contínuo (estado vazio) — respeita reduced-motion */
  function flutuar(sel, opts) {
    if (reduzido) return;
    opts = opts || {};
    var el = qs(sel); if (!el) return;
    g.to(el, { y: opts.y || -6, x: opts.x || 4, duration: opts.duration || 2.4, yoyo: true, repeat: -1, ease: 'sine.inOut', force3D: true });
  }

  /** Contador animado */
  function counter(sel, to, opts) {
    opts = opts || {};
    var el = qs(sel); if (!el) return;
    var from = parseFloat(String(el.textContent).replace(/[^\d.-]/g, '')) || 0;
    var obj = { v: from };
    g.to(obj, {
      v: to, duration: opts.duration || 0.5, ease: 'power2.out',
      onUpdate: function () { el.textContent = Math.round(obj.v); }
    });
  }

  /* ---------- Pressão delegada: um handler para TODOS os interativos ---------- */
  /* Funciona para elementos criados dinamicamente (cards, tarefas, pastas…).  */
  var SELETORES = '.btn,.nav-item,.pasta-row,.tarefa-dia,.tarefa-check,.check,.card-check,.pin-key,.pill,.tarefa-del,.lista-del,.view-toggle button,.barra-selecao .btn';
  function ligado(el) { return el && el.closest && el.closest(SELETORES); }
  function ligar() {
    if (root._mvLigado) return;
    root._mvLigado = true;
    document.addEventListener('mousedown', function (e) {
      var el = ligado(e.target); if (!el) return;
      g.to(el, { scale: 0.93, duration: 0.11, ease: easeSine, force3D: true });
    }, true);
    document.addEventListener('mouseup', function (e) {
      var el = ligado(e.target); if (!el) return;
      g.to(el, { scale: 1, duration: 0.3, ease: easeBack, force3D: true });
    }, true);
    document.addEventListener('mouseleave', function (e) {
      var el = ligado(e.target); if (!el) return;
      g.to(el, { scale: 1, duration: 0.25, ease: easeBack, force3D: true });
    }, true);
    // hover magnético sutil nos cards do grid (levita em direção ao mouse)
    document.addEventListener('mousemove', function (e) {
      var card = e.target && e.target.closest && e.target.closest('.grid:not(.lista) .card');
      qsa('.grid .card').forEach(function (c) { if (c !== card && c._mvH) { c._mvH = false; g.to(c, { x: 0, rotateX: 0, rotateY: 0, duration: 0.4, ease: 'power2.out', force3D: true }); } });
      if (!card) return;
      if (e._mvThrottle) return; e._mvThrottle = true;
      setTimeout(function () { e._mvThrottle = false; }, 40);
      var r = card.getBoundingClientRect();
      var cx = (e.clientX - r.left) / r.width - 0.5;
      var cy = (e.clientY - r.top) / r.height - 0.5;
      card._mvH = true;
      g.to(card, {
        x: cx * 5, rotateY: cx * 4, rotateX: -cy * 4,
        transformPerspective: 800, duration: 0.45, ease: 'power2.out', force3D: true
      });
    });
  }

  /** Entrada inicial do app (chamado 1x no boot) */
  function entrada() {
    ligar();
    var shell = qs('.sidebar'); if (shell) {
      g.from(shell, { x: -40, opacity: 0, duration: 0.5, ease: easeExpo, clearProps: 'x,opacity', force3D: true });
      stagger('.sidebar', '.nav-item', { y: 12, each: 0.05, duration: 0.4 });
    }
    var main = qs('.main'); if (main) {
      g.from(main, { y: 26, opacity: 0, duration: 0.5, ease: easeExpo, delay: 0.08, clearProps: 'y,opacity', force3D: true });
    }
  }

  root.Movimento = {
    grid: grid, viewIn: viewIn, editorIn: editorIn, modalIn: modalIn,
    toast: toast, chip: chip, flutuar: flutuar, counter: counter,
    stagger: stagger, ligar: ligar, alarmeIn: alarmeIn, entrada: entrada
  };
})(window);
