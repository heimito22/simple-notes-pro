import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { registrarApagado, tsDoItemExportado } from './tombstones';

export interface ItemLista {
  id: string;
  texto: string;
  concluido: boolean;
}

export interface ListaCompras {
  id: string;
  titulo: string;
  itens: ItemLista[];
  protegida?: boolean;
  fixada?: boolean; // Nova propriedade
  /** Pasta à qual a lista pertence (undefined = lista principal de notas). */
  pastaId?: string;
}

interface ListaContextData {
  listas: ListaCompras[];
  setListas: React.Dispatch<React.SetStateAction<ListaCompras[]>>;
  salvarLista: (lista: ListaCompras) => void;
  excluirLista: (id: string) => void;
  alternarFixarLista: (id: string) => void; // Nova função
  moverListasParaPasta: (ids: string[], pastaId: string | null) => void;
  recarregarListas: () => Promise<void>;
}

const ListaContext = createContext<ListaContextData>({} as ListaContextData);

export const ListaProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [listas, setListas] = useState<ListaCompras[]>([]);
  // Só persiste depois do carregamento inicial: sem isto o efeito de montagem
  // gravava [] por cima do storage ANTES do carregarListas resolver (async).
  const [carregado, setCarregado] = useState(false);

  const getStorageKey = async () => {
    const user = await GoogleSignin.getCurrentUser();
    return user ? `@notas_user_${user.user.id}` : '@minhas_notas_locais';
  };

  // Função para persistir dados sempre que o estado 'listas' mudar
  const persistirDados = useCallback(async (novasListas: ListaCompras[]) => {
    try {
      const key = await getStorageKey();
      // Como o AsyncStorage armazena tanto notas quanto listas na mesma chave no seu esquema,
      // buscamos o que já existe para não sobrescrever as notas.
      const stored = await AsyncStorage.getItem(key);
      const data = stored ? JSON.parse(stored) : {};
      data.listas = novasListas;
      await AsyncStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.error("[Listas] Erro ao persistir:", e);
    }
  }, []);

  const carregarListas = useCallback(async () => {
    try {
      const key = await getStorageKey();
      const stored = await AsyncStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        setListas(parsed.listas || []);
      }
    } catch (e) {
      console.error("[Listas] Erro ao carregar:", e);
    } finally {
      setCarregado(true);
    }
  }, []);

  useEffect(() => {
    carregarListas();
  }, [carregarListas]);

  // Persiste automaticamente quando as listas mudam — SEMPRE, inclusive o
  // estado VAZIO. O gate antigo (`listas.length > 0`) fazia apagar a ÚLTIMA
  // lista (ou todas) nunca gravar no storage: ao reabrir o app as listas
  // ressuscitavam do disco.
  useEffect(() => {
    if (carregado) {
      persistirDados(listas);
    }
  }, [listas, carregado, persistirDados]);

  const salvarLista = (listaEditada: ListaCompras) => {
  setListas(prev => {
    // Procuramos se a lista já existe no estado atual
    const listaExistente = prev.find(l => l.id === listaEditada.id);

    if (listaExistente) {
      // Se existe, mesclamos: mantemos o que já tinha (...listaExistente)
      // e sobrescrevemos com o que veio do editor (...listaEditada)
      const novas = prev.map(l => 
        l.id === listaEditada.id 
          ? { ...l, ...listaEditada, dataModificacao: Date.now() } 
          : l
      );
      persistirDados(novas);
      return novas;
    } else {
      // Se for nova, apenas adicionamos ao início
      // Carimbo numérico: sem `dataModificacao` o merge por item era cego
      // (tsDoItem caía em 0 — disputas de versão entre aparelhos eram
      // resolvidas por sorte) e o tombstone da exclusão não tinha contra o
      // que disputar ("editado depois da exclusão" nunca se decidia).
      const novas = [{ ...listaEditada, dataModificacao: Date.now() }, ...prev];
      persistirDados(novas);
      return novas;
    }
  });
};

  const excluirLista = (id: string) => {
    // Tombstone À PROVA DE RELÓGIO: ts = max(agora, dataModificacao da lista + 1).
    // A lista pode ter sido criada/editada no PC (relógio adiantado): um
    // tombstone com o relógio do celular perdia a disputa e o item
    // ressuscitava no celular depois de um tempo. O carimbo pelo próprio item
    // garante que a versão que este aparelho via morre de verdade.
    const alvo = listas.find(l => l.id === id);
    registrarApagado(id, tsDoItemExportado(alvo) + 1);
    setListas(prev => {
      const novas = prev.filter(l => l.id !== id);
      persistirDados(novas);
      return novas;
    });
  };

  const alternarFixarLista = (id: string) => {
    setListas(prev => {
      const novas = prev.map(l => 
        l.id === id ? { ...l, fixada: !l.fixada, dataModificacao: Date.now() } : l
      );
      persistirDados(novas);
      return novas;
    });
  };

  /** Move listas para uma pasta (pastaId null = tira da pasta, volta à lista principal). */
  const moverListasParaPasta = (ids: string[], pastaId: string | null) => {
    const alvo = new Set(ids);
    setListas(prev => {
      const novas = prev.map(l => (alvo.has(l.id) ? { ...l, pastaId: pastaId || undefined, dataModificacao: Date.now() } : l));
      persistirDados(novas);
      return novas;
    });
  };

  return (
    <ListaContext.Provider value={{ 
      listas, 
      setListas, 
      salvarLista, 
      excluirLista, 
      alternarFixarLista,
      moverListasParaPasta,
      recarregarListas: carregarListas
    }}>
      {children}
    </ListaContext.Provider>
  );
};

export default ListaProvider;

export const useListas = () => useContext(ListaContext);