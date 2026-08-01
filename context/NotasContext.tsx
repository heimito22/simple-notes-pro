import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useListas } from './ListaContext';

// SEM webClientId de propósito: o client OAuth do app (google-services.json,
// projeto simple-notes-39893) é do tipo Android (android_info) — não é um Web
// client. Usar um client Android como webClientId causa DEVELOPER_ERROR (erro 10).
// O app só usa o accessToken (getTokens) para o Drive, então não precisa de
// idToken de servidor. Sem webClientId, o SDK usa o client nativo do
// google-services.json (já processado pelo plugin google-services).
GoogleSignin.configure({
  scopes: ['https://www.googleapis.com/auth/drive.appdata'],
});

const NotasContext = createContext<any>(null);

export function NotasProvider({ children }: any) {
  const [notas, setNotas] = useState<any[]>([]);
  const [isAppBloqueado, setIsAppBloqueado] = useState<boolean>(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [estaOnline, setEstaOnline] = useState<boolean>(true);
  // Só passa a salvar localmente depois que os dados foram carregados do storage
  const [dadosCarregados, setDadosCarregados] = useState<boolean>(false);
  
  const listaContext = useListas();
  const listas = listaContext?.listas || [];
  const setListas = listaContext?.setListas;

  const getStorageKey = async () => {
    const user = await GoogleSignin.getCurrentUser();
    return user ? `@notas_user_${user.user.id}` : '@minhas_notas_locais';
  };

  // 1. MONITOR DE CONEXÃO
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      const online = !!state.isConnected && !!state.isInternetReachable;
      setEstaOnline(online);
      
      if (online && currentUserId && currentUserId !== 'local') {
        console.log("[NetInfo] Internet restaurada. Iniciando backup automático...");
        fazerBackupCloud();
      }
    });
    return () => unsubscribe();
  }, [currentUserId, notas, listas]);

  const carregarTudo = useCallback(async () => {
    try {
      const key = await getStorageKey();
      const dados = await AsyncStorage.getItem(key);
      
      if (dados) {
        const parsed = JSON.parse(dados);
        if (Array.isArray(parsed)) {
          // Formato legado: array puro de notas
          setNotas(parsed);
        } else {
          // Formato atual: { notas, listas } — não quebra se só existirem listas salvas
          setNotas(parsed.notas || []);
          if (parsed.listas && typeof setListas === 'function') {
            setListas(parsed.listas);
          }
        }
      } else {
        setNotas([]);
        if (typeof setListas === 'function') setListas([]);
      }

      const bloqueio = await AsyncStorage.getItem('@config_bloqueio_app');
      setIsAppBloqueado(bloqueio ? JSON.parse(bloqueio) : false);
    } catch (e) {
      console.error("[Storage] Erro ao carregar:", e);
    } finally {
      setDadosCarregados(true);
    }
  }, [setListas]);

  useEffect(() => {
    const checkUserChange = async () => {
      try {
        const user = GoogleSignin.getCurrentUser();
        const userId = user ? user.user.id : 'local';
        
        if (userId !== currentUserId) {
          setCurrentUserId(userId);
          await carregarTudo();
        }
      } catch (e) {
        console.warn("[Google] Falha ao verificar sessão", e);
      }
    };
    checkUserChange();
  }, [currentUserId, carregarTudo]);

  // 2. SALVAMENTO LOCAL SEMPRE ATIVO
  useEffect(() => {
    const salvarLocal = async () => {
      try {
        const key = await getStorageKey();
        const payload = JSON.stringify({ notas, listas });
        await AsyncStorage.setItem(key, payload);
        console.log("[Storage] Save local garantido no telefone.");
      } catch (e) {
        console.error("[Storage] Erro no save local:", e);
      }
    };
    // Salva até o estado vazio — assim apagar a última nota/lista persiste
    if (dadosCarregados) salvarLocal();
  }, [notas, listas, dadosCarregados]);

  // 3. BACKUP AUTOMÁTICO NA NUVEM
  useEffect(() => {
    const agendarBackup = async () => {
      if (!estaOnline) return;

      const user = await GoogleSignin.getCurrentUser();
      if (user) {
        try {
          await GoogleSignin.signInSilently(); 
          await fazerBackupCloud();
        } catch (e) {
          console.log("[Cloud] Sessão expirada ou erro de rede.");
        }
      }
    };

    const timer = setTimeout(agendarBackup, 5000); 
    return () => clearTimeout(timer);
  }, [notas, listas, estaOnline]);

  const fazerBackupCloud = async () => {
    if (!estaOnline) return;

    try {
      const user = await GoogleSignin.getCurrentUser();
      if (!user) return;

      const tokens = await GoogleSignin.getTokens();
      const search = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=name='backup_notas.json' and parents in 'appDataFolder'&spaces=appDataFolder`,
        { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
      );

      const searchData = await search.json();
      const fileId = searchData.files?.[0]?.id;
      
      const bodyContent = JSON.stringify({
        notas,
        listas,
        ultimaSincronizacao: new Date().toISOString()
      });

      let res;
      if (fileId) {
        res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' },
          body: bodyContent,
        });
      } else {
        const metadata = { name: 'backup_notas.json', parents: ['appDataFolder'] };
        const boundary = 'foo_bar';
        const multipartBody = 
          `--${boundary}\nContent-Type: application/json\n\n${JSON.stringify(metadata)}\n` +
          `--${boundary}\nContent-Type: application/json\n\n${bodyContent}\n--${boundary}--`;

        res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
          body: multipartBody,
        });
      }

      if (res.ok) console.log(`[Cloud] Sincronização Google finalizada.`);
    } catch (e) {
      console.log("[Cloud] Erro no backup.");
    }
  };

  const restaurarBackupCloud = async () => {
    if (!estaOnline) {
      Alert.alert("Offline", "Você precisa de internet para restaurar.");
      return;
    }
    try {
      await GoogleSignin.signInSilently();
      const tokens = await GoogleSignin.getTokens();
      const search = await fetch('https://www.googleapis.com/drive/v3/files?q=name="backup_notas.json"&spaces=appDataFolder', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` }
      });
      const data = await search.json();
      if (data.files?.length > 0) {
        const download = await fetch(`https://www.googleapis.com/drive/v3/files/${data.files[0].id}?alt=media`, {
          headers: { Authorization: `Bearer ${tokens.accessToken}` }
        });
        const backupData = await download.json();
        if (backupData.notas) setNotas(backupData.notas);
        if (backupData.listas && typeof setListas === 'function') setListas(backupData.listas);
        Alert.alert("Sucesso", "Dados restaurados!");
      }
    } catch (e) {
      Alert.alert("Erro", "Falha ao restaurar.");
    }
  };

  const logout = async () => {
    await GoogleSignin.signOut();
    setNotas([]);
    if (typeof setListas === 'function') setListas([]);
    setCurrentUserId('local');
    Alert.alert("Sair", "Desconectado.");
  };

  const salvarNota = (titulo: string, conteudo: string, id?: string, protegida: boolean = false) => {
  setNotas(prev => {
    if (id) {
      // Edição: Mantemos TODAS as propriedades antigas (...n) 
      // e atualizamos apenas o que veio do editor
      return prev.map(n => 
        n.id === id 
          ? { ...n, titulo, conteudo, protegida } // O '...n' garante que 'fixada' continue true se já era true
          : n
      );
    } else {
      // Nova nota
      const nova = { 
        id: Math.random().toString(36).substr(2, 9), 
        titulo, 
        conteudo, 
        data: new Date().toLocaleDateString('pt-BR'),
        fixada: false, // Começa sempre false
        protegida: protegida 
      };
      return [nova, ...prev];
    }
  });
};

  const excluirNota = (id: string) => {
    setNotas(prev => prev.filter(n => n.id !== id));
  };

  // NOVA FUNÇÃO PARA FIXAR NOTAS
  const alternarFixarNota = (id: string) => {
    setNotas(prev => prev.map(n => n.id === id ? { ...n, fixada: !n.fixada } : n));
  };

  const toggleBloqueioApp = async (val: boolean) => {
    setIsAppBloqueado(val);
    await AsyncStorage.setItem('@config_bloqueio_app', JSON.stringify(val));
  };

  return (
    <NotasContext.Provider value={{ 
      notas, salvarNota, excluirNota, alternarFixarNota, logout, 
      fazerBackupCloud, estaOnline,
      restaurarBackupCloud, isAppBloqueado, toggleBloqueioApp,
      recarregarTudo: carregarTudo 
    }}>
      {children}
    </NotasContext.Provider>
  );
}

export const useNotas = () => {
  const context = useContext(NotasContext);
  if (!context) throw new Error('useNotas deve ser usado dentro de um NotasProvider');
  return context;
};