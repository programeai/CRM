import { useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';

const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
      theme?: 'auto' | 'light' | 'dark';
    },
  ) => string;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;
function loadTurnstileScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Falha ao carregar o captcha.'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

type Props = {
  siteKey: string;
  onVerify: (token: string) => void;
  /** Chamado quando o token expira ou o desafio falha (limpa o token). */
  onReset?: () => void;
};

/** Widget do Cloudflare Turnstile. Renderiza de forma explícita e emite o token. */
export function Turnstile({ siteKey, onVerify, onReset }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // refs para manter callbacks atuais sem re-renderizar o widget
  const onVerifyRef = useRef(onVerify);
  const onResetRef = useRef(onReset);
  onVerifyRef.current = onVerify;
  onResetRef.current = onReset;
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    let active = true;
    void loadTurnstileScript()
      .then(() => {
        if (!active || !containerRef.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: resolvedTheme === 'dark' ? 'dark' : 'light',
          callback: (token) => onVerifyRef.current(token),
          'expired-callback': () => onResetRef.current?.(),
          'error-callback': () => onResetRef.current?.(),
        });
      })
      .catch(() => onResetRef.current?.());
    return () => {
      active = false;
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
    // Recria o widget se o site key ou o tema mudarem.
  }, [siteKey, resolvedTheme]);

  return <div ref={containerRef} className="flex justify-center" />;
}
