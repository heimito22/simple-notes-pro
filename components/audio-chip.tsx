import { Ionicons } from '@expo/vector-icons';
import { File } from 'expo-file-system';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { appColors } from '../constants/theme';
import { idiomaAtual, tIdioma } from '../context/idiomas';
import { useTheme } from '../context/ThemeContext';

export interface AudioAttachment {
  uri: string;
  nome: string;
}

interface Props {
  uri: string;
  nome?: string;
  compact?: boolean;
  /** Aparência textual para anexos dentro da nota. */
  textual?: boolean;
  /** A exclusão é confirmada pelo próprio player e executada após liberar o player nativo. */
  onDelete?: () => void | Promise<void>;
}

const formatarTempo = (segundos: number, vazio = '0:00') => {
  if (!Number.isFinite(segundos) || segundos <= 0) return vazio;
  const minutos = Math.floor(segundos / 60);
  const segundosRestantes = Math.floor(segundos % 60);
  return `${minutos}:${segundosRestantes.toString().padStart(2, '0')}`;
};

const nomeDoArquivo = (nome: string, fallback?: string) => {
  const semCaminho = nome.split(/[\\/]/).pop() || nome;
  return (
    semCaminho
      .replace(/^audio_/, '')
      .replace(/\.m4a$/i, '')
      .replace(/_/g, ' ') ||
    fallback ||
    tIdioma(idiomaAtual, 'Gravação de áudio')
  );
};

const escaparRegExp = (valor: string) => valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Extrai todos os áudios do HTML da nota, incluindo o formato legado por marcador. */
export const extrairAudios = (html: string, audiosDirUri?: string): AudioAttachment[] => {
  const encontrados: AudioAttachment[] = [];
  const tags = /<audio\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/audio>/gi;
  let match: RegExpExecArray | null;

  while ((match = tags.exec(html || '')) !== null) {
    const uri = match[1];
    if (!encontrados.some(audio => audio.uri === uri)) {
      encontrados.push({ uri, nome: nomeDoArquivo(uri) });
    }
  }

  const marcadores = /\[Áudio anexado:\s*([^\]]+?)\s*\]/gi;
  while ((match = marcadores.exec(html || '')) !== null) {
    const nome = match[1].trim();
    const uri = nome.startsWith('file://') || nome.includes('://')
      ? nome
      : audiosDirUri
        ? `${audiosDirUri}/${nome}`
        : nome;
    if (!encontrados.some(audio => audio.uri === uri || audio.nome === nomeDoArquivo(nome))) {
      encontrados.push({ uri, nome: nomeDoArquivo(nome) });
    }
  }

  return encontrados;
};

/** Remove apenas o anexo de áudio indicado, preservando o restante da nota. */
export const removerAudioDoHtml = (html: string, audio: AudioAttachment) => {
  let resultado = html || '';
  resultado = resultado.replace(
    /<audio\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/audio>\s*/gi,
    (tagCompleta, uri: string) => uri === audio.uri ? '' : tagCompleta
  );

  if (audio.nome) {
    const nomeSeguro = escaparRegExp(audio.nome);
    resultado = resultado.replace(
      new RegExp(`\\[Áudio anexado:\\s*${nomeSeguro}\\s*\\]\\s*`, 'i'),
      ''
    );
    // Remove a representação textual criada junto com o áudio, sem atingir
    // outras linhas de texto da nota.
    resultado = resultado.replace(
      new RegExp(`<span\\b[^>]*data-audio-name=["']${nomeSeguro}["'][^>]*>[\\s\\S]*?<\\/span>\\s*`, 'i'),
      ''
    );
  }

  if (audio.uri) {
    resultado = resultado.replace(
      new RegExp(`<span\\b[^>]*data-audio-uri=["']${escaparRegExp(audio.uri)}["'][^>]*>[\\s\\S]*?<\\/span>\\s*`, 'i'),
      ''
    );
  }

  // Remove apenas quebras redundantes criadas ao redor do anexo.
  return resultado.replace(/(<br\s*\/?>(\s*)){3,}/gi, '<br><br>');
};

/** Apaga o arquivo local sem interromper a remoção do anexo no texto. */
export const excluirArquivoAudio = async (uri: string) => {
  if (!uri || !uri.startsWith('file://')) return;
  try {
    const arquivo = new File(uri);
    if (arquivo.exists) arquivo.delete();
  } catch {
    // O conteúdo da nota já pode ter sido removido; arquivo inexistente é seguro.
  }
};

export default function AudioPlayer({ uri, nome, compact = false, textual = false, onDelete }: Props) {
  const { isDark, t } = useTheme();
  const paleta = appColors(isDark);
  const player = useAudioPlayer(uri, { updateInterval: compact || textual ? 500 : 250 });
  const status = useAudioPlayerStatus(player);
  const [trackWidth, setTrackWidth] = useState(0);
  const [removendo, setRemovendo] = useState(false);
  const playerLiberadoRef = useRef(false);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    return () => {
      // O hook libera o recurso nativo ao desmontar. Apenas pause aqui para não
      // tentar operar em um player que já foi removido durante a exclusão.
      if (!playerLiberadoRef.current) {
        try { player.pause(); } catch { /* player já pode ter sido liberado pelo nativo */ }
      }
    };
  }, [player]);

  const liberarPlayer = () => {
    if (playerLiberadoRef.current) return;
    playerLiberadoRef.current = true;
    try { player.pause(); } catch { /* ignora interrupções do player */ }
    try { player.remove(); } catch { /* o hook pode já ter iniciado a liberação */ }
  };

  const nomeExibido = nomeDoArquivo(nome || uri, t('Gravação de áudio'));
  const duracao = status.duration || 0;
  const progresso = duracao > 0 ? Math.min(status.currentTime / duracao, 1) : 0;

  const alternarReproducao = () => {
    if (removendo || status.error) return;
    try {
      if (status.playing) {
        player.pause();
        return;
      }
      if (status.didJustFinish || (duracao > 0 && status.currentTime >= duracao - 0.05)) {
        player.seekTo(0).catch(() => {});
      }
      player.play();
    } catch {
      // Uma URI antiga/inválida não pode derrubar a tela; o player apenas não inicia.
    }
  };

  const buscarNaFaixa = (event: Parameters<NonNullable<React.ComponentProps<typeof Pressable>['onPress']>>[0]) => {
    if (removendo || status.error || !trackWidth || !duracao) return;
    const percentual = Math.max(0, Math.min(1, event.nativeEvent.locationX / trackWidth));
    try {
      player.seekTo(percentual * duracao).catch(() => {});
    } catch {
      // O arquivo pode ter sido removido externamente; ignora a busca inválida.
    }
  };

  const aoMedirFaixa = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  };

  const solicitarExclusao = () => {
    if (!onDelete || removendo) return;
    Alert.alert(
      t('Apagar áudio'),
      t('Deseja remover este áudio da nota?'),
      [
        { text: t('Cancelar'), style: 'cancel' },
        {
          text: t('Apagar'),
          style: 'destructive',
          onPress: async () => {
            setRemovendo(true);
            // Primeiro para e remove o player nativo; só depois o callback
            // altera o HTML e apaga o arquivo físico.
            liberarPlayer();
            try {
              await onDelete();
            } catch {
              // A nota continua íntegra mesmo se o arquivo já não existir.
            }
          },
        },
      ]
    );
  };

  return (
    <View
      style={[
        styles.player,
        compact && styles.playerCompact,
        textual && styles.playerTextual,
        { backgroundColor: textual ? 'transparent' : paleta.surfaceElevated, borderColor: textual ? paleta.border : paleta.border },
      ]}
      onStartShouldSetResponder={compact ? () => true : undefined}
    >
      <Pressable
        onPress={alternarReproducao}
        style={[styles.playButton, compact && styles.playButtonCompact, textual && styles.playButtonTextual, { backgroundColor: paleta.primary }]}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? t('Pausar áudio') : t('Reproduzir áudio')}
      >
        <Ionicons name={status.playing ? 'pause' : 'play'} size={compact ? 17 : 20} color={paleta.onPrimary} style={!status.playing ? { marginLeft: 2 } : undefined} />
      </Pressable>

      <View style={styles.content}>
        <View style={styles.titleRow}>
          <View style={[styles.audioIcon, textual && styles.audioIconTextual, { backgroundColor: paleta.primarySoft }]}>
            <Ionicons name="mic" size={compact || textual ? 14 : 16} color={paleta.primary} />
          </View>
          <Text style={[styles.title, compact && styles.titleCompact, { color: paleta.text }]} numberOfLines={1}>
            {nomeExibido}
          </Text>
          <Text style={[styles.duration, { color: paleta.muted }]}>
            {formatarTempo(status.currentTime)} / {formatarTempo(duracao, '--:--')}
          </Text>
        </View>

        <Pressable
          onLayout={aoMedirFaixa}
          onPress={buscarNaFaixa}
          style={[styles.track, textual && styles.trackTextual, { backgroundColor: paleta.border }]}
          accessibilityRole="adjustable"
          accessibilityLabel="Posição do áudio"
        >
          <View style={[styles.trackFill, { width: `${progresso * 100}%`, backgroundColor: paleta.primary }]} />
          <View style={[styles.trackThumb, { left: `${Math.max(progresso * 100, 1)}%`, backgroundColor: paleta.primary }]} />
        </Pressable>
      </View>

      {onDelete && !compact && (
        <Pressable
          onPress={solicitarExclusao}
          style={[styles.deleteButton, removendo && styles.deleteButtonDisabled]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Apagar áudio"
          disabled={removendo}
        >
          <Ionicons name="trash-outline" size={20} color={removendo ? paleta.muted : paleta.danger} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  player: {
    width: '100%',
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
    marginVertical: 8,
    gap: 10,
  },
  playerCompact: {
    minHeight: 50,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 14,
    marginVertical: 5,
    gap: 8,
  },
  playerTextual: {
    minHeight: 44,
    paddingVertical: 5,
    paddingHorizontal: 2,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderRadius: 0,
    marginVertical: 3,
    gap: 8,
  },
  playButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButtonCompact: { width: 34, height: 34, borderRadius: 17 },
  playButtonTextual: { width: 30, height: 30, borderRadius: 15 },
  content: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', minWidth: 0, gap: 7 },
  audioIcon: { width: 27, height: 27, borderRadius: 9, justifyContent: 'center', alignItems: 'center' },
  audioIconTextual: { width: 23, height: 23, borderRadius: 7 },
  title: { flex: 1, fontSize: 13.5, fontWeight: '800' },
  titleCompact: { fontSize: 12.5 },
  duration: { fontSize: 11, fontWeight: '700' },
  track: { height: 6, borderRadius: 3, marginTop: 10, overflow: 'visible', position: 'relative' },
  trackTextual: { height: 4, borderRadius: 2, marginTop: 6 },
  trackFill: { height: '100%', borderRadius: 3 },
  trackThumb: { position: 'absolute', top: -3, width: 12, height: 12, borderRadius: 6, marginLeft: -6 },
  deleteButton: { width: 30, height: 36, justifyContent: 'center', alignItems: 'center' },
  deleteButtonDisabled: { opacity: 0.55 },
});
