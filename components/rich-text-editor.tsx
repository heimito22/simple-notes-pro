import React, { forwardRef, memo, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Paths } from 'expo-file-system';

export interface FormatoAtivo {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeThrough: boolean;
  unorderedList: boolean;
  orderedList: boolean;
}

export interface RichTextEditorHandle {
  execCommand: (cmd: string) => void;
  setContent: (html: string) => void;
  appendContent: (html: string, options?: { focus?: boolean }) => void;
  /** Remove o foco do WebView sem recarregar o conteúdo ou reabrir o teclado. */
  blur: () => void;
  /** Alterna o modo leitura/edição (contenteditable) sem recarregar o WebView. */
  setEditable: (editavel: boolean) => void;
  /** Rola até o fim e posiciona o cursor no final (para continuar a nota após anexos). */
  prepararEscrita: () => void;
}

interface Props {
  /** Conteúdo inicial (usado apenas no mount — o editor é não-controlado depois). */
  initialValue?: string;
  onChange?: (html: string) => void;
  onFormatoChange?: (fmt: FormatoAtivo) => void;
  /** Modo leitura inicial. Mudanças usam setEditable() (sem recarregar o WebView). */
  editavel?: boolean;
  placeholder?: string;
  textColor: string;
  placeholderColor: string;
  backgroundColor: string;
  accentColor: string;
  /** URI base das pastas de anexos (para converter marcadores antigos em <img>/<audio>). */
  imagensDirUri?: string;
  audiosDirUri?: string;
  /** Posição de rolagem (y) e altura rolável máxima (com throttle) — p/ o botão "Continuar no fim". */
  onScrollPos?: (y: number, maxScroll: number) => void;
  /** Solicita a remoção de um áudio exibido inline na nota. */
  onAudioDelete?: (uri: string) => void;
  style?: any;
}

/**
 * Limpa/normaliza o conteúdo antes de injetar no WebView:
 * - Remove scripts, atributos de evento e tags do shell
 * - Mantém <img> com src local file:/data:/content: (com ou sem aspas); as
 *   demais (ex.: src remoto sem permissão) viram [Foto]
 * - Converte quebras de linha cruas em <br> (notas antigas em texto puro)
 */
const sanitize = (html: string) =>
  (html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\s+on\w+\s*=\s*['"]?[^'">\s]*/gi, '')
    .replace(/<\/?(body|html|head)[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Aceita src com ou sem aspas: src="file:///...", src='data:...', src=content:...
    .replace(/<img(?![^>]*\bsrc\s*=\s*['"]?(file:|data:|content:))[^>]*>/gi, ' [Foto] ')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '<br>');

const escaparHtml = (valor: string) => valor
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const audioInlineHtml = (uri: string, nome: string) => {
  const uriHtml = escaparHtml(uri);
  const nomeHtml = escaparHtml(nome);
  return `<span class="anexo-audio-inline" data-audio-uri="${uriHtml}" data-audio-name="${nomeHtml}"><audio controls src="${uriHtml}" class="anexo-audio"></audio><button type="button" class="anexo-audio-remove" data-audio-delete="${uriHtml}" aria-label="Apagar áudio">×</button></span>`;
};

// Remove as apresentações antigas (texto, player circular ou card) e preserva
// somente o controle nativo do Android dentro do conteúdo da nota.
const normalizarAudioInline = (html: string) => html.replace(
  /<span\b[^>]*class=["'][^"']*anexo-audio-inline[^"']*["'][^>]*>[\s\S]*?(<audio\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/audio>)[\s\S]*?<\/span>/gi,
  (_bloco, audioTag: string, uri: string) => `<span class="anexo-audio-inline" data-audio-uri="${uri}">${audioTag}<button type="button" class="anexo-audio-remove" data-audio-delete="${uri}" aria-label="Apagar áudio">×</button></span>`
);

// Converte marcadores de anexos antigos ("[Imagem anexada: x.jpg]") em tags reais.
const converterMarcadores = (html: string, imagensDirUri?: string, audiosDirUri?: string) => {
  if (!html || (!imagensDirUri && !audiosDirUri)) return html;
  const convertido = html
    .replace(/\[Imagem anexada:\s*([^\]]+?)\s*\]/gi, (m, nome: string) =>
      imagensDirUri
        ? `<img src="${imagensDirUri}/${nome.trim()}" alt="${nome.trim()}" class="anexo-img">`
        : m
    )
    .replace(/\[Áudio anexado:\s*([^\]]+?)\s*\]/gi, (m, nome: string) => {
      const nomeLimpo = nome.trim();
      return audiosDirUri
        ? `<br>${audioInlineHtml(`${audiosDirUri}/${nomeLimpo}`, nomeLimpo)}<br>`
        : m;
    });
  return normalizarAudioInline(convertido);
};

// Serializa para uma string JS segura dentro de <script> (escapa `<` para
// impedir que um `</script>` literal no conteúdo feche o script do shell).
const toJSString = (s: string) => JSON.stringify(s).replace(/</g, '\\u003c');

const buildDoc = (
  initialHtml: string,
  textColor: string,
  placeholderColor: string,
  backgroundColor: string,
  accentColor: string,
  placeholder: string,
  editavel: boolean
) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
  * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
  /* min-height (não height fixa) é ESSENCIAL: com altura fixa + border-box o
     conteúdo transborda o body e o padding-bottom nunca vira espaço rolável,
     prendendo o fim da nota atrás da toolbar. */
  html { height: 100%; }
  body { margin: 0; padding: 0; min-height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 18px;
    line-height: 1.55;
    color: ${textColor};
    background: ${backgroundColor};
    padding: 4px 25px 16px;
  }
  /* Em edição: espaço extra no fim (acima da toolbar) para o texto final nunca
     ficar preso atrás dela — com adjustResize o teclado encolhe a janela, então
     o espaço do teclado já é liberado sozinho (innerHeight diminui). */
  body.editando { padding-bottom: 210px; }
  #editor { outline: none; min-height: 60vh; word-break: break-word; }
  #editor:empty::before { content: attr(data-placeholder); color: ${placeholderColor}; pointer-events: none; }
  ul, ol { padding-left: 26px; margin: 6px 0; }
  li { margin: 3px 0; }
  h1 { font-size: 26px; margin: 10px 0 6px; }
  h2 { font-size: 22px; margin: 10px 0 6px; }
  h3 { font-size: 19px; margin: 8px 0 4px; }
  blockquote { border-left: 3px solid ${accentColor}; margin: 8px 0; padding-left: 12px; color: ${placeholderColor}; }
  a { color: ${accentColor}; }
  /* Limita a altura das imagens (fotos verticais grandes não podem bloquear o
     acesso ao texto abaixo delas) — mantém a proporção com width/height auto. */
  img { max-width: 100%; max-height: 60vh; width: auto; height: auto; }
  img.anexo-img { border-radius: 14px; margin: 8px 0; display: block; }
  /* Imagens da nota: sem arraste nativo nem menu de contexto/toque longo do
     navegador — o reposicionamento é controlado pelo JS (fantasma + linha). */
  img.anexo-img {
    -webkit-user-drag: none;
    -webkit-touch-callout: none;
    user-select: none;
    -webkit-user-select: none;
  }
  body.editando img.anexo-img { touch-action: none; }
  /* Player original: controle nativo do Android/WebView, sem card, nome ou
     player customizado. O wrapper existe apenas para manter a exclusão. */
  .anexo-audio-inline {
    display: flex;
    align-items: center;
    width: 100%;
    margin: 8px 0;
    gap: 8px;
  }
  audio.anexo-audio {
    display: block !important;
    flex: 1;
    min-width: 0;
    width: 100%;
    height: 48px;
    margin: 0;
  }
  .anexo-audio-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 28px;
    border: 0;
    border-radius: 14px;
    background: ${accentColor};
    color: ${backgroundColor};
    font-size: 18px;
    line-height: 28px;
    width: 28px;
    height: 28px;
    padding: 0;
  }
  body:not(.editando) .anexo-audio-remove { display: none; }
</style>
</head>
<body class="${editavel ? 'editando' : ''}">
<div id="editor" contenteditable="${editavel ? 'true' : 'false'}" data-placeholder="${placeholder.replace(/"/g, '&quot;')}"></div>
<script>
(function() {
  var el = document.getElementById('editor');
  // Conteúdo inicial injetado via JSON (evita quebrar o shell com tags literais no texto)
  var initial = ${toJSString(initialHtml)};
  el.innerHTML = initial;
  var savedRange = null;

  function notify() {
    window.ReactNativeWebView.postMessage(el.innerHTML);
  }
  function cmdState(c) {
    try { return !!document.queryCommandState(c); } catch (e) { return false; }
  }
  function currentFormats() {
    var sel = window.getSelection();
    var fmt = {
      bold: cmdState('bold'),
      italic: cmdState('italic'),
      underline: cmdState('underline'),
      strikeThrough: cmdState('strikeThrough'),
      unorderedList: false,
      orderedList: false
    };
    if (sel && sel.rangeCount > 0) {
      var node = sel.getRangeAt(0).commonAncestorContainer;
      if (node.nodeType === 3) node = node.parentNode;
      var n = node;
      while (n && n !== document.body && n !== document.documentElement) {
        var tag = n.nodeName;
        if (tag === 'UL') fmt.unorderedList = true;
        if (tag === 'OL') fmt.orderedList = true;
        n = n.parentNode;
      }
    }
    return fmt;
  }
  var fmtTimer = null;
  function notifyFormats() {
    window.ReactNativeWebView.postMessage('__fmt__' + JSON.stringify(currentFormats()));
  }
  function scheduleFormats() {
    if (fmtTimer) return;
    fmtTimer = setTimeout(function() { fmtTimer = null; notifyFormats(); }, 120);
  }

  // Evita que mudanças PROGRAMÁTICAS de seleção (disparadas pelo próprio execCommand)
  // sobrescrevam a seleção do usuário. Sem isso, o Android colapsa a seleção no meio
  // do comando e os botões da toolbar ficam alternando modos sozinhos.
  var aplicandoComando = false;

  el.addEventListener('click', function(event) {
    var target = event.target;
    var botao = target && target.closest ? target.closest('[data-audio-delete]') : null;
    if (!botao) return;
    event.preventDefault();
    event.stopPropagation();
    var audio = botao.parentNode && botao.parentNode.querySelector ? botao.parentNode.querySelector('audio') : null;
    if (audio) {
      try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) {}
    }
    window.ReactNativeWebView.postMessage('__delete_audio__' + (botao.getAttribute('data-audio-delete') || ''));
  });
  el.addEventListener('input', notify);
  el.addEventListener('blur', function() {
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0) savedRange = sel.getRangeAt(0).cloneRange();
  });
  document.addEventListener('selectionchange', function() {
    var sel = window.getSelection();
    if (!aplicandoComando && sel && sel.rangeCount > 0) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
    scheduleFormats();
  });

  window.editorSetContent = function(html) {
    el.innerHTML = html;
    notify();
    scheduleFormats();
    return true;
  };
  window.editorAppend = function(html, shouldFocus) {
    if (shouldFocus !== false) {
      el.focus();
      try {
        var sel = window.getSelection();
        sel.selectAllChildren(el);
        sel.collapseToEnd();
        document.execCommand('insertHTML', false, html);
      } catch (e) {}
      // Rola para o FIM quando a inserção também devolve o foco ao editor.
      setTimeout(rolarParaOFim, 60);
    } else {
      // Anexos de áudio entram no conteúdo sem focar o WebView. Isso evita que o
      // teclado reabra quando a gravação termina.
      try { el.insertAdjacentHTML('beforeend', html); } catch (e) {}
    }
    notify();
    scheduleFormats();
    return true;
  };
  window.editorBlur = function() {
    try { el.blur(); } catch (e) {}
    try {
      var active = document.activeElement;
      if (active && active !== document.body && active.blur) active.blur();
    } catch (e) {}
    return true;
  };
  window.editorSetEditable = function(v) {
    el.contentEditable = v ? 'true' : 'false';
    document.body.classList.toggle('editando', !!v);
    if (v) {
      el.focus();
      try {
        var sel = window.getSelection();
        sel.selectAllChildren(el);
        sel.collapseToEnd();
      } catch (e) {}
      // Rola até o fim: anexos grandes não podem impedir de tocar abaixo deles
      setTimeout(rolarParaOFim, 80);
    }
    notifyScroll();
    return true;
  };
  // Prepara a escrita após recarregar em modo edição: coloca o cursor no fim e
  // rola até o final da nota (continuar a digitação logo abaixo das imagens).
  window.editorPrepararEscrita = function() {
    el.focus();
    try {
      var sel = window.getSelection();
      sel.selectAllChildren(el);
      sel.collapseToEnd();
    } catch (e) {}
    setTimeout(rolarParaOFim, 80);
    return true;
  };

  window.editorExec = function(cmd) {
    // Flag ANTES do focus: o próprio focus() pode disparar selectionchange (o Android
    // às vezes desloca o caret ao focar) e não pode sobrescrever o savedRange.
    aplicandoComando = true;
    el.focus();
    var sel = window.getSelection();
    if (savedRange) {
      // Se o range salvo ficou inválido (DOM reestruturado por um comando anterior,
      // ex.: texto envolvido em <b>/<li>), DESCARTE e use a seleção atual — reaplicar
      // um range velho depois de removeAllRanges zera a seleção e mata os toggles.
      try { sel.removeAllRanges(); sel.addRange(savedRange); } catch (e) { savedRange = null; }
    }
    document.execCommand(cmd, false, null);
    // Re-captura a seleção pós-comando SE o WebView a manteve não colapsada: assim,
    // comandos consecutivos (N + I + desligar N) atuam no mesmo trecho. NADA é
    // re-aplicado aqui — re-selecionar range antigo após reestruturação quebra tudo.
    if (sel && sel.rangeCount > 0) {
      var r = sel.getRangeAt(0);
      if (!r.collapsed) savedRange = r.cloneRange();
    }
    aplicandoComando = false;
    notify();
    notifyFormats();
    return true;
  };

  // Posição de rolagem (com throttle) — o app usa para mostrar o botão
  // "Continuar no fim" apenas quando a nota está no topo (ou levemente acima).
  var scrollT = null;
  function notifyScroll() {
    var de = document.documentElement, be = document.body;
    // Alguns WebViews rolam o body, outros o documentElement — leia de todas as fontes.
    var y = Math.max(window.pageYOffset || 0, de.scrollTop || 0, be.scrollTop || 0);
    var h = Math.max(de.scrollHeight || 0, be.scrollHeight || 0, de.offsetHeight || 0, be.offsetHeight || 0);
    var max = Math.max(0, h - window.innerHeight);
    window.ReactNativeWebView.postMessage('__scroll__' + Math.round(y) + '|' + Math.round(max));
  }
  // Rola até o FIM REAL (incluindo o padding extra que libera o texto da toolbar).
  function rolarParaOFim() {
    var de = document.documentElement, be = document.body;
    var h = Math.max(de.scrollHeight || 0, be.scrollHeight || 0);
    try { window.scrollTo(0, h); } catch (e) {}
    notifyScroll();
  }
  window.addEventListener('scroll', function() {
    if (scrollT) return;
    scrollT = setTimeout(function() { scrollT = null; notifyScroll(); }, 80);
  }, { passive: true });
  notifyScroll();

  /* ============ ARRASTE DE IMAGENS ============
     Segura numa foto e arrasta: um fantasma segue o dedo e uma linha
     indicadora mostra ENTRE quais linhas de texto ela vai entrar. Ao soltar,
     a imagem é movida para aquela posição do conteúdo (e o app salva). */
  var COR_LINHA = '${accentColor}';
  var imgArrastada = null;  // <img> original
  var fantasma = null;      // clone que segue o dedo
  var linhaDrop = null;     // linha indicadora
  var dragAtivo = false;
  var dragX0 = 0, dragY0 = 0; // ponto onde o toque começou

  function eImagem(t) {
    return t && t.tagName === 'IMG' && t.classList && t.classList.contains('anexo-img');
  }
  function subirBloco(node) {
    if (!node) return null;
    if (node.nodeType === 3) node = node.parentNode;
    while (node && node !== el && !/^(DIV|P|LI|H[1-6]|BLOCKQUOTE|UL|OL)$/.test(node.nodeName)) {
      node = node.parentNode;
    }
    return node && node !== el ? node : null;
  }
  function rangeEmPonto(x, y) {
    try {
      if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    } catch (e) {}
    return null;
  }
  function posicaoDaLinha(x, y) {
    // Chrome/WebView Android: caretRangeFromPoint dá a linha de texto exata.
    var range = rangeEmPonto(x, y);
    if (range) {
      var r = range.getBoundingClientRect();
      // Range de caret colapsado tem largura 0 (Chrome/WebView Android) mas
      // ALTURA = altura da linha — é isso que usamos para achar a linha exata.
      if (r && r.height > 0) {
        // Dedo na metade inferior da linha → a imagem entra DEPOIS dela
        // (linha indicadora na base); na metade superior → entra ANTES.
        var depois = y > r.top + r.height / 2;
        return { range: range, y: depois ? r.bottom : r.top, depois: depois };
      }
    }
    // Fallback (iOS/WKWebView): usa o bloco de texto mais próximo.
    var alvo = document.elementFromPoint(x, y);
    var bloco = subirBloco(alvo);
    if (bloco) {
      var br = bloco.getBoundingClientRect();
      var depois2 = y > br.top + br.height / 2;
      return { bloco: bloco, y: depois2 ? br.bottom : br.top, depois: depois2 };
    }
    return null;
  }

  function iniciarArraste(img, x, y) {
    if (!document.body.classList.contains('editando')) return;
    imgArrastada = img;
    dragAtivo = true;
    fantasma = img.cloneNode(true);
    fantasma.removeAttribute('width');
    fantasma.removeAttribute('height');
    fantasma.style.cssText = 'position:fixed;left:0;top:0;max-width:130px;max-height:130px;opacity:0.9;pointer-events:none;z-index:99999;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.35);transform:translate(-50%,-50%);';
    document.body.appendChild(fantasma);
    linhaDrop = document.createElement('div');
    linhaDrop.style.cssText = 'position:fixed;left:25px;right:25px;height:3px;background:' + COR_LINHA + ';pointer-events:none;z-index:99998;opacity:0;box-shadow:0 0 8px ' + COR_LINHA + ';border-radius:2px;';
    document.body.appendChild(linhaDrop);
    img.style.opacity = '0.25';
    dragX0 = x; dragY0 = y;
    moverArraste(x, y);
  }

  function moverArraste(x, y) {
    if (!dragAtivo || !fantasma) return;
    fantasma.style.left = x + 'px';
    fantasma.style.top = y + 'px';
    // A linha só aparece depois de um deslocamento real (o toque inicial na
    // imagem não deve sugerir que ela já vai se mover).
    var dist = Math.sqrt((x - dragX0) * (x - dragX0) + (y - dragY0) * (y - dragY0));
    if (dist < 8) {
      linhaDrop.style.opacity = '0';
      return;
    }
    var p = posicaoDaLinha(x, y);
    if (p) {
      linhaDrop.style.top = Math.max(0, p.y) + 'px';
      linhaDrop.style.opacity = '0.95';
    } else {
      linhaDrop.style.opacity = '0';
    }
  }

  function removerImgComBrsVizinhos(img) {
    var pai = img.parentNode;
    if (!pai) return;
    // Remove até um <br> imediatamente antes e um imediatamente depois da imagem.
    var anterior = img.previousSibling;
    if (anterior && anterior.nodeName === 'BR') pai.removeChild(anterior);
    var proximo = img.nextSibling;
    if (proximo && proximo.nodeName === 'BR') pai.removeChild(proximo);
    pai.removeChild(img);
  }

  function limparArraste() {
    dragAtivo = false;
    if (fantasma && fantasma.parentNode) fantasma.parentNode.removeChild(fantasma);
    if (linhaDrop && linhaDrop.parentNode) linhaDrop.parentNode.removeChild(linhaDrop);
    fantasma = null;
    linhaDrop = null;
    if (imgArrastada) { imgArrastada.style.opacity = ''; imgArrastada = null; }
  }

  function soltarArraste(x, y) {
    if (!dragAtivo) return;
    dragAtivo = false;
    var img = imgArrastada;
    limparArraste();
    // Toque simples (sem arrastar): não mexe em nada.
    var dist = Math.sqrt((x - dragX0) * (x - dragX0) + (y - dragY0) * (y - dragY0));
    if (!img || !img.parentNode || dist < 8) return;
    var p = posicaoDaLinha(x, y);
    var nova = img.cloneNode(true);
    nova.removeAttribute('width');
    nova.removeAttribute('height');
    // A classe da animação de chegada NUNCA vai para o conteúdo salvo: ela é
    // aplicada no nó vivo após a inserção e removida ao terminar (ver abaixo).
    nova.classList.remove('chegou');
    // A imagem é um bloco próprio (display:block + margens) — entra sem <br>
    // extras. Remove da origem os <br> vizinhos para não sobrar linha vazia.
    // Insere via insertBefore (nó vivo) para poder animar e limpar a classe.
    var inserida = null;
    var inserirPerto = function(bloco, depois) {
      // Dentro de lista (li), sobe para a <ul>/<ol>: imagem dentro de <ul>
      // fora de <li> é HTML inválido — a foto entra antes/depois da lista.
      if (bloco && /^(LI)$/.test(bloco.nodeName)) bloco = bloco.parentNode;
      if (!bloco) return;
      var pai = bloco.parentNode;
      if (!pai) return;
      if (depois) pai.insertBefore(nova, bloco.nextSibling);
      else pai.insertBefore(nova, bloco);
      inserida = nova;
    };
    if (p && p.range) {
      // Preferência: inserir antes/depois do BLOCO de texto (nunca divide uma
      // palavra ao meio — soltar logo abaixo de uma linha não corta o texto).
      var bloco = subirBloco(p.range.startContainer);
      if (bloco) {
        inserirPerto(bloco, p.depois);
      } else {
        // Texto direto no #editor (sem <div>): usa o caret, mas ajustado para
        // o INÍCIO ou o FIM do nó de texto conforme a direção — sem dividir
        // palavra também neste caso.
        try {
          var node = p.range.startContainer;
          var off;
          if (node && node.nodeType === 3) off = p.depois ? node.length : 0;
          else if (node && node.nodeType === 1) off = p.depois ? node.childNodes.length : 0;
          else off = 0;
          p.range.setStart(node, off);
          p.range.setEnd(node, off);
          p.range.insertNode(nova);
          inserida = nova;
        } catch (e) {}
      }
    } else if (p && p.bloco) {
      inserirPerto(p.bloco, p.depois);
    }
    // Soltou numa área vazia do editor (abaixo do último texto): coloca no fim.
    if (!inserida) {
      el.appendChild(nova);
      inserida = nova;
    }
    // Só remove a original se a cópia foi realmente inserida. Se por algum
    // motivo a inserção falhou (ex.: range inválido), a imagem fica onde estava
    // — nunca há perda de dado no arraste.
    if (!inserida) return;
    removerImgComBrsVizinhos(img);
    // Animação de chegada via Web Animations API: roda no nó vivo SEM tocar no
    // DOM (nenhuma classe/style entra no innerHTML) — o conteúdo salvo fica
    // sempre limpo, mesmo se o usuário digitar logo em seguida.
    notify();
    scheduleFormats();
    if (inserida && typeof inserida.animate === 'function') {
      try {
        inserida.animate(
          [{ transform: 'scale(0.92)', opacity: 0.4 }, { transform: 'scale(1)', opacity: 1 }],
          { duration: 350, easing: 'ease' }
        );
      } catch (e) {}
    }
  }

  // Pointer Events (WebView Android moderno) com fallback para touch.
  if (window.PointerEvent) {
    el.addEventListener('pointerdown', function(e) {
      var t = e.target;
      if (!eImagem(t)) return;
      if (!document.body.classList.contains('editando')) return;
      e.preventDefault();
      iniciarArraste(t, e.clientX, e.clientY);
    });
    document.addEventListener('pointermove', function(e) {
      if (dragAtivo) { e.preventDefault(); moverArraste(e.clientX, e.clientY); }
    }, { passive: false });
    document.addEventListener('pointerup', function(e) {
      if (dragAtivo) soltarArraste(e.clientX, e.clientY);
    });
    document.addEventListener('pointercancel', limparArraste);
  } else {
    el.addEventListener('touchstart', function(e) {
      var t = e.target;
      if (!eImagem(t)) return;
      if (!document.body.classList.contains('editando')) return;
      e.preventDefault();
      var touch = e.touches && e.touches[0];
      if (touch) iniciarArraste(t, touch.clientX, touch.clientY);
    }, { passive: false });
    document.addEventListener('touchmove', function(e) {
      if (dragAtivo) {
        e.preventDefault();
        var touch = e.touches && e.touches[0];
        if (touch) moverArraste(touch.clientX, touch.clientY);
      }
    }, { passive: false });
    document.addEventListener('touchend', function(e) {
      if (dragAtivo) {
        var touch = e.changedTouches && e.changedTouches[0];
        if (touch) soltarArraste(touch.clientX, touch.clientY);
        else limparArraste();
      }
    });
    document.addEventListener('touchcancel', limparArraste);
  }
  // Impede o menu de contexto (long-press) sobre a imagem no Android.
  el.addEventListener('contextmenu', function(e) {
    if (eImagem(e.target)) e.preventDefault();
  });

  notify();
  notifyFormats();
})();
</script>
</body>
</html>`;

const RichTextEditor = memo(
  forwardRef<RichTextEditorHandle, Props>(function RichTextEditor(
    {
      initialValue = '',
      onChange,
      onFormatoChange,
      placeholder = '',
      textColor,
      placeholderColor,
      backgroundColor,
      accentColor,
      editavel = true,
      imagensDirUri,
      audiosDirUri,
      onScrollPos,
      onAudioDelete,
      style,
    },
    ref
  ) {
    const webviewRef = useRef<WebView>(null);
    const loadedRef = useRef(false);
    const pendingContent = useRef<string | null>(null);

    // Conteúdo inicial capturado uma única vez (o WebView NÃO é recarregado nem
    // re-injetado durante a digitação — isso eliminou o bug de texto embaralhado).
    const [initialContent] = useState(() =>
      sanitize(converterMarcadores(initialValue, imagensDirUri, audiosDirUri))
    );
    // useRef usa o argumento apenas no mount: não sobrescreve o conteúdo digitado em re-renders.
    const ultimoConteudo = useRef(initialContent);

    // O doc depende do modo (editavel): trocar leitura→edição recarrega o WebView
    // com o contenteditable CORRETO embutido. Alternar via JS (el.contentEditable)
    // é instável no Android (cursor/caret não aparecem) — por isso recarregamos.
    const doc = useMemo(
      () => buildDoc(initialContent, textColor, placeholderColor, backgroundColor, accentColor, placeholder, editavel),
      [initialContent, textColor, placeholderColor, backgroundColor, accentColor, placeholder, editavel]
    );
    // Objeto estável: evita que o react-native-webview recarregue a página em re-renders.
    const source = useMemo(() => ({ html: doc }), [doc]);

    const injetar = (script: string) => webviewRef.current?.injectJavaScript(script);

    useImperativeHandle(ref, () => ({
      execCommand: (cmd: string) => {
        injetar(`window.editorExec(${toJSString(cmd)}); true;`);
      },
      setContent: (html: string) => {
        const h = sanitize(converterMarcadores(html, imagensDirUri, audiosDirUri));
        ultimoConteudo.current = h;
        if (loadedRef.current) {
          injetar(`window.editorSetContent(${toJSString(h)}); true;`);
        } else {
          pendingContent.current = h;
        }
      },
      appendContent: (html: string, options?: { focus?: boolean }) => {
        ultimoConteudo.current = ultimoConteudo.current + html;
        if (loadedRef.current) {
          const deveFocar = options?.focus !== false;
          injetar(`window.editorAppend(${toJSString(html)}, ${deveFocar}); true;`);
        } else {
          pendingContent.current = ultimoConteudo.current;
        }
      },
      blur: () => {
        injetar('window.editorBlur(); true;');
      },
      setEditable: (v: boolean) => {
        injetar(`window.editorSetEditable(${v}); true;`);
      },
      prepararEscrita: () => {
        injetar('window.editorPrepararEscrita(); true;');
      },
    }));

    const handleMessage = (event: WebViewMessageEvent) => {
      const data = event.nativeEvent.data;
      if (typeof data === 'string' && data.startsWith('__scroll__')) {
        const partes = data.slice(9).split('|');
        onScrollPos?.(Number(partes[0]) || 0, Number(partes[1]) || 0);
        return;
      }
      if (typeof data === 'string' && data.startsWith('__fmt__')) {
        try {
          onFormatoChange?.(JSON.parse(data.slice(7)));
        } catch {
          // ignora payload de formato inválido
        }
        return;
      }
      if (typeof data === 'string' && data.startsWith('__delete_audio__')) {
        onAudioDelete?.(data.slice('__delete_audio__'.length));
        return;
      }
      ultimoConteudo.current = data;
      onChange?.(data);
    };

    const handleLoadEnd = () => {
      loadedRef.current = true;
      let alvo: string | null = pendingContent.current;
      pendingContent.current = null;
      if (alvo == null && ultimoConteudo.current !== initialContent) {
        alvo = ultimoConteudo.current;
      }
      if (alvo != null) {
        injetar(`window.editorSetContent(${toJSString(alvo)}); true;`);
      }
      // Ao entrar em edição (a troca de modo recarrega o WebView), posiciona o
      // cursor no fim e rola até o final — sem isso, imagens grandes impedem de
      // tocar abaixo delas para continuar a nota.
      if (editavel) {
        injetar('window.editorPrepararEscrita(); true;');
      }
    };

    return (
      <View style={[{ flex: 1 }, style]}>
        <WebView
          ref={webviewRef}
          source={source}
          onMessage={handleMessage}
          onLoadEnd={handleLoadEnd}
          style={{ flex: 1, backgroundColor }}
          keyboardDisplayRequiresUserAction={false}
          setSupportMultipleWindows={false}
          overScrollMode="never"
          originWhitelist={['*']}
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          allowingReadAccessToURL={Platform.OS === 'ios' ? Paths.document.uri : undefined}
          onContentProcessDidTerminate={() => webviewRef.current?.reload()}
        />
      </View>
    );
  })
);

export default RichTextEditor;
