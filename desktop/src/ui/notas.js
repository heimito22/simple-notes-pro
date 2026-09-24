// Domínio Notas/Listas — grid + editor rico contenteditable + seleção + mídia arrastável
(function (root) {
  var edit = null; // { kind:'nota'|'lista', id }
  var selecionados = new Set(); // ids de notas+listas
  var dragListaId = null;

  function filtrados(ctx){
    var q=ctx.query, view=ctx.view, store=ctx.store, pastaAtiva=ctx.pastaAtiva;
    var notas=[].concat(store.notas||[]), listas=[].concat(store.listas||[]);
    if(q){ notas=notas.filter(function(n){ return String(n.titulo||'').toLowerCase().indexOf(q)!==-1 || String(n.conteudo||'').toLowerCase().indexOf(q)!==-1; }); listas=listas.filter(function(l){ return String(l.titulo||'').toLowerCase().indexOf(q)!==-1 || (l.itens||[]).some(function(it){ return String(it.texto).toLowerCase().indexOf(q)!==-1; }); }); }
    if(view==='fixadas'){ notas=notas.filter(function(n){return n.fixada;}); listas=listas.filter(function(l){return l.fixada;}); }
    if(view==='pasta' && pastaAtiva){ notas=notas.filter(function(n){return n.pastaId===pastaAtiva;}); listas=listas.filter(function(l){return l.pastaId===pastaAtiva;}); }
    notas.sort(function(a,b){ return (b.fixada?1:0)-(a.fixada?1:0); }); listas.sort(function(a,b){ return (b.fixada?1:0)-(a.fixada?1:0); });
    return { notas: notas, listas: listas };
  }

  function temMidia(html){
    if(!html) return {img:false,audio:false};
    return { img:/<img/i.test(html), audio:/<audio/i.test(html) };
  }

  function atualizarBarra(ctx){
    var barra=document.getElementById('barraSelecao');
    var cnt=document.getElementById('selecaoCont');
    var hint=document.getElementById('selecaoHint');
    if(!barra) return;
    var n=selecionados.size;
    if(n>0){ barra.classList.add('visivel'); if(cnt) cnt.textContent=n+' selecionado'+(n>1?'s':''); if(hint) hint.textContent=T('Ações em lote'); }
    else { barra.classList.remove('visivel'); }
  }
  function limparSelecao(ctx){ selecionados.clear(); atualizarBarra(ctx); render(ctx); }

  // ---- editor rico helpers ----
  function richEl(){ return document.getElementById('rich'); }
  function isListaEdit(){ return edit && edit.kind==='lista'; }
  function atualizarToolbarEstado(){
    var tb=document.getElementById('editorToolbar'); if(!tb) return;
    var cmds=['bold','italic','underline','strikeThrough','insertUnorderedList','insertOrderedList'];
    cmds.forEach(function(cmd){
      var btn=tb.querySelector('[data-cmd=\"'+cmd+'\"]');
      if(!btn) return;
      try{ var on=document.queryCommandState(cmd); btn.classList.toggle('ativo', !!on); }catch(e){}
    });
  }
  function exec(cmd){
    var r=richEl(); if(!r) return;
    r.focus();
    try{ document.execCommand(cmd, false, null); }catch(e){}
    atualizarToolbarEstado();
    if(edit) persistirRichDebounced();
  }
  var richSaveTimer=null;
  function persistirRichDebounced(){
    clearTimeout(richSaveTimer);
    richSaveTimer=setTimeout(function(){
      if(!edit || edit.kind==='lista') return;
      var r=richEl(); if(!r) return;
      var n=(ctxRef.store.notas||[]).find(function(x){return x.id===edit.id;});
      if(n){ n.conteudo=r.innerHTML; ctxRef.scheduleSave(); }
    }, 320);
  }
  var ctxRef=null;

  function insertHtmlAtCaret(html){
    var r=richEl(); if(!r) return;
    r.focus();
    try{
      if(document.queryCommandSupported && document.queryCommandSupported('insertHTML')){
        document.execCommand('insertHTML', false, html);
      } else {
        var sel=window.getSelection();
        if(sel && sel.getRangeAt && sel.rangeCount){
          var range=sel.getRangeAt(0); range.deleteContents();
          var div=document.createElement('div'); div.innerHTML=html;
          var frag=document.createDocumentFragment(), node, last;
          while((node=div.firstChild)){ last=frag.appendChild(node); }
          range.insertNode(frag);
          if(last){ range.setStartAfter(last); range.collapse(true); sel.removeAllRanges(); sel.addRange(range); }
        } else { r.innerHTML+=html; }
      }
    }catch(e){ r.innerHTML+=html; }
    persistirRichDebounced();
    atualizarToolbarEstado();
  }

  function handleFileImagem(file){
    if(!file || !file.type || file.type.indexOf('image/')!==0) return;
    var reader=new FileReader();
    reader.onload=function(e){
      var dataUrl=e.target.result;
      var html='<img src=\"'+dataUrl.replace(/\"/g,'&quot;')+'\" alt=\"imagem\" style=\"max-width:100%;border-radius:10px;margin:8px 0;display:block\" draggable=\"true\">';
      insertHtmlAtCaret(html+'<br>');
      ctxRef.toast(T('Imagem inserida'));
    };
    reader.readAsDataURL(file);
  }
  function handleFileAudio(file){
    if(!file || file.type.indexOf('audio/')!==0) return;
    var reader=new FileReader();
    reader.onload=function(e){
      var dataUrl=e.target.result;
      var html='<span class=\"audio-wrap\" contenteditable=\"false\" draggable=\"true\" style=\"display:flex;align-items:center;gap:8px;background:var(--bg3);border:1px solid var(--bd);border-radius:10px;padding:8px 10px;margin:8px 0\"><audio controls src=\"'+dataUrl.replace(/\"/g,'&quot;')+'\" style=\"flex:1\"></audio><span style=\"cursor:pointer;color:var(--bad)\" title=\"Remover\" data-audio-del>✕</span></span><br>';
      insertHtmlAtCaret(html);
      ctxRef.toast(T('Áudio inserido'));
    };
    reader.readAsDataURL(file);
  }

  function render(ctx){
    ctxRef=ctx;
    var store=ctx.store, esc=ctx.esc, $=ctx.$;
    var listaPastas=$('#listaPastas');
    if(listaPastas){
      listaPastas.innerHTML='';
      if(!store.pastas.length) listaPastas.innerHTML='<small style=\"color:var(--tx2);padding:6px 8px\">'+esc(T('Nenhuma pasta'))+'</small>';
      else store.pastas.forEach(function(p){
        var nNotas = (store.notas||[]).filter(function(n){return n.pastaId===p.id;}).length + (store.listas||[]).filter(function(l){return l.pastaId===p.id;}).length;
        var div=document.createElement('div'); div.className='pasta-row'+(ctx.pastaAtiva===p.id?' ativo':'');
        div.innerHTML='<svg class="pasta-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg><span class="pasta-nome">'+esc(p.nome)+'</span><span class="cnt">'+nNotas+'</span>';
        div.onclick=function(){ ctx.pastaAtiva=p.id; ctx.view='pasta'; document.querySelectorAll('.nav-item').forEach(function(x){x.classList.remove('ativo');}); var tv=$('#tituloView'); if(tv) tv.textContent=p.nome; ctx.showView('pasta'); render(ctx); };
        div.oncontextmenu=function(e){
          e.preventDefault();
          if(ctx.abrirGerirPasta) ctx.abrirGerirPasta(p);
        };
        div.addEventListener('dblclick', function(){ if(ctx.abrirGerirPasta) ctx.abrirGerirPasta(p); });
        listaPastas.appendChild(div);
      });
    }
    var dados=filtrados(ctx);
    var c1=$('#cntTodas'), c2=$('#cntFix'), c3=$('#cntTar'), sv=$('#subView');
    if(window.Movimento) window.Movimento.stagger('#listaPastas', '.pasta-row', { y: 10, each: 0.04, scale: 0.96, duration: 0.3 });
    if(c1) c1.textContent = String((store.notas||[]).length + (store.listas||[]).length);
    if(c2) c2.textContent = String((store.notas||[]).filter(function(n){return n.fixada;}).length + (store.listas||[]).filter(function(l){return l.fixada;}).length);
    if(c3) c3.textContent = String((store.tarefas||[]).length);
    if(sv) sv.textContent = Tf('{n} itens', { n: dados.notas.length+dados.listas.length });
    var edPasta=$('#edPasta');
    if(edPasta){
      // Reescrever o innerHTML a cada render ZERAVA a pasta escolhida (o select
      // voltava para "Sem pasta") — e o Salvar seguinte tirava a nota da pasta.
      // Só reconstrói quando a lista de pastas muda de verdade e devolve o valor.
      var opcoes='<option value="">'+esc(T('Sem pasta (Todas)'))+'</option>'+(store.pastas||[]).map(function(p){return '<option value="'+p.id+'">'+esc(p.nome)+'</option>';}).join('');
      if(edPasta.getAttribute('data-opcoes')!==opcoes){
        var escolha=edPasta.value;
        edPasta.innerHTML=opcoes;
        edPasta.setAttribute('data-opcoes', opcoes);
        edPasta.value=escolha;
      }
    }
    var g=$('#grid'); if(!g) return; g.innerHTML='';
    var total=dados.notas.length+dados.listas.length;
    atualizarBarra(ctx);
    var gridModoLista=g.classList.contains('lista');
    // Stagger de entrada só no modo GRADE; lista fica fluída (device-friendly)
    if(g) g.classList.toggle('entra', !gridModoLista);
    if(!total){ g.innerHTML='<div class=\"empty\"><b>'+(ctx.query?T('Nenhum resultado'):T('Tudo limpo por aqui!'))+'</b><span>'+(ctx.query?T('Tente outro termo.'):T('Crie sua primeira nota — ela aparece no celular após sincronizar.'))+'</span><button class=\"btn prim\" id=\"emptyNova\">'+esc(T('Nova nota'))+'</button><button class=\"btn\" id=\"emptyNovaLista\" style=\"margin-top:6px\">'+esc(T('Nova lista'))+'</button></div>'; var b=$('#emptyNova'); if(b) b.addEventListener('click', function(){ nova(ctx); }); var bl=$('#emptyNovaLista'); if(bl) bl.addEventListener('click', function(){ novaLista(ctx); }); return; }
    var itens=[].concat(dados.notas.map(function(n){return {k:'nota', o:n};}), dados.listas.map(function(l){return {k:'lista', o:l};}));
    // Fixadas SEMPRE no topo; dentro de cada grupo, por data (mais nova primeiro)
    itens.sort(function(a,b){
      var fa=a.o.fixada?1:0, fb=b.o.fixada?1:0;
      if(fa!==fb) return fb-fa;
      return String(b.o.data||'').localeCompare(String(a.o.data||''));
    });
    itens.forEach(function(entry, idx){
      var k=entry.k, o=entry.o;
      var sel=selecionados.has(o.id);
      var card=document.createElement('div'); card.className='card'+(o.fixada?' fixada':'')+(sel?' selecionado':'');
      var badgePasta=o.pastaId ? '<span class=\"badge\">'+esc(((store.pastas||[]).find(function(p){return p.id===o.pastaId;})||{}).nome||'')+'</span>' : '';
      if(k==='nota'){
        var m=temMidia(o.conteudo);
        var thumb=''; try{ var match=String(o.conteudo||'').match(/<img[^>]+src=\"([^\"]+)\"/i); if(match) thumb='<img class=\"card-thumb\" src=\"'+match[1]+'\" alt=\"\">'; }catch(e){}
        var prev=String(o.conteudo||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,180);
        var audioBadge=m.audio ? '<span class=\"card-audio\">'+esc(T('🎙 áudio'))+'</span>' : '';
        var imgBadge=m.img ? '<span class=\"card-audio\">'+esc(T('🖼 imagem'))+'</span>' : '';
        card.innerHTML='<span class=\"card-check\">'+(sel?'✓':'')+'</span>'+thumb+'<h3>'+esc(o.titulo||T('Sem título'))+' '+badgePasta+'</h3><p>'+esc(prev||'—')+'</p><div class=\"meta\"><span>'+esc(o.data||'')+'</span>'+(o.fixada?'<span class=\"badge\">'+esc(T('Fixada'))+'</span>':'')+(o.protegida?'<span class=\"badge lock\">'+esc(T('Protegida'))+'</span>':'')+audioBadge+imgBadge+'<span style=\"margin-left:auto\" class=\"badge\">'+esc(T('Nota'))+'</span></div>';
      } else {
        var txt=(o.itens||[]).slice(0,3).map(function(it){return (it.concluido?'☑ ':'☐ ')+it.texto;}).join(' · ') || '—';
        var pend=(o.itens||[]).filter(function(it){return !it.concluido;}).length;
        card.innerHTML='<span class=\"card-check\">'+(sel?'✓':'')+'</span><h3>'+esc(o.titulo||T('Lista'))+' '+badgePasta+'</h3><p>'+esc(txt)+'</p><div class=\"meta\"><span>'+(o.itens||[]).length+esc(Tf('{n} itens · {m} pendentes',{ n:(o.itens||[]).length, m:pend }))+'</span>'+(o.fixada?'<span class=\"badge\">Fixada</span>':'')+'<span style=\"margin-left:auto\" class=\"badge\">'+esc(T('Lista'))+'</span></div>';
      }
      card.addEventListener('click', function(e){
        var isMulti = e.ctrlKey || e.metaKey || selecionados.size>0;
        if(isMulti){
          if(selecionados.has(o.id)) selecionados.delete(o.id); else selecionados.add(o.id);
          render(ctx); return;
        }
        abrir(ctx,k,o.id);
      });
      card.addEventListener('contextmenu', function(e){
        e.preventDefault();
        if(selecionados.has(o.id)) selecionados.delete(o.id); else selecionados.add(o.id);
        render(ctx);
      });
      card.querySelector('.card-check').addEventListener('click', function(e){
        e.stopPropagation();
        if(selecionados.has(o.id)) selecionados.delete(o.id); else selecionados.add(o.id);
        render(ctx);
      });
      g.appendChild(card);
    });
    // Stagger animations: GSAP (liso) ou fallback ao CSS
    if(window.Movimento) window.Movimento.grid('#grid');
  }

  function abrir(ctx, kind, id){
    edit={kind:kind,id:id};
    var shell=ctx.$('#shell'), ed=ctx.$('#editor');
    if(shell) shell.classList.add('editor-aberto'); if(ed) ed.style.display='flex';
    if(window.Movimento) window.Movimento.editorIn('.editor');
    var obj = kind==='nota' ? (ctx.store.notas||[]).find(function(n){return n.id===id;}) : (ctx.store.listas||[]).find(function(l){return l.id===id;});
    if(!obj) return;
    var edTitulo=ctx.$('#edTitulo'), edPasta=ctx.$('#edPasta'), edMeta=ctx.$('#edMeta'), rich=richEl(), edListaWrap=ctx.$('#edListaWrap'), tb=ctx.$('#editorToolbar');
    if(edTitulo) edTitulo.value=obj.titulo||'';
    if(kind==='nota'){
      if(edListaWrap) edListaWrap.style.display='none';
      if(rich){ rich.style.display='block'; rich.innerHTML=obj.conteudo||''; setTimeout(function(){ rich.focus(); atualizarToolbarEstado(); }, 30); }
      if(tb) tb.style.display='flex';
    } else {
      if(rich) rich.style.display='none';
      if(tb) tb.style.display='none';
      if(edListaWrap){ edListaWrap.style.display='flex'; renderListaEditor(ctx, obj); }
    }
    if(edPasta) edPasta.value=obj.pastaId||'';
    var bf=ctx.$('#btnFixar'); if(bf) bf.textContent=obj.fixada?T('★ Fixada'):T('☆ Fixar');
    if(edMeta) edMeta.textContent=(obj.data||'')+(obj.fixada?T('· Fixada'):'');
  }
  function fechar(ctx){
    if(edit && edit.kind==='nota'){
      var r=richEl(); var n=(ctx.store.notas||[]).find(function(x){return x.id===edit.id;}); if(r && n){ n.conteudo=r.innerHTML; ctx.salvarLocal(); }
    }
    edit=null;
    var shell=ctx.$('#shell'), ed=ctx.$('#editor');
    if(shell) shell.classList.remove('editor-aberto'); if(ed) ed.style.display='none';
    render(ctx);
  }
  // Salva o editor (título/conteúdo/pasta) SEM fechar — usado pelo botão Salvar e por Ctrl+S.
  function salvarConteudo(ctx){
    if(!edit) return;
    var edTitulo=document.getElementById('edTitulo'), edPasta=document.getElementById('edPasta');
    var titulo=(edTitulo&&edTitulo.value.trim())||(edit.kind==='lista'?T('Lista'):T('Sem título'));
    var pastaId=(edPasta&&edPasta.value)||undefined;
    // A pasta escolhida pode ter sido apagada (aqui ou no celular) com o editor
    // aberto: gravar um id órfão deixaria a nota "presa" a uma pasta inexistente.
    if(pastaId && !(ctx.store.pastas||[]).some(function(p){ return p.id===pastaId; })) pastaId=undefined;
    if(edit.kind==='nota'){
      var n=(ctx.store.notas||[]).find(function(x){return x.id===edit.id;});
      if(n){ n.titulo=titulo; var r=richEl(); if(r) n.conteudo=r.innerHTML; n.pastaId=pastaId; }
    } else {
      var l=(ctx.store.listas||[]).find(function(x){return x.id===edit.id;});
      if(l){ l.titulo=titulo; l.pastaId=pastaId; }
    }
    ctx.salvarLocal(); // salva no PC e agenda o push para o Drive (sync ~350ms)
  }
  // Fechar = Salvar + fechar a aba do editor. Usado pelo botão Fechar e pelo
  // atalho Esc (e qualquer caminho que feche o editor) — nada se perde.
  function salvarEFechar(ctx){
    salvarConteudo(ctx);
    fechar(ctx);
    ctx.toast(T('Salvo · sincronizando…'));
  }
  function nova(ctx){ var id=ctx.uid(); (ctx.store.notas||(ctx.store.notas=[])).unshift({ id:id, titulo:'', conteudo:'', data: ctx.hoje(), fixada:false, pastaId: ctx.pastaAtiva||undefined }); ctx.salvarLocal(); render(ctx); abrir(ctx,'nota',id); ctx.toast(T('Nota criada')); }
  function novaLista(ctx){ var id=ctx.uid(); (ctx.store.listas||(ctx.store.listas=[])).unshift({ id:id, titulo:T('Nova lista'), itens:[{id:ctx.uid(), texto:T('Novo item'), concluido:false}], data: ctx.hoje(), fixada:false, pastaId: ctx.pastaAtiva||undefined }); ctx.salvarLocal(); render(ctx); abrir(ctx,'lista',id); }

  function renderListaEditor(ctx, lista){
    var $=ctx.$, esc=ctx.esc;
    var wrap=$('#lpItens'), cont=$('#lpCont'), fill=$('#lpFill'); if(!wrap) return;
    var itens=lista.itens||[]; var concl=itens.filter(function(it){return it.concluido;}).length, total=itens.length;
    if(cont) cont.textContent=concl+'/'+total; if(fill) fill.style.width= total? Math.max(4,(concl/total)*100)+'%' : '0%';
    wrap.innerHTML=''; if(!itens.length){ wrap.innerHTML='<small style=\"color:var(--tx2);padding:8px\">'+esc(T('Sua lista está vazia — adicione o primeiro item acima.'))+'</small>'; return; }
    itens.forEach(function(it, idx){
      var row=document.createElement('div'); row.className='lista-row'+(it.concluido?' feito':''); row.draggable=true; row.dataset.id=it.id;
      row.innerHTML='<span class=\"lista-handle\" title=\"'+esc(T('Arraste'))+'\">⋮⋮</span><div class=\"check '+(it.concluido?'on':'')+'\">'+(it.concluido?'✓':'')+'</div><span class=\"lista-txt\">'+ctx.esc(it.texto)+'</span><button class=\"lista-del\" title=\"'+esc(T('Remover'))+'\">✕</button>';
      row.querySelector('.check').addEventListener('click', function(){ it.concluido=!it.concluido; ctx.salvarLocal(); renderListaEditor(ctx, lista); render(ctx); });
      row.querySelector('.lista-del').addEventListener('click', function(){ lista.itens=lista.itens.filter(function(x){return x.id!==it.id;}); ctx.salvarLocal(); renderListaEditor(ctx, lista); render(ctx); });
      row.addEventListener('dragstart', function(e){ dragListaId=it.id; row.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
      row.addEventListener('dragend', function(){ dragListaId=null; row.classList.remove('dragging'); });
      row.addEventListener('dragover', function(e){ e.preventDefault(); });
      row.addEventListener('drop', function(e){
        e.preventDefault();
        if(!dragListaId || dragListaId===it.id) return;
        var srcIdx=lista.itens.findIndex(function(x){return x.id===dragListaId;});
        var dstIdx=lista.itens.findIndex(function(x){return x.id===it.id;});
        if(srcIdx<0||dstIdx<0) return;
        var moved=lista.itens.splice(srcIdx,1)[0];
        var insertAt=dstIdx;
        lista.itens.splice(insertAt,0,moved);
        ctx.salvarLocal(); renderListaEditor(ctx, lista); render(ctx);
      });
      wrap.appendChild(row);
    });
    wrap.ondragover=function(e){ e.preventDefault(); };
    wrap.ondrop=function(e){
      if(!dragListaId) return;
      var srcIdx=lista.itens.findIndex(function(x){return x.id===dragListaId;});
      if(srcIdx<0) return;
      var target=e.target.closest && e.target.closest('.lista-row');
      if(!target){ var mv=lista.itens.splice(srcIdx,1)[0]; lista.itens.push(mv); ctx.salvarLocal(); renderListaEditor(ctx, lista); render(ctx); }
      dragListaId=null;
    };
  }

  function bind(ctx){
    ctxRef=ctx;
    var $=ctx.$;
    var edTitulo=$('#edTitulo'), edPasta=$('#edPasta'), rich=richEl();
    if(edTitulo) edTitulo.addEventListener('input', function(){
      if(!edit) return; var t=edTitulo.value;
      if(edit.kind==='nota'){ var n=(ctx.store.notas||[]).find(function(x){return x.id===edit.id;}); if(n) n.titulo=t; }
      else { var l=(ctx.store.listas||[]).find(function(x){return x.id===edit.id;}); if(l) l.titulo=t; }
      ctx.scheduleSave(); render(ctx);
    });
    if(rich){
      rich.addEventListener('input', function(){ persistirRichDebounced(); });
      rich.addEventListener('keyup', atualizarToolbarEstado);
      rich.addEventListener('mouseup', atualizarToolbarEstado);
      rich.addEventListener('paste', function(e){
        try{
          var items=e.clipboardData && e.clipboardData.items;
          if(items){
            for(var i=0;i<items.length;i++){
              var it=items[i];
              if(it.kind==='file' && it.type.indexOf('image/')===0){
                e.preventDefault();
                var f=it.getAsFile(); if(f) handleFileImagem(f);
                return;
              }
            }
          }
        }catch(err){}
      });
      rich.addEventListener('dragover', function(e){ e.preventDefault(); rich.style.outline='2px dashed var(--azul)'; });
      rich.addEventListener('dragleave', function(){ rich.style.outline=''; });
      rich.addEventListener('drop', function(e){
        e.preventDefault(); rich.style.outline='';
        var files=e.dataTransfer && e.dataTransfer.files;
        if(files && files.length){
          for(var i=0;i<files.length;i++){
            var f=files[i];
            if(f.type.indexOf('image/')===0) handleFileImagem(f);
            else if(f.type.indexOf('audio/')===0) handleFileAudio(f);
          }
          return;
        }
      });
      rich.addEventListener('click', function(e){
        var t=e.target;
        if(t && t.getAttribute && t.getAttribute('data-audio-del')!==null){
          var wrap=t.closest('.audio-wrap');
          if(wrap) wrap.remove();
          persistirRichDebounced();
        }
      });
    }
    if(edPasta) edPasta.addEventListener('change', function(){
      if(!edit) return; var v=edPasta.value||undefined;
      if(edit.kind==='nota'){ var n=(ctx.store.notas||[]).find(function(x){return x.id===edit.id;}); if(n) n.pastaId=v; }
      else { var l=(ctx.store.listas||[]).find(function(x){return x.id===edit.id;}); if(l) l.pastaId=v; }
      ctx.salvarLocal(); render(ctx);
    });
    var tb=$('#editorToolbar');
    if(tb) tb.addEventListener('click', function(e){
      var btn=e.target.closest('button[data-cmd]'); if(!btn) return;
      e.preventDefault();
      exec(btn.getAttribute('data-cmd'));
    });
    var inpImg=$('#inpImagem'), inpAud=$('#inpAudio'), btnImg=$('#btnEditorImagem'), btnAud=$('#btnEditorAudio');
    if(btnImg && inpImg) btnImg.addEventListener('click', function(){ inpImg.click(); });
    if(btnAud && inpAud) btnAud.addEventListener('click', function(){ inpAud.click(); });
    if(inpImg) inpImg.addEventListener('change', function(){
      var f=inpImg.files && inpImg.files[0]; if(f) handleFileImagem(f); inpImg.value='';
    });
    if(inpAud) inpAud.addEventListener('change', function(){
      var f=inpAud.files && inpAud.files[0]; if(f) handleFileAudio(f); inpAud.value='';
    });
    var btnSelTodos=$('#btnSelTodos'), btnSelApagar=$('#btnSelApagar'), btnSelCancelar=$('#btnSelCancelar'), btnSelFixar=$('#btnSelFixar'), btnSelMover=$('#btnSelMover');
    if(btnSelTodos) btnSelTodos.addEventListener('click', function(){
      var d=filtrados(ctx); var todos=[].concat(d.notas, d.listas);
      if(selecionados.size===todos.length) selecionados.clear(); else { selecionados.clear(); todos.forEach(function(o){ selecionados.add(o.id); }); }
      render(ctx);
    });
    if(btnSelCancelar) btnSelCancelar.addEventListener('click', function(){ limparSelecao(ctx); });
    if(btnSelApagar) btnSelApagar.addEventListener('click', function(){
      if(!selecionados.size) return;
      // Único caminho de exclusão em lote. Antes havia um fallback que apagava
      // direto no store SEM tombstone: se ele algum dia rodasse, a exclusão não
      // viajaria no backup e o item ressuscitaria no celular.
      ctx.abrirModalApagarSelecionados(selecionados);
    });
    if(btnSelFixar) btnSelFixar.addEventListener('click', function(){
      if(!selecionados.size) return;
      var ids=new Set(selecionados);
      var all=[].concat(ctx.store.notas||[], ctx.store.listas||[]);
      var algumFixado=all.some(function(o){return ids.has(o.id) && o.fixada;});
      all.forEach(function(o){ if(ids.has(o.id)) o.fixada=!algumFixado; });
      ctx.salvarLocal(); render(ctx); ctx.toast(algumFixado?T('Desfixados'):T('Fixados'));
    });
    if(btnSelMover) btnSelMover.addEventListener('click', function(){
      if(!selecionados.size) return;
      if(ctx.abrirMoverSelecionados) ctx.abrirMoverSelecionados(selecionados);
      else ctx.toast(T('Selecione a pasta de destino'));
    });

    var btnNova=$('#btnNovaNota'), btnLista=$('#btnNovaLista'), btnFechar=$('#btnFecharEditor'), btnExcluir=$('#btnExcluir'), btnFixar=$('#btnFixar'), btnSalvar=$('#btnSalvar'), btnLpAdd=$('#btnLpAdd');
    if(btnNova) btnNova.addEventListener('click', function(){ nova(ctx); });
    if(btnLista) btnLista.addEventListener('click', function(){ novaLista(ctx); });
    if(btnFechar) btnFechar.addEventListener('click', function(){ salvarEFechar(ctx); });
    if(btnExcluir) btnExcluir.addEventListener('click', function(){
      if(!edit) return;
      // apagar SIMPLES: modal de confirmação de um clique (não 'Apagar tudo')
      if(ctx.abrirModalApagarSelecionados){
        var s=new Set([edit.id]);
        ctx.abrirModalApagarSelecionados(s, function(){ fechar(ctx); });
        return;
      }
      if(!confirm(T('Excluir?'))) return;
      if(window.Tombstones) window.Tombstones.registrar(edit.id); // exclusão sincroniza
      if(edit.kind==='nota') ctx.store.notas=(ctx.store.notas||[]).filter(function(n){return n.id!==edit.id;});
      else ctx.store.listas=(ctx.store.listas||[]).filter(function(l){return l.id!==edit.id;});
      ctx.salvarLocal(); fechar(ctx); ctx.toast(T('Excluído'));
    });
    if(btnFixar) btnFixar.addEventListener('click', function(){
      if(!edit) return;
      var o = edit.kind==='nota' ? (ctx.store.notas||[]).find(function(n){return n.id===edit.id;}) : (ctx.store.listas||[]).find(function(l){return l.id===edit.id;});
      if(!o) return; o.fixada=!o.fixada; btnFixar.textContent=o.fixada?T('★ Fixada'):T('☆ Fixar'); ctx.salvarLocal(); render(ctx);
    });
    if(btnSalvar) btnSalvar.addEventListener('click', function(){
      if(!edit) return;
      salvarConteudo(ctx);
      render(ctx);
      if(edit.kind==='lista'){ var ll=(ctx.store.listas||[]).find(function(x){return x.id===edit.id;}); if(ll) renderListaEditor(ctx, ll); }
      ctx.toast(T('Salvo · sincronizando…'));
    });
    if(btnLpAdd) btnLpAdd.addEventListener('click', function(){
      if(!edit||edit.kind!=='lista') return;
      var l=(ctx.store.listas||[]).find(function(x){return x.id===edit.id;}); if(!l) return;
      var inp=ctx.$('#lpNovo'); var txt=(inp&&inp.value.trim())||''; if(!txt) return;
      (l.itens||(l.itens=[])).unshift({ id: ctx.uid(), texto: txt, concluido:false }); if(inp) inp.value=''; ctx.salvarLocal(); renderListaEditor(ctx, l); render(ctx); ctx.toast(T('Item adicionado'));
    });
    var lpNovo=$('#lpNovo');
    if(lpNovo) lpNovo.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); if(btnLpAdd) btnLpAdd.click(); } });

    document.addEventListener('keydown', function(e){
      if(e.key==='Escape' && selecionados.size>0){ e.preventDefault(); limparSelecao(ctx); }
    });
  }

  root.snNotas = { render: function(c){ return render(c); }, bind: bind, abrir: function(c,k,id){ return abrir(c,k,id); }, fechar: function(c){ return fechar(c); }, salvarEFechar: function(c){ return salvarEFechar(c); }, salvarConteudo: function(c){ return salvarConteudo(c); }, nova: function(c){ return nova(c); }, novaLista: function(c){ return novaLista(c); }, renderListaEditor: function(c,l){ return renderListaEditor(c,l); }, getEdit: function(){ return edit; }, setEdit: function(v){ edit=v; }, limparSelecao: function(c){ return limparSelecao(c||ctxRef); }, selecionados: selecionados };
}(typeof self !== 'undefined' ? self : this));
