import React, { createContext, useContext } from 'react';

/**
 * Stub web da monetização (anúncios / Play Billing / Google Sign-In são
 * nativos e não existem na web). Mantém a MESMA interface do contexto para
 * que as telas compilem e rodem sem anúncios nem compras no navegador.
 *
 * A implementação real fica em monetizacao.native.tsx (resolvida
 * automaticamente pelo Metro em Android/iOS).
 */
interface MonetizacaoContextData {
  anunciosRemovidos: boolean;
  premiumPorEmail: boolean;
  comprando: boolean;
  mostrarAnuncio: () => void;
  comprarRemoverAnuncios: () => Promise<void>;
}

const VALORES_PADRAO: MonetizacaoContextData = {
  anunciosRemovidos: false,
  premiumPorEmail: false,
  comprando: false,
  mostrarAnuncio: () => {},
  comprarRemoverAnuncios: async () => {},
};

const MonetizacaoContext = createContext<MonetizacaoContextData>(VALORES_PADRAO);

export function MonetizacaoProvider({ children }: { children: React.ReactNode }) {
  // Na web não há anúncios: o provider é apenas um pass-through com os
  // valores padrão (nunca mostra anúncio, nunca abre pagamento).
  return <MonetizacaoContext.Provider value={VALORES_PADRAO}>{children}</MonetizacaoContext.Provider>;
}

export const useMonetizacao = () => useContext(MonetizacaoContext);
