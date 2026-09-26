// Simple Notes Pro — Desktop: orquestrador fino (domínios em notas.js/tarefas.js/config.js)
document.addEventListener('DOMContentLoaded', function () {
var S = window.snDesktop;
if (!S) { document.body.innerHTML='<div style="padding:40px;color:#fff">'+(window.I18N?window.I18N.T('Erro: preload não carregou.'):'Erro: preload não carregou.')+'</div>'; return; }
var $ = function(s){ return document.querySelector(s); };
var shell=$('#shell'), mainNotas=$('#mainNotas'), painelTarefas=$('#painelTarefas'), painelConfig=$('#painelConfig'), painelIA=$('#painelIA');
var grid=$('#grid'); if(!grid){ console.error('DOM incompleto'); return; }

var store={ notas:[], listas:[], pastas:[], tarefas:[], chaveIA:'', config:null };
var config=null;
var view='todas', pastaAtiva=null, query='';
var saveTimer=null, syncTimer=null;
var iaHistorico=[];

function uid(){ return Math.random().toString(36).slice(2,10); }
function locale(){ var l=(window.I18N&&window.I18N.idiomaAtual)?window.I18N.idiomaAtual():'pt'; return l==='en'?'en-US':(l==='es'?'es-ES':'pt-BR'); }
function hoje(){ return new Date().toLocaleDateString(locale()); }
function toast(msg, ms){ var t=$('#toast'); if(!t) return; t.textContent=msg; t.classList.add('show'); setTimeout(function(){ t.classList.remove('show'); }, ms||2200); if(window.Movimento) window.Movimento.toast('#toast'); }
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

var btnMin=$('#btnMin'), btnMax=$('#btnMax'), btnFechar=$('#btnFechar');
if(btnMin) btnMin.onclick=function(){ S.minimizar(); };
if(btnMax) btnMax.onclick=function(){ S.maximizar(); };
if(btnFechar) btnFechar.onclick=function(){ S.fechar(); };

function aplicarTema(){ var dark=!config || config.temaEscuro!==false; document.documentElement.setAttribute('data-tema', dark?'dark':'light'); }

function showView(v){
  if(v==='tarefas'){ hideAll(); if(painelTarefas) painelTarefas.style.display='flex'; if(window.Movimento) window.Movimento.viewIn('#painelTarefas'); }
  else if(v==='config'){ hideAll(); if(painelConfig) painelConfig.style.display='flex'; if(window.Movimento) window.Movimento.viewIn('#painelConfig'); }
  else if(v==='ia'){ hideAll(); if(painelIA) painelIA.style.display='flex'; if(window.Movimento) window.Movimento.viewIn('#painelIA'); }
  else { hideAllNotas(); }
}
function hideAll(){
  if(mainNotas) mainNotas.style.display='none';
  if(painelTarefas) painelTarefas.style.display='none';
  if(painelConfig) painelConfig.style.display='none';
  if(painelIA) painelIA.style.display='none';
  var ed=$('#editor'); if(ed) ed.style.display='none';
  if(shell) shell.classList.remove('editor-aberto');
}
function hideAllNotas(){
  if(mainNotas) mainNotas.style.display='flex';
  if(painelTarefas) painelTarefas.style.display='none';
  if(painelConfig) painelConfig.style.display='none';
  if(painelIA) painelIA.style.display='none';
}

// --- Modais que substituem prompt() bloqueado no Electron ---
var pastaEmGestao=null, idsMoverPendentes=null, idsApagarPendentes=null, cbApagarPos=null;
function abrirModalNovaPasta(){
  var ov=document.getElementById('modalPasta'); if(!ov) return;
  pastaEmGestao=null;
  document.getElementById('modalPastaTitulo').textContent=T('Nova pasta');
  document.getElementById('modalPastaSub').textContent=T('Digite o nome da nova pasta');
  var inp=document.getElementById('modalPastaInput'); inp.value='';
  document.getElementById('modalPastaAcoesExtras').style.display='none';
  document.getElementById('modalPastaOk').textContent=T('Criar');
  ov.style.display='flex'; setTimeout(function(){ inp.focus(); }, 50);
  if(window.Movimento) window.Movimento.modalIn('.modal-card');
}
function abrirGerirPasta(pasta){
  var ov=document.getElementById('modalPasta'); if(!ov) return;
  pastaEmGestao=pasta;
  document.getElementById('modalPastaTitulo').textContent=T('Gerenciar pasta');
  document.getElementById('modalPastaSub').textContent=T('Renomeie a pasta ou exclua (notas voltam para Todas)');
  var inp=document.getElementById('modalPastaInput'); inp.value=pasta.nome;
  document.getElementById('modalPastaAcoesExtras').style.display='flex';
  document.getElementById('modalPastaOk').textContent=T('Salvar nome');
  ov.style.display='flex'; setTimeout(function(){ inp.focus(); inp.select(); }, 50);
}
function fecharModalPasta(){ var ov=document.getElementById('modalPasta'); if(ov) ov.style.display='none'; }
function confirmarModalPasta(){
  var nome=(document.getElementById('modalPastaInput').value||'').trim();
  if(!nome){ toast(T('Digite um nome')); return; }
  if(pastaEmGestao){
    pastaEmGestao.nome=nome; salvarLocal(); renderNotas(); toast(T('Pasta renomeada'));
  } else {
    store.pastas.push({ id: uid(), nome: nome }); salvarLocal(); renderNotas(); toast(T('Pasta criada'));
  }
  fecharModalPasta();
}
function excluirPastaEmGestao(){
  if(!pastaEmGestao) return;
  var nome=pastaEmGestao.nome, id=pastaEmGestao.id;
  fecharModalPasta();
  // confirmação simples (confirm nativo funciona no renderer, mas usamos modal para ser consistente)
  var ok = window.confirm ? confirm(Tf('Excluir pasta "{nome}"? Notas voltam para Todas.', { nome: nome })) : true;
  if(!ok) return;
  // Tombstone da PASTA: sem isso o celular recria a pasta a cada pull (o merge
  // a vê como "só-local"). Também tomba o detach — remoto sem pastaId vence.
  if(window.Tombstones) window.Tombstones.registrar(id);
  store.pastas=store.pastas.filter(function(x){return x.id!==id;});
  (store.notas||[]).forEach(function(n){ if(n.pastaId===id) delete n.pastaId; });
  (store.listas||[]).forEach(function(l){ if(l.pastaId===id) delete l.pastaId; });
  if(pastaAtiva===id){ pastaAtiva=null; view='todas'; var tv=document.getElementById('tituloView'); if(tv) tv.textContent=T('Todas'); document.querySelectorAll('.nav-item').forEach(function(x){x.classList.toggle('ativo', x.dataset.view==='todas');}); }
  salvarLocal(); renderNotas(); toast(T('Pasta excluída'));
}
function abrirModalMover(idsSet){
  idsMoverPendentes=new Set(idsSet);
  var ov=document.getElementById('modalMover'); if(!ov) return;
  var sub=document.getElementById('modalMoverSub');
  sub.textContent=Tf('Mover {n} item(ns) para:', { n: idsMoverPendentes.size });
  var sel=document.getElementById('modalMoverSelect');
  var html='<option value="">'+esc(T('Sem pasta (Todas)'))+'</option>';
  (store.pastas||[]).forEach(function(p){ html+='<option value="'+p.id+'">'+esc(p.nome)+'</option>'; });
  sel.innerHTML=html;
  ov.style.display='flex';
  if(window.Movimento) window.Movimento.modalIn('.modal-card');
}
function fecharModalMover(){ var ov=document.getElementById('modalMover'); if(ov) ov.style.display='none'; idsMoverPendentes=null; }
function confirmarModalMover(){
  if(!idsMoverPendentes) return;
  var pastaId=document.getElementById('modalMoverSelect').value || undefined;
  var ids=new Set(idsMoverPendentes);
  (store.notas||[]).forEach(function(n){ if(ids.has(n.id)) n.pastaId=pastaId; });
  (store.listas||[]).forEach(function(l){ if(ids.has(l.id)) l.pastaId=pastaId; });
  fecharModalMover();
  try{ if(window.snNotas) window.snNotas.limparSelecao(ctx); }catch(e){}
  salvarLocal(); renderNotas(); toast(T('Movidos'));
}
function abrirModalApagarSelecionados(idsSet, cbPos){
  idsApagarPendentes=new Set(idsSet); cbApagarPos=cbPos||null;
  var ov2=document.getElementById('modalApagarSimples'); if(!ov2) return;
  var T=window.I18N?window.I18N.T:function(s){return s;};
  document.getElementById('modalApagarSimplesMsg').textContent=T('Apagar')+' '+idsApagarPendentes.size+' item(ns)? Esta ação não pode ser desfeita.';
  ov2.style.display='flex';
}
function fecharModalApagarSimples(){ var ov=document.getElementById('modalApagarSimples'); if(ov) ov.style.display='none'; }
function confirmarModalApagarSimples(){
  var pend=idsApagarPendentes; var cb=cbApagarPos;
  fecharModalApagarSimples();
  if(!pend) return;
  var ids=new Set(pend);
  // tombstones: a exclusão viaja no backup e o celular obedece (não ressuscita)
  if(window.Tombstones){ pend.forEach(function(id){ window.Tombstones.registrar(id); }); }
  store.notas=(store.notas||[]).filter(function(n){return !ids.has(n.id);});
  store.listas=(store.listas||[]).filter(function(l){return !ids.has(l.id);});
  idsApagarPendentes=null; cbApagarPos=null;
  try{ if(window.snNotas) window.snNotas.limparSelecao(ctx); }catch(e){}
  salvarLocal(); renderNotas();
  toast(window.I18N?window.I18N.T(T('Excluir')):T('Apagados'));
  if(cb) try{ cb(); }catch(e){}
}
var mAsOv=document.getElementById('modalApagarSimples');
var mAsOk=document.getElementById('modalApagarSimplesOk');
var mAsCancel=document.getElementById('modalApagarSimplesCancelar');
if(mAsOk) mAsOk.addEventListener('click', confirmarModalApagarSimples);
if(mAsCancel) mAsCancel.addEventListener('click', fecharModalApagarSimples);
if(mAsOv) mAsOv.addEventListener('click', function(e){ if(e.target===mAsOv) fecharModalApagarSimples(); });
function abrirModalApagarTudo(){
  var ov=document.getElementById('modalApagar'); if(!ov) return;
  idsApagarPendentes=null; cbApagarPos=null;
  S.googleUsuario().then(function(u){
    var msg=u && u.email ? Tf('Apagar TUDO do PC e da nuvem ({email})? Notas, listas e tarefas serão perdidas. Digite APAGAR para confirmar.', { email: u.email }) : T('Apagar TUDO deste PC (local apenas). Digite APAGAR para confirmar.');
    document.getElementById('modalApagarMsg').textContent=msg;
    document.getElementById('modalApagarInput').value='';
    ov.style.display='flex';
    setTimeout(function(){ var inp=document.getElementById('modalApagarInput'); if(inp) inp.focus(); }, 50);
  }).catch(function(){
    document.getElementById('modalApagarMsg').textContent=T('Apagar TUDO deste PC? Digite APAGAR para confirmar.');
    document.getElementById('modalApagarInput').value='';
    ov.style.display='flex';
    if(window.Movimento) window.Movimento.modalIn('.modal-card');
  });
}
function fecharModalApagar(){ var ov=document.getElementById('modalApagar'); if(ov) ov.style.display='none'; }
function confirmarModalApagar(){
  var v=(document.getElementById('modalApagarInput').value||'').trim().toUpperCase();
  if(v!=='APAGAR'){ toast(T('Digite APAGAR para confirmar')); return; }
  var pend=idsApagarPendentes;
  var cb=cbApagarPos;
  fecharModalApagar();
  if(pend){
    var ids=new Set(pend);
    // tombstones: exclusão viaja no backup (caminho "APAGAR" digitado)
    if(window.Tombstones){ pend.forEach(function(id){ window.Tombstones.registrar(id); }); }
    store.notas=(store.notas||[]).filter(function(n){return !ids.has(n.id);});
    store.listas=(store.listas||[]).filter(function(l){return !ids.has(l.id);});
    idsApagarPendentes=null; cbApagarPos=null;
    try{ if(window.snNotas) window.snNotas.limparSelecao(ctx); }catch(e){}
    salvarLocal(); renderNotas();
    toast(T('Apagados'));
    if(cb) try{ cb(); }catch(e){}
    return;
  }
  // apagar tudo
  executarApagarTudo();
}

var ctx={
  get store(){ return store; }, set store(v){ store=v; },
  get config(){ return config; }, set config(v){ config=v; },
  get view(){ return view; }, set view(v){ view=v; },
  get pastaAtiva(){ return pastaAtiva; }, set pastaAtiva(v){ pastaAtiva=v; },
  get query(){ return query; }, set query(v){ query=v; },
  $, esc: esc, toast: toast, uid: uid, hoje: hoje, S: S, aplicarTema: aplicarTema,
  salvarLocal: salvarLocal, scheduleSave: scheduleSave, salvarConfigPatch: salvarConfigPatch, showView: showView,
  abrirGerirPasta: abrirGerirPasta, abrirMoverSelecionados: abrirModalMover, abrirModalApagarSelecionados: abrirModalApagarSelecionados,
  refreshConta: function(){ return refreshConta(); }
};

var ultimoPushAt=0, autoPollTimer=null, syncPullEmAndamento=false, haMudancasLocais=false;
/**
 * Gravação local = a ÚNICA porta de saída das alterações do PC. Antes de
 * gravar, carimba `dataModificacao` nos itens que realmente mudaram (comparando
 * com o último estado conhecido): é esse carimbo que faz o merge decidir por
 * item quem é o mais novo, em vez de aceitar cegamente o backup da nuvem.
 */
function salvarLocal(){
  try{ if(window.Merge) window.Merge.carimbarAlterados(store); }catch(e){}
  var payload={ notas: store.notas, listas: store.listas, pastas: store.pastas, tarefas: store.tarefas, chaveIA: (config&&config.chaveIA)||'', config: config };
  S.storeSalvar(payload).catch(function(){});
  ultimoPushAt=Date.now();
  haMudancasLocais=true;
  clearTimeout(syncTimer); syncTimer=setTimeout(syncEnviar, 350);
}
function scheduleSave(){ clearTimeout(saveTimer); saveTimer=setTimeout(salvarLocal, 350); }
/** Salva local E sobe para a nuvem na hora — sem esperar o debounce de digitação. */
function salvarEAgora(){ salvarLocal(); clearTimeout(syncTimer); syncEnviar(); }
/** Item pelo id NO MOMENTO do clique: um pull pode ter trocado os objetos. */
function alvoAtual(id){ var t=[].concat(store.notas||[], store.listas||[]); for(var i=0;i<t.length;i++){ if(t[i] && t[i].id===id) return t[i]; } return null; }
async function salvarConfigPatch(patch){
  config=Object.assign({}, config, patch);
  try{ await S.configSalvar(patch); }catch(e){}
  if(patch.temaEscuro!==undefined) aplicarTema();
  ctx.config=config;
  salvarLocal();
}

function renderNotas(){ if(window.snNotas) window.snNotas.render(ctx); }
function renderTarefas(){ if(window.snTarefas) window.snTarefas.render(ctx); }
function renderConfig(){ if(window.snConfig) window.snConfig.render(ctx); }

async function reagendarTarefas(){
  if(window.snTarefas && window.snTarefas.reagendarTodas) return window.snTarefas.reagendarTodas(ctx);
  var fn = window.proximoDisparo || function(){return null;};
  for(var i=0;i<(store.tarefas||[]).length;i++){
    var tt=store.tarefas[i];
    if(tt.concluida){ try{ await S.alarme.cancelar(tt.id);}catch(e){} continue; }
    var q=fn(tt.recorrencia, tt.horario); if(!q) continue;
    try{ await S.alarme.agendar(tt.id, tt.titulo, q, tt.recorrencia, tt.horario);}catch(e){}
  }
}

// Nav
document.querySelectorAll('.nav-item').forEach(function(el){
  el.addEventListener('click', function(){
    document.querySelectorAll('.nav-item').forEach(function(x){ x.classList.remove('ativo'); });
    el.classList.add('ativo'); view=el.dataset.view;
    if(view==='tarefas' || view==='config' || view==='ia'){
      pastaAtiva=null;
      var tv=$('#tituloView'); if(view==='ia'){ showView('ia'); return; }
      if(tv) tv.textContent=el.textContent.trim().split('\n')[0].trim();
      showView(view);
      if(view==='config') renderConfig();
      if(view==='tarefas') renderTarefas();
      return;
    }
    pastaAtiva=null;
    var tv2=$('#tituloView'); if(tv2) tv2.textContent=el.textContent.trim().split('\n')[0].trim();
    showView('notas'); renderNotas();
  });
});
var btnGrid=$('#btnGrid'), btnLista=$('#btnLista');
if(btnGrid) btnGrid.onclick=function(){ btnGrid.classList.add('ativo'); if(btnLista) btnLista.classList.remove('ativo'); var g=$('#grid'); if(g) g.classList.remove('lista'); };
if(btnLista) btnLista.onclick=function(){ btnLista.classList.add('ativo'); if(btnGrid) btnGrid.classList.remove('ativo'); var g=$('#grid'); if(g) g.classList.add('lista'); };
var busca=$('#busca');
if(busca) busca.addEventListener('input', function(){ query=busca.value.trim().toLowerCase(); if(view==='tarefas') renderTarefas(); else if(view==='config') renderConfig(); else if(view==='ia'){} else renderNotas(); });
// Handler único com prioridade determinística: bloqueio > pin > app (elimina corrida de listeners)
document.addEventListener('keydown', function(e){
  // 1) Bloqueio — quando ativo, consome dígitos/Backspace/Enter/Esc e nada mais passa
  if(bloqueioAtivo){
    var isBloqOverlay=document.getElementById('bloqueioOverlay') && document.getElementById('bloqueioOverlay').style.display==='flex';
    if(isBloqOverlay || bloqueioAtivo){ onBloqueioKey(e); return; }
  }
  // 2) PinOverlay — só quando bloqueio não está visível
  var pinOv=document.getElementById('pinOverlay');
  if(pinOv && pinOv.style.display==='flex' && window.snConfig && window.snConfig.onKeyPin){
    var consumiuPin=window.snConfig.onKeyPin(e);
    if(consumiuPin) return;
    // se Esc/Enter não consumido com 4 dígitos, ainda consome para não cair no app
    if(e.key==='Escape' || e.key==='Enter'){ e.preventDefault(); return; }
  }
  // 3) App normal
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='n'){ e.preventDefault(); if(window.snNotas) window.snNotas.nova(ctx); return; }
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='f'){ e.preventDefault(); if(busca) busca.focus(); return; }
  // Ctrl+S salva o editor sem fechar (o push para o Drive sai pelo salvarLocal)
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s'){ e.preventDefault(); if(window.snNotas){ window.snNotas.salvarConteudo(ctx); ctx.toast(T('Salvo · sincronizando…')); } return; }
  if(e.key==='Escape'){
    if(document.getElementById('modalPasta') && document.getElementById('modalPasta').style.display==='flex'){ fecharModalPasta(); return; }
    if(document.getElementById('modalMover') && document.getElementById('modalMover').style.display==='flex'){ fecharModalMover(); return; }
    if(document.getElementById('modalApagar') && document.getElementById('modalApagar').style.display==='flex'){ fecharModalApagar(); return; }
    if(window.alarmeSom) try{ window.alarmeSom.parar(); }catch(err){}
    var at=$('#alarmToast'); if(at) at.style.display='none';
    var ed=$('#editor'); if(ed && ed.style.display!=='none'){ if(window.snNotas) window.snNotas.salvarEFechar(ctx); return; }
    // pinOverlay já tratado acima; fallback caso snConfig ainda não tenha carregado
    if(document.getElementById('pinOverlay') && document.getElementById('pinOverlay').style.display==='flex'){ var ov=document.getElementById('pinOverlay'); if(ov) ov.style.display='none'; return; }
  }
});
var btnNovaPasta=$('#btnNovaPasta');
if(btnNovaPasta) btnNovaPasta.addEventListener('click', function(){ abrirModalNovaPasta(); });
// bindings dos modais
var mPastaOk=document.getElementById('modalPastaOk'), mPastaCancel=document.getElementById('modalPastaCancelar'), mPastaRen=document.getElementById('btnPastaRenomear'), mPastaDel=document.getElementById('btnPastaExcluir');
if(mPastaOk) mPastaOk.addEventListener('click', confirmarModalPasta);
if(mPastaCancel) mPastaCancel.addEventListener('click', fecharModalPasta);
if(mPastaRen) mPastaRen.addEventListener('click', confirmarModalPasta);
if(mPastaDel) mPastaDel.addEventListener('click', excluirPastaEmGestao);
var mpInp=document.getElementById('modalPastaInput'); if(mpInp) mpInp.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); confirmarModalPasta(); } });
document.getElementById('modalPasta').addEventListener('click', function(e){ if(e.target===this) fecharModalPasta(); });
var mMoverOk=document.getElementById('modalMoverOk'), mMoverCancel=document.getElementById('modalMoverCancelar');
if(mMoverOk) mMoverOk.addEventListener('click', confirmarModalMover);
if(mMoverCancel) mMoverCancel.addEventListener('click', fecharModalMover);
document.getElementById('modalMover').addEventListener('click', function(e){ if(e.target===this) fecharModalMover(); });
var mApagarOk=document.getElementById('modalApagarOk'), mApagarCancel=document.getElementById('modalApagarCancelar');
if(mApagarOk) mApagarOk.addEventListener('click', confirmarModalApagar);
if(mApagarCancel) mApagarCancel.addEventListener('click', fecharModalApagar);
var mApagarInp=document.getElementById('modalApagarInput'); if(mApagarInp) mApagarInp.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); confirmarModalApagar(); } });
document.getElementById('modalApagar').addEventListener('click', function(e){ if(e.target===this) fecharModalApagar(); });

// Apagar tudo (igual celular) — usa modal nativo
var btnApagarTudo=document.getElementById('btnApagarTudo');
if(btnApagarTudo) btnApagarTudo.addEventListener('click', async function(){ abrirModalApagarTudo(); });
async function executarApagarTudo(){
  var btn=document.getElementById('btnApagarTudo');
  if(btn){ btn.disabled=true; btn.textContent=T('Apagando…'); }
  try{
    var r=await S.storeApagarTudo();
    if(r && r.ok){
      store={ notas:[], listas:[], pastas:[], tarefas:[], chaveIA:'', config:null };
      config=null;
      // Apagar tudo = recomeço: exclusões e o "já conhecido" do merge também zeram
      try{ if(window.Tombstones) window.Tombstones.limpar(); }catch(e){}
      try{ if(window.Merge) window.Merge.reset(); }catch(e){}
      await S.configSalvar({}).catch(function(){});
      var ed=document.getElementById('editor'); if(ed) ed.style.display='none';
      var sh=document.getElementById('shell'); if(sh) sh.classList.remove('editor-aberto');
      if(window.snNotas && window.snNotas.limparSelecao) window.snNotas.limparSelecao(ctx);
      renderNotas(); renderTarefas(); renderConfig();
      toast(r.nuvemOk===false ? T('Apagado localmente (nuvem falhou)') : T('Tudo apagado'));
      setTimeout(function(){ location.reload(); }, 900);
    } else toast((r&&r.erro)||T('Falha ao apagar'));
  }catch(e){ toast(String(e.message||e).slice(0,120)); }
  if(btn){ btn.disabled=false; btn.textContent=T('Apagar tudo'); }
}

// Conta / sync
async function refreshConta(){
  try{
    var hasSecret=await S.googleTemSecret().catch(function(){return false;});
    var hs=$('#hintSecret'); if(hs) hs.style.display=hasSecret?'none':'block';
    var u=await S.googleUsuario().catch(function(){return null;});
    var cn=$('#contaNome'), ce=$('#contaEmail'), av=$('#avatar'), sd=$('#syncDot'), st=$('#syncTxt'), bl=$('#btnLogin');
    var cfgN=$('#cfgContaNome'), cfgE=$('#cfgContaEmail'), cfgS=$('#cfgSyncInfo'), cfgL=$('#btnCfgLogin');
    if(u && u.email){
      if(cn) cn.textContent=u.name||u.email;
      if(ce) ce.textContent=u.email;
      if(cfgN) cfgN.textContent=u.name||u.email;
      if(cfgE) cfgE.textContent=u.email;
      if(cfgS) cfgS.textContent=T('Sincronizado com o Drive');
      if(av){ if(u.photo) av.innerHTML='<img src="'+esc(u.photo)+'" alt="">'; else av.textContent=(u.name||u.email||'?').charAt(0).toUpperCase(); }
      if(sd){ sd.style.background='var(--ok)'; sd.style.boxShadow='0 0 0 4px rgba(52,199,89,.18)'; }
      if(st) st.textContent=T('Sincronizado com o Drive');
      if(bl) bl.textContent=T('Sair');
      if(cfgL) cfgL.textContent=T('Sair');
    } else {
      if(cn) cn.textContent=T('Desconectado');
      if(ce) ce.textContent=hasSecret?T('Faça login para vincular ao celular'):T('Configure o client_secret.txt e faça login');
      if(cfgN) cfgN.textContent=T('Desconectado');
      if(cfgE) cfgE.textContent=hasSecret?T('Faça login para vincular ao celular'):T('Configure o client_secret.txt e faça login');
      if(cfgS) cfgS.textContent=T('Local apenas');
      if(av) av.textContent='?';
      if(sd){ sd.style.background='#6E6E73'; sd.style.boxShadow='none'; }
      if(st) st.textContent=T('Local apenas');
      if(bl) bl.textContent=T('Conectar Google');
      if(cfgL) cfgL.textContent=T('Conectar Google');
    }
  }catch(e){ console.error('refreshConta',e); }
}
async function doLoginToggle(){
  var u=await S.googleUsuario().catch(function(){return null;});
  if(u && u.email){ await S.googleSair(); await refreshConta(); renderConfig(); toast(T('Desconectado')); return; }
  var st=$('#syncTxt'); if(st) st.textContent=T('Abrindo navegador…');
  var sd=$('#syncDot'); if(sd) sd.style.background='var(--warn)';
  try{
    var r=await S.googleEntrar();
    if(r && r.type==='success'){ await refreshConta(); renderConfig(); toast(T('Conectado! Sincronizando…')); await syncBaixar(); }
    else if(r && r.type==='cancelled'){ toast(T('Login cancelado')); await refreshConta(); renderConfig(); }
    else { toast(T('Falha no login')); await refreshConta(); renderConfig(); }
  }catch(e){
    var msg=String(e.message||e);
    toast(msg.slice(0, 900), 9000);
    await refreshConta(); renderConfig();
  }
}
var btnLogin=$('#btnLogin'), btnCfgLogin=$('#btnCfgLogin');
if(btnLogin) btnLogin.onclick=doLoginToggle;
if(btnCfgLogin) btnCfgLogin.onclick=doLoginToggle;

/* === Sync helpers — única fonte de verdade do patch de preferências === */
function montarPatchPreferencias(prefs){
  if(!prefs || typeof prefs!=='object') return null;
  var patch={};
  if(prefs.config && typeof prefs.config==='object'){
    for(var k in prefs.config) if(k!=='pinDesbloqueio') patch[k]=prefs.config[k];
  }
  if(typeof prefs.isDark==='boolean') patch.temaEscuro=prefs.isDark;
  return Object.keys(patch).length ? patch : null;
}
/*
 * MARCADOR DO BACKUP NO DRIVE — quem decide se a nuvem mudou é o relógio do
 * SERVIDOR (`modifiedTime`), guardado aqui no aparelho.
 *
 * Antes a comparação era `modifiedTime do Google > ultimaSincronizacao do
 * aparelho`: dois relógios diferentes. Com o PC 2 minutos adiantado, a
 * nuvem nunca parecia "mais nova", o pull automático nunca disparava e o
 * usuário só recebia alteração do celular clicando em Sincronizar. Agora não
 * há relógio de aparelho nenhum no caminho: enquanto o `modifiedTime` do Drive
 * for o mesmo que já vimos, não há nada a fazer.
 */
var META_DRIVE_KEY='sn_drive_meta';
function metaDrive(){ try{ return localStorage.getItem(META_DRIVE_KEY)||null; }catch(e){ return null; } }
function marcarMetaDrive(iso){ if(!iso) return; try{ localStorage.setItem(META_DRIVE_KEY, iso); }catch(e){} }
async function aplicarPreferenciasRemotasDesktop(prefs, metaIso){
  if(!prefs) return false;
  // Só chega aqui quando o backup do Drive mudou (marcador do servidor): o que
  // veio é o estado mais novo da conta. Sem marcador (boot ou falha ao consultar
  // o Drive), aplica apenas se este aparelho nunca sincronizou — assim não há
  // ajuste local recente para perder.
  if(!metaIso){
    var curStore=await S.storeLer().catch(function(){return null;});
    if(curStore && curStore.ultimaSincronizacao) return false;
  }
  var patch=montarPatchPreferencias(prefs);
  if(!patch) return false;
  try{
    var novoCfg=await S.configSalvar(patch);
    config=novoCfg; if(store) store.config=novoCfg; ctx.config=novoCfg;
    if(patch.temaEscuro!==undefined) aplicarTema();
    return true;
  }catch(e){ return false; }
}

/**
 * RECONCILIAÇÃO — caminho ÚNICO de pull (boot, botão Sincronizar e ciclo
 * automático). Antes cada um tinha a sua própria cópia do merge e todas
 * escolhiam o remoto quando o item existia dos dois lados; a edição local feita
 * antes do push chegar era descartada. Agora o merge é por item (o mais novo
 * vence, com tombstones) e o resultado diz se o LOCAL tem algo que a nuvem não
 * tem — aí quem chamou sobe o backup na hora.
 */
async function reconciliarComNuvem(dados, metaIso){
  if(!dados) return { mudou:false, localVenceu:false };
  if(window.Tombstones && Array.isArray(dados.apagados)) window.Tombstones.carregar(dados.apagados);
  await aplicarPreferenciasRemotasDesktop(dados.preferencias, metaIso);
  if(config && dados.chaveIA && !config.chaveIA){
    try{ await S.configSalvar({ chaveIA: dados.chaveIA }); }catch(e){}
    config.chaveIA=dados.chaveIA;
  }
  // ── Captura ANTES do wipe e do merge (pra detectar que o wipe mudou algo) ──
  var antes=JSON.stringify({ n:store.notas, l:store.listas, p:store.pastas, t:store.tarefas });

  // ── WIPE MARKER: "apagar tudo" do outro aparelho ──
  // Sem isto, notas que SÓ existiam no PC sobreviviam ao "apagar tudo"
  // do celular (o celular nem sabia que elas existiam pra criar tombstone).
  // O carimbo `wipeAllAt` no backup diz: "tudo antes deste instante morreu".
  var P=window.PoliticaSync;
  var ultimoWipeVisto=0;
  try{ ultimoWipeVisto=Number(localStorage.getItem('sn_wipe_visto')||0)||0; }catch(e){}
  var wipeAllAt=Number(dados.wipeAllAt||0)||0;
  if(P && wipeAllAt>0 && wipeAllAt>ultimoWipeVisto){
    var antesWipe=store.notas.length+store.listas.length+store.pastas.length+store.tarefas.length;
    var rW=P.aplicarWipe(store.notas, wipeAllAt, 0);
    store.notas=rW.itens;
    store.listas=(P.aplicarWipe(store.listas, wipeAllAt, 0)).itens;
    store.pastas=(P.aplicarWipe(store.pastas, wipeAllAt, 0)).itens;
    store.tarefas=(P.aplicarWipe(store.tarefas, wipeAllAt, 0)).itens;
    try{ localStorage.setItem('sn_wipe_visto', String(wipeAllAt)); }catch(e){}
     console.log('[Sync] WIPE processado: sobreviveram', store.notas.length, 'de', antesWipe, 'itens');
   }
   var mesclar=function(remotos, locais){
    if(window.Merge) return window.Merge.mesclar(remotos, locais);
    return { itens: remotos||[], localVenceu:false };
  };
  var rn=mesclar(dados.notas, store.notas), rl=mesclar(dados.listas, store.listas),
      rp=mesclar(dados.pastas, store.pastas), rt=mesclar(dados.tarefas, store.tarefas);
  var localVenceu = rn.localVenceu||rl.localVenceu||rp.localVenceu||rt.localVenceu;
  store={ notas:rn.itens, listas:rl.itens, pastas:rp.itens, tarefas:rt.itens,
          chaveIA: dados.chaveIA||store.chaveIA||'', config: config,
          ultimaSincronizacao: store.ultimaSincronizacao };
  ctx.store=store;
  // Tudo o que acabou de ser mesclado já é conhecido: não é "mudança local".
  if(window.Merge) window.Merge.registrar(store);
  // Só adota o carimbo do remoto se o local não tem nada pendente — adotá-lo com
  // pendência fazia o app achar que estava em dia e nunca subir a alteração.
  if(!localVenceu && typeof dados.ultimaSincronizacao==='string') store.ultimaSincronizacao=dados.ultimaSincronizacao;
  await S.storeSalvar(store);
  if(metaIso) marcarMetaDrive(metaIso);
  var depois=JSON.stringify({ n:store.notas, l:store.listas, p:store.pastas, t:store.tarefas });
  return { mudou: antes!==depois, localVenceu: localVenceu };
}

async function syncBaixar(mostrarToast, metaIsoConhecido){
  var st=$('#syncTxt'), sd=$('#syncDot');
  if(st) st.textContent=T('Sincronizando…'); if(sd) sd.style.background='var(--warn)';
  try{
    var metaIso=metaIsoConhecido||null;
    if(!metaIso){
      var m=await S.syncMeta().catch(function(){return null;});
      metaIso=(m && m.ok && m.meta && m.meta.modifiedTime)||null;
    }
    var r=await S.syncBaixar();
    if(r && r.ok){
      if(r.dados){
        var rec=await reconciliarComNuvem(r.dados, metaIso);
        await reagendarTarefas();
        renderNotas(); renderTarefas(); renderConfig();
        // Re-marca o marcador com o valor ATUAL do servidor: a nuvem pode ter
        // mudado entre a leitura da meta e o download (o celular enviou nesse
        // intervalo) — sem isso o poll re-puxava o backup inteiro de novo.
        try{ var m2=await S.syncMeta(); if(m2 && m2.ok && m2.meta && m2.meta.modifiedTime) marcarMetaDrive(m2.meta.modifiedTime); }catch(e){}
        if(rec.localVenceu){ if(mostrarToast!==false) toast(T('Enviando suas alterações para o Drive…')); await syncEnviar(); }
        else if(mostrarToast!==false) toast(T('Sincronizado com o celular'));
      } else if(mostrarToast!==false){ toast(T('Nenhum backup no Drive — este PC vira a fonte')); await syncEnviar(); }
    } else if(mostrarToast!==false){ toast((r&&r.erro)||T('Falha ao sincronizar')); }
  }catch(e){ if(mostrarToast!==false) toast(String(e.message||e).slice(0,120)); }
  if(mostrarToast!==false){ await refreshConta(); renderConfig(); }
}
// Anexos (imagens/áudios do celular) que ainda estão como file:// viram data:uri
// baixando do Drive. Tenta: no boot, 20s depois (retry para sync lento) e 1x por
// minuto — barato porque só busca quando existe src file:// no store local.
async function hidratarAnexosSilencioso(){
  try{
    var u=await S.googleUsuario().catch(function(){return null;});
    if(!u || !u.email) return;
    var temFile=false;
    var notas=(store&&store.notas)||[];
    for(var i=0;i<notas.length;i++){ if(String((notas[i]||{}).conteudo||'').indexOf('file://')!==-1){ temFile=true; break; } }
    if(!temFile) return;
    var r=await S.anexosHidratar().catch(function(){return null;});
    if(r && r.ok && r.total>0){
      var lr=await S.storeLer().catch(function(){return null;});
      if(lr && Array.isArray(lr.notas)){
        store.notas=lr.notas;
        // Re-registra o snapshot do Merge: sem isso a próxima edição carimbava
        // TODAS as notas hidratadas como alteradas e subia o backup GIGANTE
        // (base64 embutido) inteiro para o Drive.
        if(window.Merge) window.Merge.registrar(store);
        renderNotas();
      }
      toast(r.total+' anexo(s) baixado(s) do Drive');
    }
  }catch(e){}
}
// Push SERIALIZADO: dois envios simultâneos podiam terminar fora de ordem e o
// mais antigo sobrescrevia o mais novo na nuvem ("minha alteração não salvou").
var pushEmAndamento=false, pushPendente=false;
async function syncEnviar(){
  if(pushEmAndamento){ pushPendente=true; return; }
  pushEmAndamento=true;
  try{
  var u=await S.googleUsuario().catch(function(){return null;});
  if(!u || !u.email) return;
  try{
    var prefsConfig=config ? (function(c){ var o={}; for(var k in c) if(k!=='pinDesbloqueio') o[k]=c[k]; return o; })(config) : null;
    var agoraIso=new Date().toISOString();
    var payload={ notas: store.notas, listas: store.listas, pastas: store.pastas, tarefas: store.tarefas, apagados: (window.Tombstones?window.Tombstones.serializar():[]), chaveIA: (config&&config.chaveIA)||store.chaveIA||'', preferencias: { isDark: config ? config.temaEscuro!==false : true, config: prefsConfig }, ultimaSincronizacao: agoraIso };
    var r=await S.syncEnviar(payload).catch(function(){return null;});
    if(r && r.ok){
      try{ await S.storeSalvar({ ultimaSincronizacao: agoraIso }); store.ultimaSincronizacao=agoraIso; }catch(e){}
      marcarMetaDrive(r.modifiedTime);   // a nuvem agora é ESTE envio: não puxar de volta
      ultimoPushAt=Date.now();
      haMudancasLocais=false;
      var st=$('#syncTxt'), sd=$('#syncDot'); if(st) st.textContent=T('Sincronizado com o Drive'); if(sd) sd.style.background='var(--ok)'; var cs=$('#cfgSyncInfo'); if(cs) cs.textContent=Tf('Sincronizado com o Drive · {hora}', { hora: new Date().toLocaleTimeString(locale()) });
    } else {
      // falhou: o que estava na memória continua pendente e volta a subir
      haMudancasLocais=true;
      var sd2=$('#syncDot'); if(sd2){ sd2.style.background='var(--bad)'; }
      var st2=$('#syncTxt'); if(st2) st2.textContent=T('Falha ao enviar — tentando de novo');
      clearTimeout(syncRetryTimer); syncRetryTimer=setTimeout(syncEnviar, 15000);
    }
  }catch(e){ haMudancasLocais=true; }
  } finally {
    pushEmAndamento=false;
    if(pushPendente){ pushPendente=false; syncEnviar(); }
  }
}
var syncRetryTimer=null;
function iniciarAutoSync(){
  if(autoPollTimer) clearInterval(autoPollTimer);
  autoPollTimer=setInterval(async function(){
    if(syncPullEmAndamento) return;
    // Sem `document.hidden`: o app vive na bandeja e a janela escondida é o caso
    // NORMAL de uso — era aí que a sincronização parava.
    if(Date.now()-ultimoPushAt < 1200) return;
    // PULL-FIRST: mesmo com mudança local pendente, PUXA antes de subir.
    // Antes era DIRTY-FIRST (subia e pulava o pull): isso SOBRESCREVIA
    // exclusões que o celular tinha acabado de subir, sem nunca ver os
    // tombstones. O merge já protege notas locais mais novas
    // (`dataModificacao` + `localVenceu`), então puxar é seguro:
    // a nota recém-criada no PC sobrevive ao merge e é enviada depois.
    try{
      var u2=await S.googleUsuario().catch(function(){return null;});
      if(!u2 || !u2.email) return;
      var metaRes=await S.syncMeta().catch(function(){return null;});
      if(!metaRes || !metaRes.ok || !metaRes.meta || !metaRes.meta.modifiedTime) return;
      var remotoIso=metaRes.meta.modifiedTime;
      if(remotoIso!==metaDrive()){   // a nuvem mudou desde a última vez que vimos
        syncPullEmAndamento=true;
        var rr=await S.syncBaixar().catch(function(){return null;});
        if(rr && rr.ok && rr.dados){
          var rec=await reconciliarComNuvem(rr.dados, remotoIso);
          if(rec.localVenceu){
            // O merge manteve versão local mais nova: sobe agora, senão ela ficaria
            // só neste PC para sempre (a nuvem "já estava em dia" para o poll).
            haMudancasLocais=false;
            ultimoPushAt=Date.now();
            syncEnviar();
          } else if(rec.mudou){ await reagendarTarefas(); renderNotas(); renderTarefas(); renderConfig(); }
          // puxou nota nova com anexo? hidrata já — não espera o ciclo de 60s
          hidratarAnexosSilencioso();
        }
      }
      // Mudança local pendente? Sobe AGORA (DEPOIS do pull — nunca antes)
      if(haMudancasLocais){
        haMudancasLocais=false;
        ultimoPushAt=Date.now();
        syncEnviar();
      }
    }catch(e){} finally { syncPullEmAndamento=false; }
  }, 3000);
}
var btnSync=$('#btnSync'), btnCfgSync=$('#btnCfgSync');
if(btnSync) btnSync.onclick=function(){ return syncBaixar(); };
if(btnCfgSync) btnCfgSync.onclick=function(){ return syncBaixar(); };
// ao voltar o foco para a janela, puxa na hora se o Drive tem algo mais novo
window.addEventListener('focus', function(){
  if(Date.now()-ultimoPushAt < 1000) return;
  S.syncMeta().then(function(m){
    if(m && m.ok && m.meta && m.meta.modifiedTime && m.meta.modifiedTime!==metaDrive()) syncBaixar(false, m.meta.modifiedTime);
  }).catch(function(){});
});

// ---- Bloqueio PIN ----
var bloqueioTimer=null, bloqueioAtivo=false, bloqueioBuffer='';
function deveBloquear(){ return !!(config && config.exigirBiometriaApp && config.pinDesbloqueio && config.pinDesbloqueio.length===4); }
function mostrarBloqueio(){
  if(!deveBloquear() || bloqueioAtivo) return;
  bloqueioAtivo=true; bloqueioBuffer='';
  var ov=$('#bloqueioOverlay'); if(!ov) return;
  ov.style.display='flex';
  montarBloqueioPad();
  atualizarBloqueioDots();
  setTimeout(function(){ var c=document.querySelector('#bloqueioOverlay .bloqueio-card'); if(c) c.focus(); }, 80);
}
function esconderBloqueio(){
  bloqueioAtivo=false; bloqueioBuffer='';
  var ov=$('#bloqueioOverlay'); if(ov) ov.style.display='none';
}
function onBloqueioKey(e){
  if(!bloqueioAtivo) return false;
  var consumiu=false;
  if(e.key>='0' && e.key<='9'){
    if(bloqueioBuffer.length<4){ bloqueioBuffer+=e.key; atualizarBloqueioDots(); if(bloqueioBuffer.length===4) setTimeout(verificarBloqueio, 180); }
    consumiu=true;
  } else if(e.key==='Backspace'){
    bloqueioBuffer=bloqueioBuffer.slice(0,-1); atualizarBloqueioDots(); consumiu=true;
  } else if(e.key==='Escape'){
    consumiu=true; // não fecha bloqueio — precisa PIN, mas consome Esc
  } else if(e.key==='Enter'){
    if(bloqueioBuffer.length===4) verificarBloqueio(); consumiu=true;
  }
  if(consumiu) e.preventDefault();
  return consumiu;
}
function montarBloqueioPad(){
  var pad=$('#bloqueioPad'); if(!pad) return;
  pad.innerHTML='';
  var keys=['1','2','3','4','5','6','7','8','9','','0','⌫'];
  keys.forEach(function(k){
    if(k===''){ var d=document.createElement('div'); pad.appendChild(d); return; }
    var b=document.createElement('button'); b.className='pin-key'; b.textContent=k;
    b.addEventListener('click', function(){
      if(k==='⌫'){ bloqueioBuffer=bloqueioBuffer.slice(0,-1); atualizarBloqueioDots(); return; }
      if(bloqueioBuffer.length>=4) return;
      bloqueioBuffer+=k; atualizarBloqueioDots();
      if(bloqueioBuffer.length===4) setTimeout(verificarBloqueio, 180);
    });
    pad.appendChild(b);
  });
}
function atualizarBloqueioDots(){
  var dots=$('#bloqueioDots'); if(!dots) return;
  var ds=dots.querySelectorAll('.pin-dot');
  ds.forEach(function(d,i){ d.classList.toggle('on', i < bloqueioBuffer.length); });
}
function verificarBloqueio(){
  if(bloqueioBuffer===config.pinDesbloqueio){
    esconderBloqueio();
    agendarBloqueio();
    toast(T('Desbloqueado'));
  } else {
    toast(T('PIN incorreto'));
    bloqueioBuffer=''; atualizarBloqueioDots();
    var card=document.querySelector('#bloqueioOverlay .bloqueio-card');
    if(card){ card.classList.remove('pin-shake'); void card.offsetWidth; card.classList.add('pin-shake'); }
  }
}
function agendarBloqueio(){
  clearTimeout(bloqueioTimer);
  if(!deveBloquear()) return;
  var ms=(config.tempoBloqueio||0)*60*1000;
  if(ms<=0) return;
  bloqueioTimer=setTimeout(function(){ if(document.hasFocus && !document.hasFocus()) mostrarBloqueio(); }, ms);
}
window.addEventListener('blur', function(){
  if(!deveBloquear()) return;
  var t=config.tempoBloqueio||0;
  if(t===0){ setTimeout(function(){ if(!document.hasFocus || !document.hasFocus()) mostrarBloqueio(); }, 400); }
  else { agendarBloqueio(); }
});
window.addEventListener('focus', function(){
  if(!bloqueioAtivo && deveBloquear() && config.tempoBloqueio!==0) agendarBloqueio();
});
document.addEventListener('visibilitychange', function(){
  if(document.hidden && deveBloquear()){
    if((config.tempoBloqueio||0)===0) setTimeout(function(){ mostrarBloqueio(); }, 500);
    else agendarBloqueio();
  }
});

// ---- IA Chat ----
function iaAppend(papel, texto, isErro){
  var hist=$('#iaHistorico'); if(!hist) return;
  var div=document.createElement('div');
  div.className='ia-msg '+(papel==='usuario'?'user':'ia')+(isErro?' erro':'');
  div.textContent=texto;
  hist.appendChild(div);
  hist.scrollTop=hist.scrollHeight;
}
async function iaEnviar(){
  var inp=$('#iaInput'); if(!inp) return;
  var pergunta=inp.value.trim(); if(!pergunta) return;
  inp.value='';
  iaAppend('usuario', pergunta);
  iaHistorico.push({papel:'usuario', texto: pergunta});
  var loading=document.createElement('div'); loading.className='ia-msg ia'; loading.textContent=T('Pensando…'); loading.id='iaLoading';
  var hist=$('#iaHistorico'); if(hist) { hist.appendChild(loading); hist.scrollTop=hist.scrollHeight; }
  var chave=(config&&config.chaveIA)||store.chaveIA||'';
  try{
    var iaLib=window.iaDesktop;
    if(!iaLib){ throw new Error(T('IA não carregada')); }
    // Alvos de edição: notas + listas com ids — a IA propõe, o app confirma.
    if(iaLib.definirAlvos) iaLib.definirAlvos([].concat(store.notas||[], store.listas||[]));
    var res=await iaLib.perguntar(pergunta, store.notas||[], store.tarefas||[], chave, iaHistorico);
    var el=document.getElementById('iaLoading'); if(el) el.remove();
    // A resposta pode conter proposta de edição (bloco ```json) — separa
    // o texto da conversa e mostra o cartão de confirmação.
    var extra={proposta:null, textoLimpo:res.texto};
    if(iaLib.extrairPropostaEdicao) extra=iaLib.extrairPropostaEdicao(res.texto);
    iaAppend('ia', extra.textoLimpo||res.texto, false);
    iaHistorico.push({papel:'ia', texto: res.texto});
    if(extra.proposta) mostrarPropostaEdicao(extra.proposta);
    // Sem bloco JSON, mas foi uma ORDEM de edição: oferece aplicar o texto na
    // nota aberta (nunca aplica sozinho — o usuário decide).
    else if(res.ordemEdicao) mostrarSugestaoEdicao(extra.textoLimpo||res.texto);
  }catch(e){
    var el2=document.getElementById('iaLoading'); if(el2) el2.remove();
    iaAppend('ia', T('Erro: ')+String(e.message||e).slice(0,200), true);
  }
}

// ---- Proposta de edição da IA (cartão de confirmação no chat) ----
function mostrarPropostaEdicao(proposta){
  var hist=$('#iaHistorico'); if(!hist) return;
  var alvo=null;
  var todos=[].concat(store.notas||[], store.listas||[]);
  for(var i=0;i<todos.length;i++){ if(todos[i].id===proposta.alvo){ alvo=todos[i]; break; } }
  var ehLista=alvo && Array.isArray(alvo.itens);
  if(!alvo && proposta.conteudo && !proposta.itens){ /* sem alvo válido: não aplica cegamente */ }
  if(!alvo){ iaAppend('ia',T('Não encontrei a nota/lista que a IA indicou para editar.'),true); return; }
  var card=document.createElement('div');
  card.className='ia-proposta';
  var prev=ehLista
    ? (proposta.itens||[]).map(function(it){ return (it.concluido?'☑ ':'☐ ')+it.texto; }).join('\n')
    : String(proposta.conteudo||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,220)+'…';
  card.innerHTML=
    '<div class="ia-proposta-head">✏️ <b>'+esc(Tf(ehLista?'Quer editar esta lista: {titulo}':'Quer editar esta nota: {titulo}', { titulo: alvo.titulo||T('Sem título') }))+'</b></div>'+
    (proposta.explicacao?'<div class="ia-proposta-exp"></div>':'')+
    (proposta.titulo&&proposta.titulo!==(alvo.titulo||'')?'<div class="ia-proposta-tit"></div>':'')+
    '<pre class="ia-proposta-prev"></pre>'+
    '<div class="ia-proposta-acoes">'+
      '<button class="btn prim" data-act="ok">'+esc(T('Aplicar edição'))+'</button>'+
      '<button class="btn ghost" data-act="no">'+esc(T('Não permitir'))+'</button>'+
    '</div>';
  var exp=card.querySelector('.ia-proposta-exp'); if(exp) exp.textContent=proposta.explicacao||'';
  var tit=card.querySelector('.ia-proposta-tit'); if(tit) tit.textContent=T('Título novo: ')+(proposta.titulo||'');
  var prevEl=card.querySelector('.ia-proposta-prev'); if(prevEl) prevEl.textContent=prev||'—';
  var btnOk=card.querySelector('[data-act="ok"]'), btnNo=card.querySelector('[data-act="no"]');
  btnOk.addEventListener('click', function(){
    if(!aplicarPropostaEdicao(proposta, alvo, ehLista)) return;   // alvo sumiu: não fecha o cartão
    card.remove();
    var fim=document.createElement('div'); fim.className='ia-msg ia'; fim.textContent=T('✅ Edição aplicada.'); hist.appendChild(fim); hist.scrollTop=hist.scrollHeight;
  });
  btnNo.addEventListener('click', function(){ card.remove(); });
  hist.appendChild(card);
  hist.scrollTop=hist.scrollHeight;
}

/** Foto do item ANTES da edição — permite "Cancelar alteração da IA" depois. */
function fotoParaDesfazer(alvo, ehLista){
  return {
    id: alvo.id,
    ehLista: ehLista,
    titulo: alvo.titulo,
    conteudo: ehLista ? null : String(alvo.conteudo||''),
    itens: ehLista ? (alvo.itens||[]).map(function(it){ return { id:it.id, texto:it.texto, concluido:!!it.concluido }; }) : null,
  };
}
/** Texto puro da IA -> HTML simples (parágrafos), para aplicar na nota aberta. */
function textoParaHtml(texto){
  return String(texto||'').split(/\n+/).map(function(l){ return l.trim(); }).filter(Boolean)
    .map(function(l){ return '<p>'+esc(l.replace(/^[-*•]\s+/,'• '))+'</p>'; }).join('');
}
/** Recarrega o painel do editor se o item alterado estiver aberto nele. */
function recarregarEditorSeAberto(id){
  try{
    var e=window.snNotas && window.snNotas.getEdit && window.snNotas.getEdit();
    if(e && e.id===id) window.snNotas.abrir(ctx, e.kind, id);
  }catch(err){}
}
/** Cria a linha "Cancelar alteração da IA" no fim do chat. */
function mostrarBotaoDesfazer(foto){
  var hist=$('#iaHistorico'); if(!hist) return;
  var antigo=hist.querySelector('.ia-desfazer'); if(antigo) antigo.remove();
  var row=document.createElement('div');
  row.className='ia-desfazer';
  row.innerHTML='<button class="btn ghost" data-act="undo">'+esc(T('↩️ Cancelar alteração da IA'))+'</button>';
  row.querySelector('[data-act="undo"]').addEventListener('click', function(){
    var alvo=alvoAtual(foto.id);
    if(!alvo){ toast(T('Item não encontrado')); return; }
    alvo.titulo=foto.titulo;
    if(foto.ehLista && foto.itens) alvo.itens=foto.itens;
    else if(!foto.ehLista) alvo.conteudo=foto.conteudo||'';
    salvarEAgora();   // o cancelamento também volta para a nuvem na hora
    try{ if(window.snNotas) window.snNotas.render(ctx); }catch(e){}
    recarregarEditorSeAberto(foto.id);
    row.remove();
    var fim=document.createElement('div'); fim.className='ia-msg ia'; fim.textContent=T('↩️ Alteração cancelada — voltou ao que era.');
    hist.appendChild(fim); hist.scrollTop=hist.scrollHeight;
    toast(T('Alteração da IA cancelada'));
  });
  hist.appendChild(row);
  hist.scrollTop=hist.scrollHeight;
}

/** Sem bloco JSON: a IA só escreveu texto — oferece aplicar na NOTA ABERTA. */
function mostrarSugestaoEdicao(texto){
  var hist=$('#iaHistorico'); if(!hist) return;
  var e=null; try{ e=window.snNotas && window.snNotas.getEdit && window.snNotas.getEdit(); }catch(err){}
  if(!e || e.kind!=='nota'){
    iaAppend('ia',T('A IA não devolveu a edição pronta. Abra a nota que deseja alterar e peça de novo.'),true);
    return;
  }
  var alvo=null, notas=store.notas||[];
  for(var i=0;i<notas.length;i++){ if(notas[i].id===e.id){ alvo=notas[i]; break; } }
  if(!alvo) return;
  var card=document.createElement('div');
  card.className='ia-proposta';
  card.innerHTML=
    '<div class="ia-proposta-head">✨ <b>'+esc(Tf('Aplicar este texto na nota: {titulo}', { titulo: alvo.titulo||T('Sem título') }))+'</b></div>'+
    '<pre class="ia-proposta-prev"></pre>'+
    '<div class="ia-proposta-acoes">'+
      '<button class="btn prim" data-act="ok">'+esc(T('Permitir'))+'</button>'+
      '<button class="btn ghost" data-act="no">'+esc(T('Não permitir'))+'</button>'+
    '</div>';
  card.querySelector('.ia-proposta-prev').textContent=String(texto||'').replace(/<[^>]+>/g,' ').slice(0,400);
  card.querySelector('[data-act="ok"]').addEventListener('click', function(){
    var item=alvoAtual(alvo.id) || alvo;   // pull no meio do caminho troca o objeto
    var foto=fotoParaDesfazer(item,false);
    item.conteudo=textoParaHtml(texto); item.data=hoje();
    salvarEAgora();   // a edição da IA vai para a nuvem na hora
    try{ if(window.snNotas) window.snNotas.render(ctx); }catch(err){}
    recarregarEditorSeAberto(item.id);
    card.remove();
    var fim=document.createElement('div'); fim.className='ia-msg ia'; fim.textContent=T('✅ Texto aplicado na nota.');
    hist.appendChild(fim); hist.scrollTop=hist.scrollHeight;
    toast(T('IA editou: ')+(item.titulo||T('Nota')));
    mostrarBotaoDesfazer(foto);
  });
  card.querySelector('[data-act="no"]').addEventListener('click', function(){ card.remove(); });
  hist.appendChild(card);
  hist.scrollTop=hist.scrollHeight;
}

function aplicarPropostaEdicao(proposta, alvo, ehLista){
  // O cartão pode ter ficado aberto enquanto um pull chegava: pega o item pelo
  // id na hora de aplicar, senão a edição cairia num objeto órfão e sumiria.
  var item=alvoAtual(alvo && alvo.id) || alvo;
  if(!item){ toast(T('Item não encontrado')); return false; }
  var foto=fotoParaDesfazer(item, ehLista);
  if(proposta.titulo && String(proposta.titulo).trim()) item.titulo=String(proposta.titulo).trim();
  if(ehLista && Array.isArray(proposta.itens)){
    item.itens=proposta.itens.map(function(it){ return { id: uid(), texto: it.texto, concluido: !!it.concluido }; });
  } else if(!ehLista && proposta.conteudo){
    // ia.js devolve o conteúdo já pronto: mídia original preservada, sem frases
    // da IA, sem repetir o título e garantidamente em HTML.
    item.conteudo = (window.iaDesktop && window.iaDesktop.conteudoAplicado)
      ? window.iaDesktop.conteudoAplicado(proposta.conteudo, item.titulo, item.id, foto.titulo)
      : String(proposta.conteudo);
    item.data=hoje();
  }
  salvarEAgora();   // a edição da IA vai para a nuvem na hora
  try{ if(window.snNotas) window.snNotas.render(ctx); }catch(e){}
  recarregarEditorSeAberto(item.id);
  toast(T('IA editou: ')+(item.titulo||T('Nota')));
  mostrarBotaoDesfazer(foto);
  return true;
}
var btnIaEnviar=$('#btnIaEnviar'), iaInput=$('#iaInput');
if(btnIaEnviar) btnIaEnviar.addEventListener('click', iaEnviar);
if(iaInput) iaInput.addEventListener('keydown', function(e){ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); iaEnviar(); } });

// ---- Alarme som + toast ----
function mostrarAlarme(payload){
  var at=$('#alarmToast'), atT=$('#alarmTitulo'), atH=$('#alarmHora');
  if(atT) atT.textContent=payload.titulo||T('Tarefa');
  if(atH) atH.textContent=(payload.recorrencia||'')+(payload.horario?' · '+payload.horario:'');
  if(at){ at.style.display='flex'; at.classList.add('tocando'); }
  if(window.Movimento) window.Movimento.alarmeIn('#alarmToast');
  var som=(config&&config.somAlarme)||'classico';
  if(window.alarmeSom) try{ window.alarmeSom.tocar(som); }catch(e){}
}
function fecharAlarme(){
  var at=$('#alarmToast'); if(at){ at.style.display='none'; at.classList.remove('tocando'); }
  if(window.alarmeSom) try{ window.alarmeSom.parar(); }catch(e){}
}
if(S.onAlarme) S.onAlarme(function(payload){ mostrarAlarme(payload); });
var alarmOkEl=$('#alarmOk'), alarmFecharEl=$('#alarmFechar'), alarmSonecaEl=$('#alarmSoneca');
if(alarmOkEl) alarmOkEl.addEventListener('click', fecharAlarme);
if(alarmFecharEl) alarmFecharEl.addEventListener('click', fecharAlarme);
if(alarmSonecaEl) alarmSonecaEl.addEventListener('click', async function(){
  var atT=$('#alarmTitulo'); var titulo=atT?atT.textContent:''; var tt=(store.tarefas||[]).find(function(x){ return x.titulo===titulo; });
  var mins=(config&&config.tempoSoneca)||10;
  if(tt){ var q=Date.now()+mins*60*1000; try{ await S.alarme.agendar(tt.id, tt.titulo, q, T('Uma vez'), tt.horario);}catch(e){} toast(T('Soneca: ')+mins+' min'); }
  fecharAlarme();
});

async function carregar(){
  try{
    store=await S.storeLer();
    config=store.config || await S.configLer().catch(function(){return null;}) || store.config;
    if(!config) config={ temaEscuro:true, idioma:'pt', chaveIA:'', pinDesbloqueio:'', exigirBiometriaApp:false, tempoBloqueio:0, tempoSoneca:10, somAlarme:'classico', exibirAjudaFAB:true };
    if(store.chaveIA && !config.chaveIA) config.chaveIA=store.chaveIA;
  }catch(e){ console.error('storeLer',e); store={notas:[],listas:[],pastas:[],tarefas:[],chaveIA:'',config:null}; config={ temaEscuro:true, idioma:'pt', chaveIA:'', pinDesbloqueio:'', exigirBiometriaApp:false, tempoBloqueio:0, tempoSoneca:10, somAlarme:'classico' }; }
  store.notas=Array.isArray(store.notas)?store.notas:[]; store.listas=Array.isArray(store.listas)?store.listas:[]; store.pastas=Array.isArray(store.pastas)?store.pastas:[]; store.tarefas=Array.isArray(store.tarefas)?store.tarefas:[]; 
  aplicarTema();
  // idioma: aplica antes do primeiro render (I18N traduz o HTML estático)
  if(window.I18N) window.I18N.definir(config.idioma||'pt');
  // Estado inicial é "o que já está aqui": o merge é quem decide o que a nuvem
  // acrescenta. Antes o boot SUBSTITUÍA o store inteiro pelo backup — nota
  // criada offline/não logado era apagada ao abrir o app logado.
  if(window.Merge) window.Merge.registrar(store);
  // Exclusões antigas (>60 dias) já circularam por todos os aparelhos: limpa para
  // o registro não crescer para sempre.
  try{ if(window.Tombstones) window.Tombstones.podar(); }catch(e){}
  var u=await S.googleUsuario().catch(function(){return null;});
  if(u && u.email){ try{
    var m0=await S.syncMeta().catch(function(){return null;});
    var metaIso0=(m0 && m0.ok && m0.meta && m0.meta.modifiedTime)||null;
    if(metaIso0 && metaIso0!==metaDrive()){
      var r=await S.syncBaixar();
      if(r && r.ok && r.dados){
        var rec=await reconciliarComNuvem(r.dados, metaIso0);
        if(rec.localVenceu) await syncEnviar();
      }
    }
  }catch(e){ console.error('syncBaixar inicial',e); } }
  await reagendarTarefas();
  renderNotas(); renderTarefas(); renderConfig();
  if(deveBloquear()) mostrarBloqueio();
  else agendarBloqueio();
}

// Liga domínios
if(window.snNotas && window.snNotas.bind) window.snNotas.bind(ctx);
if(window.snTarefas && window.snTarefas.bind) window.snTarefas.bind(ctx);
if(window.snConfig && window.snConfig.bind) window.snConfig.bind(ctx);
var btnCopiar=document.getElementById('btnCopiarRedirect');
if(btnCopiar) btnCopiar.onclick=function(){ var el=document.getElementById('hintRedirectUri'); var v=el?el.textContent.trim():''; if(!v) return; if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(function(){ toast(T('URI copiado: ')+v); }).catch(function(){ toast(v); }); else toast(v); };

(async function(){ try{ await refreshConta(); await carregar(); iniciarAutoSync(); document.addEventListener('visibilitychange', function(){ if(!document.hidden) iniciarAutoSync(); }); await hidratarAnexosSilencioso(); setTimeout(hidratarAnexosSilencioso, 20000); setInterval(hidratarAnexosSilencioso, 60000); if(window.Movimento){ window.Movimento.entrada(); window.Movimento.stagger('#grid', '.card', { y: 24, each: 0.035 }); } }catch(e){ console.error('boot',e); } })();
});
