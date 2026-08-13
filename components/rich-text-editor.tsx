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
  return `<span class="anexo-audio-inline" data-audio-uri="${uriHtml}" data-audio-name="${nomeHtml}"><span class="anexo-audio-text">🎙️ ${nomeHtml}</span><audio controls src="${uriHtml}" class="anexo-audio"></audio><button type="button" class="anexo-audio-remove" data-audio-delete="${uriHtml}" aria-label="Apagar áudio">×</button></span>`;
};

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
  return convertido;
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
  /* Controle nativo do Android/WebView, mantido inline no conteúdo da nota. */
  .anexo-audio-inline {
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
    gap: 6px;
    margin: 5px 0;
    padding: 5px 7px;
    border: 1px solid ${accentColor};
    border-radius: 10px;
    color: ${accentColor};
  }
  .anexo-audio-text {
    color: ${accentColor};
    font-size: 14px;
    font-weight: 700;
    white-space: nowrap;
  }
  audio.anexo-audio {
    display: inline-block !important;
    width: 178px;
    height: 32px;
    vertical-align: middle;
  }
  .anexo-audio-remove {
    display: inline-block;
    border: 0;
    border-radius: 12px;
    background: ${accentColor};
    color: ${backgroundColor};
    font-size: 18px;
    line-height: 22px;
    width: 23px;
    height: 23px;
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
