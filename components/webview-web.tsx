import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

/**
 * WebView para a WEB (desktop): o react-native-webview não existe nessa
 * plataforma (stub "does not support this platform"). Aqui o mesmo contrato é
 * implementado com um <iframe> real:
 *
 * - source.html        → documento escrito via srcDoc
 * - onMessage          → mensagens do doc (via postMessage do iframe)
 * - injectJavaScript() → roda código DENTRO do iframe (contentWindow.eval)
 * - onLoadEnd          → disparado quando o doc carrega
 * - reload()           → remonta o iframe (refaz o doc)
 *
 * O doc do editor (rich-text-editor.tsx) fala com o host por
 * window.ReactNativeWebView (nativo) OU via postMessage (aqui na web).
 * O iframe srcDoc NÃO é same-origin acessível via parent diretamente em todos
 * os navegadores — então usamos postMessage bidirecional.
 */

interface WebViewWebProps {
  source: { html: string };
  onMessage?: (event: { nativeEvent: { data: string } }) => void;
  onLoadEnd?: () => void;
  style?: any;
  originWhitelist?: unknown;
  allowFileAccess?: unknown;
  allowFileAccessFromFileURLs?: unknown;
  allowUniversalAccessFromFileURLs?: unknown;
  allowingReadAccessToURL?: unknown;
  keyboardDisplayRequiresUserAction?: unknown;
  setSupportMultipleWindows?: unknown;
  overScrollMode?: unknown;
  onContentProcessDidTerminate?: unknown;
}

export interface WebViewWebHandle {
  injectJavaScript: (script: string) => void;
  reload: () => void;
}

export const WebViewWeb = forwardRef<WebViewWebHandle, WebViewWebProps>(function WebViewWeb(
  { source, onMessage, onLoadEnd, style },
  ref
) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [verso, setVerso] = useState(0);
  const filaInjecao = useRef<string[]>([]);

  // O iframe posta mensagens via window.parent.postMessage({snEditor: msg}, '*')
  // — escutamos aqui e repassamos como onMessage do WebView nativo.
  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      // Só aceita mensagens do nosso iframe
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const d: any = ev.data;
      if (d && typeof d.snEditor === 'string') {
        onMessage?.({ nativeEvent: { data: d.snEditor } });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onMessage]);

  useImperativeHandle(ref, () => ({
    injectJavaScript: (script: string) => {
      const win = iframeRef.current?.contentWindow as (Window & { eval?: (s: string) => unknown }) | null;
      if (!win || typeof win.eval !== 'function') {
        filaInjecao.current.push(script);
        return;
      }
      try {
        win.eval(script);
      } catch (e) {
        /* script inválido não derruba o app */
      }
    },
    reload: () => setVerso((v) => v + 1),
  }));

  const aoCarregar = () => {
    const win = iframeRef.current?.contentWindow as (Window & { eval?: (s: string) => unknown }) | null;
    if (win && typeof win.eval === 'function') {
      for (const script of filaInjecao.current) {
        try {
          win.eval(script);
        } catch (e) {}
      }
    }
    filaInjecao.current = [];
    onLoadEnd?.();
  };

  return (
    <iframe
      key={verso}
      ref={iframeRef as any}
      srcDoc={source.html}
      onLoad={aoCarregar}
      title="editor"
      sandbox="allow-scripts allow-same-origin"
      style={
        [
          { flex: 1, width: '100%', height: '100%', border: 'none', backgroundColor: 'transparent' },
          ...(Array.isArray(style) ? style : [style]),
        ].reduce((acc: Record<string, unknown>, s: any) => {
          if (!s) return acc;
          return Object.assign(acc, s);
        }, {} as Record<string, unknown>) as React.CSSProperties
      }
    />
  );
});

export default WebViewWeb;
