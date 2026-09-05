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
  comprarRemoverAnuncios,
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
const AD_UNIT_ID = __DEV__ ? TestIds.INTERSTITIAL : 'ca-app-pub-3940256099942544/1033173712';

const STORAGE_KEY = '@config_anuncios_removidos';
// Marca quando a liberação veio do email de convite (exibe o selo nos Ajustes)
const STORAGE_KEY_PREMIUM_EMAIL = '@config_premium_por_email';

// Emails com premium grátis (desenvolvedor). Quando a conta Google logada
// estiver nesta lista, o app libera sem anúncios automaticamente.
const EMAILS_PREMIUM = ['heitoruliacchrabeloreis@gmail.com', 'elenuliach@gmail.com'];
const emailTemPremium = (email: string): boolean => EMAILS_PREMIUM.includes(email.trim().toLowerCase());

interface MonetizacaoContextData {
  /** true quando o usuário comprou a remoção de anúncios (para sempre). */
  anunciosRemovidos: boolean;
  /**
   * true quando o premium foi liberado por EMAIL (convite do desenvolvedor)
   * em vez de compra — usado para exibir o selo "Premium por convite".
   * O convite só vale ENQUANTO a conta Google logada estiver na lista de
   * convidados: deslogou ou trocou de conta → o convite sai.
   */
  premiumPorEmail: boolean;
  /** true enquanto a janela de pagamento está abrindo. */
  comprando: boolean;
  /** Mostra o anúncio interstitial (curto) se o usuário NÃO comprou. */
  mostrarAnuncio: () => void;
  /** Abre a janela de pagamento da Play Store (produto "remover_anuncios"). */
  comprarRemoverAnuncios: () => Promise<void>;
  /**
   * Reavalia o premium por convite contra a conta logada. Chamado ao abrir o
   * app, ao voltar do background e (pelas telas) após login/logout. Quando
   * `usuario` é passado, usa o usuário conhecido em vez de consultar o Google.
   */
  sincronizarPremiumConvite: (usuario?: { user?: { email?: string | null } } | null) => Promise<void>;
}

const MonetizacaoContext = createContext<MonetizacaoContextData>({
  anunciosRemovidos: false,
  premiumPorEmail: false,
  comprando: false,
  mostrarAnuncio: () => {},
  comprarRemoverAnuncios: async () => {},
  sincronizarPremiumConvite: async () => {},
});

export function MonetizacaoProvider({ children }: { children: React.ReactNode }) {
  const [anunciosRemovidos, setAnunciosRemovidos] = useState(false);
  const [premiumPorEmail, setPremiumPorEmail] = useState(false);
  const [comprando, setComprando] = useState(false);
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
  // Espelho do selo de convite: o sincronizador precisa saber se o premium ativo
  // veio do convite (para revogar só o convite, nunca uma compra real).
  const premiumPorEmailRef = useRef(false);

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

  // Carrega o estado de compra: storage local + verificação nativa (Play Billing)
  useEffect(() => {
    let ativo = true;

    const carregar = async () => {
      try {
        const salvo = await AsyncStorage.getItem(STORAGE_KEY);
        if (salvo === 'true' && ativo) setAnunciosRemovidos(true);
        const porEmail = await AsyncStorage.getItem(STORAGE_KEY_PREMIUM_EMAIL);
        if (porEmail === 'true' && ativo) setPremiumPorEmail(true);
      } catch (e) {
        // ignora
      }

      // Verificação real no Play Billing (restaura compras em outro aparelho)
      if (billingNativoDisponivel()) {
        const comprado = await restaurarComprasRemoverAnuncios();
        if (comprado && ativo) {
          // Compra real tem precedência sobre o convite (selo some)
          setAnunciosRemovidos(true);
          setPremiumPorEmail(false);
          AsyncStorage.setItem(STORAGE_KEY, 'true').catch(() => {});
          AsyncStorage.removeItem(STORAGE_KEY_PREMIUM_EMAIL).catch(() => {});
        }
      }
    };
    carregar();

    // Reage a compras concluídas em tempo real
    const sub = ouvirCompraAtualizada(info => {
      if (info.comprado) {
        // Compra real tem precedência sobre o convite (selo some)
        setAnunciosRemovidos(true);
        setPremiumPorEmail(false);
        AsyncStorage.setItem(STORAGE_KEY, 'true').catch(() => {});
        AsyncStorage.removeItem(STORAGE_KEY_PREMIUM_EMAIL).catch(() => {});
      }
    });

    return () => {
      ativo = false;
      sub.remove();
    };
  }, []);

  const mostrarAnuncio = useCallback(() => {
    // Comprou → nunca mostra anúncio
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

  const comprar = useCallback(async () => {
    if (anunciosRemovidos || comprando) return;
    if (!billingNativoDisponivel()) return;
    setComprando(true);
    try {
      await comprarRemoverAnuncios();
    } catch (e) {
      console.warn('[Billing] Erro ao abrir pagamento:', e);
    } finally {
      setComprando(false);
    }
  }, [anunciosRemovidos, comprando]);

  // Libera o premium (mesma chave da compra real — persiste entre reinícios).
  // COMPRA nunca é revogada; o CONVITE (porEmail=true) é revogado pelo
  // sincronizador quando a conta certa sai. Quando porEmail=true, marca a
  // origem para exibir o selo "Premium por convite" nos Ajustes.
  const liberarPremium = useCallback(async (porEmail = false) => {
    setAnunciosRemovidos(true);
    anunciosRemovidosRef.current = true;
    if (porEmail) {
      setPremiumPorEmail(true);
      premiumPorEmailRef.current = true;
    }
    try {
      await AsyncStorage.setItem(STORAGE_KEY, 'true');
      if (porEmail) await AsyncStorage.setItem(STORAGE_KEY_PREMIUM_EMAIL, 'true');
    } catch (e) {
      console.warn('[Premium] Falha ao salvar liberação:', e);
    }
  }, []);

  // Premium grátis por EMAIL (convite do desenvolvedor): o convite só vale
  // ENQUANTO a conta Google logada estiver na lista de convidados.
  // - Conta convidada logada → libera/garante o premium por convite;
  // - Deslogado OU conta sem convite → se o premium ativo veio do convite,
  //   REVOGA (o selo some e os anúncios voltam). Compra real nunca é tocada.
  const sincronizarPremiumConvite = useCallback(async (usuario?: { user?: { email?: string | null } } | null) => {
    if (Platform.OS === 'web') return;
    try {
      let email: string | null | undefined;
      if (usuario !== undefined) {
        email = usuario?.user?.email;
      } else {
        const user = await GoogleSignin.getCurrentUser();
        email = user?.user?.email;
      }

      const convidado = !!email && emailTemPremium(email);
      if (convidado) {
        await liberarPremium(true);
        return;
      }

      // Sem conta convidada: revoga SOMENTE o que veio do convite. Se a compra
      // real estiver ativa (premiumPorEmail=false), ela permanece intocada.
      const veioDoConvite =
        premiumPorEmailRef.current ||
        (await AsyncStorage.getItem(STORAGE_KEY_PREMIUM_EMAIL).catch(() => null)) === 'true';
      if (veioDoConvite) {
        setAnunciosRemovidos(false);
        anunciosRemovidosRef.current = false;
        setPremiumPorEmail(false);
        premiumPorEmailRef.current = false;
        await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
        await AsyncStorage.removeItem(STORAGE_KEY_PREMIUM_EMAIL).catch(() => {});
      }
    } catch {
      // Falha ao ler a sessão (offline/token expirado): não revoga nem libera
      // às cegas — o próximo ciclo (foreground ou login/logout) reavalia.
    }
  }, [liberarPremium]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    // Primeira verificação agendada: a liberação só ocorre após a leitura
    // assíncrona do Google, então o setState nunca roda no corpo do efeito
    // (evita o aviso react-hooks/set-state-in-effect).
    const t = setTimeout(() => sincronizarPremiumConvite(), 0);
    const sub = AppState.addEventListener('change', estado => {
      // O Google Sign-In abre uma tela do sistema (app vai a background e
      // volta como "active"), então o login também é coberto por aqui.
      if (estado === 'active') sincronizarPremiumConvite();
    });
    return () => {
      clearTimeout(t);
      sub.remove();
    };
  }, [sincronizarPremiumConvite]);

  return (
    <MonetizacaoContext.Provider
      value={{
        anunciosRemovidos,
        premiumPorEmail,
        comprando,
        mostrarAnuncio,
        comprarRemoverAnuncios: comprar,
        sincronizarPremiumConvite,
      }}
    >
      {children}
    </MonetizacaoContext.Provider>
  );
}

export const useMonetizacao = () => useContext(MonetizacaoContext);
