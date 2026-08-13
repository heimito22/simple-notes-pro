import { Ionicons } from '@expo/vector-icons';
import { File } from 'expo-file-system';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import React, { useEffect, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { appColors } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';

export interface AudioAttachment {
  uri: string;
  nome: string;
}

interface Props {
  uri: string;
  nome?: string;
  compact?: boolean;
  onDelete?: () => void;
}

const formatarTempo = (segundos: number, vazio = '0:00') => {
  if (!Number.isFinite(segundos) || segundos <= 0) return vazio;
  const minutos = Math.floor(segundos / 60);
  const segundosRestantes = Math.floor(segundos % 60);
  return `${minutos}:${segundosRestantes.toString().padStart(2, '0')}`;
};

const nomeDoArquivo = (nome: string) => {
  const semCaminho = nome.split(/[\\/]/).pop() || nome;
  return semCaminho
    .replace(/^audio_/, '')
    .replace(/\.m4a$/i, '')
    .replace(/_/g, ' ') || 'Gravação de áudio';
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
    resultado = resultado.replace(
      new RegExp(`\\[Áudio anexado:\\s*${escaparRegExp(audio.nome)}\\s*\\]\\s*`, 'i'),
      ''
    );
  }

  // Remove apenas quebras redundantes criadas ao redor do anexo.
  return resultado.replace(/(<br\s*\/?>(\s*)){3,}/gi, '<br><br>');
};

/** Apaga o arquivo local sem interromper a remoção do anexo no texto. */
export const excluirArquivoAudio = async (uri: string) => {
  if (!uri.startsWith('file://')) return;
  try {
    new File(uri).delete();
  } catch {
    // O conteúdo da nota já pode ter sido removido; arquivo inexistente é seguro.
  }
};

export default function AudioPlayer({ uri, nome, compact = false, onDelete }: Props) {
  const { isDark } = useTheme();
  const paleta = appColors(isDark);
  const player = useAudioPlayer(uri, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    return () => {
      player.pause();
    };
  }, [player]);

  const nomeExibido = nomeDoArquivo(nome || uri);
  const duracao = status.duration || 0;
  const progresso = duracao > 0 ? Math.min(status.currentTime / duracao, 1) : 0;

  const alternarReproducao = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.didJustFinish || (duracao > 0 && status.currentTime >= duracao - 0.05)) {
      player.seekTo(0).catch(() => {});
    }
    player.play();
  };

  const buscarNaFaixa = (event: Parameters<NonNullable<React.ComponentProps<typeof Pressable>['onPress']>>[0]) => {
    if (!trackWidth || !duracao) return;
    const percentual = Math.max(0, Math.min(1, event.nativeEvent.locationX / trackWidth));
    player.seekTo(percentual * duracao).catch(() => {});
  };

  const aoMedirFaixa = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  };

  return (
    <View
      style={[
        styles.player,
        compact && styles.playerCompact,
        { backgroundColor: paleta.surfaceElevated, borderColor: paleta.border },
      ]}
    >
      <Pressable
        onPress={alternarReproducao}
        style={[styles.playButton, { backgroundColor: paleta.primary }]}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Pausar áudio' : 'Reproduzir áudio'}
      >
        <Ionicons name={status.playing ? 'pause' : 'play'} size={compact ? 17 : 20} color={paleta.onPrimary} style={!status.playing ? { marginLeft: 2 } : undefined} />
      </Pressable>

      <View style={styles.content}>
        <View style={styles.titleRow}>
          <View style={[styles.audioIcon, { backgroundColor: paleta.primarySoft }]}>
            <Ionicons name="mic" size={compact ? 14 : 16} color={paleta.primary} />
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
          style={[styles.track, { backgroundColor: paleta.border }]}
          accessibilityRole="adjustable"
          accessibilityLabel="Posição do áudio"
        >
          <View style={[styles.trackFill, { width: `${progresso * 100}%`, backgroundColor: paleta.primary }]} />
          <View style={[styles.trackThumb, { left: `${Math.max(progresso * 100, 1)}%`, backgroundColor: paleta.primary }]} />
        </Pressable>
      </View>

      {onDelete && (
        <Pressable
          onPress={onDelete}
          style={styles.deleteButton}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Apagar áudio"
        >
          <Ionicons name="trash-outline" size={compact ? 18 : 20} color={paleta.danger} />
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
    minHeight: 68,
    padding: 10,
    borderRadius: 16,
    marginVertical: 6,
  },
  playButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', minWidth: 0, gap: 7 },
  audioIcon: { width: 27, height: 27, borderRadius: 9, justifyContent: 'center', alignItems: 'center' },
  title: { flex: 1, fontSize: 13.5, fontWeight: '800' },
  titleCompact: { fontSize: 12.5 },
  duration: { fontSize: 11, fontWeight: '700' },
  track: { height: 6, borderRadius: 3, marginTop: 10, overflow: 'visible', position: 'relative' },
  trackFill: { height: '100%', borderRadius: 3 },
  trackThumb: { position: 'absolute', top: -3, width: 12, height: 12, borderRadius: 6, marginLeft: -6 },
  deleteButton: { width: 30, height: 36, justifyContent: 'center', alignItems: 'center' },
});
