import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useListas } from './ListaContext';
import { agendarLembretes, cancelarLembretes, type LembreteNota } from './lembrete-notas';
import { useMonetizacao } from './monetizacao';
import { verificarTelaCheia } from './permissao-alarme';
import { useTheme } from './ThemeContext';

// SEM webClientId de propósito: o client OAuth do app (google-services.json,
// projeto simple-notes-39893) é do tipo Android (android_info) — não é um Web
// client. Usar um client Android como webClientId causa DEVELOPER_ERROR (erro 10).
// O app só usa o accessToken (getTokens) para o Drive, então não precisa de
// idToken de servidor. Sem webClientId, o SDK usa o client nativo do
// google-services.json (já processado pelo plugin google-services).
GoogleSignin.configure({
  scopes: ['https://www.googleapis.com/auth/drive.appdata'],
});

export interface Pasta {
  id: string;
  nome: string;
  data?: string;
}

const NotasContext = createContext<any>(null);

export function NotasProvider({ children }: any) {
  const [notas, setNotas] = useState<any[]>([]);
  const [pastas, setPastas] = useState<Pasta[]>([]);
  const [isAppBloqueado, setIsAppBloqueado] = useState<boolean>(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [estaOnline, setEstaOnline] = useState<boolean>(true);
  // Só passa a salvar localmente depois que os dados foram carregados do storage
  const [dadosCarregados, setDadosCarregados] = useState<boolean>(false);
  // Ref espelhado do estado (para agendar lembretes com o título atual em handlers)
  const notasRef = useRef<any[]>([]);

  useEffect(() => {
    notasRef.current = notas;
  }, [notas]);

  const listaContext = useListas();
  const listas = listaContext?.listas || [];
  const setListas = listaContext?.setListas;
  const { mostrarAnuncio } = useMonetizacao();
  // Acesso às configurações (a chave de IA é sincronizada no backup do Drive)
  const { config: configTema, atualizarConfig: atualizarConfigTema } = useTheme();

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
          // Formato atual: { notas, listas, pastas } — não quebra se só existirem listas/pastas salvas
          setNotas(parsed.notas || []);
          if (parsed.listas && typeof setListas === 'function') {
            setListas(parsed.listas);
          }
          if (Array.isArray(parsed.pastas)) {
            setPastas(parsed.pastas);
          }
        }
      } else {
        setNotas([]);
        if (typeof setListas === 'function') setListas([]);
        setPastas([]);
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
        const payload = JSON.stringify({ notas, listas, pastas });
        await AsyncStorage.setItem(key, payload);
        console.log("[Storage] Save local garantido no telefone.");
      } catch (e) {
        console.error("[Storage] Erro no save local:", e);
      }
    };
    // Salva até o estado vazio — assim apagar a última nota/lista persiste
    if (dadosCarregados) salvarLocal();
  }, [notas, listas, pastas, dadosCarregados]);

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

  // Sincroniza a chave de IA no backup assim que ela mudar (sem esperar
  // o usuário editar uma nota). Usa um efeito separado para não depender
  // de mudanças em notas/listas.
  const chaveIASincronizadaRef = useRef<string | null>(null);
  useEffect(() => {
    const chave = configTema?.chaveIA || '';
    // Ignora o primeiro carregamento (não força backup só por abrir o app)
    if (chaveIASincronizadaRef.current === null) {
      chaveIASincronizadaRef.current = chave;
      return;
    }
    if (chave === chaveIASincronizadaRef.current) return;
    chaveIASincronizadaRef.current = chave;
    console.log("[Cloud] Chave de IA alterada — sincronizando backup...");
    fazerBackupCloud();
  }, [configTema?.chaveIA]);

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
        pastas,
        chaveIA: configTema?.chaveIA || '',
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

  // Baixa o backup do Drive ({ notas, listas, chaveIA }). Retorna null se não
  // houver arquivo na conta. Lança erro se a leitura falhar (rede/sessão).
  const buscarBackupDrive = useCallback(async (): Promise<any | null> => {
    await GoogleSignin.signInSilently();
    const tokens = await GoogleSignin.getTokens();
    const search = await fetch('https://www.googleapis.com/drive/v3/files?q=name="backup_notas.json"&spaces=appDataFolder', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` }
    });
    const data = await search.json();
    const fileId = data.files?.[0]?.id;
    if (!fileId) return null;
    const download = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` }
    });
    return await download.json();
  }, []);

  const restaurarBackupCloud = async () => {
    if (!estaOnline) {
      Alert.alert("Offline", "Você precisa de internet para restaurar.");
      return;
    }
    try {
      const backupData = await buscarBackupDrive();
      if (!backupData) {
        Alert.alert("Erro", "Nenhum backup encontrado na sua conta.");
        return;
      }
      if (backupData.notas) setNotas(backupData.notas);
      if (backupData.listas && typeof setListas === 'function') setListas(backupData.listas);
      if (Array.isArray(backupData.pastas)) setPastas(backupData.pastas);
      // Restaura a chave de IA SOMENTE se o aparelho não tiver uma configurada
      // (evita que um backup antigo apague uma chave local recém-colada).
      const chaveLocal = configTema?.chaveIA || '';
      if (backupData.chaveIA && !chaveLocal && typeof atualizarConfigTema === 'function') {
        await atualizarConfigTema('chaveIA', backupData.chaveIA);
      }
      Alert.alert("Sucesso", "Dados restaurados!");
    } catch (e) {
      Alert.alert("Erro", "Falha ao restaurar.");
    }
  };

  // Restaura automaticamente a CHAVE DE IA do backup do Drive ao abrir o app
  // (se o aparelho não tiver chave local e houver conta logada) — evita ter
  // que digitar a chave de novo após reinstalar/trocar de aparelho.
  useEffect(() => {
    const restaurarChave = async () => {
      if (!estaOnline) return;
      try {
        const user = await GoogleSignin.getCurrentUser();
        if (!user) return;
        if (configTema?.chaveIA) return; // já tem chave local
        const backup = await buscarBackupDrive();
        if (backup?.chaveIA && typeof atualizarConfigTema === 'function') {
          await atualizarConfigTema('chaveIA', backup.chaveIA);
        }
      } catch {
        // offline/sessão expirada: tenta de novo quando a internet voltar
      }
    };
    const t = setTimeout(restaurarChave, 2500);
    return () => clearTimeout(t);
  }, [estaOnline, configTema?.chaveIA, buscarBackupDrive]);

  const logout = async () => {
    await GoogleSignin.signOut();
    setNotas([]);
    if (typeof setListas === 'function') setListas([]);
    setPastas([]);
    setCurrentUserId('local');
    Alert.alert("Sair", "Desconectado.");
  };

  const salvarNota = (titulo: string, conteudo: string, id?: string, protegida: boolean = false, pastaId?: string | null) => {
  // Nota NOVA = sem id (o contexto gera o id). Anúncio curto só na criação.
  const ehNova = !id;
  // Id gerado FORA do updater para poder retorná-lo — o editor usa o retorno
  // quando o sino é acionado na primeira edição de uma nota nova.
  const idFinal = id || Math.random().toString(36).substr(2, 9);

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
        id: idFinal, 
        titulo, 
        conteudo, 
        data: new Date().toLocaleDateString('pt-BR'),
        fixada: false, // Começa sempre false
        protegida: protegida,
        // Nota criada dentro de uma pasta (ou movida) carrega o id da pasta
        pastaId: pastaId || undefined
      };
      return [nova, ...prev];
    }
  });

  // Anúncio curto ao CRIAR uma nota nova (não ao editar)
  if (ehNova) mostrarAnuncio();

  // Se o título mudou, re-agenda os lembretes com o novo título
  // (cancela os IDs antigos do fallback e guarda os novos)
  if (id) {
    const notaAntiga = notasRef.current.find(n => n.id === id);
    if (notaAntiga?.lembrete && notaAntiga.titulo !== titulo) {
      agendarLembretes(id, titulo, notaAntiga.lembrete, notaAntiga.lembreteExpoIds ?? [])
        .then(novosIds => {
          setNotas(prev => prev.map(n => n.id === id ? { ...n, lembreteExpoIds: novosIds } : n));
        })
        .catch(() => {});
    }
  }

  return idFinal;
};

  /** Salva (ou remove) o lembrete de revisão da nota e re-agenda os alarmes. */
  const salvarLembreteNota = async (id: string, lembrete: LembreteNota | null) => {
    const nota = notasRef.current.find(n => n.id === id);
    if (!nota) return;
    if (!lembrete) {
      await cancelarLembretes(id, nota.lembreteExpoIds ?? []);
      setNotas(prev => prev.map(n => n.id === id ? { ...n, lembrete: undefined, lembreteExpoIds: [] } : n));
      return;
    }
    const expoIds = await agendarLembretes(id, nota.titulo || 'Nota', lembrete, nota.lembreteExpoIds ?? []);
    setNotas(prev => prev.map(n => n.id === id ? { ...n, lembrete, lembreteExpoIds: expoIds } : n));
    // Abre a guia de permissões do alarme na 1ª vez (mesma regra das tarefas)
    verificarTelaCheia().catch(() => {});
  };

  const excluirNota = (id: string) => {
    const nota = notasRef.current.find(n => n.id === id);
    cancelarLembretes(id, nota?.lembreteExpoIds ?? []).catch(() => {});
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

  // --- PASTAS ---
  const criarPasta = useCallback((nome: string): string => {
    const id = Math.random().toString(36).substr(2, 9);
    const pasta: Pasta = {
      id,
      nome: nome.trim() || 'Nova pasta',
      data: new Date().toLocaleDateString('pt-BR'),
    };
    setPastas(prev => [pasta, ...prev]);
    return id;
  }, []);

  const renomearPasta = useCallback((id: string, nome: string) => {
    setPastas(prev => prev.map(p => (p.id === id ? { ...p, nome: nome.trim() || p.nome } : p)));
  }, []);

  /** Remove a pasta e devolve as notas dela para a lista principal. */
  const excluirPasta = useCallback((id: string) => {
    setPastas(prev => prev.filter(p => p.id !== id));
    setNotas(prev => prev.map(n => (n.pastaId === id ? { ...n, pastaId: undefined } : n)));
  }, []);

  /** Move notas para uma pasta (pastaId null = tira da pasta, volta à lista principal). */
  const moverNotasParaPasta = useCallback((ids: string[], pastaId: string | null) => {
    const alvo = new Set(ids);
    setNotas(prev =>
      prev.map(n => (alvo.has(n.id) ? { ...n, pastaId: pastaId || undefined } : n))
    );
  }, []);

  return (
    <NotasContext.Provider value={{ 
      notas, pastas, criarPasta, renomearPasta, excluirPasta, moverNotasParaPasta,
      salvarNota, salvarLembreteNota, excluirNota, alternarFixarNota, logout, 
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