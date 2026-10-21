// AÇÕES DA IA (desktop) — executor do protocolo {"acoes":[...]}.
//
// O NotaIA responde com um bloco ```json {"acoes":[...]} ``` propondo
// operações (criar nota/lista/tarefa/pasta, mover, fixar, apagar, lembretes).
// O app mostra o cartão de confirmação e SÓ quando o usuário permite chama
// executar() — cada ação muta o store PELO MESMO CAMINHO da UI (shapes
// idênticos, Tombstones nas exclusões, alarme agendado nas tarefas) e
// salvarEAgora() sobe para a nuvem na hora: o celular recebe tudo igual a
// qualquer ação manual. A IA NUNCA aplica nada sozinha.
(function(root){
  function _t(extra, s){ return (extra && typeof extra.T === 'function') ? extra.T(s) : s; }
  var tem = function(v){ return typeof v === 'string' && v.trim().length > 0; };

  var TIPOS_VALIDOS = ['criar_nota','editar_nota','criar_lista','editar_lista','apagar_nota','fixar_nota','criar_tarefa','concluir_tarefa','apagar_tarefa','criar_pasta','apagar_pasta','mover_para_pasta','lembrete_nota'];
  var MAX_ACOES = 10;
  var DIAS_VALIDOS = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

  function semAcento(s){ return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }
  function normRecorrencia(v){
    var s = semAcento(v||'').trim();
    if(!s) return 'Uma vez';
    if(/^(uma vez|once|unic[oa]|one time)$/.test(s)) return 'Uma vez';
    if(/^(diari[oa]|daily|todo dia|todos os dias|cada dia)$/.test(s)) return 'Diária';
    var dias = [/^domingo|^sunday/, /^segunda|^monday/, /^terca|^tuesday/, /^quarta|^wednesday/, /^quinta|^thursday/, /^sexta|^friday/, /^sabado|^saturday/];
    var vals = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
    for(var i=0;i<dias.length;i++) if(dias[i].test(s)) return vals[i];
    return 'Uma vez';
  }
  function normHorario(v){
    var m = String(v==null?'':v).match(/(\d{1,2})[:h](\d{2})/);
    if(!m) return '09:00';
    var h = Math.min(23, Math.max(0, parseInt(m[1],10)));
    var mi = Math.min(59, Math.max(0, parseInt(m[2],10)));
    return (h<10?'0':'')+h+':'+(mi<10?'0':'')+mi;
  }
  function normLembrete(v){
    if(!v || typeof v!=='object') return null;
    var tipo = v.tipo==='dias' ? 'dias' : (v.tipo==='semana' ? 'semana' : 'data');
    var out = { tipo: tipo, horario: normHorario(v.horario) };
    if(tipo==='data'){
      var m = String(v.data==null?'':v.data).match(/(\d{4})-(\d{2})-(\d{2})/);
      if(!m) return null;
      out.data = m[1]+'-'+m[2]+'-'+m[3];
    } else if(tipo==='dias'){
      var n = Number(v.intervaloDias);
      if(!isFinite(n) || n<1 || n>365) return null;
      out.intervaloDias = Math.floor(n);
    } else {
      var dias = [];
      (Array.isArray(v.diasSemana)?v.diasSemana:[]).forEach(function(d){
        var achou = null;
        for(var i=0;i<DIAS_VALIDOS.length;i++) if(semAcento(DIAS_VALIDOS[i])===semAcento(d)) achou = DIAS_VALIDOS[i];
        if(achou && dias.indexOf(achou)===-1) dias.push(achou);
      });
      if(!dias.length) return null;
      out.diasSemana = dias;
    }
    return out;
  }

  /** Extrai todos os objetos/arrays JSON de nível superior, respeitando strings. */
  function blocosJson(texto){
    var s = String(texto||'');
    var out = [], inicio = -1, prof = 0, emString = false, escape = false;
    for(var i=0;i<s.length;i++){
      var ch = s.charAt(i);
      if(emString){
        if(escape) escape = false;
        else if(ch === '\\') escape = true;
        else if(ch === '"') emString = false;
        continue;
      }
      if(ch === '"'){ emString = true; continue; }
      if(ch === '{' || ch === '['){
        if(prof === 0) inicio = i;
        prof++;
      } else if(ch === '}' || ch === ']'){
        if(prof > 0){
          prof--;
          if(prof === 0 && inicio >= 0){ out.push(s.slice(inicio, i+1)); inicio = -1; }
        }
      }
    }
    return out;
  }

  /** Aceita {"acoes":[...]}, {"tipo":...}, {"acao":{...}} ou um array solto. */
  function listaDeAcoes(obj){
    if(Array.isArray(obj)) return obj;
    if(obj && Array.isArray(obj.acoes)) return obj.acoes;
    if(obj && Array.isArray(obj.actions)) return obj.actions;
    if(obj && obj.acao && typeof obj.acao === 'object') return [obj.acao];
    if(obj && obj.action && typeof obj.action === 'object') return [obj.action];
    if(obj && typeof obj.tipo === 'string') return [obj];
    return null;
  }

  function normalizarTipo(v){
    return String(v||'').replace(/([a-z])([A-Z])/g,'$1_$2').toLowerCase().replace(/[\s-]+/g,'_');
  }

  /** Extrai e valida o bloco {"acoes":[...]} — acoes null se não veio. */
  function extrairAcoes(texto){
    var bruto = String(texto||'');
    var blocos = blocosJson(bruto);
    var validas = [], usados = [], vistas = {};
    for(var c=0;c<blocos.length;c++){
      var cand = blocos[c];
      try{
        var obj = JSON.parse(cand);
        var lista = listaDeAcoes(obj);
        if(!lista || !lista.length) continue;
        var achou = false;
        for(var i=0;i<lista.length;i++){
          var a = lista[i];
          if(!a || typeof a!=='object') continue;
          // Modelo free pode mandar camelCase ("editarLista") — normaliza.
          a.tipo = normalizarTipo(a.tipo);
          if(TIPOS_VALIDOS.indexOf(a.tipo)===-1) continue;
          var ok =
            (a.tipo==='criar_nota' && tem(a.titulo)) ||
            (a.tipo==='editar_nota' && tem(a.alvo)) ||
            (a.tipo==='criar_lista' && tem(a.titulo)) ||
            (a.tipo==='editar_lista' && tem(a.alvo)) ||
            (a.tipo==='apagar_nota' && tem(a.alvo)) ||
            (a.tipo==='fixar_nota' && tem(a.alvo)) ||
            (a.tipo==='criar_tarefa' && tem(a.titulo)) ||
            (a.tipo==='concluir_tarefa' && tem(a.alvo)) ||
            (a.tipo==='apagar_tarefa' && tem(a.alvo)) ||
            (a.tipo==='criar_pasta' && tem(a.nome)) ||
            (a.tipo==='apagar_pasta' && (tem(a.nome) || tem(a.alvo))) ||
            (a.tipo==='mover_para_pasta' && Array.isArray(a.alvos) && a.alvos.length>0) ||
            (a.tipo==='lembrete_nota' && tem(a.alvo));
          if(ok){
            var chave = JSON.stringify(a);
            if(!vistas[chave]){ vistas[chave]=1; validas.push(a); }
            achou = true;
          }
        }
        if(achou) usados.push(cand);
      }catch(e){ /* JSON inválido — próximo bloco */ }
    }
    if(validas.length){
      var limpo = bruto;
      for(var u=0;u<usados.length;u++) limpo = limpo.split(usados[u]).join('');
      // Remove cercas que ficaram vazias (```json ... ```).
      limpo = limpo.replace(/```(?:json)?\s*```/gi,'').replace(/```(?:json)?/gi,'').trim();
      return { acoes: validas.slice(0,MAX_ACOES), textoLimpo: limpo };
    }
    // Mesmo inválido, nunca mostrar o JSON cru para o usuário.
    var limpoFalha = bruto;
    for(var b=0;b<blocos.length;b++){
      try{
        var o = JSON.parse(blocos[b]);
        var l = listaDeAcoes(o);
        if(l && l.length) limpoFalha = limpoFalha.split(blocos[b]).join('');
      }catch(e){}
    }
    limpoFalha = limpoFalha.replace(/```(?:json)?\s*```/gi,'').replace(/```(?:json)?/gi,'').trim();
    return { acoes: null, textoLimpo: limpoFalha };
  }

  function tituloDoId(store, id){
    var todos = [].concat(store.notas||[], store.listas||[], store.tarefas||[]);
    for(var i=0;i<todos.length;i++) if(todos[i] && todos[i].id===id) return todos[i].titulo || 'Sem título';
    return '?';
  }

  /** Linha legível da ação pro cartão de confirmação. */
  function resumoAcao(a, store){
    var nome = function(id){ return tituloDoId(store, id); };
    switch(a.tipo){
      case 'criar_nota': { var s='📝 '+_t2('Criar nota')+' "'+a.titulo+'"'; if(a.pasta) s+=' '+_t2('na pasta')+' "'+a.pasta+'"'; if(a.lembrete) s+=' 🔔'; if(a.fixar) s+=' 📌'; return s; }
      case 'editar_nota': return '✏️ '+_t2('Editar nota')+' "'+nome(a.alvo)+'"';
      case 'criar_lista': return '📋 '+_t2('Criar lista')+' "'+a.titulo+'"'+((a.itens&&a.itens.length)?' ('+a.itens.length+' '+_t2('itens')+')':'')+(a.pasta?' '+_t2('na pasta')+' "'+a.pasta+'"':'');
      case 'editar_lista': return '✏️ '+_t2('Editar lista')+' "'+nome(a.alvo)+'"';
      case 'apagar_nota': return '🗑 '+_t2('Apagar')+' "'+nome(a.alvo)+'"';
      case 'fixar_nota': return '📌 '+(a.valor===false?_t2('Desafixar'):_t2('Fixar'))+' "'+nome(a.alvo)+'"';
      case 'criar_tarefa': return '⏰ '+_t2('Criar tarefa')+' "'+a.titulo+'" — '+normRecorrencia(a.recorrencia)+' '+_t2('às')+' '+normHorario(a.horario);
      case 'concluir_tarefa': return '✔️ '+(a.valor===false?_t2('Reabrir'):_t2('Concluir'))+' "'+nome(a.alvo)+'"';
      case 'apagar_tarefa': return '🗑 '+_t2('Apagar tarefa')+' "'+nome(a.alvo)+'"';
      case 'criar_pasta': return '📁 '+_t2('Criar pasta')+' "'+a.nome+'"';
    case 'apagar_pasta': return '🗑 '+_t2('Apagar pasta')+' "'+(a.nome||a.alvo)+'"';
      case 'mover_para_pasta': return '➡️ '+_t2('Mover')+' '+(a.alvos?a.alvos.length:0)+' '+_t2('item(ns) para')+' '+(a.pasta?'"'+a.pasta+'"':_t2('a lista principal'));
      case 'lembrete_nota': return a.lembrete ? '🔔 '+_t2('Lembrar da nota')+' "'+nome(a.alvo)+'"' : '🔕 '+_t2('Remover lembrete (só no celular)')+' "'+nome(a.alvo)+'"';
    }
    return '• '+a.tipo;
  }
  var _t2 = function(s){ return s; }; // substituído por T real quando resumoAcoes é chamado com extra
  function resumoAcoes(acoes, store, extra){
    if(extra && typeof extra.T==='function'){ var T=extra.T; _t2=function(s){ return T(s); }; }
    return (acoes||[]).map(function(a){ return resumoAcao(a, store); });
  }

  /** Resolve o NOME da pasta → id (cria se não existir). null = lista principal. */
  function resolverPastaId(ctx, nome, resultados, extra){
    if(nome===null) return null;
    var alvo = String(nome==null?'':nome).trim();
    if(!alvo) return undefined;
    var pastas = (ctx.store.pastas||[]);
    for(var i=0;i<pastas.length;i++){
      if(semAcento(pastas[i].nome||'').trim() === semAcento(alvo).trim()) return pastas[i].id;
    }
    var novoId = ctx.uid();
    ctx.store.pastas.push({ id: novoId, nome: alvo, dataModificacao: Date.now() });
    resultados.push('✅ '+_t(extra,'Pasta criada')+': "'+alvo+'"');
    return novoId;
  }

  function encontrar(arr, id){ arr = arr||[]; for(var i=0;i<arr.length;i++) if(arr[i] && arr[i].id===id) return arr[i]; return null; }

  /**
   * Executa as ações confirmadas. ctx = o ctx do app.js (store, uid, hoje, S,
   * toast); extra = {salvarEAgora, renderNotas, renderTarefas, T} (locais do
   * app.js). Devolve lista de linhas de resultado pro chat.
   */
  async function executar(acoes, ctx, extra){
    var resultados = [];
    var notaParaAbrir = null, listaParaAbrir = null;
    // Pasta criada neste mesmo lote: as notas/listas seguintes sem "pasta"
    // explícita entram nela (ex.: "crie a pasta Poemas e 5 poemas").
    var pastaCriadaNoLote = null;
    var store = ctx.store;
    var iaLib = (typeof root!=='undefined' && root.iaDesktop) || (typeof window!=='undefined' && window.iaDesktop) || null;
    function T(s){ return _t(extra, s); }

    // conteúdo tratado (falas da IA fora, notação → HTML, mídia preservada)
    function conteudoFinal(conteudo, titulo, notaId, tituloAntigo){
      if(iaLib && iaLib.conteudoAplicado) return iaLib.conteudoAplicado(String(conteudo||''), titulo, notaId, tituloAntigo);
      return String(conteudo||'');
    }

    for(var k=0;k<(acoes||[]).length;k++){
      var a = acoes[k];
      try{
        if(a.tipo==='criar_nota'){
          var titulo = String(a.titulo||'').trim();
          var id = ctx.uid();
          var pastaId = (a.pasta !== undefined && String(a.pasta).trim() !== '')
            ? resolverPastaId(ctx, a.pasta, resultados, extra)
            : (pastaCriadaNoLote ? pastaCriadaNoLote.id : undefined);
          store.notas.unshift({ id: id, titulo: titulo, conteudo: conteudoFinal(a.conteudo, titulo, id, undefined), data: ctx.hoje(), fixada: !!a.fixar, pastaId: pastaId||undefined });
          if(!notaParaAbrir) notaParaAbrir = id; // primeiro criado (ex.: Poema 1)
          if(a.lembrete) await lembreteComoTarefa(ctx, extra, '🔔 '+titulo, a.lembrete, store, resultados);
          resultados.push('✅ '+T('Nota criada')+': "'+titulo+'"'+(a.lembrete?' 🔔':''));

        } else if(a.tipo==='editar_nota'){
          var nota = encontrar(store.notas, a.alvo);
          if(!nota){ resultados.push('⚠️ '+T('Nota não encontrada')+' ('+a.alvo+')'); continue; }
          var novoTitulo = tem(a.titulo) ? String(a.titulo).trim() : nota.titulo;
          if(tem(a.conteudo)) nota.conteudo = conteudoFinal(a.conteudo, novoTitulo, nota.id, nota.titulo);
          nota.titulo = novoTitulo;
          notaParaAbrir = nota.id;
          resultados.push('✅ '+T('Nota atualizada')+': "'+novoTitulo+'"');

        } else if(a.tipo==='criar_lista'){
          var itens = (Array.isArray(a.itens)?a.itens:[]).filter(function(it){ return it && tem(it.texto); })
            .map(function(it){ return { id: ctx.uid(), texto: String(it.texto).trim(), concluido: !!it.concluido }; });
          var lId = ctx.uid();
          var lPasta = (a.pasta !== undefined && String(a.pasta).trim() !== '')
            ? resolverPastaId(ctx, a.pasta, resultados, extra)
            : (pastaCriadaNoLote ? pastaCriadaNoLote.id : undefined);
          (store.listas||(store.listas=[])).unshift({ id: lId, titulo: String(a.titulo||'').trim()||T('Nova lista'), itens: itens, data: ctx.hoje(), fixada: false, pastaId: lPasta||undefined });
          if(!listaParaAbrir) listaParaAbrir = lId;
          resultados.push('✅ '+T('Lista criada')+': "'+a.titulo+'" ('+itens.length+' '+T('itens')+')');

        } else if(a.tipo==='editar_lista'){
          var lista = encontrar(store.listas, a.alvo);
          if(!lista){ resultados.push('⚠️ '+T('Lista não encontrada')+' ('+a.alvo+')'); continue; }
          if(tem(a.titulo)) lista.titulo = String(a.titulo).trim();
          if(Array.isArray(a.itens)) lista.itens = a.itens.filter(function(it){ return it && tem(it.texto); })
            .map(function(it){ return { id: ctx.uid(), texto: String(it.texto).trim(), concluido: !!it.concluido }; });
          listaParaAbrir = lista.id;
          resultados.push('✅ '+T('Lista atualizada')+': "'+lista.titulo+'"');

        } else if(a.tipo==='apagar_nota'){
          var vitimaN = encontrar(store.notas, a.alvo);
          var vitimaL = encontrar(store.listas, a.alvo);
          var vitima = vitimaN || vitimaL;
          if(!vitima){ resultados.push('⚠️ '+T('Item não encontrado')+' ('+a.alvo+')'); continue; }
          if(root.Tombstones && root.Tombstones.tombarItem) root.Tombstones.tombarItem(vitima.id, vitima);
          if(vitimaN) store.notas.splice(store.notas.indexOf(vitimaN), 1);
          else store.listas.splice(store.listas.indexOf(vitimaL), 1);
          resultados.push('🗑 '+T('Apagada')+': "'+(vitima.titulo||T('Sem título'))+'"');

        } else if(a.tipo==='fixar_nota'){
          var alvoFix = encontrar(store.notas, a.alvo) || encontrar(store.listas, a.alvo);
          if(!alvoFix){ resultados.push('⚠️ '+T('Item não encontrado')+' ('+a.alvo+')'); continue; }
          alvoFix.fixada = a.valor !== false;
          resultados.push('📌 '+(alvoFix.fixada?T('Fixada'):T('Desafixada'))+': "'+(alvoFix.titulo||'')+'"');

        } else if(a.tipo==='criar_tarefa'){
          var rec = normRecorrencia(a.recorrencia);
          var hor = normHorario(a.horario);
          var tId = ctx.uid();
          (store.tarefas||(store.tarefas=[])).unshift({ id: tId, titulo: String(a.titulo||'').trim(), recorrencia: rec, horario: hor, concluida: false });
          agendarTarefa(ctx, tId, String(a.titulo||''), rec, hor);
          resultados.push('✅ '+T('Tarefa criada')+': "'+a.titulo+'" — '+rec+' '+T('às')+' '+hor);

        } else if(a.tipo==='concluir_tarefa'){
          var tarefa = encontrar(store.tarefas, a.alvo);
          if(!tarefa){ resultados.push('⚠️ '+T('Tarefa não encontrada')+' ('+a.alvo+')'); continue; }
          var quer = a.valor !== false;
          if(!!tarefa.concluida !== quer){
            tarefa.concluida = quer;
            if(quer){ try{ await ctx.S.alarme.cancelar(tarefa.id); }catch(e){} }
            else agendarTarefa(ctx, tarefa.id, tarefa.titulo, tarefa.recorrencia, tarefa.horario);
          }
          resultados.push((quer?'✔️ ':'↩️ ')+(quer?T('Tarefa concluída'):T('Tarefa reaberta'))+': "'+tarefa.titulo+'"');

        } else if(a.tipo==='apagar_tarefa'){
          var tDel = encontrar(store.tarefas, a.alvo);
          if(!tDel){ resultados.push('⚠️ '+T('Tarefa não encontrada')+' ('+a.alvo+')'); continue; }
          try{ await ctx.S.alarme.cancelar(tDel.id); }catch(e){}
          if(root.Tombstones && root.Tombstones.tombarItem) root.Tombstones.tombarItem(tDel.id, tDel);
          store.tarefas.splice(store.tarefas.indexOf(tDel), 1);
          resultados.push('🗑 '+T('Tarefa apagada')+': "'+tDel.titulo+'"');

        } else if(a.tipo==='criar_pasta'){
          var novaPasta = { id: ctx.uid(), nome: String(a.nome||'').trim(), dataModificacao: Date.now() };
          store.pastas.push(novaPasta);
          pastaCriadaNoLote = novaPasta;
          resultados.push('✅ '+T('Pasta criada')+': "'+a.nome+'"');

        } else if(a.tipo==='apagar_pasta'){
          var alvoPasta = String(a.alvo||a.nome||'').trim();
          var pastaApagar = null;
          for(var pi=0; pi<(store.pastas||[]).length; pi++){
            var pAtual = store.pastas[pi];
            if(!pAtual) continue;
            if(String(pAtual.id)===alvoPasta || semAcento(pAtual.nome||'').trim()===semAcento(alvoPasta).trim()){ pastaApagar=pAtual; break; }
          }
          if(!pastaApagar){ resultados.push('⚠️ '+T('Pasta não encontrada')+' ('+alvoPasta+')'); continue; }
          var nomePastaApagada = pastaApagar.nome || '';
          try{ if(window.Tombstones) window.Tombstones.tombarItem(pastaApagar.id, pastaApagar); }catch(e){}
          store.pastas = (store.pastas||[]).filter(function(p){ return p.id !== pastaApagar.id; });
          (store.notas||[]).forEach(function(n){ if(n.pastaId===pastaApagar.id) delete n.pastaId; });
          (store.listas||[]).forEach(function(l){ if(l.pastaId===pastaApagar.id) delete l.pastaId; });
          if(pastaCriadaNoLote && pastaCriadaNoLote.id===pastaApagar.id) pastaCriadaNoLote=null;
          resultados.push('🗑 '+T('Pasta apagada')+': "'+nomePastaApagada+'"');

        } else if(a.tipo==='mover_para_pasta'){
          var pastaId2 = a.pasta ? resolverPastaId(ctx, a.pasta, resultados, extra) : null;
          var movidos = 0;
          (Array.isArray(a.alvos)?a.alvos:[]).forEach(function(id){
            var item = encontrar(store.notas, id) || encontrar(store.listas, id);
            if(item){ item.pastaId = pastaId2 || undefined; movidos++; }
          });
          resultados.push('✅ '+movidos+' '+T('item(ns) movido(s) para')+' '+(a.pasta?'"'+a.pasta+'"':T('a lista principal')));

        } else if(a.tipo==='lembrete_nota'){
          var notaAlvo = encontrar(store.notas, a.alvo);
          if(!notaAlvo){ resultados.push('⚠️ '+T('Nota não encontrada')+' ('+a.alvo+')'); continue; }
          if(!a.lembrete){ resultados.push('ℹ️ '+T('Remoção de lembrete de nota vale só no celular.')); continue; }
          var lem = normLembrete(a.lembrete);
          if(!lem){ resultados.push('⚠️ '+T('Lembrete inválido — use data (yyyy-mm-dd), intervalo de dias ou dias da semana, com horário HH:MM')); continue; }
          await lembreteComoTarefa(ctx, extra, '🔔 '+(notaAlvo.titulo||T('Sem título')), lem, store, resultados);
        }
      }catch(e){
        resultados.push('⚠️ '+a.tipo+': '+String((e&&e.message)||e).slice(0,80));
      }
    }

    // Um único save + push imediato + re-render: a nuvem recebe na hora.
    try{ if(extra && extra.salvarEAgora) extra.salvarEAgora(); }catch(e){}
    try{ if(extra && extra.renderNotas) extra.renderNotas(); }catch(e){}
    try{ if(extra && extra.renderTarefas) extra.renderTarefas(); }catch(e){}
    try{ resultados.notaId = notaParaAbrir; resultados.listaId = listaParaAbrir; }catch(e){}
    return resultados;
  }

  /** Agenda o alarme de uma tarefa (mesmo caminho do botão "+ tarefa"). */
  function agendarTarefa(ctx, id, titulo, recorrencia, horario){
    try{
      var prox = (typeof root!=='undefined' && root.proximoDisparo) || (typeof window!=='undefined' && window.proximoDisparo) || null;
      var q = prox ? prox(recorrencia, horario) : null;
      if(q) ctx.S.alarme.agendar(id, titulo, q, recorrencia, horario).catch(function(e){ console.error(e); });
    }catch(e){}
  }

  /** No PC, lembrete de nota vira TAREFA com alarme (comportamento documentado do app). */
  async function lembreteComoTarefa(ctx, extra, tituloTarefa, lem, store, resultados){
    if(extra && typeof extra.T==='function') T_ = extra.T;
    var criadas = [];
    function novaTarefa(rec, hor, quando){
      var id = ctx.uid();
      (store.tarefas||(store.tarefas=[])).unshift({ id: id, titulo: tituloTarefa, recorrencia: rec, horario: hor, concluida: false });
      try{
        var prox = (typeof root!=='undefined' && root.proximoDisparo) || (typeof window!=='undefined' && window.proximoDisparo) || null;
        var q = quando || (prox ? prox(rec, hor) : null);
        if(q) ctx.S.alarme.agendar(id, tituloTarefa, q, rec, hor).catch(function(e){});
      }catch(e){}
      criadas.push(id);
    }
    if(lem.tipo==='data'){
      var quando = new Date(lem.data+'T'+lem.horario+':00');
      if(quando.getTime() <= Date.now()) quando = new Date(quando.getTime() + 86400000);
      novaTarefa('Uma vez', lem.horario, quando.getTime());
    } else if(lem.tipo==='dias'){
      novaTarefa('Uma vez', lem.horario, Date.now() + (lem.intervaloDias*86400000));
    } else {
      (lem.diasSemana||[]).forEach(function(dia){ novaTarefa(dia, lem.horario, null); });
    }
    var quandoTxt = lem.tipo==='data' ? lem.data : (lem.tipo==='dias' ? (T_('a cada')+' '+lem.intervaloDias+' '+T_('dias')) : (lem.diasSemana||[]).join(', '));
    resultados.push('🔔 '+T_('Lembrete criado como tarefa')+' "'+tituloTarefa+'" — '+quandoTxt+' '+T_('às')+' '+lem.horario);
  }
  var T_ = function(s){ return s; }; // T real é injetado via extra em executar()

  root.snIaAcoes = { extrairAcoes: extrairAcoes, resumoAcoes: resumoAcoes, executar: executar };
})(typeof self!=='undefined'?self:this);
