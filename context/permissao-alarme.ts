import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Alert, Platform } from 'react-native';
import { idiomaAtual, tIdioma } from './idiomas';
import {
  alarmeNativoDisponivel,
  ehDispositivoXiaomi,
  podeExibirSobreposicao,
  podeUsarTelaCheia,
} from '../modules/minhasnotas-alarm';

// Aviso de tela cheia exibido uma única vez por sessão (tarefas + lembretes)
let avisoTelaCheiaRef = false;

/**
 * Na PRIMEIRA ação com alarme (tarefa ou lembrete de nota, Android/nativo),
 * abre a tela de permissões AUTOMATICAMENTE se algo estiver bloqueando o
 * popup — ou em qualquer Xiaomi, onde Autostart/tela de bloqueio não são
 * verificáveis e merecem guia. Depois disso, vira um lembrete leve (1x por
 * sessão).
 */
export const verificarTelaCheia = async () => {
  try {
    if (!alarmeNativoDisponivel()) return;
    const apiLevel = Number(Platform.Version) || 0;
    const xiaomi = await ehDispositivoXiaomi();

    // Junta tudo o que falta em um único aviso (Xiaomi pode precisar das duas)
    const faltando: string[] = [];
    if (apiLevel >= 34) {
      const ok = await podeUsarTelaCheia();
      if (!ok) faltando.push(tIdioma(idiomaAtual, '“Tela cheia” do Android 14+'));
    }
    // A permissão de sobreposição é o que permite o popup abrir com a TELA LIGADA
    const podePopup = await podeExibirSobreposicao();
    if (!podePopup) {
      faltando.push(
        xiaomi
          ? tIdioma(idiomaAtual, '“Exibir pop-ups em segundo plano” do MIUI')
          : tIdioma(idiomaAtual, '“Exibir sobre outros apps”')
      );
    }

    // Xiaomi sempre merece a guia (mesmo com as permissões verificáveis OK)
    const precisaGuiar = xiaomi || faltando.length > 0;
    const jaVisto = await AsyncStorage.getItem('@alarme_permissao_visto');

    if (jaVisto === null) {
      // PRIMEIRA VEZ: marca como visto e abre a tela de permissões (se necessário)
      await AsyncStorage.setItem('@alarme_permissao_visto', '1');
      avisoTelaCheiaRef = true; // evita o alerta duplicado se criar outra ação agora
      if (precisaGuiar) {
        // Pequeno atraso para a ação (criar tarefa/lembrete) terminar antes de navegar
        setTimeout(() => router.push('/permissoes'), 350);
      }
      return;
    }

    // Já viu a tela antes: lembrete leve, uma única vez por sessão
    if (faltando.length > 0 && !avisoTelaCheiaRef) {
      avisoTelaCheiaRef = true;
      Alert.alert(
        tIdioma(idiomaAtual, 'Popup do alarme bloqueado'),
        `${tIdioma(idiomaAtual, 'Para o alarme abrir em POPUP (por cima de outros apps, mesmo com o celular bloqueado), ative: {itens}.')}${faltando.join(' e ')}.${xiaomi ? tIdioma(idiomaAtual, ' No Xiaomi, ative também “Iniciar automaticamente” e “Sem restrições” na bateria.') : ''}`,
        [
          { text: tIdioma(idiomaAtual, 'Agora não'), style: 'cancel' },
          { text: tIdioma(idiomaAtual, 'Abrir permissões'), onPress: () => router.push('/permissoes') },
        ]
      );
    }
  } catch {
    // ignora
  }
};
