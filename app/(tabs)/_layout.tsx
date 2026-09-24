import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { appColors } from '../../constants/theme';

/**
 * BARRA DE ABAS PERSONALIZADA — visual premium:
 * - Uma "chip" de acento translúcida DESLIZA com mola entre as abas, sempre
 *   centralizada por geometria exata (flex 1/3 + largura medida), nunca flutua;
 * - O ícone da aba ativa dá um POP de mola (cresce e assenta com bounce) e
 *   troca de contorno → preenchido;
 * - Abas inativas ficam discretas (ícone menor + cinza), a ativa em destaque.
 * Tudo com Animated nativo — o chip e os ícones rodam na thread nativa.
 */

type NomeIcone = React.ComponentProps<typeof Ionicons>['name'];

// Ícones: par contorno (inativo) → preenchido (ativo) de cada aba.
const DADOS_ABAS: { rota: string; rotulo: string; inativo: NomeIcone; ativo: NomeIcone }[] = [
  { rota: 'index', rotulo: 'Notas', inativo: 'document-text-outline', ativo: 'document-text' },
  { rota: 'tarefas', rotulo: 'Tarefas', inativo: 'list-outline', ativo: 'list' },
  { rota: 'settings', rotulo: 'Ajustes', inativo: 'settings-outline', ativo: 'settings' },
];

/**
 * Ícone de aba com POP de mola: ao ATIVAR, cresce de 0.82 → 1.16 com bounce
 * (overshoot da spring) e troca o glifo contorno → preenchido. Ao desativar,
 * encolhe suavemente de volta. Todas as abas repousam com o mesmo alinhamento
 * (escala é sobre o centro, sem deslocamento) — nada fica torto.
 */
const IconeAbaAnimado = ({
  focado,
  tamanho,
  corAtiva,
  corInativa,
  inativo,
  ativo,
}: {
  focado: boolean;
  tamanho: number;
  corAtiva: string;
  corInativa: string;
  inativo: NomeIcone;
  ativo: NomeIcone;
}) => {
  const pop = useRef(new Animated.Value(focado ? 1 : 0)).current;
  const focadoAntes = useRef(focado);

  useEffect(() => {
    if (focado === focadoAntes.current) return;
    if (focado) {
      pop.setValue(0);
      Animated.spring(pop, {
        toValue: 1,
        friction: 5,
        tension: 280,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(pop, { toValue: 0, duration: 170, useNativeDriver: true }).start();
    }
    focadoAntes.current = focado;
  }, [focado, pop]);

  const escala = pop.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1.16] });

  return (
    <Animated.View style={{ transform: [{ scale: escala }] }}>
      <Ionicons name={focado ? ativo : inativo} size={tamanho} color={focado ? corAtiva : corInativa} />
    </Animated.View>
  );
};

/**
 * Barra customizada: cada aba é flex:1 (terço exato da largura) com conteúdo
 * centralizado — o chip de acento nasce na mesma geometria, então o centro do
 * chip SEMPRE coincide com o centro do item. A chip desliza com spring ao trocar
 * de aba e a primeira renderização já pousa na posição certa (sem animação).
 */
const BarraAbasAnimada = ({ state, navigation, insets }: BottomTabBarProps) => {
  const { isDark, t } = useTheme();
  const paleta = appColors(isDark);
  const abaInset = insets?.bottom ?? 0;
  const [largura, setLargura] = useState(0);
  // Valor EM ÍNDICE DE ABA (0..2): a interpolação converte para pixels — assim a
  // rotação da tela reposiciona o chip sozinha (a largura só muda o outputRange).
  const deslize = useRef(new Animated.Value(state.index)).current;
  const idxAnterior = useRef(state.index);
  const n = state.routes.length;
  const conteudoAlt = 66; // altura útil acima do inset de navegação do sistema

  useEffect(() => {
    if (idxAnterior.current !== state.index) {
      Animated.spring(deslize, {
        toValue: state.index,
        friction: 12,
        tension: 110,
        useNativeDriver: true,
      }).start();
      idxAnterior.current = state.index;
    }
  }, [state.index, deslize]);

  const itemLarg = largura / n;
  const chipLarg = Math.max(itemLarg - 26, 0);
  // Entrada em índices (0..2) → saída em pixels: 0, centro do item 1, centro do item 2.
  const tx = deslize.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [0, itemLarg, itemLarg * 2],
  });

  return (
    <View
      testID="sn-tabbar"
      style={[
        styles.barra,
        {
          backgroundColor: paleta.tabBackground,
          borderTopColor: paleta.border,
          height: conteudoAlt + abaInset,
          paddingBottom: abaInset,
          shadowOpacity: isDark ? 0.35 : 0.1,
        },
      ]}
      onLayout={e => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - largura) > 0.5) setLargura(w);
      }}
    >
      {largura > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.chipAba,
            {
              width: chipLarg,
              top: (conteudoAlt - 52) / 2,
              height: 52,
              backgroundColor: paleta.primary,
              opacity: 0.18,
              transform: [{ translateX: tx }],
            },
          ]}
        />
      )}
      {state.routes.map((rota, i) => {
        const dados = DADOS_ABAS.find(d => d.rota === rota.name) || DADOS_ABAS[0];
        const focado = state.index === i;
        const cor = focado ? paleta.primaryStrong : paleta.muted;
        return (
          <Pressable
            key={rota.key}
            accessibilityRole="button"
            accessibilityState={focado ? { selected: true } : {}}
            accessibilityLabel={t(dados.rotulo)}
            style={({ pressed }) => [styles.itemAba, { opacity: pressed ? 0.65 : 1 }]}
            onPress={() => {
              const evento = navigation.emit({
                type: 'tabPress',
                target: rota.key,
                canPreventDefault: true,
              } as never) as { defaultPrevented?: boolean } | undefined;
              if (!focado && !evento?.defaultPrevented) {
                navigation.navigate(rota.name);
              }
            }}
          >
            <IconeAbaAnimado
              focado={focado}
              tamanho={24}
              corAtiva={paleta.primaryStrong}
              corInativa={paleta.muted}
              inativo={dados.inativo}
              ativo={dados.ativo}
            />
            <Text style={[styles.rotuloAba, { color: cor }]}>{t(dados.rotulo)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
};

export default function TabLayout() {
  const { t } = useTheme();
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={props => <BarraAbasAnimada {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: t('Notas') }} />
      <Tabs.Screen name="tarefas" options={{ title: t('Tarefas') }} />
      <Tabs.Screen name="settings" options={{ title: t('Ajustes') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  // Container da barra: fileira de abas com o chip absoluto por trás.
  barra: {
    flexDirection: 'row',
    position: 'relative',
    borderTopWidth: 1,
    elevation: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowRadius: 12,
  },
  // Chip de acento: pílula arredondada que desliza atrás da aba ativa.
  chipAba: {
    position: 'absolute',
    left: 13,
    borderRadius: 22,
  },
  // Cada aba ocupa exatamente 1/3 — conteúdo centralizado por flex.
  itemAba: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rotuloAba: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 3,
  },
});