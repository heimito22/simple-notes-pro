import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { ehSomAlarme, SOM_PADRAO, type SomAlarme } from './sons-alarme';

// 1. Defina a interface para as configurações
interface Config {
  exigirBiometriaApp: boolean;
  protegerNotasIndividuais: boolean;
  tempoBloqueio: number;
  exibirAjudaFAB: boolean;
  tempoSoneca: number;
  somAlarme: SomAlarme;
  chaveIA: string;
}

const CONFIG_PADRAO: Config = {
  exigirBiometriaApp: false,
  protegerNotasIndividuais: false,
  tempoBloqueio: 0,
  exibirAjudaFAB: true,
  tempoSoneca: 10,
  somAlarme: SOM_PADRAO,
  chaveIA: '',
};

// 2. Defina o formato do Contexto
interface ThemeContextData {
  isDark: boolean;
  toggleTheme: () => void;
  config: Config;
  atualizarConfig: (chave: keyof Config, valor: any) => void;
  loading: boolean;
}

const ThemeContext = createContext<ThemeContextData>({} as ThemeContextData);

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(true);
  const [loading, setLoading] = useState(true);
  
  // 3. Estado inicial com valores padrão (evita o erro de 'undefined')
  const [config, setConfig] = useState<Config>(CONFIG_PADRAO);

  // Carregar dados ao iniciar o App
  useEffect(() => {
    async function carregarPreferencias() {
      try {
        const [temaSalvo, configSalva] = await Promise.all([
          AsyncStorage.getItem('@tema_escuro'),
          AsyncStorage.getItem('@config_seguranca')
        ]);

        if (temaSalvo !== null) setIsDark(JSON.parse(temaSalvo));
        // Mescla com os padrões para garantir que opções novas (ex: exibirAjudaFAB) sempre existam
        if (configSalva !== null) {
          const parseada = JSON.parse(configSalva);
          // Valida somAlarme (config antiga pode ter valor inválido/ausente)
          if (parseada.somAlarme !== undefined && !ehSomAlarme(parseada.somAlarme)) {
            delete parseada.somAlarme;
          }
          setConfig({ ...CONFIG_PADRAO, ...parseada });
        }
      } catch (e) {
        console.error("Erro ao carregar preferências", e);
      } finally {
        setLoading(false);
      }
    }
    carregarPreferencias();
  }, []);

  const toggleTheme = async () => {
    const novoValor = !isDark;
    setIsDark(novoValor);
    await AsyncStorage.setItem('@tema_escuro', JSON.stringify(novoValor));
  };

  // 4. Função para atualizar configurações específicas
  const atualizarConfig = async (chave: keyof Config, valor: any) => {
    const novasConfigs = { ...config, [chave]: valor };
    setConfig(novasConfigs);
    await AsyncStorage.setItem('@config_seguranca', JSON.stringify(novasConfigs));
  };

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme, config, atualizarConfig, loading }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);