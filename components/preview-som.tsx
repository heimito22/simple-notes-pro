import { useAudioPlayer } from 'expo-audio';
import { useEffect } from 'react';
import { assetDoSom } from '../context/sons-alarme';

/**
 * Prévia de som para o seletor (iOS / Expo Go — onde não há o módulo nativo).
 * Toca o som uma única vez quando a fonte (chave) muda.
 */
export default function PreviewSom({ chave }: { chave: string }) {
  const player = useAudioPlayer(assetDoSom(chave));

  useEffect(() => {
    player.seekTo(0).catch(() => {});
    player.play();
    const t = setTimeout(() => player.pause(), 2600);
    return () => {
      clearTimeout(t);
      player.pause();
    };
  }, [player]);

  return null;
}
