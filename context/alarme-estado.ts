// Estado compartilhado do alarme em tela cheia.
//
// A tela de bloqueio (biometria) consulta/escuta este estado para NÃO pedir
// biometria enquanto um alarme estiver na frente: o alarme é sempre visível
// sem desbloquear; as anotações só abrem depois de desbloquear.

type Ouvinte = (ativo: boolean) => void;

const ouvintes = new Set<Ouvinte>();
let ativo = false;

export const alarmeEstado = {
  get ativo(): boolean {
    return ativo;
  },
  setAtivo(valor: boolean) {
    if (ativo === valor) return;
    ativo = valor;
    ouvintes.forEach(o => o(valor));
  },
  ouvir(ouvinte: Ouvinte): () => void {
    ouvintes.add(ouvinte);
    return () => {
      ouvintes.delete(ouvinte);
    };
  },
};
