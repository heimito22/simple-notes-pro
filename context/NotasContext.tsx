import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { useListas } from './ListaContext';
import { useTarefas } from './TarefasContext';
import { agendarLembretes, cancelarLembretes, type LembreteNota } from './lembrete-notas';
import { verificarTelaCheia } from './permissao-alarme';
import { sincronizarAnexosUpload, restaurarAnexosDownload } from './anexos-cloud';
import { hidratarApagados, registrarApagado, registrarApagados, serializarApagados, carregarApagados, mesclarPorItem, limparApagados, assinaturaItem } from './tombstones';
import { acharBackupCanonico } from './backup-drive';
import { useTheme } from './ThemeContext';
import { idiomaAtual, tIdioma } from './idiomas';

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

/** Mesmo conteúdo (por id + assinatura)? Evita setNotas com array "novo" igual. */
const conjuntosIguais = (a: any[], b: any[]): boolean => {
  if ((a || []).length !== (b || []).length) return false;
  const mapa = new Map((b || []).map((x: any) => [String(x?.id), assinaturaItem(x)]));
  return (a || []).every((x: any) => mapa.get(String(x?.id)) === assinaturaItem(x));
};

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
  /**
   * Estado MAIS RECENTE de tudo que sobe para a nuvem. O push pode ser disparado
   * de dentro de uma closure antiga (tick do poll automático) — sem isto ele
   * enviava notas velhas por cima das novas no Drive, e a alteração "voltava".
   */
  const dadosRef = useRef<{ notas: any[]; listas: any[]; pastas: any[]; tarefas: any[] }>({ notas: [], listas: [], pastas: [], tarefas: [] });
  /** id -> assinatura do item como o app já conhece (base do carimbo de tempo). */
  const snapRef = useRef<Record<string, string>>({});
  /** Assinatura da LISTA de ids — detecta criação/exclusão sem hashear conteúdo. */
  const idsRef = useRef<string>('');
  /** Marca itens como "já conhecidos" — nada vindo do remoto é mudança local. */
  const registrarSnap = useCallback((conjuntos: (any[] | undefined)[]) => {
    for (const conjunto of conjuntos || []) {
      for (const it of conjunto || []) {
        if (it && it.id != null) snapRef.current[String(it.id)] = assinaturaItem(it);
      }
    }
  }, []);

  useEffect(() => {
    notasRef.current = notas;
  }, [notas]);

  const listaContext = useListas();
  const listas = listaContext?.listas || [];
  const setListas = listaContext?.setListas;
  // Tarefas entram no backup/restauração/migração por conta (o TarefasProvider
  // é pai deste provider, então o hook está disponível).
  const tarefasContext = useTarefas();
  const tarefas: any[] = tarefasContext?.tarefas || [];
  // Acesso às configurações (a chave de IA é sincronizada no backup do Drive)
  const { config: configTema, isDark: isDarkTema, aplicarPreferenciasRemotas, atualizarConfig: atualizarConfigTema } = useTheme();

  // Guarda local da ultimaSincronizacao do Drive para comparar antes de sobrescrever
  const STORAGE_ULTIMA_SYNC = '@backup_ultima_sincronizacao';
  const obterUltimaSyncLocal = async (): Promise<string | null> => {
    try { const v = await AsyncStorage.getItem(STORAGE_ULTIMA_SYNC); return typeof v === 'string' && v ? v : null; } catch { return null; }
  };
  const salvarUltimaSyncLocal = async (iso: string) => {
    try { await AsyncStorage.setItem(STORAGE_ULTIMA_SYNC, iso); } catch {}
  };
  // Marcador de "até onde já vi a nuvem" = modifiedTime do SERVIDOR (mesmo
  // critério do PC). É o que decide se o pull precisa acontecer, sem relógio
  // do aparelho nem tolerância.
  const STORAGE_META_MODIFIED = '@backup_meta_modifiedtime';
  const obterMetaLocal = async (): Promise<string | null> => {
    try { const v = await AsyncStorage.getItem(STORAGE_META_MODIFIED); return typeof v === 'string' && v ? v : null; } catch { return null; }
  };
  const salvarMetaLocal = async (iso: string) => {
    try { await AsyncStorage.setItem(STORAGE_META_MODIFIED, iso); } catch {}
  };
  const isRemotoMaisNovo = (remotoIso: any, localIso: string | null): boolean => {
    if (!remotoIso || typeof remotoIso !== 'string') return true; // legado sem timestamp = trata como novo (compat)
    if (!localIso) return true;
    const r = Date.parse(remotoIso);
    const l = Date.parse(localIso);
    if (isNaN(r) || isNaN(l)) return true; // timestamps inválidos = não bloqueia
    return r > l;
  };

  const getStorageKey = async () => {
    const user = await GoogleSignin.getCurrentUser();
    return user ? `@notas_user_${user.user.id}` : '@minhas_notas_locais';
  };

  // 1. MONITOR DE CONEXÃO
  // Dependência é SÓ o usuário: com `notas/listas` aqui, cada pull do Drive
  // recriava o listener, o NetInfo emitia o estado atual na hora, e o app
  // empurrava o backup de novo — um loop de push a cada ciclo (o app chegou a
  // subir o backup a cada ~6s, gastando bateria e deixando a sincronização
  // "eterna"). Agora só reage quando a internet REALMENTE volta, e deixa o
  // envio por conta do ciclo automático (que sobe pendência antes de puxar).
  useEffect(() => {
    let estavaOnline: boolean | null = null;
    const unsubscribe = NetInfo.addEventListener(state => {
      const online = !!state.isConnected && !!state.isInternetReachable;
      setEstaOnline(online);
      const voltou = estavaOnline === false && online === true;
      estavaOnline = online;
      if (voltou && currentUserId && currentUserId !== 'local') {
        console.log('[NetInfo] Internet voltou — pendências serão enviadas.');
        haMudancasLocaisRef.current = true;
      }
    });
    return () => unsubscribe();
  }, [currentUserId]);

  const carregarTudo = useCallback(async () => {
    try {
      const key = await getStorageKey();
      const dados = await AsyncStorage.getItem(key);
      
      if (dados) {
        const parsed = JSON.parse(dados);
        if (Array.isArray(parsed)) {
          // Formato legado: array puro de notas
          setNotas(parsed);
          registrarSnap([parsed]);
        } else {
          // Formato atual: { notas, listas, pastas } — não quebra se só existirem listas/pastas salvas
          setNotas(parsed.notas || []);
          // Já estão no aparelho: não são "mudança local" (senão o primeiro
          // carimbo marcaria tudo como novo e o telefone sobrescreveria o Drive)
          registrarSnap([parsed.notas, parsed.listas, parsed.pastas]);
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
        const user = await GoogleSignin.getCurrentUser();
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

  // 2. SALVAMENTO LOCAL SEMPRE ATIVO (+ carimbo do que mudou de verdade)
  useEffect(() => {
    if (!dadosCarregados) return;
    // Espelha o estado para o push (uma closure antiga não pode enviar dado velho)
    dadosRef.current = { notas, listas: listas || [], pastas: pastas || [], tarefas: tarefas || [] };
    // Carimba dataModificacao só no que MUDOU: é o que permite ao merge decidir
    // por item (o mais novo vence) em vez de o backup sempre sobrescrever aqui.
    const agora = Date.now();
    let mudou = false;
    for (const conjunto of [notas, listas as any[], pastas as any[], tarefas as any[]]) {
      for (const it of (conjunto as any[]) || []) {
        if (!it || it.id == null) continue;
        const id = String(it.id);
        const assinatura = assinaturaItem(it);
        if (snapRef.current[id] === assinatura) continue;
        it.dataModificacao = agora;
        snapRef.current[id] = assinatura;
        mudou = true;
      }
    }
    // Assinatura da LISTA de itens: pega criação e exclusão (que não têm item
    // para carimbar) sem hashear conteúdo.
    const idsAtual = [notas, listas, pastas].map((c: any) => (c || []).map((x: any) => String(x?.id)).join(',')).join('|');
    if (idsAtual !== idsRef.current) { idsRef.current = idsAtual; mudou = true; }
    // Grava só quando algo mudou de verdade: antes o efeito regravava a cada
    // pull do Drive (o array voltava com nova identidade e o AsyncStorage era
    // reescrito sem necessidade, milhares de vezes por dia).
    const salvarLocal = async () => {
      try {
        const key = await getStorageKey();
        const payload = JSON.stringify({ notas, listas, pastas });
        await AsyncStorage.setItem(key, payload);
      } catch (e) {
        console.error("[Storage] Erro no save local:", e);
      }
    };
    // Salva até o estado vazio — assim apagar a última nota/lista persiste
    if (mudou) salvarLocal();
    // Dependência é o estado real do contexto (e não o fallback `|| []`, que
    // criava um array novo a cada render e disparava gravação sem parar).
  }, [notas, listas, pastas, tarefasContext?.tarefas, dadosCarregados]);

  // Sincroniza a chave de IA no backup assim que ela mudar (sem esperar
  // o usuário editar uma nota). Usa um efeito separado para não depender
  // de mudanças em notas/listas.
  const chaveIASincronizadaRef = useRef<string | null>(null);
  /** Timestamp do último push ACEITO — anti-rajada (ver fazerBackupCloud). */
  const ultimoPushOkRef = useRef<number>(0);
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

  /**
   * Envio do backup. IDENTIDADE ESTÁVEL (useCallback) de propósito: enquanto a
   * função era recriada a cada render, a tela de notas — cujo efeito a tem nas
   * dependências — agendava um backup A CADA RENDER e o celular subia o backup
   * eternamente, a cada ~6s. Era o pior bug de bateria/dados do app, deixava a
   * animação de sincronizar girando para sempre e podia sobrescrever com estado
   * velho o que o PC acabou de gravar. O estado é lido por ref (dadosRef).
   */
  const fazerBackupCloud = useCallback(async () => {
    if (!estaOnline) return;
    // Exclusões do disco ANTES de montar o backup: subir `apagados` incompleto
    // apagaria na nuvem o registro das exclusões feitas no PC/celular e o
    // aparelho reenviaria o que já tinha sido apagado.
    await hidratarApagados();
    // Rede de segurança: rajada de pedidos (ex.: vários efeitos disparando
    // juntos) não vira uma fila de backups — marca pendência e o ciclo
    // automático sobe uma vez.
    if (Date.now() - ultimoPushOkRef.current < 2500) { haMudancasLocaisRef.current = true; return; }

    try {
      const user = await GoogleSignin.getCurrentUser();
      if (!user) return;
      setSyncStatus(s => ({ ...s, estado: 'ocupado' }));

      // Token válido após reinício do app (sessão fria): renova em silêncio.
      await GoogleSignin.signInSilently().catch(() => {});
      const tokens = await GoogleSignin.getTokens();

      // Estado MAIS RECENTE (não o da closure deste push): o tick do poll pode
      // chamar este backup a partir de um render antigo e enviaria dado velho.
      const dados = dadosRef.current;
      // 1) Anexos (imagens/áudios citados pelas notas) que ainda não estão no Drive.
      // Best-effort: falha não impede o backup do JSON.
      try {
        const htmls = dados.notas.map((n: any) => n?.conteudo || '');
        const enviados = await sincronizarAnexosUpload(htmls);
        if (enviados > 0) console.log(`[Cloud] ${enviados} anexo(s) subido(s) para o Drive.`);
      } catch (e: any) {
        console.log(`[Cloud] Anexos: falha no upload (segue o backup do JSON): ${(e && (e.message || e)) || e}`);
      }
      // quantos anexos citados ainda faltam no Drive (para a barra de progresso)
      let pendentes = 0;
      try {
        const { anexosPendentesUpload } = require('./anexos-cloud');
        pendentes = await anexosPendentesUpload(dados.notas.map((n: any) => n?.conteudo || ''));
      } catch { pendentes = 0; }

      // Backup canônico: o arquivo MAIS RECENTE da conta (a conta pode ter
      // duplicados antigos; gravar no mais velho fazia a alteração desaparecer).
      const canonico = await acharBackupCanonico(tokens.accessToken);
      const fileId = canonico?.id;
      
      // Preferencias (tema + config sem PIN) sincronizadas dentro do mesmo backup — PC<->celular ficam iguais.
      // Fonte única: ThemeContext (em memória), não AsyncStorage cru — reflete na hora sem reinício.
      const prefsParaBackup: any = {
        isDark: typeof isDarkTema === 'boolean' ? isDarkTema : undefined,
        config: configTema ? (({ pinDesbloqueio, ...resto }: any) => resto)(configTema) : undefined,
      };
      const agoraIso = new Date().toISOString();
      const bodyContent = JSON.stringify({
        notas: dados.notas,
        listas: dados.listas,
        pastas: dados.pastas,
        tarefas: dados.tarefas,
        apagados: serializarApagados(), // exclusões viajam no backup
        chaveIA: configTema?.chaveIA || '',
        preferencias: prefsParaBackup,
        ultimaSincronizacao: agoraIso
      });

      let res;
      if (fileId) {
        // fields=modifiedTime: o PATCH devolve o relógio do SERVIDOR (mesmo
        // critério do PC) — é esse valor que vira o marcador de "até onde já
        // vi a nuvem". Sem depender do relógio do aparelho nem de tolerância.
        res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=modifiedTime`, {
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

      if (res.ok) {
        ultimoPushOkRef.current = Date.now();
        // Marcador = modifiedTime do SERVIDOR (resposta do PATCH), não o ISO local.
        let mtServidor: string | null = null;
        try { const j = await res.json().catch(() => null); mtServidor = (j && j.modifiedTime) || null; } catch { mtServidor = null; }
        if (mtServidor) await salvarMetaLocal(mtServidor);
        else await salvarUltimaSyncLocal(agoraIso); // fallback: mantém o comportamento antigo
        setSyncStatus({ estado: 'ok', pendentes });
        console.log(`[Cloud] Sincronização Google finalizada.`);
      } else {
        const corpo = await res.text().catch(() => '');
        setSyncStatus({ estado: 'erro', pendentes });
        console.log(`[Cloud] Backup recusado pelo Drive (${res.status}): ${corpo.slice(0, 260)}`);
      }
    } catch (e: any) {
      setSyncStatus(s => ({ ...s, estado: 'erro' }));
      console.log(`[Cloud] Erro no backup: ${(e && (e.message || e)) || e}`);
    }
  }, [estaOnline, isDarkTema, configTema]);

  // Cache do token de acesso: getTokens()/signInSilently são 2 round-trips de
  // rede a CADA pull — com cache, o tick faz 1 request de meta em vez de 3.
  const tokenCacheRef = useRef<{ token: string; expiraEm: number } | null>(null);
  const obterTokenRapido = useCallback(async (): Promise<string | null> => {
    const c = tokenCacheRef.current;
    if (c && c.expiraEm > Date.now() + 30000) return c.token;
    try {
      await GoogleSignin.signInSilently().catch(() => {});
      const tokens = await GoogleSignin.getTokens();
      if (!tokens?.accessToken) return null;
      tokenCacheRef.current = { token: tokens.accessToken, expiraEm: Date.now() + 55 * 60 * 1000 };
      return tokens.accessToken;
    } catch { return null; }
  }, []);

  // Baixa o backup do Drive ({ notas, listas, chaveIA }). Retorna null se não
  // houver arquivo na conta. Lança erro se a leitura falhar (rede/sessão).
  const buscarBackupDrive = useCallback(async (): Promise<any | null> => {
    const token = await obterTokenRapido();
    if (!token) return null;
    // Mesmo critério do PC: o backup canônico é o MAIS RECENTE da conta.
    const canonico = await acharBackupCanonico(token);
    if (!canonico) return null;
    const download = await fetch(`https://www.googleapis.com/drive/v3/files/${canonico.id}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return await download.json();
  }, [obterTokenRapido]);

  // 3. SYNC AUTOMÁTICO LEVE — push debounce + pull por modifiedTime (sem pesar, só após defs acima)
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncEmAndamentoRef = useRef(false);
  /**
   * Estado de sync para a UI (barra de progresso no celular):
   * 'ocupado' = subindo/baixando dados ou anexos · 'ok' = em dia · 'erro' = falhou.
   * pendentes = anexos que ainda faltam subir (mostra "X imagens/áudios...").
   */
  const [syncStatus, setSyncStatus] = useState<{ estado: 'ocupado' | 'ok' | 'erro'; pendentes: number }>({ estado: 'ok', pendentes: 0 });
  const ultimoPushTsRef = useRef<number>(0);
  /** true quando há alteração local ainda não confirmada no Drive — pull espera. */
  const haMudancasLocaisRef = useRef(false);
  /**
   * Suprime o push enquanto o pull aplica dados REMOTOS. Sem isso, cada pull
   * (setNotas/setListas/…) dispara o efeito de push de novo — o celular reenvia
   * o que acabou de baixar (eco) e esse push extra chega DEPOIS de edições do
   * PC no Drive, sobrescrevendo-as com estado velho. Era o motivo de fixadas
   * do PC "desfixarem" no celular e voltarem erradas.
   */
  const suprimirPushRef = useRef(false);

  // Push: qualquer alteração local sobe para o Drive em ~900ms (sem pesar)
  useEffect(() => {
    if (!dadosCarregados) return;
    if (!estaOnline) return;
    if (!currentUserId || currentUserId === 'local') return;
    if (suprimirPushRef.current) return; // aplicando remoto — não é mudança local
    // há mudança local não enviada: o pull NÃO pode rodar antes do push,
    // senão ele aplica o backup antigo e apaga a nota/tarefa/lista recém-criada.
    haMudancasLocaisRef.current = true;
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);      pushTimerRef.current = setTimeout(() => {
        ultimoPushTsRef.current = Date.now();
        void fazerBackupCloud();
      }, 900);
    return () => { if (pushTimerRef.current) clearTimeout(pushTimerRef.current); };
  }, [notas, listas, pastas, tarefas, estaOnline, currentUserId, dadosCarregados]);

  const buscarMetadadosDrive = useCallback(async (): Promise<{ id: string; modifiedTime: string } | null> => {
    const token = await obterTokenRapido();
    if (!token) return null;
    const canonico = await acharBackupCanonico(token);
    return canonico ? { id: canonico.id, modifiedTime: canonico.modifiedTime || '' } : null;
  }, [obterTokenRapido]);

  /**
   * Aplica o backup remoto sem apagar nada que seja mais novo aqui:
   * merge POR ITEM (dataModificacao), tombstones respeitados. Diz no fim se o
   * local venceu em algum item — nesse caso o Drive precisa receber de volta.
   */
  const mesclarComLocais = useCallback((remotos: any[], locais: any[]) => {
    // merge POR ITEM: o mais novo vence (dataModificacao), exclusões vencem
    // (não ressuscita nota apagada no outro aparelho), item remodificado depois
    // da exclusão volta e item só-local é mantido.
    return mesclarPorItem(remotos, locais);
  }, []);

  const aplicarBackupSilencioso = useCallback(async (backupData: any) => {
    if (!backupData) return false;
    // registro de exclusões do disco + as remotas, antes do merge
    await hidratarApagados();
    // tombstones remotos chegam antes do merge — defines o que ficou apagado
    if (Array.isArray(backupData.apagados)) carregarApagados(backupData.apagados);
    suprimirPushRef.current = true;
    try {
    const mNotas = backupData.notas ? mesclarComLocais(backupData.notas, notasRef.current) : null;
    const mListas = backupData.listas ? mesclarComLocais(backupData.listas, listas || []) : null;
    const mPastas = Array.isArray(backupData.pastas) ? mesclarComLocais(backupData.pastas, pastas || []) : null;
    const mTarefas = Array.isArray(backupData.tarefas)
      ? mesclarComLocais(backupData.tarefas, dadosRef.current.tarefas || [])
      : null;
    // O que acabou de ser mesclado já é conhecido: nada disso é "mudança local".
    registrarSnap([mNotas?.itens, mListas?.itens, mPastas?.itens, mTarefas?.itens]);
    // Só toca o estado quando o merge REALMENTE muda algo. Antes era sempre um
    // array novo igual, o que reexecutava os efeitos de push/gravação a cada
    // pull — o app ficava subindo o mesmo backup sem parar.
    if (mNotas && !conjuntosIguais(mNotas.itens, notasRef.current)) setNotas(mNotas.itens);
    if (mListas && !conjuntosIguais(mListas.itens, listas || [])) setListas(mListas.itens);
    if (mPastas && !conjuntosIguais(mPastas.itens, pastas || [])) setPastas(mPastas.itens);
    try {
      const htmls: string[] = (backupData.notas || []).map((n: any) => n?.conteudo || '');
      await (restaurarAnexosDownload(htmls) as Promise<any>).catch(() => {});
    } catch {}
    if (mTarefas && typeof tarefasContext?.definirTarefas === 'function'
        && !conjuntosIguais(mTarefas.itens, dadosRef.current.tarefas || [])) {
      await (tarefasContext.definirTarefas as any)(mTarefas.itens).catch(() => {});
    }
    // Algum item local era mais novo que o da nuvem? O Drive tem que receber de
    // volta, senão a alteração fica só neste aparelho (era o "não salva na nuvem").
    if ([mNotas, mListas, mPastas, mTarefas].some(m => m?.localVenceu)) {
      haMudancasLocaisRef.current = true;
    }
    const chaveLocal = configTema?.chaveIA || '';
    if (backupData.chaveIA && !chaveLocal && typeof atualizarConfigTema === 'function') {
      await (atualizarConfigTema as any)('chaveIA', backupData.chaveIA).catch(() => {});
    }
    if (backupData.preferencias) {
      const localIso = await obterUltimaSyncLocal();
      if (isRemotoMaisNovo(backupData.ultimaSincronizacao, localIso)) {
        try { await aplicarPreferenciasRemotas(backupData.preferencias as any); } catch {}
        if (typeof backupData.ultimaSincronizacao === 'string') await salvarUltimaSyncLocal(backupData.ultimaSincronizacao);
      }
    } else if (typeof backupData.ultimaSincronizacao === 'string') {
      await salvarUltimaSyncLocal(backupData.ultimaSincronizacao);
    }
    } finally {
      // solta na próxima volta do event loop — os efeitos de estado já rodaram
      await new Promise(r => setTimeout(r, 50));
      suprimirPushRef.current = false;
    }
    return true;
  }, [pastas, tarefas, listas, configTema?.chaveIA, aplicarPreferenciasRemotas, mesclarComLocais]);

  // Pull polling: modifiedTime a cada 12s quando em primeiro plano (só metadados, barato)
  useEffect(() => {
    if (!estaOnline || !currentUserId || currentUserId === 'local') return;
    let intervalo: ReturnType<typeof setInterval> | null = null;
    let appAtivo = AppState.currentState === 'active';
    const sub = AppState.addEventListener('change', s => { appAtivo = s === 'active'; });
    const tick = async () => {
      if (!appAtivo || syncEmAndamentoRef.current) return;
      if (Date.now() - ultimoPushTsRef.current < 4000) return;
      // Anexos pendentes (imagem/áudio que nunca subiu — ex.: nota criada antes
      // do login ou antes do fix de upload): tenta a cada ciclo, best-effort.
      // Barato: sincronizarAnexosUpload pula os que já estão no Drive.
      try {
        const subiram = await sincronizarAnexosUpload(notasRef.current.map((n: any) => n?.conteudo || ''));
        if (subiram > 0) console.log(`[Cloud] retry: ${subiram} anexo(s) subido(s)`);
      } catch {}
      // DIRTY-FIRST: mudança local ainda não confirmada no Drive? sobe primeiro
      // e pula o pull — aplicar o backup antigo agora APAGARIA a criação local.
      if (haMudancasLocaisRef.current) {
        haMudancasLocaisRef.current = false;
        ultimoPushTsRef.current = Date.now();
        try { await fazerBackupCloud(); } catch {}
        return;
      }
      try {
        const meta = await buscarMetadadosDrive().catch(() => null);
        if (!meta?.modifiedTime) return;
        // Marcador = modifiedTime do SERVIDOR (mesmo critério do PC): se a
        // nuvem não mudou desde a última vez que vimos, não há o que puxar.
        // Sem depender do relógio local nem da tolerância de 2s (que causava
        // re-pull/re-push quando os relógios divergiam).
        const marcadorLocal = await obterMetaLocal();
        if (marcadorLocal && meta.modifiedTime === marcadorLocal) return;
        syncEmAndamentoRef.current = true;
        const backup: any = await (buscarBackupDrive() as Promise<any>).catch(() => null);
        if (backup && isRemotoMaisNovo(backup.ultimaSincronizacao || meta.modifiedTime, await obterUltimaSyncLocal())) {
          await aplicarBackupSilencioso(backup);
        } else if (backup && !(await obterUltimaSyncLocal())) {
          await aplicarBackupSilencioso(backup);
        }
        // Depois do pull (ou se nada veio), marca com o modifiedTime ATUAL do
        // servidor — a nuvem pode ter mudado entre a leitura da meta e o
        // download; marcar o valor velho faria re-puxar o backup inteiro.
        try {
          const meta2 = await buscarMetadadosDrive().catch(() => null);
          if (meta2?.modifiedTime) await salvarMetaLocal(meta2.modifiedTime);
        } catch {}
      } catch {} finally { syncEmAndamentoRef.current = false; }
    };
    intervalo = setInterval(tick, 5000);
    const t0 = setTimeout(tick, 2500);
    return () => { if (intervalo) clearInterval(intervalo); clearTimeout(t0); sub.remove(); };
  }, [estaOnline, currentUserId, buscarMetadadosDrive, buscarBackupDrive, aplicarBackupSilencioso]);

  /**
   * Pull-to-refresh (gesto de deslizar para cima na lista de notas):
   * pull IMEDIATO e forçado do Drive — ignora os guards do ciclo automático
   * (tempo desde o último push, modifiedTime mais novo) porque o usuário
   * pediu explicitamente. Retorna true se algo veio do remoto.
   */
  const sincronizarAgora = useCallback(async (): Promise<boolean> => {
    if (!estaOnline || !currentUserId || currentUserId === 'local') return false;
    if (syncEmAndamentoRef.current) return false;
    // mudança local ainda não enviada? sobe primeiro (mesma regra do dirty-first)
    if (haMudancasLocaisRef.current) {
      haMudancasLocaisRef.current = false;
      ultimoPushTsRef.current = Date.now();
      try { await fazerBackupCloud(); } catch {}
      return false;
    }
    try {
      syncEmAndamentoRef.current = true;
      const backup: any = await (buscarBackupDrive() as Promise<any>).catch(() => null);
      if (backup) {
        const localIso = await obterUltimaSyncLocal();
        if (isRemotoMaisNovo(backup.ultimaSincronizacao, localIso)) {
          await aplicarBackupSilencioso(backup);
          // Marca o modifiedTime atual do servidor (mesmo critério do PC)
          try { const m = await buscarMetadadosDrive().catch(() => null); if (m?.modifiedTime) await salvarMetaLocal(m.modifiedTime); } catch {}
          return true;
        }
      }
      return false;
    } catch { return false; } finally { syncEmAndamentoRef.current = false; }
  }, [estaOnline, currentUserId, buscarBackupDrive, aplicarBackupSilencioso, fazerBackupCloud]);

  /**
   * Busca o uso de armazenamento da conta no Drive. Tenta primeiro o endpoint
   * `about?fields=storageQuota` (cota completa da conta) — mas ele exige escopo
   * além de `drive.appdata`, e devolve 403 com o escopo que o app usa. Nesse
   * caso, cai para o plano B: soma o tamanho (`size`) dos arquivos no
   * appDataFolder, que o escopo do backup cobre. Retorna null se
   * offline/deslogado/falha.
   */
  const buscarCotaDrive = useCallback(async (): Promise<{
    usado: number;
    total: number;
    limite: number | null;
    escopoApenasApp: boolean;
  } | null> => {
    try {
      const user = await GoogleSignin.getCurrentUser();
      if (!user) return null;
      // Sessão de token: após reiniciar o app o getCurrentUser() devolve o
      // usuário em cache, mas getTokens() falha sem um signInSilently antes
      // (mesmo padrão do buscarBackupDrive).
      await GoogleSignin.signInSilently().catch(() => {});
      const tokens = await GoogleSignin.getTokens();
      const auth = { Authorization: `Bearer ${tokens.accessToken}` };

      // Plano A: cota completa da conta.
      try {
        const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota', { headers: auth });
        if (res.ok) {
          const data = await res.json();
          const quota = data?.storageQuota;
          if (quota) {
            const usado = Number(quota.usage || 0);
            const limite = quota.limit !== undefined ? Number(quota.limit) : null;
            return { usado, total: Math.max(usado, limite ?? usado), limite, escopoApenasApp: false };
          }
        }
      } catch {
        // cai para o plano B abaixo
      }

      // Plano B (escopo drive.appdata): soma o tamanho dos arquivos do app
      // na pasta privada (inclui backup_notas.json e cópias antigas).
      const lista = await fetch(
        'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(size,name)&pageSize=100',
        { headers: auth }
      );
      if (!lista.ok) {
        const corpo = await lista.text().catch(() => '');
        console.log('[Cota] Falha ao listar appDataFolder:', lista.status, corpo.slice(0, 300));
        return null;
      }
      const dados = await lista.json();
      const arquivos: any[] = dados?.files || [];
      const usado = arquivos.reduce((soma, a) => soma + (Number(a.size) || 0), 0);
      return { usado, total: usado, limite: null, escopoApenasApp: true };
    } catch (e) {
      console.log('[Cota] Erro ao buscar cota do Drive.');
      return null;
    }
  }, []);

  const restaurarBackupCloud = async () => {
    if (!estaOnline) {
      Alert.alert(tIdioma(idiomaAtual, 'Offline'), tIdioma(idiomaAtual, 'Você precisa de internet para restaurar.'));
      return;
    }
    try {
      const backupData = await buscarBackupDrive();
      if (!backupData) {
        // Sem backup na conta é NORMAL (primeiro acesso) — não é um erro:
        // o login segue sem alarme, o primeiro backup sobe logo em seguida.
        console.log('[Backup] Nenhum backup na conta — primeiro acesso.');
        return;
      }
      if (backupData.notas) setNotas(backupData.notas);
      if (backupData.listas && typeof setListas === 'function') setListas(backupData.listas);
      if (Array.isArray(backupData.pastas)) setPastas(backupData.pastas);
      // Restauração explícita: o que veio do Drive não é alteração local.
      registrarSnap([backupData.notas, backupData.listas, backupData.pastas]);
      // Anexos (imagens/áudios) das notas restauradas: baixa do Drive os que
      // faltam localmente. Best-effort — a nota funciona mesmo sem o arquivo
      // (e o próximo backup/ciclo tenta de novo).
      try {
        const htmls: string[] = (backupData.notas || []).map((n: any) => n?.conteudo || '');
        const restaurados = await restaurarAnexosDownload(htmls);
        if (restaurados > 0) console.log(`[Cloud] ${restaurados} anexo(s) restaurado(s) do Drive.`);
      } catch (e: any) {
        console.log(`[Cloud] Anexos: falha no download (seguindo): ${(e && (e.message || e)) || e}`);
      }
      // Tarefas da conta: substitui o conjunto local pelas tarefas do backup
      // (a chave por conta já é da própria conta — backup é a fonte da verdade).
    if (Array.isArray(backupData.tarefas) && typeof tarefasContext?.definirTarefas === 'function') {
      // merge por item: tarefa apagada no PC (ou aqui) NÃO ressuscita e a
      // versão mais nova (celular ou PC) é a que fica
      const mTarefas = mesclarComLocais(backupData.tarefas, dadosRef.current.tarefas || []);
      registrarSnap([mTarefas.itens]);
      await tarefasContext.definirTarefas(mTarefas.itens);
    }
      // Restaura a chave de IA SOMENTE se o aparelho não tiver uma configurada
      // (evita que um backup antigo apague uma chave local recém-colada).
      const chaveLocal = configTema?.chaveIA || '';
      if (backupData.chaveIA && !chaveLocal && typeof atualizarConfigTema === 'function') {
        await atualizarConfigTema('chaveIA', backupData.chaveIA);
      }
      // Preferencias vindas do PC: só aplica se remoto for mais novo (evita last-writer-wins)
      if (backupData.preferencias) {
        const localIso = await obterUltimaSyncLocal();
        if (isRemotoMaisNovo(backupData.ultimaSincronizacao, localIso)) {
          try { await aplicarPreferenciasRemotas(backupData.preferencias as any); } catch {}
          if (typeof backupData.ultimaSincronizacao === 'string') await salvarUltimaSyncLocal(backupData.ultimaSincronizacao);
        } else {
          console.log('[Cloud] Preferências remotas ignoradas (local mais novo).');
        }
      } else if (typeof backupData.ultimaSincronizacao === 'string') {
        await salvarUltimaSyncLocal(backupData.ultimaSincronizacao);
      }
      Alert.alert(tIdioma(idiomaAtual, 'Sucesso'), tIdioma(idiomaAtual, 'Dados restaurados!'));
    } catch (e) {
      Alert.alert(tIdioma(idiomaAtual, 'Erro'), tIdioma(idiomaAtual, 'Falha ao restaurar.'));
    }
  };

  /**
   * Apaga TODOS os arquivos de backup (`backup_notas.json`) do appDataFolder
   * da conta logada. Retorna true se a exclusão foi concluída (mesmo que não
   * houvesse nada para apagar). Não mexe nos dados locais do aparelho.
   */
  const apagarBackupsCloud = async (): Promise<boolean> => {
    if (!estaOnline) {
      Alert.alert(tIdioma(idiomaAtual, 'Offline'), tIdioma(idiomaAtual, 'Você precisa de internet para apagar os backups.'));
      return false;
    }
    try {
      const user = await GoogleSignin.getCurrentUser();
      if (!user) return false;
      const tokens = await GoogleSignin.getTokens();

      // PADRÃO DE SINCRONIZAÇÃO CORRETO: nunca DELETAR o arquivo do Drive.
      // Em vez disso, SOBE um backup vazio COM os tombstones. O outro aparelho
      // (PC/celular) puxa, vê os tombstones e apaga o conteúdo local dele.
      // Sem isto o PC via "Drive vazio", o merge mantinha tudo local e
      // RE-SUBIA todas as notas apagadas.
      const backupVazio = JSON.stringify({
        notas: [],
        listas: [],
        pastas: [],
        tarefas: [],
        apagados: serializarApagados(),
      });

      const search = await fetch('https://www.googleapis.com/drive/v3/files?q=name="backup_notas.json"&spaces=appDataFolder', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` }
      });
      const data = await search.json();
      const arquivos: any[] = data.files || [];
      const canonico = arquivos[0];

      if (canonico?.id) {
        // ATUALIZA o arquivo existente (PUT) com o backup vazio + tombstones
        const boundary = 'outrico-sync-' + Date.now();
        const metadata = JSON.stringify({ name: 'backup_notas.json' });
        const corpo = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${backupVazio}\r\n--${boundary}--`;
        const r = await fetch(
          `https://www.googleapis.com/upload/drive/v3/files/${canonico.id}?uploadType=multipart`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
              'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body: corpo,
          }
        );
        if (!r.ok) throw new Error(`Drive PATCH falhou: ${r.status}`);
      } else {
        // CRIA o arquivo (primeira vez)
        const boundary = 'outrico-sync-' + Date.now();
        const metadata = JSON.stringify({ name: 'backup_notas.json', parents: ['appDataFolder'] });
        const corpo = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${backupVazio}\r\n--${boundary}--`;
        const r = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
              'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body: corpo,
          }
        );
        if (!r.ok) throw new Error(`Drive POST falhou: ${r.status}`);
      }
      return true;
    } catch (e) {
      console.log('[Cloud] Erro ao apagar backups:', e);
      Alert.alert(tIdioma(idiomaAtual, 'Erro'), tIdioma(idiomaAtual, 'Falha ao apagar os backups.'));
      return false;
    }
  };

  // Restaura automaticamente CHAVE DE IA + PREFERENCIAS do backup do Drive ao abrir o app
  // (se houver conta logada) — evita ter que digitar a chave e reconfigurar o app em novo aparelho.
  useEffect(() => {
    const restaurarDoBackup = async () => {
      if (!estaOnline) return;
      try {
        const user = await GoogleSignin.getCurrentUser();
        if (!user) return;
        const backup = await buscarBackupDrive();
        if (!backup) return;
        if (!configTema?.chaveIA && backup?.chaveIA && typeof atualizarConfigTema === 'function') {
          await atualizarConfigTema('chaveIA', backup.chaveIA);
        }
        if (backup?.preferencias) {
          const localIso2 = await obterUltimaSyncLocal();
          if (isRemotoMaisNovo(backup.ultimaSincronizacao, localIso2)) {
            try { await aplicarPreferenciasRemotas(backup.preferencias as any); } catch {}
            if (typeof backup.ultimaSincronizacao === 'string') await salvarUltimaSyncLocal(backup.ultimaSincronizacao);
          }
        } else if (backup && typeof backup.ultimaSincronizacao === 'string') {
          await salvarUltimaSyncLocal(backup.ultimaSincronizacao);
        }
      } catch {
        // offline/sessão expirada: tenta de novo quando a internet voltar
      }
    };
    const t = setTimeout(restaurarDoBackup, 2500);
    return () => clearTimeout(t);
  }, [estaOnline, configTema?.chaveIA, buscarBackupDrive]);

  const logout = async () => {
    await GoogleSignin.signOut();
    setNotas([]);
    if (typeof setListas === 'function') setListas([]);
    setPastas([]);
    setCurrentUserId('local');
    // Tarefas voltam ao conjunto local imediatamente (força a recarga).
    if (typeof tarefasContext?.recarregarTarefas === 'function') {
      await tarefasContext.recarregarTarefas(true).catch(() => {});
    }
    Alert.alert(tIdioma(idiomaAtual, 'Sair'), tIdioma(idiomaAtual, 'Desconectado.'));
  };

  /**
   * Migra o que o usuário criou DESLOGADO (`@minhas_notas_locais`) para a
   * conta recém-logada (`@notas_user_<id>`), preservando o que já existia na
   * conta. Notas/listas de ids iguais mantêm a versão da conta; ids novos são
   * adicionados. Pastas entram sem duplicar. Retorna a quantidade migrada
   * (itens = notas + listas). Idempotente: rodar duas vezes não duplica.
   */
  const migrarLocaisParaConta = useCallback(async (): Promise<number> => {
    try {
      const bruto = await AsyncStorage.getItem('@minhas_notas_locais');
      if (!bruto) return 0;
      const locais = JSON.parse(bruto);
      const notasLocais: any[] = Array.isArray(locais) ? locais : (locais.notas || []);
      const listasLocais: any[] = Array.isArray(locais) ? [] : (locais.listas || []);
      const pastasLocais: Pasta[] = Array.isArray(locais) ? [] : (locais.pastas || []);

      const totalItensLocais = notasLocais.length + listasLocais.length;
      if (totalItensLocais === 0 && pastasLocais.length === 0) return 0;

      // Estado atual da conta (pode já ter dados de backup/restore).
      const user = await GoogleSignin.getCurrentUser();
      if (!user) return 0;
      const keyConta = `@notas_user_${user.user.id}`;
      const brutoConta = await AsyncStorage.getItem(keyConta);
      const conta = brutoConta ? JSON.parse(brutoConta) : {};
      const notasConta: any[] = Array.isArray(conta) ? conta : (conta.notas || []);
      const listasConta: any[] = Array.isArray(conta) ? [] : (conta.listas || []);
      const pastasConta: Pasta[] = Array.isArray(conta) ? [] : (conta.pastas || []);

      const idsNotasConta = new Set(notasConta.map(n => n.id));
      const idsListasConta = new Set(listasConta.map(l => l.id));
      const idsPastasConta = new Set(pastasConta.map(p => p.id));

      const notasNovas = notasLocais.filter(n => n?.id && !idsNotasConta.has(n.id));
      const listasNovas = listasLocais.filter(l => l?.id && !idsListasConta.has(l.id));
      const pastasNovas = pastasLocais.filter(p => p?.id && !idsPastasConta.has(p.id));

      const migrados = notasNovas.length + listasNovas.length;
      if (migrados === 0 && pastasNovas.length === 0) {
        // Nada novo a trazer — apaga o local para não re-migrar no próximo login.
        await AsyncStorage.removeItem('@minhas_notas_locais');
        return 0;
      }

      // Grava a fusão na chave da conta ANTES de atualizar o estado, para que o
      // efeito de salvamento local não sobrescreva a conta com o estado antigo.
      const payloadConta = {
        notas: [...notasNovas, ...notasConta],
        listas: [...listasNovas, ...listasConta],
        pastas: [...pastasNovas, ...pastasConta],
      };
      await AsyncStorage.setItem(keyConta, JSON.stringify(payloadConta));

      // Atualiza o estado em memória (as notas locais entram no topo, como
      // itens recém-criados). O efeito de salvamento local persistirá em
      // seguida, e o backup na nuvem sobe com tudo junto.
      setNotas(prev => {
        const ids = new Set(prev.map(n => n.id));
        return [...notasNovas.filter(n => !ids.has(n.id)), ...prev];
      });
      if (typeof setListas === 'function') {
        setListas(prev => {
          const ids = new Set(prev.map(l => l.id));
          return [...listasNovas.filter(l => !ids.has(l.id)), ...prev];
        });
      }
      setPastas(prev => {
        const ids = new Set(prev.map(p => p.id));
        return [...pastasNovas.filter(p => !ids.has(p.id)), ...prev];
      });

      // Consome o local: migrado uma vez, não volta (logout não ressuscita).
      await AsyncStorage.removeItem('@minhas_notas_locais');
      return migrados;
    } catch (e) {
      console.error('[Migração] Falha ao migrar dados locais para a conta:', e);
      return 0;
    }
  }, [setListas]);

  /**
   * Migra as TAREFAS criadas deslogado (`@minhas_tarefas_v1`) para a chave da
   * conta (`@tarefas_user_<id>`), sem duplicar por id. Idempotente. Chamar
   * APÓS o login (quando getCurrentUser já devolve a nova conta).
   */
  const migrarTarefasLocaisParaConta = useCallback(async (): Promise<number> => {
    try {
      const user = await GoogleSignin.getCurrentUser();
      if (!user) return 0;
      const bruto = await AsyncStorage.getItem('@minhas_tarefas_v1');
      if (!bruto) return 0;
      const locais: any[] = JSON.parse(bruto);
      if (!Array.isArray(locais) || locais.length === 0) return 0;

      const chaveConta = `@tarefas_user_${user.user.id}`;
      const brutoConta = await AsyncStorage.getItem(chaveConta);
      const conta: any[] = brutoConta ? JSON.parse(brutoConta) : [];
      if (!Array.isArray(conta)) return 0;

      const idsConta = new Set(conta.map(x => x.id));
      const novas = locais.filter(x => x?.id && !idsConta.has(x.id));
      if (novas.length === 0) {
        // Nada novo: consome o local para não re-migrar.
        await AsyncStorage.removeItem('@minhas_tarefas_v1');
        return 0;
      }

      await AsyncStorage.setItem(chaveConta, JSON.stringify([...novas, ...conta]));
      await AsyncStorage.removeItem('@minhas_tarefas_v1');
      // Recarrega o estado (forçado, pois o userId já é o novo).
      if (typeof tarefasContext?.recarregarTarefas === 'function') {
        await tarefasContext.recarregarTarefas(true).catch(() => {});
      }
      return novas.length;
    } catch (e) {
      console.error('[Migração] Falha ao migrar tarefas locais:', e);
      return 0;
    }
  }, [tarefasContext]);

  /**
   * APAGAR TUDO (botão da tela de bloqueio): destrói TODO o conteúdo do app no
   * APARELHO — notas, listas, pastas, tarefas, lembretes agendados — de todas
   * as contas que já logaram nesta instalação. NÃO toca na nuvem (o backup do
   * Drive da conta continua intacto; para a nuvem use o botão do modal de
   * conta). Mantém configurações do aparelho (tema, idioma, bloqueio) para não
   * desconfigurar o app do usuário. Após apagar, re-carrega o estado vazio.
   */
  const apagarTudoLocal = useCallback(async (): Promise<boolean> => {
    try {
      // 0) REGISTRA TOMBSTONES de TODAS as notas/listas/pastas/tarefas
      // ANTES de apagar — sem isto o PC faz merge sem saber que foi
      // exclusão intencional e RE-SOBE tudo para o Drive.
      const itens = notasRef.current || [];
      const ids = itens.map(n => n?.id).filter(Boolean);
      if (typeof setListas === 'function') {
        // listas e pastas também precisam de tombstone
        // (o merge é por item, não por tipo)
      }
      if (ids.length > 0) {
        registrarApagados(ids);
        console.log('[Apagar tudo] Tombstones registrados:', ids.length);
      }

      // 1) Cancela TODOS os lembretes agendados das notas (Android nativo + expo).
      for (const nota of itens) {
        if (nota?.lembrete) {
          await cancelarLembretes(nota.id, nota.lembreteExpoIds ?? []).catch(() => {});
        }
      }

      // 2) Coleta todas as chaves de conteúdo: local + de cada conta que já logou.
      const todas = await AsyncStorage.getAllKeys();
      const chavesConteudo = todas.filter(k =>
        k === '@minhas_notas_locais' || k.startsWith('@notas_user_')
      );

      // 3) Apaga as chaves e zera os estados (ordem: storage ANTES do estado,
      // para o efeito de salvamento não regravar o conteúdo antigo).
      if (chavesConteudo.length) await AsyncStorage.multiRemove(chavesConteudo);
      setNotas([]);
      if (typeof setListas === 'function') setListas([]);
      setPastas([]);
      return true;
    } catch (e) {
      console.error('[Apagar tudo] Falha ao apagar conteúdo local:', e);
      return false;
    }
  }, [setListas]);

  const salvarNota = (titulo: string, conteudo: string, id?: string, protegida: boolean = false, pastaId?: string | null) => {
  // Nota NOVA = sem id (o contexto gera o id). O anúncio por alteração é
  // decidido NO EDITOR (Pronto/voltar), nunca aqui no save.
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
    registrarApagado(id); // tombstone: a exclusão viaja no backup e o outro aparelho obedece
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
      nome: nome.trim() || tIdioma(idiomaAtual, 'Nova pasta'),
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
    // Tombstone da PASTA: sem isso o merge do outro aparelho vê a pasta como
    // "só-local" e a recria a cada pull (bug: pasta que nunca morre).
    registrarApagado(id);
    setPastas(prev => prev.filter(p => p.id !== id));
    // Notas/listas voltam para a lista principal — o detach sincroniza porque
    // a versão remota (sem pastaId) vence no merge por id.
    setNotas(prev => prev.map(n => (n.pastaId === id ? { ...n, pastaId: undefined } : n)));
    if (typeof setListas === 'function') {
      setListas((prev: any[]) => (prev || []).map((l: any) => (l.pastaId === id ? { ...l, pastaId: undefined } : l)));
    }
  }, [setListas]);

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
      salvarNota, salvarLembreteNota, excluirNota, alternarFixarNota,      logout, 
      migrarLocaisParaConta,
      migrarTarefasLocaisParaConta,
      apagarTudoLocal,
      fazerBackupCloud, apagarBackupsCloud, buscarCotaDrive, estaOnline,
      restaurarBackupCloud, isAppBloqueado, toggleBloqueioApp,
      recarregarTudo: carregarTudo,
      // Identidade da conta logada ('local' quando deslogado) — usada, ex., para
      // saber se a conta já deu feedback no plano gratuito.
      usuarioId: currentUserId ?? 'local',
      syncStatus,
      sincronizarAgora,
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
