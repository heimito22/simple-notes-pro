import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

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
}

interface ListaContextData {
  listas: ListaCompras[];
  setListas: React.Dispatch<React.SetStateAction<ListaCompras[]>>;
  salvarLista: (lista: ListaCompras) => void;
  excluirLista: (id: string) => void;
  alternarFixarLista: (id: string) => void; // Nova função
  recarregarListas: () => Promise<void>;
}

const ListaContext = createContext<ListaContextData>({} as ListaContextData);

export const ListaProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [listas, setListas] = useState<ListaCompras[]>([]);

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
    }
  }, []);

  useEffect(() => {
    carregarListas();
  }, [carregarListas]);

  // Persiste automaticamente quando as listas mudam
  useEffect(() => {
    if (listas.length > 0) {
      persistirDados(listas);
    }
  }, [listas, persistirDados]);

  const salvarLista = (listaEditada: ListaCompras) => {
  setListas(prev => {
    // Procuramos se a lista já existe no estado atual
    const listaExistente = prev.find(l => l.id === listaEditada.id);

    if (listaExistente) {
      // Se existe, mesclamos: mantemos o que já tinha (...listaExistente)
      // e sobrescrevemos com o que veio do editor (...listaEditada)
      const novas = prev.map(l => 
        l.id === listaEditada.id 
          ? { ...l, ...listaEditada } 
          : l
      );
      persistirDados(novas);
      return novas;
    } else {
      // Se for nova, apenas adicionamos ao início
      const novas = [listaEditada, ...prev];
      persistirDados(novas);
      return novas;
    }
  });
};

  const excluirLista = (id: string) => {
    setListas(prev => {
      const novas = prev.filter(l => l.id !== id);
      persistirDados(novas);
      return novas;
    });
  };

  const alternarFixarLista = (id: string) => {
    setListas(prev => {
      const novas = prev.map(l => 
        l.id === id ? { ...l, fixada: !l.fixada } : l
      );
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
      recarregarListas: carregarListas
    }}>
      {children}
    </ListaContext.Provider>
  );
};

export default ListaProvider;

export const useListas = () => useContext(ListaContext);