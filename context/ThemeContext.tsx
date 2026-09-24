import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { definirSomAlarme } from '../modules/minhasnotas-alarm';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { ehSomAlarme, SOM_PADRAO, type SomAlarme } from './sons-alarme';
import { definirIdiomaAtual, ehIdioma, tIdioma, type Idioma } from './idiomas';

// 1. Defina a interface para as configurações
interface Config {
  exigirBiometriaApp: boolean;
  protegerNotasIndividuais: boolean;
  tempoBloqueio: number;
  exibirAjudaFAB: boolean;
  tempoSoneca: number;
  somAlarme: SomAlarme;
  chaveIA: string;
  idioma: Idioma;
  /** DESKTOP: PIN de 4 dígitos do próprio app (armazenado ofuscado). Vazio = sem PIN. */
  pinDesbloqueio: string;
}

const CONFIG_PADRAO: Config = {
  exigirBiometriaApp: false,
  protegerNotasIndividuais: false,
  tempoBloqueio: 0,
  exibirAjudaFAB: true,
  tempoSoneca: 10,
  somAlarme: SOM_PADRAO,
  chaveIA: '',
  idioma: 'pt',
  pinDesbloqueio: '',
};

// 2. Defina o formato do Contexto
interface ThemeContextData {
  isDark: boolean;
  toggleTheme: () => void;
  config: Config;
  atualizarConfig: (chave: keyof Config, valor: any) => void;
  /** Aplica preferencias vindas do backup na nuvem (tema + config) — usado para sincronizar PC<->celular. */
  aplicarPreferenciasRemotas: (prefs: { isDark?: boolean; config?: Partial<Config> }) => Promise<void>;
  /** Traduz uma chave para o idioma ativo do app. */
  t: (chave: string, vars?: Record<string, string | number>) => string;
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
          // Valida idioma (config antiga pode não ter o campo)
          if (parseada.idioma !== undefined && !ehIdioma(parseada.idioma)) {
            delete parseada.idioma;
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
    // Sincroniza o som do alarme com o módulo nativo (usado no Android
  // fechado: SharedPreferences do AlarmSound.somAtual).
  useEffect(() => {
    if (Platform.OS === 'android' && config.somAlarme) {
      definirSomAlarme(config.somAlarme);
    }
  }, [config.somAlarme]);

  const atualizarConfig = async (chave: keyof Config, valor: any) => {
    const novasConfigs = { ...config, [chave]: valor };
    setConfig(novasConfigs);
    await AsyncStorage.setItem('@config_seguranca', JSON.stringify(novasConfigs));
  };

  /** Normaliza uma config parcial vinda da nuvem: valida som/idioma, remove pin e mescla com padrões. */
  function sanitizarConfigRemota(parcial: any, base: Config): Config {
    const sanitizada: any = { ...(parcial || {}) };
    if (sanitizada.somAlarme !== undefined && !ehSomAlarme(sanitizada.somAlarme)) delete sanitizada.somAlarme;
    if (sanitizada.idioma !== undefined && !ehIdioma(sanitizada.idioma)) delete sanitizada.idioma;
    delete sanitizada.pinDesbloqueio; // nunca sincroniza
    const mesclada = { ...CONFIG_PADRAO, ...base, ...sanitizada } as Config;
    (mesclada as any).pinDesbloqueio = base.pinDesbloqueio; // preserva pin local
    // normaliza tipos restantes (temaEscuro não faz parte de Config aqui, fica em isDark)
    (mesclada as any).tempoBloqueio = Number((mesclada as any).tempoBloqueio) || 0;
    (mesclada as any).tempoSoneca = Number((mesclada as any).tempoSoneca) || 10;
    return mesclada;
  }

  const aplicarPreferenciasRemotas = async (prefs: { isDark?: boolean; config?: Partial<Config> }) => {
    if (!prefs || typeof prefs !== 'object') return;
    let novoIsDark = isDark;
    let novoConfig = config;
    let mudouTema = false;
    let mudouConfig = false;
    if (typeof prefs.isDark === 'boolean' && prefs.isDark !== isDark) {
      novoIsDark = prefs.isDark;
      mudouTema = true;
    }
    // empty config após sanitização não deve disparar mudança
    if (prefs.config && typeof prefs.config === 'object') {
      const tmp: any = { ...(prefs.config as any) };
      if (tmp.somAlarme !== undefined && !ehSomAlarme(tmp.somAlarme)) delete tmp.somAlarme;
      if (tmp.idioma !== undefined && !ehIdioma(tmp.idioma)) delete tmp.idioma;
      delete tmp.pinDesbloqueio;
      if (Object.keys(tmp).length) {
        const mesclada = sanitizarConfigRemota(prefs.config, config);
        novoConfig = mesclada;
        mudouConfig = JSON.stringify(novoConfig) !== JSON.stringify(config);
      }
    }
    if (mudouTema) {
      setIsDark(novoIsDark);
      await AsyncStorage.setItem('@tema_escuro', JSON.stringify(novoIsDark));
    }
    if (mudouConfig) {
      setConfig(novoConfig);
      await AsyncStorage.setItem('@config_seguranca', JSON.stringify(novoConfig));
    }
  };

  // Mantém o espelho do idioma ativo (módulos puros usam para notificações)
  useEffect(() => {
    definirIdiomaAtual(config.idioma);
  }, [config.idioma]);

  const t = (chave: string, vars?: Record<string, string | number>) =>
    tIdioma(config.idioma, chave, vars);

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme, config, atualizarConfig, aplicarPreferenciasRemotas, t, loading }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);