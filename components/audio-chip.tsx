import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../context/ThemeContext';

interface Props {
  uri: string;
  nome?: string;
}

const formatarTempo = (s: number) => {
  if (!isFinite(s) || s <= 0) return '0:00';
  const m = Math.floor(s / 60);
  const seg = Math.floor(s % 60);
  return `${m}:${seg.toString().padStart(2, '0')}`;
};

export default function AudioChip({ uri, nome }: Props) {
  const { isDark } = useTheme();
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  const nomeLimpo = (nome || 'Áudio').replace(/^audio_/, '').replace(/\.m4a$/, '').replace(/_/g, ' ');

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      style={[styles.chip, { backgroundColor: isDark ? '#2C2C2E' : '#F2F2F7' }]}
      onPress={() => (status.playing ? player.pause() : player.play())}
    >
      <Ionicons
        name={status.playing ? 'pause-circle' : 'play-circle'}
        size={30}
        color={isDark ? '#BB86FC' : '#6200EE'}
      />
      <Text style={[styles.nome, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>
        {status.playing && status.currentTime > 0 ? formatarTempo(status.currentTime) : nomeLimpo}
      </Text>
      <Text style={[styles.tempo, { color: isDark ? '#888' : '#999' }]}>
        {formatarTempo(status.duration)}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    gap: 8,
    flexShrink: 1,
  },
  nome: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  tempo: {
    fontSize: 12,
    fontWeight: '500',
  },
});
