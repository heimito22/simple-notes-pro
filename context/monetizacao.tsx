import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import MobileAds, {
  AdEventType,
  InterstitialAd,
  TestIds,
} from 'react-native-google-mobile-ads';
import {
  billingNativoDisponivel,
  comprarRemoverAnuncios as comprarNativo,
  ouvirCompraAtualizada,
  restaurarComprasRemoverAnuncios,
} from '../modules/minhasnotas-alarm';

/**
 * Configuração de anúncios (AdMob).
 *
 * IMPORTANTE: enquanto não houver conta AdMob, usamos o App ID e o Ad Unit de
 * TESTE do Google (ca-app-pub-3940256099942544/1033173712) — os anúncios de
 * teste aparecem normalmente. Para anúncios REAIS, troque PROD_AD_UNIT_ID pelo
 * ID do seu Ad Unit interstitial no console do AdMob.
 */
const AD_UNIT_ID = __DEV__ ? TestIds.INTERSTITIAL : 'ca-app-pub-3606563609683859/1398347698';

/**
 * Modelo de premium por CONTA (direito vinculado ao email que pagou):
 *
 * 1. COMPRA REAL (Play Billing, não-consumível "removeranuncios"): exige conta
 *    Google logada e fica VINCULADA ao email logado no pagamento — o dono é
 *    gravado (a) localmente, como cache do aparelho, e (b) no DRIVE DA CONTA
 *    (`premium_owner.json` no appDataFolder — a mesma pasta privada do backup
 *    `backup_notas.json`), que é por-conta e acompanha o email entre aparelhos.
 *    A restauração PURA do Play Billing nunca vincula dono; só compra nova
 *    (restaurado===false) ou o arquivo por-conta do Drive vinculam.
 * 2. CONVITE do desenvolvedor: vale SÓ enquanto a conta convidada estiver
 *    logada (chave `@config_premium_por_email`).
 *
 * REGRAS (sem auto-adoção legada):
 * - Sem conta logada (offline/deslogado) → NUNCA premium (revoga em memória).
 * - Só o email DONO da compra tem premium comprado. Outra conta → anúncios.
 * - Reembolso: quando a Play confirma sem compra (Boolean false), limpa STORAGE.
 *   Quando a Play está indisponível/offline (null), apenas revoga em memória
 *   sem destruir o entitlement local — o próximo online reavalia.
 * - Legado sem dono nunca é auto-adotado para "qualquer conta".
 */
const STORAGE_KEY = '@config_anuncios_removidos';
const STORAGE_KEY_DONO = '@config_premium_dono_email';
const STORAGE_KEY_PREMIUM_EMAIL = '@config_premium_por_email';
// Arquivo por-conta no appDataFolder do Drive: fonte durável do dono.
const ARQUIVO_PREMIUM_NUVEM = 'premium_owner.json';

// Emails com premium grátis (desenvolvedor). Quando a conta Google logada
// estiver nesta lista, o app libera sem anúncios automaticamente.
const EMAILS_PREMIUM = ['heitoruliacchrabeloreis@gmail.com', 'elenuliach@gmail.com'];
const emailTemPremium = (email: string): boolean => EMAILS_PREMIUM.includes(email.trim().toLowerCase());

/** Resultado de tentar abrir a compra (a UI decide o que avisar). */
export type ResultadoCompra = 'aberta' | 'precisaLogin' | 'outraConta' | 'indisponivel';

interface MonetizacaoContextData {
  /** true quando o premium está ATIVO nesta sessão (ads desligados). */
  anunciosRemovidos: boolean;
  /**
   * true quando o premium ativo veio de CONVITE (selo "Premium por convite").
   * O convite só vale enquanto a conta Google logada estiver na lista.
   */
  premiumPorEmail: boolean;
  /** true enquanto a janela de pagamento está abrindo. */
  comprando: boolean;
  /** Email da conta Google logada agora (null quando deslogado). */
  emailLogado: string | null;
  /** Email dono da compra (null = compra legada ou sem compra). */
  emailDonoCompra: string | null;
  /** true quando a compra foi bloqueada e o login para comprar está pendente. */
  aguardandoLoginParaCompra: boolean;
  /** Mostra o anúncio interstitial (curto) se o premium NÃO estiver ativo. */
  mostrarAnuncio: () => void;
  /**
   * Tenta abrir o pagamento. NÃO abre sem conta Google logada — o premium é
   * vinculado ao email da conta. Retorna o que aconteceu para a UI orientar.
   */
  comprarRemoverAnuncios: () => Promise<ResultadoCompra>;
  /**
   * Reavalia o premium (compra por conta + convite) contra a conta logada.
   * Chamado ao abrir o app, voltar do background e após login/logout/troca.
   */
  sincronizarPremium: (usuario?: { user?: { email?: string | null } } | null) => Promise<void>;
  /** Marca que o usuário quer comprar e precisa entrar primeiro (abre o login). */
  solicitarLoginParaCompra: () => void;
  /** Cancela o pedido de compra pendente (fechou o login sem entrar). */
  cancelarCompraPendente: () => void;
  /**
   * Depois do login bem-sucedido, dispara a compra que ficou pendente e
   * devolve o resultado (a tela dá o feedback se ela não abriu).
   */
  tentarCompraPendente: () => Promise<ResultadoCompra>;
}

const MonetizacaoContext = createContext<MonetizacaoContextData>({
  anunciosRemovidos: false,
  premiumPorEmail: false,
  comprando: false,
  emailLogado: null,
  emailDonoCompra: null,
  aguardandoLoginParaCompra: false,
  mostrarAnuncio: () => {},
  comprarRemoverAnuncios: async () => 'indisponivel',
  sincronizarPremium: async () => {},
  solicitarLoginParaCompra: () => {},
  cancelarCompraPendente: () => {},
  tentarCompraPendente: async () => 'indisponivel',
});

const normalizarEmail = (email?: string | null): string | null =>
  email ? email.trim().toLowerCase() : null;

/* ---------------------------------------------------------------------------
 * Acesso ao appDataFolder do Drive da conta logada (mesmo padrão do backup de
 * notas do NotasContext: escopo drive.appdata, sessão renovada em silêncio).
 * O arquivo `premium_owner.json` é POR CONTA: cada conta Google tem a sua
 * pasta privada, então o dono viaja com o email entre aparelhos.
 * ------------------------------------------------------------------------- */

const buscarTokenDrive = async (): Promise<string | null> => {
  try {
    await GoogleSignin.signInSilently().catch(() => {});
    const tokens = await GoogleSignin.getTokens();
    return tokens.accessToken || null;
  } catch {
    return null;
  }
};

/** Lê o dono registrado na nuvem da conta logada (null se não houver/offline). */
const lerDonoNuvem = async (): Promise<string | null> => {
  const token = await buscarTokenDrive();
  if (!token) return null;
  try {
    const busca = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='${ARQUIVO_PREMIUM_NUVEM}' and parents in 'appDataFolder'&spaces=appDataFolder`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const dados = await busca.json();
    const fileId = dados?.files?.[0]?.id;
    if (!fileId) return null;
    const download = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!download.ok) return null;
    const corpo = await download.json();
    return normalizarEmail(corpo?.email);
  } catch {
    return null;
  }
};

/** Grava o dono na nuvem da conta logada (cria ou atualiza o arquivo). */
const escreverDonoNuvem = async (email: string): Promise<void> => {
  const token = await buscarTokenDrive();
  if (!token) return;
  const corpo = JSON.stringify({ email: normalizarEmail(email) });
  try {
    const busca = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='${ARQUIVO_PREMIUM_NUVEM}' and parents in 'appDataFolder'&spaces=appDataFolder`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const dados = await busca.json();
    const fileId = dados?.files?.[0]?.id;
    if (fileId) {
      await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: corpo,
      });
    } else {
      const metadata = { name: ARQUIVO_PREMIUM_NUVEM, parents: ['appDataFolder'] };
      const boundary = 'premium_boundary';
      const multipart =
        `--${boundary}\nContent-Type: application/json\n\n${JSON.stringify(metadata)}\n` +
        `--${boundary}\nContent-Type: application/json\n\n${corpo}\n--${boundary}--`;
      await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: multipart,
      });
    }
  } catch {
    // best-effort: o cache local cobre o offline
  }
};

/* ------------------------------------------------------------------------- */

export function MonetizacaoProvider({ children }: { children: React.ReactNode }) {
  const [anunciosRemovidos, setAnunciosRemovidos] = useState(false);
  const [premiumPorEmail, setPremiumPorEmail] = useState(false);
  const [comprando, setComprando] = useState(false);
  const [emailLogado, setEmailLogado] = useState<string | null>(null);
  const [emailDonoCompra, setEmailDonoCompra] = useState<string | null>(null);
  const [aguardandoLoginParaCompra, setAguardandoLoginParaCompra] = useState(false);
  // Cache do interstitial: recarregado ao abrir após ser mostrado/fechado
  const intersticialRef = useRef<InterstitialAd | null>(null);
  const intersticialCarregadoRef = useRef(false);
  // Evita pilha de anúncios (só mostra 1 por vez)
  const mostrandoRef = useRef(false);
  // Pedido pendente: usuário criou nota/lembrete enquanto o anúncio ainda
  // carregava. Quando o anúncio carregar (evento LOADED), ele é mostrado
  // automaticamente — o pedido nunca é perdido.
  const pendenteRef = useRef(false);
  // Espelho do estado para uso dentro dos listeners do anúncio (evita captura
  // de valor antigo após a compra "remover anúncios").
  const anunciosRemovidosRef = useRef(false);
  const premiumPorEmailRef = useRef(false);
  // Existe compra REAL (Play Billing) neste aparelho — nunca é apagada por
  // troca de conta/convite (só o estado de SESSÃO é revogado).
  const possuiCompraRef = useRef(false);
  const aguardandoRef = useRef(false);

  // Ref para a função de recriação (o listener do anúncio a chama ao fechar —
  // evita o ciclo de declaração e mantém sempre a versão mais recente)
  const recriarRef = useRef<() => void>(() => {});

  const criarIntersticial = useCallback(() => {
    if (Platform.OS === 'web') return;
    try {
      const ad = InterstitialAd.createForAdRequest(AD_UNIT_ID, {
        requestNonPersonalizedAdsOnly: true,
      });
      ad.addAdEventListener(AdEventType.LOADED, () => {
        intersticialCarregadoRef.current = true;
        // Se havia um pedido pendente (criou nota/lembrete durante o
        // carregamento), mostra o anúncio imediatamente.
        if (pendenteRef.current && !mostrandoRef.current && !anunciosRemovidosRef.current) {
          pendenteRef.current = false;
          mostrandoRef.current = true;
          try {
            ad.show();
          } catch (e) {
            mostrandoRef.current = false;
          }
        }
      });
      ad.addAdEventListener(AdEventType.CLOSED, () => {
        intersticialCarregadoRef.current = false;
        mostrandoRef.current = false;
        // Prepara o próximo anúncio
        recriarRef.current();
      });
      ad.addAdEventListener(AdEventType.ERROR, () => {
        intersticialCarregadoRef.current = false;
        mostrandoRef.current = false;
      });
      ad.load();
      intersticialRef.current = ad;
    } catch (e) {
      console.warn('[Ads] Erro ao criar interstitial:', e);
    }
  }, []);

  useEffect(() => {
    recriarRef.current = criarIntersticial;
  }, [criarIntersticial]);

  // Mantém os espelhos de estado sincronizados para os listeners
  useEffect(() => {
    anunciosRemovidosRef.current = anunciosRemovidos;
  }, [anunciosRemovidos]);
  useEffect(() => {
    premiumPorEmailRef.current = premiumPorEmail;
  }, [premiumPorEmail]);
  useEffect(() => {
    aguardandoRef.current = aguardandoLoginParaCompra;
  }, [aguardandoLoginParaCompra]);

  // Inicializa o SDK de anúncios e o primeiro interstitial (só no Android)
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let ativo = true;
    MobileAds()
      .initialize()
      .then(() => {
        if (ativo) criarIntersticial();
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, [criarIntersticial]);

  const lerDono = useCallback(async (): Promise<string | null> => {
    try {
      return normalizarEmail(await AsyncStorage.getItem(STORAGE_KEY_DONO));
    } catch {
      return null;
    }
  }, []);

  // Ativa o premium na sessão (ads desligados). `porEmail=true` marca o selo de
  // convite e persiste SÓ a chave de convite — nunca toca na chave de compra
  // real (o convite não pode "virar" compra).
  const liberarPremium = useCallback(async (porEmail = false) => {
    setAnunciosRemovidos(true);
    anunciosRemovidosRef.current = true;
    if (porEmail) {
      setPremiumPorEmail(true);
      premiumPorEmailRef.current = true;
      try {
        await AsyncStorage.setItem(STORAGE_KEY_PREMIUM_EMAIL, 'true');
      } catch (e) {
        console.warn('[Premium] Falha ao salvar convite:', e);
      }
    } else {
      setPremiumPorEmail(false);
      premiumPorEmailRef.current = false;
      // Se sobrava uma marca de convite antiga (outra conta convidada já usou
      // este aparelho), limpa — a compra do dono tem precedência na sessão.
      try {
        await AsyncStorage.removeItem(STORAGE_KEY_PREMIUM_EMAIL);
      } catch {
        // ignora
      }
    }
  }, []);

  // Desativa o premium da sessão. NUNCA apaga a chave de compra (STORAGE):
  // a limpeza de legado de convite é feita no momento do decode (ver
  // sincronizarPremium), longe da corrida com a restauração do billing — um
  // logout/revogação não consegue mais destruir o marcador de compra real
  // enquanto o restore ainda não respondeu (ex.: offline no boot).
  const revogarPremium = useCallback(async (haviaInvite: boolean) => {
    setAnunciosRemovidos(false);
    anunciosRemovidosRef.current = false;
    setPremiumPorEmail(false);
    premiumPorEmailRef.current = false;
    if (haviaInvite) {
      try {
        await AsyncStorage.removeItem(STORAGE_KEY_PREMIUM_EMAIL);
      } catch {
        // ignora
      }
    }
  }, []);

  /**
   * Reavalia o premium contra a conta logada (compra por conta + convite).
   * `usuario` passado evita a consulta assíncrona ao Google (login/logout já
   * conhecem o usuário); sem ele, consulta a sessão atual.
   */
  const sincronizarPremium = useCallback(
    async (usuario?: { user?: { email?: string | null } } | null) => {
      if (Platform.OS === 'web') return;
      try {
        let email: string | null | undefined;
        if (usuario !== undefined) {
          email = usuario?.user?.email;
        } else {
          const user = await GoogleSignin.getCurrentUser();
          email = user?.user?.email;
        }
        email = normalizarEmail(email);
        setEmailLogado(email);

        const convidado = !!email && emailTemPremium(email);

        // Fonte durável do dono: primeiro a nuvem DA CONTA logada (se o email
        // estiver logado e houver arquivo), depois o cache local do aparelho.
        let dono = await lerDono();
        if (email) {
          const donoNuvem = await lerDonoNuvem();
          if (donoNuvem && donoNuvem === email) {
            dono = donoNuvem;
            try {
              await AsyncStorage.setItem(STORAGE_KEY_DONO, donoNuvem);
            } catch {
              // ignora
            }
          } else if (dono === email && !donoNuvem) {
            escreverDonoNuvem(email).catch(() => {});
          }
        }
        // Sem conta logada = sem dono efetivo (premium exige login)
        if (!email) dono = null;
        setEmailDonoCompra(dono);

        // Verifica no Play Billing se a compra ainda existe (reembolso/cancelamento).
        // null = Play indisponível/offline → não destrói entitlement; false = sem
        // compra confirmada → limpa marca local. Em null, só revoga em memória.
        let possuiCompraAtual: boolean | null = null;
        if (billingNativoDisponivel()) {
          try {
            const r: boolean | null = await restaurarComprasRemoverAnuncios();
            if (r === null) {
              possuiCompraAtual = null;
            } else if (!r) {
              possuiCompraAtual = false;
              possuiCompraRef.current = false;
              try { await AsyncStorage.removeItem(STORAGE_KEY); } catch {}
              try {
                const inv = await AsyncStorage.getItem(STORAGE_KEY_PREMIUM_EMAIL).catch(() => null);
                if (inv === 'true') await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
              } catch {}
            } else {
              possuiCompraAtual = true;
              possuiCompraRef.current = true;
              try { await AsyncStorage.setItem(STORAGE_KEY, 'true'); } catch {}
            }
          } catch {
            possuiCompraAtual = null;
          }
        }

        const invite = (await AsyncStorage.getItem(STORAGE_KEY_PREMIUM_EMAIL).catch(() => null)) === 'true';
        const entit = (await AsyncStorage.getItem(STORAGE_KEY).catch(() => null)) === 'true';
        // Se a Play confirmou sem compra (false), zera; se indisponível (null), usa cache.
        const possuiCompra =
          possuiCompraAtual === false ? false
          : possuiCompraAtual === true ? true
          : possuiCompraRef.current || (entit && !invite);
        if (possuiCompra) {
          possuiCompraRef.current = true;
        } else if (entit && invite) {
          try { await AsyncStorage.removeItem(STORAGE_KEY); } catch {}
        }

        // Legado sem dono: nunca auto-adota. Dono só é vinculado em compra nova
        // (registrarCompra, restaurado===false) ou via premium_owner.json da conta.
        // Sem dono, premium comprado fica indisponível até compra nova.

        // REGRA DURA: sem conta logada → nunca premium (nem comprado nem convite)
        if (!email) {
          const haviaInvite = invite || premiumPorEmailRef.current;
          const haviaPremium = anunciosRemovidosRef.current;
          if (haviaPremium || haviaInvite) await revogarPremium(haviaInvite);
          return;
        }

        // Conta logada: convite vale só para a conta convidada
        if (convidado) {
          await liberarPremium(true);
          return;
        }

        // Compra vale SÓ quando há compra ativa E o email logado é o dono.
        const compraVale = possuiCompra && dono !== null && dono === email;
        if (compraVale) {
          await liberarPremium(false);
          return;
        }

        // Não vale para esta conta: revoga premium (outra conta sem compra ou reembolsado).
        const haviaInvite2 = invite || premiumPorEmailRef.current;
        const haviaPremium2 = anunciosRemovidosRef.current;
        if (haviaPremium2 || haviaInvite2) {
          await revogarPremium(haviaInvite2);
        }
      } catch {
        // Falha ao ler a sessão (offline/token expirado): não revoga nem libera
        // às cegas — o próximo ciclo (foreground ou login/logout) reavalia.
      }
    },
    [lerDono, liberarPremium, revogarPremium]
  );

  // Assinatura persistente do evento de compra (ref evita re-subscrição).
  const aoCompraAtualizadaRef = useRef<() => void>(() => {});
  const registrarCompra = useCallback(
    async (comprado: boolean, restaurado: boolean) => {
      if (!comprado) return;
      // Compra confirmada pelo Play: existe compra real neste aparelho.
      possuiCompraRef.current = true;
      try {
        await AsyncStorage.setItem(STORAGE_KEY, 'true');
      } catch (e) {
        console.warn('[Premium] Falha ao salvar compra:', e);
      }
      if (!restaurado) {
        // Compra NOVA feita agora: vincula ao email logado no momento do
        // pagamento (o fluxo exige conta logada para comprar) e sobe o dono
        // para o Drive DA CONTA — é o que garante o "para sempre" entre
        // aparelhos. Restauração pura nunca adota dono.
        try {
          const cur = await GoogleSignin.getCurrentUser();
          const email = normalizarEmail(cur?.user?.email);
          if (email) {
            await AsyncStorage.setItem(STORAGE_KEY_DONO, email);
            setEmailDonoCompra(email);
            escreverDonoNuvem(email).catch(() => {});
          }
        } catch (e) {
          console.warn('[Premium] Falha ao vincular dono da compra:', e);
        }
      }
      aoCompraAtualizadaRef.current();
    },
    []
  );
  aoCompraAtualizadaRef.current = () => {
    sincronizarPremium().catch(() => {});
  };

  // Carrega o estado inicial: conta logada + compra real (restauração nativa).
  useEffect(() => {
    let ativo = true;

    const carregar = async () => {
      try {
        const dono = await lerDono();
        if (ativo) setEmailDonoCompra(dono);
      } catch {
        // ignora
      }
      // Verificação real no Play Billing (restaura compras em outro aparelho)
      // null = indisponível/offline → não assume compra nem limpa nada.
      if (billingNativoDisponivel()) {
        try {
          const restaurado: boolean | null = await restaurarComprasRemoverAnuncios();
          if (restaurado === null) {
            // indisponível/offline: mantém cache; sincronizarPremium reavalia depois
          } else if (restaurado) {
            possuiCompraRef.current = true;
            await AsyncStorage.setItem(STORAGE_KEY, 'true').catch(() => {});
          } else {
            possuiCompraRef.current = false;
            await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
          }
        } catch {
          // billing indisponível
        }
      }
    };
    carregar();

    // Reage a compras concluídas em tempo real (nova ou reconciliada)
    const sub = ouvirCompraAtualizada(info => {
      registrarCompra(!!info.comprado, !!info.restaurado);
    });

    return () => {
      ativo = false;
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registrarCompra]);

  const mostrarAnuncio = useCallback(() => {
    // Premium ativo → nunca mostra anúncio
    if (anunciosRemovidos) return;
    if (Platform.OS !== 'android') return;
    if (mostrandoRef.current) return;
    const ad = intersticialRef.current;
    if (!ad || !intersticialCarregadoRef.current) {
      // Ainda não carregou: registra o pedido pendente e tenta carregar.
      // Quando o LOADED disparar, o anúncio será mostrado na hora.
      pendenteRef.current = true;
      if (ad) ad.load();
      return;
    }
    pendenteRef.current = false;
    mostrandoRef.current = true;
    try {
      ad.show();
    } catch (e) {
      mostrandoRef.current = false;
    }
  }, [anunciosRemovidos]);

  /**
   * Abre a janela de pagamento. O premium é vinculado ao email da conta Google
   * logada — por isso, sem conta logada o pagamento NÃO abre (a UI pede login).
   * Com conta de outro email dono de compra, também não abre (não há o que
   * comprar de novo: a compra pertence àquele email).
   */
  const comprar = useCallback(async (): Promise<ResultadoCompra> => {
    if (anunciosRemovidos || comprando) return 'aberta';
    if (!billingNativoDisponivel()) return 'indisponivel';

    // Deteta a conta logada no momento da compra.
    let email: string | null = null;
    try {
      const cur = await GoogleSignin.getCurrentUser();
      email = normalizarEmail(cur?.user?.email);
    } catch {
      email = null;
    }

    const dono = await lerDono();
    if (possuiCompraRef.current && dono && email && dono !== email) {
      // A compra deste aparelho pertence a outro email: trocar de conta é o
      // caminho (a UI avisa qual email tem o premium).
      return 'outraConta';
    }
    if (!email) {
      // Exige login para comprar (o premium fica no email da conta).
      return 'precisaLogin';
    }

    setComprando(true);
    try {
      const res = await comprarNativo();
      return res?.ok ? 'aberta' : 'indisponivel';
    } catch (e) {
      console.warn('[Billing] Erro ao abrir pagamento:', e);
      return 'indisponivel';
    } finally {
      setComprando(false);
    }
  }, [anunciosRemovidos, comprando, lerDono]);

  const solicitarLoginParaCompra = useCallback(() => {
    if (anunciosRemovidosRef.current) return;
    setAguardandoLoginParaCompra(true);
  }, []);

  const cancelarCompraPendente = useCallback(() => {
    setAguardandoLoginParaCompra(false);
  }, []);

  // Depois de um login bem-sucedido, dispara a compra que ficou pendente e
  // devolve o resultado — a tela dá o feedback se ela não abriu (outraConta,
  // precisaLogin, indisponivel) em vez de engolir em silêncio.
  const tentarCompraPendente = useCallback(async (): Promise<ResultadoCompra> => {
    if (!aguardandoRef.current) return 'aberta';
    setAguardandoLoginParaCompra(false);
    return comprar();
  }, [comprar]);

  // Primeira avaliação + reavaliação ao voltar do background (o Google
  // Sign-In também cobre login aqui: a tela do sistema manda o app a
  // background e ele volta como active).
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const t = setTimeout(() => sincronizarPremium(), 0);
    const sub = AppState.addEventListener('change', estado => {
      if (estado === 'active') sincronizarPremium();
    });
    return () => {
      clearTimeout(t);
      sub.remove();
    };
  }, [sincronizarPremium]);

  return (
    <MonetizacaoContext.Provider
      value={{
        anunciosRemovidos,
        premiumPorEmail,
        comprando,
        emailLogado,
        emailDonoCompra,
        aguardandoLoginParaCompra,
        mostrarAnuncio,
        comprarRemoverAnuncios: comprar,
        sincronizarPremium,
        solicitarLoginParaCompra,
        cancelarCompraPendente,
        tentarCompraPendente,
      }}
    >
      {children}
    </MonetizacaoContext.Provider>
  );
}

export const useMonetizacao = () => useContext(MonetizacaoContext);
