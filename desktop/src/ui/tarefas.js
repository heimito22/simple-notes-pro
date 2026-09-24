// Domínio Tarefas — sem dono de estado, recebe ctx (store/config/S/…)
(function (root) {
  // ATENÇÃO: estes valores são PERSISTIDOS (t.recorrencia) — nunca traduza a lista.
  // A tradução acontece só na exibição (T(d)).
  var DIAS = [T('Uma vez'),T('Diária'),T('Segunda'),T('Terça'),T('Quarta'),T('Quinta'),T('Sexta'),T('Sábado'),T('Domingo')];
  var diaSel = T('Diária');
  function render(ctx) {
    var store = ctx.store, query = ctx.query, esc = ctx.esc, toast = ctx.toast, $ = ctx.$;
    var c1 = $('#cntTodas'), c2 = $('#cntFix'), c3 = $('#cntTar');
    if (c1) c1.textContent = String((store.notas||[]).length + (store.listas||[]).length);
    if (c2) c2.textContent = String((store.notas||[]).filter(function(n){return n.fixada;}).length + (store.listas||[]).filter(function(l){return l.fixada;}).length);
    if (c3) c3.textContent = String((store.tarefas||[]).length);
    var sub = $('#tarefasSub'); if (sub) sub.textContent = Tf('{n} tarefas', { n: (store.tarefas||[]).length });
    var diasEl = $('#tarefaDias');
    if (diasEl) {
      diasEl.innerHTML = '';
      DIAS.forEach(function(d){
        var b=document.createElement('button'); b.className='tarefa-dia'+(diaSel===d?' ativo':''); b.textContent=T(d);
        b.onclick=function(){ diaSel=d; render(ctx); };
        diasEl.appendChild(b);
      });
    }
    var listaEl=$('#tarefaLista'), prog=$('#tarefaProgress'), fill=$('#tarefaFill');
    if(window.Movimento) window.Movimento.stagger('#tarefaDias', '.tarefa-dia', { y: 12, each: 0.03, scale: 0.9, duration: 0.3 });
    if(!listaEl) return;
    var total=(store.tarefas||[]).length, concl=(store.tarefas||[]).filter(function(t){return t.concluida;}).length;
    if(prog&&fill){ if(!total) prog.style.display='none'; else { prog.style.display='block'; fill.style.width=Math.max(4,(concl/total)*100)+'%'; } }
    var arr=[].concat(store.tarefas||[]);
    if(query) arr=arr.filter(function(t){ return String(t.titulo||'').toLowerCase().indexOf(query)!==-1; });
    arr.sort(function(a,b){ return Number(!!a.concluida)-Number(!!b.concluida); });
    listaEl.innerHTML='';
    if(!arr.length){ listaEl.innerHTML='<div class="empty" style="padding:28px"><b>'+esc(T('Tudo limpo por aqui!'))+'</b><span>'+esc(T('Adicione sua primeira tarefa acima — o alarme toca no horário mesmo com o app minimizado.'))+'</span></div>'; return; }
    arr.forEach(function(t){
      var row=document.createElement('div'); row.className='tarefa-card'+(t.concluida?' concluida':'');
      row.innerHTML='<div class="tarefa-check '+(t.concluida?'on':'')+'">'+(t.concluida?'✓':'')+'</div><div class="tarefa-info"><b>'+esc(t.titulo)+'</b><small>'+esc(T(t.recorrencia))+' · '+esc(t.horario)+'</small></div><button class="tarefa-del" title="'+esc(T('Excluir'))+'">🗑</button>';
      row.querySelector('.tarefa-check').addEventListener('click', function(){
        t.concluida=!t.concluida;
        if(t.concluida) ctx.S.alarme.cancelar(t.id).catch(function(){});
        else { var q=(root.proximoDisparo||function(){return null;})(t.recorrencia,t.horario); if(q) ctx.S.alarme.agendar(t.id,t.titulo,q,t.recorrencia,t.horario).catch(function(){}); }
        ctx.salvarLocal(); render(ctx); toast(t.concluida?T('Concluída'):T('Reaberta'));
      });
      row.querySelector('.tarefa-del').addEventListener('click', function(){
        if(!confirm(Tf('Excluir tarefa "{nome}"?', { nome: t.titulo }))) return;
        ctx.S.alarme.cancelar(t.id).catch(function(){});
        ctx.store.tarefas = (ctx.store.tarefas||[]).filter(function(x){ return x.id!==t.id; });
        // tombstone: sem isto o celular "ressuscita" a tarefa no próximo pull
        if(window.Tombstones) window.Tombstones.registrar(t.id);
        ctx.salvarLocal(); render(ctx); toast(T('Tarefa excluída'));
      });
      listaEl.appendChild(row);
    });
    if(window.Movimento) window.Movimento.stagger('#tarefaLista', '.tarefa-card', { y: 18, each: 0.03 });
  }
  function bind(ctx) {
    var $=ctx.$;
    var btnAdd=$('#btnAddTarefa'), elTitulo=$('#tarefaTitulo'), elHora=$('#tarefaHora'), btnTeste=$('#btnTesteAlarme');
    if(btnAdd) btnAdd.addEventListener('click', function(){
      var titulo=(elTitulo&&elTitulo.value.trim())||''; if(!titulo){ ctx.toast(T('Digite o título da tarefa')); return; }
      var horario=(elHora&&elHora.value)||'09:00'; var id=ctx.uid(); var nova={ id: id, titulo: titulo, recorrencia: diaSel, horario: horario, concluida:false };
      ctx.store.tarefas.unshift(nova);
      var q=(root.proximoDisparo||function(){return null;})(nova.recorrencia,nova.horario);
      if(q) ctx.S.alarme.agendar(id,titulo,q,nova.recorrencia,horario).catch(function(e){ console.error(e); });
      ctx.salvarLocal(); render(ctx); if(elTitulo) elTitulo.value=''; ctx.toast(T('Tarefa criada · alarme agendado'));
    });
    if(btnTeste) btnTeste.addEventListener('click', function(){
      var titulo=(elTitulo&&elTitulo.value.trim())||T('Lembrete teste');
      ctx.S.alarme.testar(titulo).then(function(){ ctx.toast(T('Notificação + som disparados')); }).catch(function(e){ ctx.toast(String(e.message||e).slice(0,120)); });
    });
    // alarme:disparou é tratado em app.js (som + toast) — não duplicar aqui
  }
  async function reagendarTodas(ctx){
    for(var i=0;i<(ctx.store.tarefas||[]).length;i++){
      var tt=ctx.store.tarefas[i];
      if(tt.concluida){ try{ await ctx.S.alarme.cancelar(tt.id);}catch(e){} continue; }
      var q=(root.proximoDisparo||function(){return null;})(tt.recorrencia, tt.horario);
      if(!q) continue;
      try{ await ctx.S.alarme.agendar(tt.id, tt.titulo, q, tt.recorrencia, tt.horario);}catch(e){}
    }
  }
  root.snTarefas = { render: function(c){ return render(c); }, bind: bind, reagendarTodas: function(c){ return reagendarTodas(c); }, getDiaSel: function(){ return diaSel; }, setDiaSel: function(v){ diaSel=v; } };
}(typeof self !== 'undefined' ? self : this));
