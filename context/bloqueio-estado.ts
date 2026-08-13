/**
 * Suspensão temporária do bloqueio por biometria do app.
 *
 * O editor de notas usa enquanto o usuário interage com a interface do SISTEMA
 * (seletor de fotos, diálogo de permissão de áudio etc.). Essas telas levam o
 * app para background e, ao voltar, o bloqueio por biometria dispararia no meio
 * da criação da nota. Com esta flag, essas idas e voltas não bloqueiam.
 */
let suspender = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export const bloqueioEstado = {
  get suspender(): boolean {
    return suspender;
  },
  set suspender(v: boolean) {
    suspender = v;
  },
  /** Suspende agora, cancelando qualquer liberação pendente. */
  ativar(): void {
    suspender = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  },
  /**
   * Libera a suspensão após ~500ms. O atraso evita uma corrida: ao voltar do
   * seletor, o evento AppState 'active' chega na mesma thread da promise — a
   * liberação imediata poderia destravar o bloqueio antes do handler rodar.
   */
  liberar(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      suspender = false;
      timer = null;
    }, 500);
  },
};
