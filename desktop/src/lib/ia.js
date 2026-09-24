// IA do desktop — mesma lógica do celular (ia-service.ts) mas para file://
// Usa fetch direto para OpenRouter com as notas do store local como contexto.
(function(root){
  // Textos que o usuário vê: usa o dicionário do desktop (i18n.js) quando
  // disponível; o prompt enviado ao modelo continua em PT (não é UI).
  function _t(s){ return (typeof root.T === 'function') ? root.T(s) : s; }

  /** Idioma da RESPOSTA do modelo — segue o idioma escolhido no app. */
  function instrucaoIdioma(){
    var lg = (root.I18N && root.I18N.idiomaAtual) ? root.I18N.idiomaAtual() : 'pt';
    if(lg === 'en') return 'Always reply in English, briefly and usefully (max 180 words).';
    if(lg === 'es') return 'Responde siempre en español, de forma breve y útil (máx. 180 palabras).';
    return 'Responda SEMPRE em português do Brasil, de forma curta e útil (máx. 180 palavras).';
  }
  var URL_API='https://openrouter.ai/api/v1/chat/completions';
  var MAX_NOTAS=8, MAX_CHARS=400, MAX_CHARS_EDICAO=3000;
  // Modelos do OpenRouter — usa IDs reais que existem (igual ao celular quando online)
  var MODEL_PRIMARY='meta-llama/llama-3.2-3b-instruct:free';
  var MODEL_FALLBACK='google/gemini-2.0-flash-exp:free';
  var MODEL_FALLBACK2='openrouter/auto';

  var RECURSOS_DO_APP = [
    'Notas com editor rico (negrito, itálico, sublinhado, listas, imagem e áudio)',
    'Pastas para organizar notas e listas: selecionar várias, criar/renomear, mover para pasta',
    'Listas (checklists): criar dentro de pastas, marcar/desmarcar, arrastar para reordenar',
    'Lembretes de nota: em data/hora, a cada X dias ou em dias da semana (alarme em tela cheia)',
    'Tarefas com recorrência (uma vez/diária/dias da semana) e horário, com notificação e soneca',
    'Login Google e backup automático no Drive (notas, listas, pastas, tarefas, chave IA e anexos)',
    'Ajustes: modo escuro, idioma, som/soneca do alarme, bloqueio PIN, chave IA gratuita (OpenRouter)',
    'Sincronização PC ↔ celular pela mesma conta Google (mesmo backup_notas.json)',
  ].join(' · ');

  // FAQ local offline (igual ao celular) — responde sobre recursos do app
  var FAQ_APP = [
    { palavras: ['exportar','pdf','compartilhar','imprimir','export','share'], resposta: 'Esse recurso não existe no Simple Notes: o app não exporta nem compartilha notas. Ele salva tudo automaticamente na sua conta Google (Drive). ✨' },
    { palavras: ['anuncio','anúncio','premium','assinatura','remover anuncio','ads'], resposta: 'Em Ajustes → Anúncios há "Remover anúncios para sempre" (pagamento único na Play Store). Também existe Premium por convite.' },
    { palavras: ['modo escuro','tema escuro','tema claro','dark','theme'], resposta: 'Sim! Em Ajustes → Aparência você alterna o Modo Escuro (OLED no PC, igual ao celular).' },
    { palavras: ['som do alarme','soneca','alarme','snooze'], resposta: 'Em Ajustes → Alarme você escolhe o som e a soneca (5 a 60 min). No PC o alarme toca com som do sistema + Web Audio e botão Soneca.' },
    { palavras: ['biometria','bloquear app','bloqueio','pin','fingerprint'], resposta: 'Em Ajustes → Segurança você define um PIN de 4 dígitos. No PC ele bloqueia ao minimizar/voltar ao app; no celular usa biometria.' },
    { palavras: ['backup','drive','sincroniz','restaurar','nuvem'], resposta: 'Entrando com a mesma conta Google no celular e no PC, notas/listas/pastas/tarefas ficam no Drive (backup_notas.json em appDataFolder) e sincronizam com um clique em Sincronizar.' },
    { palavras: ['tarefa','recorrência','recorrencia','task'], resposta: 'Na aba Tarefas você cria tarefas com recorrência (uma vez/diária/dias específicos) e horário, com notificação e soneca.' },
    { palavras: ['pasta','folder','organizar em pastas','mover para pasta','renomear pasta'], resposta: 'Na barra lateral, clique em + Nova para criar pasta; clique direito na pasta para renomear/excluir; selecione notas/listas com Ctrl+clique e Mover para outra pasta.' },
    { palavras: ['lista','checklist'], resposta: 'As listas são checklists com checkbox, marcar/desmarcar e arrastar para reordenar (⋮⋮). Também moram dentro de pastas.' },
    { palavras: ['lembrete','reminder'], resposta: 'No editor da nota, o ícone de sino agenda lembretes (data/hora, a cada X dias ou dias da semana). No PC o lembrete entra como tarefa com alarme.' },
    { palavras: ['chave da ia','openrouter','inteligência','ia','ai key'], resposta: 'A IA fica em Ajustes → IA: cole a chave gratuita do OpenRouter (botão Como criar a chave) para respostas como ChatGPT. Sem chave, respondo buscando nas suas notas.' },
    { palavras: ['imagem','foto','áudio','audio','anexo','image','photo'], resposta: 'No editor você insere imagem (🖼) e áudio (🎙) — no PC arraste arquivos para dentro da nota ou use Ctrl+V. No celular as imagens vão para o Drive como anexo e são baixadas ao restaurar.' },
    { palavras: ['idioma','language','english','español','trocar idioma'], resposta: 'Em Ajustes → Aparência → Idioma escolha Português/English/Español — o app e a IA respondem no idioma escolhido.' },
  ];
  function respostaRecursoApp(pergunta){
    var p=String(pergunta||'').toLowerCase();
    for(var i=0;i<FAQ_APP.length;i++){ var item=FAQ_APP[i]; for(var j=0;j<item.palavras.length;j++) if(p.indexOf(item.palavras[j])!==-1) return _t(item.resposta); }
    return null;
  }

  function limparHtml(html){
    var d=document.createElement('div'); d.innerHTML=String(html||'');
    return (d.textContent||d.innerText||'').replace(/\s+/g,' ').trim();
  }

  // ---- Mídia da nota ----------------------------------------------------
  // A IA recebe uma MARCA no lugar de cada imagem/áudio (ela não vê base64) e
  // devolve a marca; na aplicação a marca volta a ser a mídia original. Marca
  // perdida = mídia re-anexada no fim: a IA NUNCA apaga a imagem do usuário.
  var RE_MIDIA=/<img\b[^>]*>|<audio\b[\s\S]*?<\/audio>|<video\b[\s\S]*?<\/video>/gi;
  var midiasPorNota={};
  function extrairMidias(html){
    var midias=[];
    var texto=String(html||'').replace(RE_MIDIA, function(tag){ midias.push(tag); return '\n[[midia'+midias.length+']]\n'; });
    return {texto:texto, midias:midias};
  }
  function restaurarMidias(html, midias){
    var out=String(html||'');
    for(var i=0;i<(midias||[]).length;i++){
      var marca='[[midia'+(i+1)+']]';
      if(out.indexOf(marca)!==-1) out=out.split(marca).join(midias[i]);
      else out=out+midias[i];
    }
    return out;
  }

  // Frases que a IA escreve PARA O USUÁRIO e que não podem virar conteúdo da nota.
  var RE_FALA_IA=/^\s*(pronto|prontinho|feito|conclu[íi]do|ok|beleza|perfeito|claro|certeza|aqui est[áa]|segue|a seguir|a nota (foi|j[áa] foi)?\s*(alterada|editada|atualizada|criada|modificada)|nota (alterada|editada|atualizada|modificada)|done|listo|la nota (ha sido|fue)?\s*(actualizada|editada|modificada))[\s!.,:;—-]*$/i;
  // Linha de conversa com RELATO da mudança: "Pronto! Acrescentei o passo do
  // forno", "Feito: organizei em tópicos", "Done — I added the list". Sem isto
  // a explicação da IA virava conteúdo da nota.
  var RE_FALA_IA_RELATO=/^\s*(pronto|prontinho|feito|conclu[íi]do|ok|beleza|perfeito|claro|certeza|done|listo)\b[^\n]{0,160}\b(acrescent|adicion|inclu|alter|atualiz|organiz|corrig|arrum|reescrev|reformul|format|coloqu|coloc|remov|apagu|exclu|tirei|tirar|added|add |updated|organized|fixed|rewrote|removed|changed|formatted|añad|agregu|actualic|organic|correg|cambi)/i;
  function ehFalaIA(linha){ return RE_FALA_IA.test(linha) || RE_FALA_IA_RELATO.test(linha); }
  function limparFalasIA(texto){
    var linhas=String(texto||'').split('\n');
    while(linhas.length>1 && ehFalaIA(linhas[0])) linhas.shift();
    while(linhas.length>1 && ehFalaIA(linhas[linhas.length-1])) linhas.pop();
    return linhas.join('\n').trim();
  }
  // Título não se repete dentro do corpo da nota (a IA costuma colocar lá).
  function semTituloNoCorpo(html, titulo){
    var t=String(titulo||'').trim(); if(!t) return html;
    var esc=t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    var out=String(html||'')
      .replace(new RegExp('^\\s*<h[1-3][^>]*>\\s*'+esc+'\\s*<\\/h[1-3]>\\s*','i'),'')
      .replace(new RegExp('^\\s*'+esc+'\\s*(<br\\s*\\/?>|\n|$)','i'),'');
    return out.trim();
  }
  function paraHtml(texto){
    var esc=function(v){ return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
    return String(texto||'').split(/\n+/).map(function(l){ return l.trim(); }).filter(Boolean)
      .map(function(l){ return '<p>'+esc(l.replace(/^[-*•]\s+/,'• '))+'</p>'; }).join('');
  }

  // ---- Formatação (notação compacta) ------------------------------------
  // A IA vê a nota COM a formatação numa notação compacta e devolve a mesma
  // notação. Enviar só texto puro obrigava o modelo a recriar o que já existia
  // a partir do zero — e a formatação da nota (negrito, listas, títulos) se
  // perdia. Aqui ela PRESERVA o que existe e acrescenta coisas formatadas.
  var ENTIDADES={amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' '};
  function decodificaEntidades(s){
    return String(s||'').replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, function(m,e){
      if(e.charAt(0)==='#'){
        var n=e.charAt(1).toLowerCase()==='x' ? parseInt(e.slice(2),16) : parseInt(e.slice(1),10);
        return isNaN(n) ? m : String.fromCharCode(n);
      }
      return ENTIDADES[e.toLowerCase()] != null ? ENTIDADES[e.toLowerCase()] : m;
    });
  }
  /** HTML da nota -> notação compacta que a IA consegue manter e estender. */
  function htmlParaMarkdown(html){
    var s=String(html||'').replace(/\r/g,'');
    s=s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, function(m,n,t){ return '\n\n'+new Array(Number(n)+1).join('#')+' '+t.trim()+'\n\n'; });
    s=s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, function(m,t){ return '\n\n> '+t.trim().replace(/\s*\n\s*/g,' ')+'\n\n'; });
    s=s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, function(m,inner){
      var i=0;
      return '\n'+inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, function(x,t){ i++; return i+'. '+t.trim()+'\n'; })+'\n';
    });
    s=s.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, function(m,inner){
      return '\n'+inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, function(x,t){ return '- '+t.trim()+'\n'; })+'\n';
    });
    s=s.replace(/<\/(p|div)>/gi,'\n\n').replace(/<(p|div)\b[^>]*>/gi,'\n\n');
    s=s.replace(/<br\s*\/?>/gi,'\n');
    s=s.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi,'**$2**');
    s=s.replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi,'*$2*');
    s=s.replace(/<(s|strike|del)\b[^>]*>([\s\S]*?)<\/\1>/gi,'~~$2~~');
    s=s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi,'`$1`');
    s=s.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,'[$2]($1)');
    // <u> é mantido: a notação não tem sublinhado
    s=s.replace(/<(?!\/?u>)[^>]+>/g,'');
    s=decodificaEntidades(s);
    return s.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  }
  /** O texto veio na notação compacta (e não em HTML)? */
  function pareceMarkdown(s){
    var t=String(s||'');
    if(/<\s*(p|div|h[1-6]|ul|ol|li|br|blockquote)\b/i.test(t)) return false;
    return /\*\*[^*\n]+\*\*|^\s*[-*•]\s+\S|^\s*\d+[.)]\s+\S|^#{1,6}\s|~~[^~\n]+~~|^\s*>\s/m.test(t);
  }
  function linhaInlineHtml(txt){
    var s=String(txt||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    s=s.replace(/&lt;u&gt;/g,'<u>').replace(/&lt;\/u&gt;/g,'</u>');
    s=s.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
    s=s.replace(/(^|[^*])\*([^*\n]+)\*/g,'$1<i>$2</i>');
    s=s.replace(/~~([^~]+)~~/g,'<s>$1</s>');
    s=s.replace(/`([^`]+)`/g,'<code>$1</code>');
    s=s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,'<a href="$2">$1</a>');
    return s;
  }
  /** Notação compacta -> HTML (o que entra na nota). */
  function markdownParaHtml(md){
    var linhas=String(md||'').replace(/\r/g,'').split('\n');
    var out=[], lista=null;
    function fecha(){ if(lista){ out.push('<'+lista.tipo+'>'+lista.itens.map(function(i){ return '<li>'+i+'</li>'; }).join('')+'</'+lista.tipo+'>'); lista=null; } }
    for(var i=0;i<linhas.length;i++){
      var l=linhas[i].trim(); if(!l){ fecha(); continue; }
      var m;
      if((m=l.match(/^[-*•]\s+(.*)$/))){ if(!lista||lista.tipo!=='ul'){ fecha(); lista={tipo:'ul', itens:[]}; } lista.itens.push(linhaInlineHtml(m[1])); continue; }
      if((m=l.match(/^\d+[.)]\s+(.*)$/))){ if(!lista||lista.tipo!=='ol'){ fecha(); lista={tipo:'ol', itens:[]}; } lista.itens.push(linhaInlineHtml(m[1])); continue; }
      fecha();
      if((m=l.match(/^(#{1,6})\s+(.*)$/))){ var n=Math.min(m[1].length,3); out.push('<h'+n+'>'+linhaInlineHtml(m[2])+'</h'+n+'>'); continue; }
      if((m=l.match(/^>\s*(.*)$/))){ out.push('<blockquote>'+linhaInlineHtml(m[1])+'</blockquote>'); continue; }
      out.push('<p>'+linhaInlineHtml(l)+'</p>');
    }
    fecha();
    return out.join('');
  }
  /**
   * Conteúdo final que vai para a nota: devolve a mídia original, remove frases
   * conversacionais, não repete o título e GARANTE HTML (a IA devolve texto puro
   * com frequência; gravar texto puro destruiria os parágrafos da nota).
   */
  function conteudoAplicado(conteudo, titulo, notaId, tituloAntigo){
    var base=limparFalasIA(String(conteudo||''));
    // A IA devolve a nota na notação compacta (com a formatação preservada).
    if(pareceMarkdown(base)) base=markdownParaHtml(base);
    base=semTituloNoCorpo(base, titulo);
    if(tituloAntigo && String(tituloAntigo) !== String(titulo)) base=semTituloNoCorpo(base, tituloAntigo);
    // Sem marcação de bloco = a IA devolveu texto puro: vira parágrafos (com a
    // marca de mídia ainda no lugar, senão o próprio <img> faria parecer HTML).
    if(!/<(p|br|h[1-6]|ul|ol|li|div|blockquote|table|strong|em|b|i|u|span|code|pre)\b/i.test(base)) base=paraHtml(base);
    // Marca que sobrou (modelo inventou ou perdeu o mapa) nunca aparece na nota.
    return restaurarMidias(base, midiasPorNota[notaId]||[]).replace(/\[\[midia\d+\]\]/g,'').trim();
  }
  function notaParaTexto(n){
    var prep=extrairMidias(n.conteudo||''); midiasPorNota[n.id]=prep.midias;
    var corpo=limparHtml(prep.texto);
    if(corpo.length>MAX_CHARS) corpo=corpo.slice(0,MAX_CHARS)+'…';
    var titulo=String(n.titulo||'Sem título').trim();
    return corpo? ('• "'+titulo+'": '+corpo) : ('• "'+titulo+'" (sem conteúdo)');
  }
  function montarContexto(notas, pergunta){
    if(!notas||!notas.length) return '';
    var termos=pergunta.toLowerCase().split(/\s+/).filter(function(w){return w.length>2;});
    var scored=notas.map(function(n){
      var txt=(String(n.titulo||'')+' '+limparHtml(n.conteudo||'')).toLowerCase();
      var sc=0; termos.forEach(function(t){ if(txt.indexOf(t)!==-1) sc++; });
      return {n:n, sc:sc};
    });
    scored.sort(function(a,b){return b.sc-a.sc;});
    var top=scored.filter(function(x){return x.sc>0;}).slice(0,MAX_NOTAS);
    if(!top.length) top=scored.slice(0, Math.min(MAX_NOTAS, notas.length));
    return top.map(function(x){ return notaParaTexto(x.n); }).join('\n');
  }

  /** Contexto COM ids para a IA poder propor edição — usado quando há chave (online). */
  function montarContextoComIds(notas, pergunta, edicao){
    if(!notas||!notas.length) return '';
    // Numa edição a IA devolve a nota INTEIRA: mandar a nota truncada faria o
    // resto do conteúdo desaparecer na resposta.
    var limite=edicao ? MAX_CHARS_EDICAO : MAX_CHARS;
    var termos=pergunta.toLowerCase().split(/\s+/).filter(function(w){return w.length>2;});
    var scored=notas.map(function(n){
      var txt=(String(n.titulo||'')+' '+limparHtml(n.conteudo||'')).toLowerCase();
      var sc=0; termos.forEach(function(t){ if(txt.indexOf(t)!==-1) sc++; });
      return {n:n, sc:sc};
    });
    scored.sort(function(a,b){return b.sc-a.sc;});
    var top=scored.filter(function(x){return x.sc>0;}).slice(0,MAX_NOTAS);
    if(!top.length) top=scored.slice(0, Math.min(MAX_NOTAS, notas.length));
    return top.map(function(x){
      var n=x.n;
      var prep=extrairMidias(n.conteudo||''); midiasPorNota[n.id]=prep.midias;
      // COM a formatação: a IA consegue manter negrito/listas/títulos e estender.
      var corpo=htmlParaMarkdown(prep.texto);
      if(corpo.length>limite) corpo=corpo.slice(0,limite)+'…';
      return '• [id='+n.id+'] '+(n.fixada?'(fixada) ':'')+'"'+String(n.titulo||'Sem título')+'":\n'+corpo;
    }).join('\n');
  }

  function ehSaudacao(t){
    var s=String(t||'').trim().toLowerCase();
    if(s.length>55) return false;
    var re1=/^(oi|olá|ola|hey|hello|eae|e aí|eai|oie|opa)(\s+(tudo bem|td bem|tdb|como vai|como vc tá|como você tá|beleza|tudo joia|tudo bom|boa tarde|boa noite|bom dia|tudo tranquilo|tranquilo|tudo e contigo|tudo bem\?))?[\s!?,.]*$/i;
    var re2=/^(tudo bem|td bem|beleza|como vai|boa tarde|boa noite|bom dia)[\s!?.]*$/i;
    if(re1.test(s) || re2.test(s)) return true;
    var palavras=s.replace(/[!?,.]/g,'').trim().split(/\s+/);
    if(palavras.length<=3){
      var primeira=palavras[0]||'';
      if(/^(oi|olá|ola|hey|hello|eae|oie|opa)$/.test(primeira)) return true;
    }
    return false;
  }
  function ehPerguntaIdentidade(t){
    var s=String(t||'').trim().toLowerCase();
    return /(quem (é|e) (vc|você|voce)|o que (é|e) vc|seu nome|quem és)/.test(s);
  }
  function ehPerguntaSobreNotas(t){
    var s=String(t||'').toLowerCase();
    return /(minha|meus|meu).*(nota|lista|tarefa|pasta)|oque tem|o que tem|o que há|resuma|resume|liste|mostra.*nota/.test(s);
  }

  var storeNotas=[]; // notas+listas com ids (definido por quem chama, para edição)
  /** Instrução de edição: a IA propõe, nunca aplica. Só é anexada quando o
   *  usuário ORDENA uma mudança — conversa normal nunca gera bloco JSON. */
  function instrucaoEdicao(){
    return 'O USUÁRIO ORDENOU UMA EDIÇÃO. Faça agora: PRIMEIRO uma linha curta de texto explicando exatamente o que muda, DEPOIS — isto é obrigatório, não opcional — acrescente um bloco cercado ```json {"edicao":{"alvo":"<id da nota>","explicacao":"<resumo da mudança>","titulo":"<título novo, ou o mesmo se não mudar>","conteudo":"<nota final COMPLETA na notação de formatação>","itens":[{"texto":"<item>","concluido":false}]}} ```. NOTAÇÃO DO CONTEÚDO (use a MESMA que você recebeu, nunca HTML): **negrito**, *itálico*, <u>sublinhado</u>, ~~riscado~~, `código`, - item de lista, 1. item numerado, # título, ## subtítulo, > citação e [texto](url) para links. Uma linha por parágrafo (linha vazia separa parágrafos). REGRAS: (1) CONSERVE a formatação que a nota já tem — se um trecho estava em negrito, ele continua em negrito; altere apenas o que o usuário pediu; (2) acrescente o conteúdo novo JÁ FORMATADO (se pedirem tópicos, use - ; se pedirem destaque, use ** ); (3) preserve TODAS as marcas [[midia1]], [[midia2]]... exatamente no lugar onde aparecem: elas são imagens/áudios do usuário e NUNCA podem ser removidas nem renomeadas; (4) o campo conteudo contém SOMENTE a nota — nada de frases suas como "Pronto", "A nota foi alterada" ou o título; (5) o título vai SÓ no campo titulo, nunca repetido no começo do conteúdo. Para LISTAS use "itens" (não "conteudo"). "alvo" deve ser o id exato de uma das notas fornecidas. O bloco JSON está ISENTO do limite de 180 palavras. Nunca aplique a mudança em silencio — o app pergunta ao usuário antes.';
  }

  /**
   * Mapa de mídia de todas as notas — preenchido ANTES da pergunta (definirAlvos),
   * para que a aplicação da edição sempre saiba quais imagens/áudios devolver.
   */
  function mapearMidias(itens){
    (itens||[]).forEach(function(it){
      if(!it || !it.id || String(it.conteudo||'').indexOf('<')===-1) return;
      midiasPorNota[it.id]=extrairMidias(it.conteudo||'').midias;
    });
  }

  /**
   * Detecta ORDEM de edição (não pergunta): verbo de mudança + alvo ou
   * referência clara ao conteúdo. Só aqui a instrução de edição é anexada.
   */
  function ehOrdemEdicao(texto){
    var s=String(texto||'').toLowerCase();
    if(!s.trim()) return false;
    // Pergunta disfarçada de ordem ("como faço pra apagar uma nota?") nunca é ordem.
    if(/^\s*(como|qual|quais|quando|onde|por que|porque|o que|quem|sera?\s*que|será\s*que|can|could|how|what|where|when|why|which|c[oó]mo|cu[aá]l|cu[aá]ndo|d[oó]nde|qu[eé]|qui[eé]n)\b/.test(s)) return false;
    var verbo=/\b(adicion\w*|inclu\w*|colo(ca|que|car)\w*|insir\w*|apag\w*|delet\w*|remov\w*|tirar?|exclu\w*|corrij\w*|corrig\w*|arrum\w*|consert\w*|edit\w*|alter\w*|mud\w*|modific\w*|reescrev\w*|reformul\w*|reorganiz\w*|organiz\w*|atualiz\w*|substitu\w*|troc\w*|complet\w*|preench\w*|resum\w*|traduz\w*|converter?|format\w*|add|insert|remove|delete|fix|correct|change|modify|rewrite|edit|update|replace|organize|complete|fill|summarize|translate|format|agreg\w*|a(ñ|n)ad\w*|elimin\w*|cambi\w*|reescrib\w*|arregl\w*|actualiz\w*|reemplaz\w*|traduc\w*)\b/;
    if(!verbo.test(s)) return false;
    var alvo=/\b(nota|notas|lista|listas|anotac\w*|anota(ç|c)\w*|tarefa|tarefas|item|itens|texto|t(í|i)tulo|note|notes|list|lists|task|tasks|items|title|conte(ú|u)do|content)\b/.test(s);
    var deitico=/\b(nele|nela|nisso|aqui|esse|essa|isso|ele|ela|it|this|that|there|lo|la|ah(í|i))\b/.test(s);
    if(alvo||deitico) return true;
    // Comando curto no imperativo ("reescreve em tópicos", "organiza isso") sem
    // alvo explícito: sem interrogação e com o verbo no início da frase.
    var palavras=s.split(/\s+/).filter(function(w){return w;});
    if(/\?/.test(s)||palavras.length>12) return false;
    return verbo.test(palavras.slice(0,2).join(' '));
  }
  async function perguntar(pergunta, notas, tarefas, chaveApi, historico){
    historico=historico||[];
    var perguntaLimpa=String(pergunta||'').trim();
    if(!perguntaLimpa) return {texto:'Digite sua pergunta 🙂', modo:'offline'};
    var ctxTexto=montarContexto(notas, perguntaLimpa);
    var tarefasTxt='';
    if(tarefas&&tarefas.length){
      var p=perguntaLimpa.toLowerCase();
      var rel=tarefas.filter(function(t){ return String(t.titulo||'').toLowerCase().indexOf(p)!==-1 || p.indexOf('tarefa')!==-1; }).slice(0,6);
      if(rel.length) tarefasTxt='\n\nTarefas:\n'+rel.map(function(t){ return '• ['+(t.concluida?'concluída':'pendente')+'] "'+(t.titulo||'')+'" '+t.recorrencia+' '+t.horario; }).join('\n');
    }

    if(ehSaudacao(perguntaLimpa)){
      return {texto:_t('Oi! 👋 Sou o NotaIA, seu assistente do Simple Notes. Posso ajudar com notas, listas, tarefas, pastas, lembretes, backup no Drive, modo escuro e PIN. O que quer fazer?'), modo:'offline'};
    }
    if(ehPerguntaIdentidade(perguntaLimpa)){
      return {texto:_t('Sou o NotaIA, assistente do Simple Notes 🤖\nAjudo com suas notas, listas, tarefas, pastas, lembretes, backup no Drive, modo escuro e bloqueio por PIN — tudo offline ou com IA online quando há chave configurada. Me diga o que precisa!'), modo:'offline'};
    }
    // FAQ local offline: perguntas sobre recursos do app respondem sem precisar de nota
    if(!chaveApi){
      var faq=respostaRecursoApp(perguntaLimpa);
      if(faq) return {texto:faq, modo:'offline'};
    }
    if(ehPerguntaSobreNotas(perguntaLimpa) && ctxTexto){
      if(!chaveApi){
        var linhas=ctxTexto.split('\n').slice(0,6);
        return {texto:'Nas suas notas encontrei:\n\n'+linhas.join('\n')+'\n\n'+(notas.length>linhas.length?('(+ '+(notas.length-linhas.length)+' outras)\n\n'):'')+'Quer que eu resuma, organize em pastas ou transforme em lista? (com a chave grátis respondo como ChatGPT)', modo:'offline'};
      }
    }

    if(!chaveApi){
      if(!ctxTexto && !tarefasTxt){
        var faq2=respostaRecursoApp(perguntaLimpa);
        if(faq2) return {texto:faq2, modo:'offline'};
        return {texto:'Você ainda não tem notas. Crie uma nota primeiro e pergunte sobre ela! 📝\n\nDica: adicione a chave grátis em Configurações → IA (OpenRouter) para respostas como ChatGPT.', modo:'offline'};
      }
      var termos=perguntaLimpa.toLowerCase().split(/\s+/).filter(function(w){return w.length>2;});
      var temRelacao=false;
      if(ctxTexto){
        var lowerCtx=ctxTexto.toLowerCase();
        for(var i=0;i<termos.length;i++){ if(lowerCtx.indexOf(termos[i])!==-1){ temRelacao=true; break; } }
      }
      // se for pergunta sobre recurso do app, já respondeu acima; se não tem relação mas tem tarefas, mostra tarefas
      if(!temRelacao && !tarefasTxt){
        var faq3=respostaRecursoApp(perguntaLimpa);
        if(faq3) return {texto:faq3, modo:'offline'};
        return {texto:_t('Só consigo ajudar com o conteúdo das suas notas 🙂\n\nPergunte sobre o que escreveu — ex: "resuma minha nota de receita" ou "o que tenho pendente?".'), modo:'offline'};
      }
      return {texto:_t('Encontrei isso nas suas notas:')+'\n\n'+(ctxTexto+tarefasTxt)+'\n\n'+_t('_(modo offline — adicione a chave gratuita em Configurações → IA para respostas como ChatGPT)_'), modo:'offline'};
    }
    if(!ctxTexto && !tarefasTxt) ctxTexto='(nenhuma nota relevante para a pergunta atual)';

    // Ordem de edição? Muda o que a IA recebe da nota (formatação + íntegra).
    var ordemEdicao=ehOrdemEdicao(perguntaLimpa);
    // Notas/listas com ids: a IA precisa dos ids para propor edição ("alvo").
    var ctxComIds=montarContextoComIds((storeNotas||[]), perguntaLimpa, ordemEdicao);
    var system='Você é o NotaIA, assistente do app Simple Notes. '+instrucaoIdioma()+' Use as notas fornecidas como contexto quando fizer sentido. Se a pergunta for saudação, responda de forma simpática e curta. Se perguntarem quem é você, diga que é o NotaIA do Simple Notes. Recursos reais do app: '+RECURSOS_DO_APP+'. Nunca invente recursos. Se a pergunta realmente não tiver relação com as notas, diga gentilmente que só pode ajudar com as notas. Se for sobre um recurso do app, responda exatamente com o que está na lista. '+(ordemEdicao?instrucaoEdicao():'');
    var msgs=[{role:'system', content: system}];
    historico.slice(-6).forEach(function(m){ msgs.push({role: m.papel==='usuario'?'user':'assistant', content: m.texto}); });
    msgs.push({role:'user', content:'Notas do usuário:\n'+ctxTexto+'\n\nTodas as notas e listas (com ids, para possíveis edições):\n'+(ctxComIds||'(vazio)')+ (tarefasTxt?('\n'+tarefasTxt):'') +'\n\nPergunta: '+perguntaLimpa});

    async function tentar(model, teto){
      var res=await fetch(URL_API, {method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+chaveApi, 'HTTP-Referer':'https://simple-notes.app','X-Title':'Simple Notes'}, body: JSON.stringify({model:model, messages: msgs, temperature:0.7, max_tokens: teto})});
      if(!res.ok){
        var corpo=await res.text().catch(function(){return '';});
        if(res.status===401) throw new Error('AUTH');
        if(res.status===429) throw new Error('RATE');
        throw new Error('API '+res.status+': '+corpo.slice(0,120));
      }
      var data=await res.json();
      var txt=data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content && data.choices[0].message.content.trim();
      if(!txt) throw new Error('Resposta vazia');
      return txt;
    }

    // Uma EDIÇÃO devolve o HTML completo da nota — teto alto, para nota longa
    // não ser truncada (e o bloco JSON não se perder). Vários modelos grátis
    // recusam tetos acima do próprio limite, então há recuo para TETO_RESERVA.
    var TETO_CHAT=400, TETO_EDICAO=16000, TETO_RESERVA=4000;
    async function tentarCom(model){
      var teto=ordemEdicao?TETO_EDICAO:TETO_CHAT;
      try{ return await tentar(model, teto); }
      catch(e){
        if(ordemEdicao && /max_tokens|maximum|too large|context length/i.test(String(e.message||'')) ) return await tentar(model, TETO_RESERVA);
        throw e;
      }
    }

    try{
      var txt;
      try{ txt=await tentarCom(MODEL_PRIMARY); } catch(e){ if(e.message==='AUTH'||e.message==='RATE') throw e; try{ txt=await tentarCom(MODEL_FALLBACK); }catch(e2){ if(e2.message==='AUTH'||e2.message==='RATE') throw e2; txt=await tentarCom(MODEL_FALLBACK2); } }
      return {texto: txt, modo:'online', ordemEdicao:ordemEdicao};
    }catch(e){
      console.warn('[IA desktop]',e);
      if(e.message==='AUTH') return {texto:_t('Chave de IA inválida. Verifique em Configurações → IA (OpenRouter).'), modo:'offline'};
      if(e.message==='RATE') return {texto:_t('IA em limite de uso. Aguarde um minuto e tente de novo.'), modo:'offline'};
      // fallback offline: se for FAQ, responde FAQ mesmo sem internet
      var faqFb=respostaRecursoApp(perguntaLimpa);
      if(faqFb) return {texto:faqFb, modo:'offline'};
      if(ctxTexto) return {texto:_t('Não consegui conectar à IA online, mas encontrei:')+'\n\n'+ctxTexto+'\n\n'+_t('_(Verifique a internet ou a chave em Configurações → IA)_'), modo:'offline'};
      return {texto:_t('Não consegui conectar à IA online. Verifique a internet ou a chave em Configurações → IA.'), modo:'offline'};
    }
  }

  root.iaDesktop={ perguntar: perguntar, _ehSaudacao: ehSaudacao, _ehPerguntaIdentidade: ehPerguntaIdentidade,
    /** Define as notas/listas com ids (chamado por app.js antes de perguntar). */
    definirAlvos: function(itens){ storeNotas=Array.isArray(itens)?itens:[]; mapearMidias(storeNotas); },
    /**
     * Proposta de edição da IA (protocolo igual ao celular): procura bloco
     * ```json {"edicao":{...}} ``` na resposta. Retorna {proposta, textoLimpo}.
     * O app NUNCA aplica sozinho — mostra confirmação ao usuário.
     */
    extrairPropostaEdicao: function(texto){
      var bruto=String(texto||'');
      var cerca=bruto.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
      var solto=bruto.match(/\{[\s\S]*"edicao"[\s\S]*\}/);
      var candidatos=[]; if(cerca) candidatos.push(cerca[1]); if(solto) candidatos.push(solto[0]);
      for(var i=0;i<candidatos.length;i++){
        try{
          var obj=JSON.parse(candidatos[i]); var ed=obj&&typeof obj==='object'?obj.edicao:null;
          if(ed&&typeof ed==='object'){
            var proposta={};
            if(typeof ed.alvo==='string'&&ed.alvo.trim()) proposta.alvo=ed.alvo.trim();
            if(typeof ed.explicacao==='string') proposta.explicacao=ed.explicacao;
            if(typeof ed.titulo==='string'&&ed.titulo.trim()) proposta.titulo=ed.titulo.trim();
            if(typeof ed.conteudo==='string'&&ed.conteudo.trim()) proposta.conteudo=ed.conteudo;
            if(Array.isArray(ed.itens)){
              var itens=ed.itens.filter(function(it){return it&&typeof it==='object'&&typeof it.texto==='string'&&it.texto.trim();})
                .map(function(it){return {texto:String(it.texto).trim(), concluido:!!it.concluido};});
              if(itens.length) proposta.itens=itens;
            }
            if(proposta.conteudo||proposta.itens||proposta.titulo){
              var limpo=bruto.replace((cerca&&cerca[0])||(solto&&solto[0])||'','').trim();
              return {proposta:proposta, textoLimpo:limpo||proposta.explicacao||''};
            }
          }
        }catch(e){ /* JSON inválido — tenta o próximo */ }
      }
      return {proposta:null, textoLimpo:bruto};
    },
    /** Instrução de edição (mesma função do system prompt; exposta p/ testes). */
    instrucaoEdicao: instrucaoEdicao,
    /** Detecta ordem de edição (só nesses casos a IA propõe mudança). */
    ehOrdemEdicao: ehOrdemEdicao,
    /** Conteúdo final para gravar na nota (mídia, frases da IA, título, HTML). */
    conteudoAplicado: conteudoAplicado,
    /** Conversão da formatação (nota HTML <-> notação compacta). Expostas p/ testes. */
    htmlParaMarkdown: htmlParaMarkdown,
    markdownParaHtml: markdownParaHtml,
    pareceMarkdown: pareceMarkdown,
  };
})(typeof self!=='undefined'?self:this);
