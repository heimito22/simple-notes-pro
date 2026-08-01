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
  appendContent: (html: string) => void;
}

interface Props {
  /** Conteúdo inicial (usado apenas no mount — o editor é não-controlado depois). */
  initialValue?: string;
  onChange?: (html: string) => void;
  onFormatoChange?: (fmt: FormatoAtivo) => void;
  placeholder?: string;
  textColor: string;
  placeholderColor: string;
  backgroundColor: string;
  accentColor: string;
  /** URI base das pastas de anexos (para converter marcadores antigos em <img>/<audio>). */
  imagensDirUri?: string;
  audiosDirUri?: string;
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

// Converte marcadores de anexos antigos ("[Imagem anexada: x.jpg]") em tags reais.
const converterMarcadores = (html: string, imagensDirUri?: string, audiosDirUri?: string) => {
  if (!html || (!imagensDirUri && !audiosDirUri)) return html;
  return html
    .replace(/\[Imagem anexada:\s*([^\]]+?)\s*\]/gi, (m, nome: string) =>
      imagensDirUri
        ? `<img src="${imagensDirUri}/${nome.trim()}" alt="${nome.trim()}" class="anexo-img">`
        : m
    )
    .replace(/\[Áudio anexado:\s*([^\]]+?)\s*\]/gi, (m, nome: string) =>
      audiosDirUri
        ? `<audio controls src="${audiosDirUri}/${nome.trim()}" class="anexo-audio"></audio>`
        : m
    );
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
  placeholder: string
) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
  * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 18px;
    line-height: 1.55;
    color: ${textColor};
    background: ${backgroundColor};
    padding: 4px 25px 120px;
  }
  #editor { outline: none; min-height: 60vh; word-break: break-word; }
  #editor:empty::before { content: attr(data-placeholder); color: ${placeholderColor}; pointer-events: none; }
  ul, ol { padding-left: 26px; margin: 6px 0; }
  li { margin: 3px 0; }
  h1 { font-size: 26px; margin: 10px 0 6px; }
  h2 { font-size: 22px; margin: 10px 0 6px; }
  h3 { font-size: 19px; margin: 8px 0 4px; }
  blockquote { border-left: 3px solid ${accentColor}; margin: 8px 0; padding-left: 12px; color: ${placeholderColor}; }
  a { color: ${accentColor}; }
  img.anexo-img { max-width: 100%; border-radius: 14px; margin: 8px 0; display: block; }
  audio.anexo-audio { width: 100%; height: 48px; border-radius: 12px; margin: 8px 0; display: block; }
</style>
</head>
<body>
<div id="editor" contenteditable="true" data-placeholder="${placeholder.replace(/"/g, '&quot;')}"></div>
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
  window.editorAppend = function(html) {
    el.focus();
    try {
      var sel = window.getSelection();
      sel.selectAllChildren(el);
      sel.collapseToEnd();
      document.execCommand('insertHTML', false, html);
    } catch (e) {}
    notify();
    scheduleFormats();
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
      imagensDirUri,
      audiosDirUri,
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

    const doc = useMemo(
      () => buildDoc(initialContent, textColor, placeholderColor, backgroundColor, accentColor, placeholder),
      [initialContent, textColor, placeholderColor, backgroundColor, accentColor, placeholder]
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
      appendContent: (html: string) => {
        ultimoConteudo.current = ultimoConteudo.current + html;
        if (loadedRef.current) {
          injetar(`window.editorAppend(${toJSString(html)}); true;`);
        } else {
          pendingContent.current = ultimoConteudo.current;
        }
      },
    }));

    const handleMessage = (event: WebViewMessageEvent) => {
      const data = event.nativeEvent.data;
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
      let alvo: string | null = pendingContent.current;
      pendingContent.current = null;
      if (alvo == null && ultimoConteudo.current !== initialContent) {
        alvo = ultimoConteudo.current;
      }
      if (alvo != null) {
        injetar(`window.editorSetContent(${toJSString(alvo)}); true;`);
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
