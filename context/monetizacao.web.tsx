import React, { createContext, useContext } from 'react';

/** Mesmo tipo do contexto real (monetizacao.tsx). */
type ResultadoCompra = 'aberta' | 'precisaLogin' | 'outraConta' | 'indisponivel';

/**
 * Stub web da monetização (anúncios / Play Billing / Google Sign-In são
 * nativos e não existem na web). Mantém a MESMA interface do contexto para
 * que as telas compilem e rodem sem anúncios nem compras no navegador.
 *
 * A implementação real fica em monetizacao.tsx (resolvida automaticamente
 * pelo Metro em Android/iOS; este stub vale para a plataforma web).
 */
interface MonetizacaoContextData {
  anunciosRemovidos: boolean;
  premiumPorEmail: boolean;
  comprando: boolean;
  emailLogado: string | null;
  emailDonoCompra: string | null;
  aguardandoLoginParaCompra: boolean;
  mostrarAnuncio: () => void;
  comprarRemoverAnuncios: () => Promise<ResultadoCompra>;
  sincronizarPremium: (usuario?: { user?: { email?: string | null } } | null) => Promise<void>;
  solicitarLoginParaCompra: () => void;
  cancelarCompraPendente: () => void;
  tentarCompraPendente: () => Promise<ResultadoCompra>;
}

const VALORES_PADRAO: MonetizacaoContextData = {
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
};

const MonetizacaoContext = createContext<MonetizacaoContextData>(VALORES_PADRAO);

export function MonetizacaoProvider({ children }: { children: React.ReactNode }) {
  // Na web não há anúncios: o provider é apenas um pass-through com os
  // valores padrão (nunca mostra anúncio, nunca abre pagamento).
  return <MonetizacaoContext.Provider value={VALORES_PADRAO}>{children}</MonetizacaoContext.Provider>;
}

export const useMonetizacao = () => useContext(MonetizacaoContext);
