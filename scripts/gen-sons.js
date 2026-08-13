/* Gera os sons de alarme do Simple Notes (16-bit PCM, mono, 22050 Hz).
 * Escreve tanto os assets do Expo (assets/sounds) quanto os recursos nativos
 * do módulo Android (modules/minhasnotas-alarm/android/src/main/res/raw). */
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 22050;
const OUT_ASSETS = path.join(__dirname, '..', 'assets', 'sounds');
const OUT_NATIVO = path.join(__dirname, '..', 'modules', 'minhasnotas-alarm', 'android', 'src', 'main', 'res', 'raw');

// Beep com envelope (attack 8ms / release 30ms) para não estalar
function beep(freq, inicio, duracao, forma = 'sine', amp = 1) {
  return (t) => {
    if (t < inicio || t > inicio + duracao) return 0;
    const fase = t - inicio;
    let env = 1;
    if (fase < 0.008) env = fase / 0.008;
    const fim = duracao - 0.03;
    if (fase > fim) env = Math.max(0, 1 - (fase - fim) / 0.03);
    const onda = forma === 'square'
      ? (Math.sin(2 * Math.PI * freq * fase) > 0 ? env * amp : -env * amp)
      : Math.sin(2 * Math.PI * freq * fase) * env * amp;
    return onda;
  };
}

// Sons: chave -> { arquivo (asset), gerar(t) }
const SONS = {
  // Clássico: dois bipes de despertador a cada 2s (loop contínuo)
  classico: {
    arquivo: 'alarme.wav',
    gerar: (t) => {
      const r = t % 2.0;
      return beep(660, 0, 0.28)(r) + beep(660, 0.5, 0.28)(r);
    },
  },
  // Digital: 6 bipes quadrados rápidos (telefone)
  digital: {
    arquivo: 'alarme-digital.wav',
    gerar: (t) => {
      const r = t % 2.0;
      let v = 0;
      for (let i = 0; i < 6; i++) v += beep(880, i * 0.2, 0.12, 'square', 0.8)(r);
      return v;
    },
  },
  // Suave: arpejo calmo (C5 -> E5) com fade
  suave: {
    arquivo: 'alarme-suave.wav',
    gerar: (t) => {
      const r = t % 4.0;
      return beep(523.25, 0, 0.7, 'sine', 0.6)(r) + beep(659.25, 0.9, 0.9, 'sine', 0.6)(r);
    },
  },
  // Urgente: 3 bipes agudos em rajada a cada 2s
  urgente: {
    arquivo: 'alarme-urgente.wav',
    gerar: (t) => {
      const r = t % 2.0;
      return beep(990, 0, 0.09, 'sine', 0.9)(r)
        + beep(990, 0.15, 0.09, 'sine', 0.9)(r)
        + beep(990, 0.3, 0.09, 'sine', 0.9)(r);
    },
  },
  // Eco: "cuco" (G5 -> E5) com eco suave
  eco: {
    arquivo: 'alarme-eco.wav',
    gerar: (t) => {
      const r = t % 4.0;
      return beep(784, 0, 0.35, 'sine', 0.7)(r)
        + beep(659.25, 0.5, 0.45, 'sine', 0.7)(r)
        + beep(784, 0.9, 0.35, 'sine', 0.25)(r)
        + beep(659.25, 1.4, 0.45, 'sine', 0.25)(r);
    },
  },
  // Sino: badaladas de sino de igreja (fundamental + parcial) a cada 3s
  sino: {
    arquivo: 'alarme-sino.wav',
    gerar: (t) => {
      const r = t % 3.0;
      return beep(880, 0, 0.7, 'sine', 0.65)(r)
        + beep(1174.66, 0, 0.5, 'sine', 0.22)(r)
        + beep(659.25, 1.1, 0.8, 'sine', 0.65)(r)
        + beep(880, 1.1, 0.55, 'sine', 0.22)(r);
    },
  },
  // Ondas: mar calmo — rumores graves com volume que "sobe e desce"
  ondas: {
    arquivo: 'alarme-ondas.wav',
    gerar: (t) => {
      const corpo = Math.sin(2 * Math.PI * 150 * t) * 0.4
        + Math.sin(2 * Math.PI * 300 * t) * 0.12;
      const onda = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.45 * t);
      return corpo * onda;
    },
  },
  // Pássaros: trinados agudos e curtos espalhados pela manhã
  passaro: {
    arquivo: 'alarme-passaro.wav',
    gerar: (t) => {
      const r = t % 3.2;
      return beep(2350, 0.1, 0.07, 'sine', 0.5)(r)
        + beep(2650, 0.18, 0.07, 'sine', 0.45)(r)
        + beep(2100, 0.7, 0.1, 'sine', 0.5)(r)
        + beep(2450, 0.82, 0.08, 'sine', 0.45)(r)
        + beep(2850, 0.92, 0.08, 'sine', 0.4)(r)
        + beep(2200, 1.5, 0.09, 'sine', 0.5)(r)
        + beep(2550, 1.62, 0.09, 'sine', 0.45)(r)
        + beep(2000, 2.4, 0.12, 'sine', 0.5)(r)
        + beep(2400, 2.55, 0.1, 'sine', 0.45)(r);
    },
  },
  // Galáxia: tom futurista com vibrato e pausas
  galaxia: {
    arquivo: 'alarme-galaxia.wav',
    gerar: (t) => {
      const r = t % 2.4;
      const v = Math.sin(2 * Math.PI * (330 + 45 * Math.sin(2 * Math.PI * 3 * r)) * r) * 0.5
        + Math.sin(2 * Math.PI * (495 + 60 * Math.sin(2 * Math.PI * 2.2 * r)) * r) * 0.2;
      if (r > 1.5 && r < 1.9) return v * ((r - 1.5) / 0.4);
      if (r >= 1.9) return 0;
      return v;
    },
  },
};

function gerarWav(nome, gerarAmplitude) {
  const DURACAO = 4;
  const n = SAMPLE_RATE * DURACAO;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let v = gerarAmplitude(t);
    v = Math.max(-1, Math.min(1, v));
    data.writeInt16LE(Math.round(v * 32767 * 0.85), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

if (!fs.existsSync(OUT_ASSETS)) fs.mkdirSync(OUT_ASSETS, { recursive: true });
if (!fs.existsSync(OUT_NATIVO)) fs.mkdirSync(OUT_NATIVO, { recursive: true });

for (const [chave, som] of Object.entries(SONS)) {
  const wav = gerarWav(som.arquivo, som.gerar);
  // Asset do Expo (player expo-audio — iOS / Expo Go)
  fs.writeFileSync(path.join(OUT_ASSETS, som.arquivo), wav);
  // Recurso nativo do Android (tocado na hora do disparo, app fechado)
  const nomeNativo = `som_${chave}.wav`;
  fs.writeFileSync(path.join(OUT_NATIVO, nomeNativo), wav);
  console.log(`Gerado: ${som.arquivo} + ${nomeNativo} (${(wav.length / 1024).toFixed(0)} KB)`);
}
console.log('Concluído!');
