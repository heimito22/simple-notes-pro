import React, { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Paths } from 'expo-file-system';
import { idiomaAtual, tIdioma } from '../context/idiomas';
import { WebViewWeb } from './webview-web';

// Na WEB o react-native-webview não existe (stub "does not support this
// platform"). WebViewWeb implementa a MESMA interface (source.html,
// onMessage, injetar JS, recarregar) com um <iframe> real — é o que faz o
// editor de notas funcionar no desktop.
const WebViewImpl: any = Platform.OS === 'web' ? WebViewWeb : WebView;

// Rótulo acessível do arraste de áudio, traduzido no momento do uso.
const rotuloGripAudio = () => tIdioma(idiomaAtual, 'Mover áudio');

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
  /** Re-lê e envia o estado de formatação ativo (usado ao entrar em edição). */
  atualizarFormato: () => void;
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
  return `<span class="anexo-audio-inline" data-audio-uri="${uriHtml}" data-audio-name="${nomeHtml}"><span class="anexo-audio-grip" contenteditable="false" aria-label="${rotuloGripAudio()}">⋮</span><audio controls src="${uriHtml}" class="anexo-audio"></audio></span>`;
};

// Remove as apresentações antigas (texto, player circular ou card) e preserva
// somente o controle nativo do Android dentro do conteúdo da nota.
const normalizarAudioInline = (html: string) => html.replace(
  /<span\b[^>]*class=["'][^"']*anexo-audio-inline[^"']*["'][^>]*>[\s\S]*?(<audio\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/audio>)[\s\S]*?<\/span>/gi,
  (_bloco, audioTag: string, uri: string) => `<span class="anexo-audio-inline" data-audio-uri="${uri}"><span class="anexo-audio-grip" contenteditable="false" aria-label="${rotuloGripAudio()}">⋮</span>${audioTag}</span>`
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
  /* Enquanto um gesto começa NUMA imagem/alça (segurar/arrastar), a seleção de
     texto do Android fica bloqueada: o toque longo do navegador (~500ms) cai
     DENTRO da espera de 280ms + pausa de mira do arraste e selecionava o texto
     ao redor da foto no meio do gesto — parecia bug. user-select bloqueia a
     seleção de verdade no Chromium (pointerdown preventDefault não basta). */
  body.bloqueia-selecao-anexo { -webkit-user-select: none !important; user-select: none !important; }
  /* Player original: controle nativo do Android/WebView, sem card, nome ou
     player customizado. O wrapper existe apenas para manter a exclusão. */
  .anexo-audio-inline {
    display: flex;
    align-items: center;
    width: 100%;
    margin: 8px 0;
    gap: 8px;
    -webkit-touch-callout: none;
  }
  /* Alça de arraste do áudio: visível APENAS em edição. É o único ponto de
     agarre do bloco — os controles nativos de play do <audio> continuam 100%
     funcionais (um agarre no bloco inteiro quebraria o toque no player). */
  .anexo-audio-grip {
    display: none;
    flex: 0 0 auto;
    width: 34px;
    height: 44px;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    background: ${accentColor}1A;
    color: ${accentColor};
    font-size: 18px;
    line-height: 1;
    user-select: none;
    -webkit-user-select: none;
    -webkit-user-drag: none;
    -webkit-touch-callout: none;
  }
  body.editando .anexo-audio-grip {
    display: flex;
    touch-action: none;
  }
  audio.anexo-audio {
    display: block !important;
    flex: 1;
    min-width: 0;
    width: 100%;
    height: 48px;
    margin: 0;
  }
  /* Margem extra abaixo do áudio para facilitar clicar/digitá-lo e
     para o arraste ficar mais acessível (área de toque maior). */
  .anexo-audio-inline { margin-bottom: 18px; }
  /* Área de toque ampliada: um padding transparente abaixo do bloco de áudio
     funciona como "corredor" para o cursor cair — o usuário toca nessa zona
     vazia e o cursor aparece logo abaixo do player, sem precisar mirar. */
  body.editando .anexo-audio-inline::after {
    content: '';
    display: block;
    height: 24px;
    margin-top: 4px;
  }
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

  // Ponte para o host: WebView nativo usa ReactNativeWebView; na WEB (desktop)
  // o iframe srcDoc fala com o parent via postMessage ({snEditor: msg}).
  var ponte = function(msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(msg);
    else try { window.parent.postMessage({ snEditor: msg }, '*'); } catch (e) {}
  };

  function notify() {
    ponte(el.innerHTML);
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
    ponte('__fmt__' + JSON.stringify(currentFormats()));
  }
  function scheduleFormats() {
    if (fmtTimer) return;
    fmtTimer = setTimeout(function() { fmtTimer = null; notifyFormats(); }, 120);
  }

  // Evita que mudanças PROGRAMÁTICAS de seleção (disparadas pelo próprio execCommand)
  // sobrescrevam a seleção do usuário. Sem isso, o Android colapsa a seleção no meio
  // do comando e os botões da toolbar ficam alternando modos sozinhos.
  var aplicandoComando = false;
  
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
    // SEM notify() aqui: o host que chamou setContent JÁ conhece esse html.
    // O eco fazia o postMessage devolver o html (possivelmente defasado —
    // salvo antes das últimas teclas em voo chegarem) e o handleMessage
    // SOBRESCREVIA o ref com conteúdo antigo: ao alternar para leitura o
    // recarregamento aplicava esse html velho e a alteração recente "sumia".
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
  };  function rangeValido(r) {
    if (!r) return false;
    try {
      var a = r.startContainer.nodeType === 3 ? r.startContainer.parentNode : r.startContainer;
      var b = r.endContainer.nodeType === 3 ? r.endContainer.parentNode : r.endContainer;
      if (!a || !b) return false;
      return document.documentElement.contains(a) && document.documentElement.contains(b);
    } catch (e) { return false; }
  }

  window.editorExec = function(cmd) {
    // Flag ANTES do focus: o próprio focus() pode disparar selectionchange (o Android
    // às vezes desloca o caret ao focar) e não pode sobrescrever o savedRange.
    aplicandoComando = true;
    el.focus();
    var sel = window.getSelection();
    // Restaura a seleção salva SÓ se ela ainda existir no documento. Reaplicar um
    // range velho (DOM reestruturado por um comando anterior, ex.: texto envolvido
    // em <b>/<li>) depois de removeAllRanges ZERA a seleção e mata os toggles — a
    // verificação de validade evita esse caminho antes de limpar a seleção atual.
    if (savedRange && rangeValido(savedRange)) {
      try {
        sel.removeAllRanges();
        sel.addRange(savedRange);
      } catch (e) {
        savedRange = null;
      }
    }

    var antes = currentFormats();
    document.execCommand(cmd, false, null);
    var depois = currentFormats();

    // Listas num bloco vazio/recém-criado: alguns WebViews ignoram o primeiro
    // insertUnorderedList/insertOrderedList quando não há linha de texto para
    // virar item. Se o comando não mudou nada, tenta uma vez de novo — o segundo
    // exec normalmente cria a lista (o primeiro apenas prepara o bloco).
    if (
      (cmd === 'insertUnorderedList' || cmd === 'insertOrderedList') &&
      !antes.unorderedList && !antes.orderedList &&
      !depois.unorderedList && !depois.orderedList
    ) {
      document.execCommand(cmd, false, null);
    }

    // Re-captura a seleção pós-comando SE o WebView a manteve não colapsada: assim,
    // comandos consecutivos (N + I + desligar N) atuam no mesmo trecho. NADA é
    // re-aplicado aqui — re-selecionar range antigo após reestruturação quebra tudo.
    try {
      if (sel && sel.rangeCount > 0) {
        var r = sel.getRangeAt(0);
        if (!r.collapsed && rangeValido(r)) savedRange = r.cloneRange();
      }
    } catch (e) {}
    aplicandoComando = false;
    notify();
    notifyFormats();
    // Alguns WebViews só terminam a reestruturação do DOM (ex.: envolver em <b>/
    // criar a <ul>) no próximo tick — um segundo aviso de estado evita o botão
    // ficar aceso/apagado errado logo depois do toque.
    setTimeout(function() {
      if (!aplicandoComando) notifyFormats();
    }, 40);
    return true;
  };

  window.editorNotificarFormatos = function() {
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
    ponte('__scroll__' + Math.round(y) + '|' + Math.round(max));
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

  /* ============ ARRASTE DE ANEXOS (IMAGENS E ÁUDIOS) ============
     Segura numa foto ou na alça de um áudio e arrasta: um fantasma segue o
     dedo e uma linha indicadora mostra ENTRE quais linhas de texto o anexo
     vai entrar. Ao soltar, o anexo é movido para aquela posição (e o app
     salva). Áudio usa apenas a alça (grip) como ponto de agarre — assim os
     controles de play do player nativo continuam tocáveis normalmente. */
  var COR_LINHA = '${accentColor}';
  var alvoArrastado = null; // <img> ou <span class="anexo-audio-inline"> original
  var fantasma = null;      // clone que segue o dedo
  var linhaDrop = null;     // linha indicadora
  var dragAtivo = false;
  var dragX0 = 0, dragY0 = 0; // ponto onde o toque começou

  /* SEGURAR-PARA-ARRastar (fotos): a imagem só entra no modo de arraste depois
     de ~280ms com o dedo parado. Um toque rápido, ou um deslize que começa
     antes do tempo, NÃO arrasta — evita ativar o modo sem querer. A alça ⋮ do
     áudio é um ponto de agarre dedicado e continua arrastando na hora. */
  var HOLD_MS = 280;
  var MOVE_CANCELA = 14; // mover além disso antes do tempo cancela a ativação
  var pendenteAlvo = null;
  var pendenteTimer = null;
  var pendenteX = 0, pendenteY = 0;

  // Bloqueio de seleção durante o gesto de anexo: aplicado no pointerdown e
  // removido só no fim do toque (up/cancel) — mesmo quando o segurar é
  // cancelado por deslize (a rolagem não é afetada por user-select).
  function bloquearSelecao(ligar) {
    if (ligar) document.body.classList.add('bloqueia-selecao-anexo');
    else document.body.classList.remove('bloqueia-selecao-anexo');
  }
  // Descarta qualquer seleção de texto ativa (destacada) sobre a nota.
  function limparSelecaoAtual() {
    try {
      var sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) sel.removeAllRanges();
    } catch (e) {}
  }

  function cancelarPendente() {
    if (pendenteTimer) { clearTimeout(pendenteTimer); pendenteTimer = null; }
    pendenteAlvo = null;
  }
  function armarPendente(alvo, x, y) {
    cancelarPendente();
    pendenteAlvo = alvo;
    pendenteX = x; pendenteY = y;
    pendenteTimer = setTimeout(function () {
      pendenteTimer = null;
      var alvo2 = pendenteAlvo;
      pendenteAlvo = null;
      if (!alvo2 || !alvo2.parentNode) return; // imagem saiu do documento
      if (!document.body.classList.contains('editando')) return;
      iniciarArraste(alvo2, pendenteX, pendenteY);
    }, HOLD_MS);
  }

  function eImagem(t) {
    return t && t.tagName === 'IMG' && t.classList && t.classList.contains('anexo-img');
  }
  function eAlcaGrip(t) {
    return t && t.classList && t.classList.contains('anexo-audio-grip');
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

  function iniciarArraste(alvo, x, y) {
    if (!document.body.classList.contains('editando')) return;
    // Nenhuma seleção antiga pode ficar ativa por cima do arraste.
    limparSelecaoAtual();
    alvoArrastado = alvo;
    dragAtivo = true;
    fantasma = alvo.cloneNode(true);
    if (fantasma.tagName === 'IMG') {
      fantasma.removeAttribute('width');
      fantasma.removeAttribute('height');
    }
    // Fantasma mais largo para áudios (o player inteiro acompanha o dedo);
    // fotos usam um quadrado compacto centrado no toque.
    var largura = fantasma.tagName === 'IMG' ? '130px' : 'min(280px, 70vw)';
    fantasma.style.cssText = 'position:fixed;left:0;top:0;max-width:' + largura + ';max-height:130px;opacity:0.9;pointer-events:none;z-index:99999;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.35);transform:translate(-50%,-50%);';
    document.body.appendChild(fantasma);
    linhaDrop = document.createElement('div');
    linhaDrop.style.cssText = 'position:fixed;left:25px;right:25px;height:3px;background:' + COR_LINHA + ';pointer-events:none;z-index:99998;opacity:0;box-shadow:0 0 8px ' + COR_LINHA + ';border-radius:2px;';
    document.body.appendChild(linhaDrop);
    alvo.style.opacity = '0.25';
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

  function removerAnexoComBrsVizinhos(alvo) {
    var pai = alvo.parentNode;
    if (!pai) return;
    // Remove até um <br> imediatamente antes e um imediatamente depois do anexo.
    var anterior = alvo.previousSibling;
    if (anterior && anterior.nodeName === 'BR') pai.removeChild(anterior);
    var proximo = alvo.nextSibling;
    if (proximo && proximo.nodeName === 'BR') pai.removeChild(proximo);
    pai.removeChild(alvo);
  }

  function limparArraste() {
    dragAtivo = false;
    if (fantasma && fantasma.parentNode) fantasma.parentNode.removeChild(fantasma);
    if (linhaDrop && linhaDrop.parentNode) linhaDrop.parentNode.removeChild(linhaDrop);
    fantasma = null;
    linhaDrop = null;
    if (alvoArrastado) { alvoArrastado.style.opacity = ''; alvoArrastado = null; }
  }

  function soltarArraste(x, y) {
    if (!dragAtivo) return;
    dragAtivo = false;
    var alvo = alvoArrastado;
    limparArraste();
    // Toque simples (sem arrastar): não mexe em nada.
    var dist = Math.sqrt((x - dragX0) * (x - dragX0) + (y - dragY0) * (y - dragY0));
    if (!alvo || !alvo.parentNode || dist < 8) return;
    var p = posicaoDaLinha(x, y);
    var nova = alvo.cloneNode(true);
    if (nova.tagName === 'IMG') {
      nova.removeAttribute('width');
      nova.removeAttribute('height');
    }
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
    removerAnexoComBrsVizinhos(alvo);
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
    // Garante que nenhum trecho de texto fique destacado após o drop.
    limparSelecaoAtual();
  }

  // SUPRESSÃO DE SELEÇÃO POR TOQUE LONGO (Android): mesmo com user-select:none
  // em CSS, o Chromium ainda inicia a seleção ao segurar numa imagem dentro de
  // um contenteditable. O único jeito que o Chromium respeita de verdade é
  // preventDefault no touchstart (fase de captura) — isso CANCELA o
  // reconhecedor de toque longo ANTES de a seleção nascer. Como a imagem já tem
  // touch-action:none (não rola pelo toque nela), o preventDefault não tira
  // nenhuma rolagem do usuário. Vale para o caminho de Pointer Events e o de
  // touch (fallback) — por isso fica fora do if/else abaixo.
  document.addEventListener('touchstart', function(e) {
    if (!document.body.classList.contains('editando')) return;
    if (!eImagem(e.target) && !eAlcaGrip(e.target)) return;
    e.preventDefault();
  }, { capture: true, passive: false });

  // Pointer Events (WebView Android moderno) com fallback para touch.
  if (window.PointerEvent) {
    el.addEventListener('pointerdown', function(e) {
      var t = e.target;
      if (!eImagem(t) && !eAlcaGrip(t)) return;
      if (!document.body.classList.contains('editando')) return;
      e.preventDefault();
      var alvo = eImagem(t) ? t : (t.closest ? t.closest('.anexo-audio-inline') : null);
      if (!alvo) return;
      // O toque começou num anexo: bloqueia a seleção de texto do Android por
      // TODO o gesto (a seleção do toque longo acontecia no meio do segurar/
      // arrastar) e descarta seleções antigas que sobraram na nota.
      bloquearSelecao(true);
      limparSelecaoAtual();
      if (eAlcaGrip(t)) {
        iniciarArraste(alvo, e.clientX, e.clientY); // alça dedicada: na hora
      } else {
        armarPendente(alvo, e.clientX, e.clientY); // foto: segure para ativar
      }
    });
    document.addEventListener('pointermove', function(e) {
      if (dragAtivo) { e.preventDefault(); moverArraste(e.clientX, e.clientY); return; }
      // Ainda não ativou: dedo deslizou antes do tempo → não era segurar.
      if (pendenteTimer) {
        var dx = e.clientX - pendenteX, dy = e.clientY - pendenteY;
        if (dx * dx + dy * dy > MOVE_CANCELA * MOVE_CANCELA) cancelarPendente();
      }
    }, { passive: false });
    document.addEventListener('pointerup', function(e) {
      if (dragAtivo) soltarArraste(e.clientX, e.clientY);
      else cancelarPendente(); // toque rápido: sem arraste
      bloquearSelecao(false); // gesto terminou: seleção normal volta
    });
    document.addEventListener('pointercancel', function() { limparArraste(); cancelarPendente(); bloquearSelecao(false); });
  } else {
    el.addEventListener('touchstart', function(e) {
      var t = e.target;
      if (!eImagem(t) && !eAlcaGrip(t)) return;
      if (!document.body.classList.contains('editando')) return;
      e.preventDefault();
      var alvo = eImagem(t) ? t : (t.closest ? t.closest('.anexo-audio-inline') : null);
      if (!alvo) return;
      var touch = e.touches && e.touches[0];
      if (!touch) return;
      // Mesmo bloqueio de seleção do caminho Pointer Events (ver acima).
      bloquearSelecao(true);
      limparSelecaoAtual();
      if (eAlcaGrip(t)) {
        iniciarArraste(alvo, touch.clientX, touch.clientY);
      } else {
        armarPendente(alvo, touch.clientX, touch.clientY);
      }
    }, { passive: false });
    document.addEventListener('touchmove', function(e) {
      if (dragAtivo) {
        e.preventDefault();
        var touch = e.touches && e.touches[0];
        if (touch) moverArraste(touch.clientX, touch.clientY);
        return;
      }
      if (pendenteTimer) {
        var touch = e.touches && e.touches[0];
        if (touch) {
          var dx = touch.clientX - pendenteX, dy = touch.clientY - pendenteY;
          if (dx * dx + dy * dy > MOVE_CANCELA * MOVE_CANCELA) cancelarPendente();
        }
      }
    }, { passive: false });
    document.addEventListener('touchend', function(e) {
      if (dragAtivo) {
        var touch = e.changedTouches && e.changedTouches[0];
        if (touch) soltarArraste(touch.clientX, touch.clientY);
        else limparArraste();
      } else {
        cancelarPendente(); // toque rápido: sem arraste
      }
      bloquearSelecao(false); // gesto terminou: seleção normal volta
    });
    document.addEventListener('touchcancel', function() { limparArraste(); cancelarPendente(); bloquearSelecao(false); });
  }
  // Impede o menu de contexto (long-press) sobre imagens e alças no Android.
  el.addEventListener('contextmenu', function(e) {
    if (eImagem(e.target) || eAlcaGrip(e.target)) e.preventDefault();
  });

  // BACKSPACE/DELETE para remover áudio: quando o cursor está logo após ou antes
  // de um .anexo-audio-inline, o backspace/remove o bloco inteiro (como se fosse
  // um caractere especial — sem botão X).
  document.addEventListener('keydown', function(e) {
    if (!document.body.classList.contains('editando')) return;
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    var range = sel.getRangeAt(0);
    if (!range.collapsed) return;
    var node = range.startContainer;
    if (node.nodeType === 3) node = node.parentNode;
    // Procura .anexo-audio-inline adjacente
    var audio = null;
    if (e.key === 'Backspace') {
      var prev = range.startOffset > 0 && node.nodeType === 3
        ? node.previousSibling : node.previousSibling;
      if (prev && prev.nodeType === 1) audio = prev.querySelector ? prev.querySelector('.anexo-audio-inline') : null;
      if (!audio && prev && prev.classList && prev.classList.contains('anexo-audio-inline')) audio = prev;
      if (!audio && prev && prev.nodeName === 'BR') {
        var pp = prev.previousSibling;
        if (pp && pp.classList && pp.classList.contains('anexo-audio-inline')) audio = pp;
      }
    } else {
      var next = node.nextSibling;
      if (next && next.nodeType === 1) audio = next.querySelector ? next.querySelector('.anexo-audio-inline') : null;
      if (!audio && next && next.classList && next.classList.contains('anexo-audio-inline')) audio = next;
    }
    if (audio) {
      e.preventDefault();
      var pai = audio.parentNode;
      // Remove <br> vizinhos
      if (audio.previousSibling && audio.previousSibling.nodeName === 'BR') pai.removeChild(audio.previousSibling);
      if (audio.nextSibling && audio.nextSibling.nodeName === 'BR') pai.removeChild(audio.nextSibling);
      pai.removeChild(audio);
      notify();
      scheduleFormats();
    }
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
      style,
    },
    ref
  ) {
    const webviewRef = useRef<any>(null);
    const loadedRef = useRef(false);
    const pendingContent = useRef<string | null>(null);

    // Conteúdo inicial — atualiza quando o conteúdo da nota muda de verdade
    // (ex.: após salvar), mas NÃO durante a digitação (onChange atualiza o ref).
    const [initialContent, setInitialContent] = useState(() =>
      sanitize(converterMarcadores(initialValue, imagensDirUri, audiosDirUri))
    );
    const initialValueAnterior = useRef(initialValue);
    useEffect(() => {
      if (initialValue !== initialValueAnterior.current) {
        initialValueAnterior.current = initialValue;
        const novo = sanitize(converterMarcadores(initialValue, imagensDirUri, audiosDirUri));
        setInitialContent(novo);
        ultimoConteudo.current = novo;
      }
    }, [initialValue, imagensDirUri, audiosDirUri]);
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
      atualizarFormato: () => {
        injetar('window.editorNotificarFormatos(); true;');
      },
    }));

    const handleMessage = (event: any) => {
      const data = event?.nativeEvent?.data;
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
      ultimoConteudo.current = data;
      onChange?.(data);
    };

    const handleLoadEnd = () => {
      loadedRef.current = true;
      // SEMPRE re-aplica o conteúdo mais recente conhecido pelo React após um
      // recarregamento do WebView (troca leitura/edição, mudança de tema ou de
      // conteúdo salvo). Ao trocar edição→leitura, editavel e initialValue
      // mudam no MESMO ciclo → há DOIS loads em voo. Antes, a reaplicação era
      // condicional (ultimoConteudo !== initialContent) comparando com o
      // initialContent capturado no render que disparou o load — e o
      // injectJavaScript pode ser perdido no Android quando outro load começa
      // no meio, então o último load a chegar podia pousar no conteúdo antigo
      // (ou vazio). Aplicar SEMPRE é seguro/idempotente: `ultimoConteudo` é a
      // fonte da verdade do React (onChange/setContent/appendContent o mantêm
      // com o HTML mais novo).
      let alvo: string | null = pendingContent.current;
      pendingContent.current = null;
      if (alvo == null) {
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
        <WebViewImpl
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
