/**
 * Catálogo central dos sons de alarme do Simple Notes.
 *
 * Cada som tem:
 * - `chave`: usada na config (somAlarme) e no módulo nativo (res/raw/som_<chave>);
 * - `asset`: o arquivo WAV para o player do expo-audio (fallback iOS / Expo Go).
 */
export type SomAlarme =
  | 'classico'
  | 'digital'
  | 'suave'
  | 'urgente'
  | 'eco'
  | 'ondas';

export const SOM_PADRAO: SomAlarme = 'classico';

export interface SomAlarmeInfo {
  chave: SomAlarme;
  nome: string;
  descricao: string;
  icone:
    | 'alarm'
    | 'phone-portrait'
    | 'flower'
    | 'warning'
    | 'musical-notes'
    | 'water';
  asset: number;
}

export const SONS_ALARME: SomAlarmeInfo[] = [
  {
    chave: 'classico',
    nome: 'Clássico',
    descricao: 'Bipes de despertador tradicionais',
    icone: 'alarm',
    asset: require('../assets/sounds/alarme.wav'),
  },
  {
    chave: 'digital',
    nome: 'Digital',
    descricao: 'Toque de telefone digital',
    icone: 'phone-portrait',
    asset: require('../assets/sounds/alarme-digital.wav'),
  },
  {
    chave: 'suave',
    nome: 'Suave',
    descricao: 'Arpejo calmo para acordar devagar',
    icone: 'flower',
    asset: require('../assets/sounds/alarme-suave.wav'),
  },
  {
    chave: 'urgente',
    nome: 'Urgente',
    descricao: 'Bipes rápidos e fortes',
    icone: 'warning',
    asset: require('../assets/sounds/alarme-urgente.wav'),
  },
  {
    chave: 'eco',
    nome: 'Eco',
    descricao: 'Melodia de cuco com eco',
    icone: 'musical-notes',
    asset: require('../assets/sounds/alarme-eco.wav'),
  },
  {
    chave: 'ondas',
    nome: 'Ondas',
    descricao: 'Mar calmo batendo na areia',
    icone: 'water',
    asset: require('../assets/sounds/alarme-ondas.wav'),
  },
];

export const ehSomAlarme = (v: unknown): v is SomAlarme =>
  typeof v === 'string' && SONS_ALARME.some(s => s.chave === v);

export const infoDoSom = (chave: string): SomAlarmeInfo =>
  SONS_ALARME.find(s => s.chave === chave) ?? SONS_ALARME[0];

export const assetDoSom = (chave: string): number => infoDoSom(chave).asset;
