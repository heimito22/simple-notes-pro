// Domínio Configurações + PIN 4 dígitos (clique + teclado)
(function (root) {
  var pinModo='criar', pinBuffer='', pinConfirm='';
  var ctxRef=null;

  function abrirPin(modo, ctx){
    var $=ctx.$;
    pinModo=modo; pinBuffer=''; pinConfirm=''; ctxRef=ctx;
    var ov=$('#pinOverlay'), tit=$('#pinTitulo'), sub=$('#pinSub');
    if(!ov) return;
    if(modo==='criar'){ if(tit) tit.textContent=T('Defina o PIN'); if(sub) sub.textContent=T('4 dígitos numéricos — clique ou digite'); }
    else if(modo==='confirmar-antigo'){ if(tit) tit.textContent=T('Digite o PIN atual'); if(sub) sub.textContent=T('Para alterar — use teclado ou clique'); }
    else { if(tit) tit.textContent=T('Confirme o PIN'); if(sub) sub.textContent=T('Digite novamente'); }
    ov.style.display='flex';
    var card=ov.querySelector('.pin-card');
    if(card){ card.setAttribute('tabindex','-1'); setTimeout(function(){ card.focus(); }, 50); }
    montarPinPad(ctx); atualizarPinDots(ctx);
  }
  function fecharPin(ctx){
    var c=ctx||ctxRef;
    var ov=(c&&c.$ ? c.$('#pinOverlay') : document.getElementById('pinOverlay'));
    if(ov) ov.style.display='none'; pinBuffer=''; pinConfirm='';
  }
  function montarPinPad(ctx){
    var $=ctx.$;
    var pad=$('#pinPad'); if(!pad) return; pad.innerHTML='';
    var keys=['1','2','3','4','5','6','7','8','9','','0','⌫'];
    keys.forEach(function(k){
      if(k===''){ var d=document.createElement('div'); pad.appendChild(d); return; }
      var b=document.createElement('button'); b.className='pin-key'; b.textContent=k;
      b.addEventListener('click', function(){
        if(k==='⌫'){ pinBuffer=pinBuffer.slice(0,-1); atualizarPinDots(ctx); return; }
        if(pinBuffer.length>=4) return; pinBuffer+=k; atualizarPinDots(ctx);
        if(pinBuffer.length===4) setTimeout(function(){ processarPin(ctx); },160);
      });
      pad.appendChild(b);
    });
  }
  function atualizarPinDots(ctx){
    var c=ctx||ctxRef;
    if(!c) return;
    var dots=c.$('#pinDots'); if(!dots) return;
    var ds=dots.querySelectorAll('.pin-dot'); ds.forEach(function(d,i){ d.classList.toggle('on', i < pinBuffer.length); });
  }
  async function processarPin(ctx){
    var c=ctx||ctxRef;
    if(pinModo==='criar'){ if(pinBuffer.length!==4) return; pinConfirm=pinBuffer; pinBuffer=''; pinModo='confirmar'; var tit=c.$('#pinTitulo'), sub=c.$('#pinSub'); if(tit) tit.textContent=T('Confirme o PIN'); if(sub) sub.textContent=T('Digite novamente'); atualizarPinDots(c); return; }
    if(pinModo==='confirmar'){
      if(pinBuffer!==pinConfirm){ c.toast(T('PINs não conferem')); pinBuffer=''; atualizarPinDots(c); var cc=c.$('#pinOverlay .pin-card'); if(cc){ cc.classList.remove('pin-shake'); void cc.offsetWidth; cc.classList.add('pin-shake'); } return; }
      await c.salvarConfigPatch({ pinDesbloqueio: pinBuffer, exigirBiometriaApp: true }); fecharPin(c); render(c); c.toast(T('PIN salvo')); return;
    }
    if(pinModo==='confirmar-antigo'){
      if(pinBuffer!==c.config.pinDesbloqueio){ c.toast(T('PIN incorreto')); pinBuffer=''; atualizarPinDots(c); var cc2=c.$('#pinOverlay .pin-card'); if(cc2){ cc2.classList.remove('pin-shake'); void cc2.offsetWidth; cc2.classList.add('pin-shake'); } return; }
      pinBuffer=''; pinModo='criar'; var tit2=c.$('#pinTitulo'), sub2=c.$('#pinSub'); if(tit2) tit2.textContent=T('Novo PIN'); if(sub2) sub2.textContent=T('4 dígitos'); atualizarPinDots(c);
    }
  }

  function onKeyPin(e){
    var ov=document.getElementById('pinOverlay');
    if(!ov || ov.style.display==='none') return false;
    var c=ctxRef; if(!c) return false;
    if(e.key>='0' && e.key<='9'){
      if(pinBuffer.length>=4) return true;
      pinBuffer+=e.key; atualizarPinDots(c);
      if(pinBuffer.length===4) setTimeout(function(){ processarPin(c); },160);
      e.preventDefault(); return true;
    } else if(e.key==='Backspace'){
      pinBuffer=pinBuffer.slice(0,-1); atualizarPinDots(c); e.preventDefault(); return true;
    } else if(e.key==='Escape'){
      fecharPin(c); e.preventDefault(); return true;
    } else if(e.key==='Enter' && pinBuffer.length===4){
      processarPin(c); e.preventDefault(); return true;
    } else if(e.key==='Escape' || e.key==='Enter'){
      // consome Esc/Enter mesmo sem 4 dígitos para não vazar para o app
      e.preventDefault(); return true;
    }
    return false;
  }
  // não registra listener próprio — app.js instala handler único com prioridade

  function render(ctx){
    ctxRef=ctx;
    var config=ctx.config; if(!config) return;
    var $=ctx.$;
    // Versão do app: lida do processo principal (não hardcoded)
    var versaoEl=ctx.$('#versaoApp');
    if(versaoEl && !versaoEl.dataset.carregado && window.snDesktop && window.snDesktop.versao){
      window.snDesktop.versao().then(function(v){ if(v && versaoEl){ versaoEl.textContent=v; versaoEl.dataset.carregado='1'; } }).catch(function(){});
    }
    var swTema=$('#swTema'), selIdioma=$('#selIdioma'), selBloq=$('#selTempoBloqueio'), selSoneca=$('#selSoneca'), selSom=$('#selSom');
    var swBloq=$('#swBloqueio'), rowPin=$('#rowPin'), pinStatus=$('#pinStatus'), btnPin=$('#btnDefinirPin');
    var chaveInput=$('#cfgChaveIA');
    if(swTema) swTema.classList.toggle('on', !!config.temaEscuro);
    if(selIdioma) selIdioma.value=config.idioma||'pt';
    if(selBloq) selBloq.value=String(config.tempoBloqueio||0);
    if(selSoneca) selSoneca.value=String(config.tempoSoneca||10);
    if(selSom) selSom.value=config.somAlarme||'classico';
    if(swBloq) swBloq.classList.toggle('on', !!config.exigirBiometriaApp);
    if(rowPin) rowPin.style.display=config.exigirBiometriaApp?'flex':'none';
    if(pinStatus) pinStatus.textContent=config.pinDesbloqueio?T('PIN definido (4 dígitos) — toque para alterar'):T('Nenhum PIN definido');
    if(btnPin) btnPin.textContent=config.pinDesbloqueio?T('Alterar PIN'):T('Definir PIN');
    if(chaveInput) chaveInput.value=config.chaveIA||'';
    // Auto-start: reflete o estado REAL do Windows (fonte da verdade)
    var swAuto=ctx.$('#swAutoStart');
    if(swAuto && window.snDesktop && window.snDesktop.iniciarComWindowsLer){
      window.snDesktop.iniciarComWindowsLer().then(function(on){ swAuto.classList.toggle('on', !!on); }).catch(function(){});
    }
  }

  function bind(ctx){
    ctxRef=ctx;
    var $=ctx.$;
    var swTema=$('#swTema'), selIdioma=$('#selIdioma'), selBloq=$('#selTempoBloqueio'), selSoneca=$('#selSoneca'), selSom=$('#selSom'), swBloq=$('#swBloqueio'), btnPin=$('#btnDefinirPin');
    if(swTema) swTema.addEventListener('click', function(){ ctx.salvarConfigPatch({ temaEscuro: !ctx.config.temaEscuro }); render(ctx); ctx.toast(ctx.config.temaEscuro?T('Tema escuro'):T('Tema claro')); });
    if(selIdioma) selIdioma.addEventListener('change', function(){ ctx.salvarConfigPatch({ idioma: selIdioma.value }); if(window.I18N) window.I18N.definir(selIdioma.value); render(ctx); if(window.snNotas&&window.snNotas.render) window.snNotas.render(ctx); if(window.snTarefas&&window.snTarefas.render) window.snTarefas.render(ctx); if(ctx.refreshConta) ctx.refreshConta(); ctx.toast(T('Idioma: ')+({pt:'Português',en:'English',es:'Español'}[selIdioma.value]||selIdioma.value)); });
    if(selBloq) selBloq.addEventListener('change', function(){ ctx.salvarConfigPatch({ tempoBloqueio: parseInt(selBloq.value,10)||0 }); });
    if(selSoneca) selSoneca.addEventListener('change', function(){ ctx.salvarConfigPatch({ tempoSoneca: parseInt(selSoneca.value,10)||10 }); });
    if(selSom) selSom.addEventListener('change', function(){ ctx.salvarConfigPatch({ somAlarme: selSom.value }); });
    if(swBloq) swBloq.addEventListener('click', function(){
      var novo=!ctx.config.exigirBiometriaApp;
      if(novo && !ctx.config.pinDesbloqueio){ abrirPin('criar', ctx); return; }
      ctx.salvarConfigPatch({ exigirBiometriaApp: novo }); render(ctx);
    });
    if(btnPin) btnPin.addEventListener('click', function(){ abrirPin(ctx.config.pinDesbloqueio ? 'confirmar-antigo' : 'criar', ctx); });
    // Iniciar com o Windows (auto-launch + bandeja em 2º plano)
    var swAuto=$('#swAutoStart');
    if(swAuto) swAuto.addEventListener('click', async function(){
      var novo=!swAuto.classList.contains('on');
      if(window.snDesktop && window.snDesktop.iniciarComWindowsSet){
        try{
          // O IPC devolve o estado RESULTANTE: o interruptor mostra o que é de
          // verdade (antes ele voltava a ficar "ligado" ao desligar).
          var on=await window.snDesktop.iniciarComWindowsSet(novo);
          swAuto.classList.toggle('on', !!on);
          ctx.toast(on===novo ? (novo?T('Vai iniciar com o Windows'):T('Não vai mais iniciar com o Windows')) : T('Não consegui alterar'));
        }catch(e){ ctx.toast(T('Não consegui alterar')); }
      }
    });
    var btnToggle=ctx.$('#btnToggleChave'), inpChave=ctx.$('#cfgChaveIA'), btnSalvar=ctx.$('#btnSalvarChave');
    if(btnToggle) btnToggle.addEventListener('click', function(){ if(inpChave) inpChave.type = inpChave.type==='password'?'text':'password'; });
    if(btnSalvar) btnSalvar.addEventListener('click', function(){ var v=(inpChave&&inpChave.value.trim())||''; ctx.salvarConfigPatch({ chaveIA: v }); ctx.toast(v?T('Chave salva'):T('Chave removida')); render(ctx); });
    var btnComo=ctx.$('#btnComoChave'); if(btnComo) btnComo.addEventListener('click', function(e){ e.preventDefault(); ctx.toast('No celular: Ajustes → IA → Como criar a chave (tutorial). No PC: mesma chave do OpenRouter.'); });
    var pinCancelar=ctx.$('#pinCancelar'), pinLimpar=ctx.$('#pinLimpar'), pinOverlay=ctx.$('#pinOverlay');
    if(pinCancelar) pinCancelar.addEventListener('click', function(){ fecharPin(ctx); });
    if(pinLimpar) pinLimpar.addEventListener('click', function(){ pinBuffer=''; atualizarPinDots(ctx); });
    if(pinOverlay) pinOverlay.addEventListener('click', function(e){ if(e.target===pinOverlay) fecharPin(ctx); });
  }

  root.snConfig = { render: render, bind: bind, abrirPin: function(m, c){ return abrirPin(m,c); }, fecharPin: function(c){ return fecharPin(c); }, onKeyPin: onKeyPin };
}(typeof self !== 'undefined' ? self : this));
