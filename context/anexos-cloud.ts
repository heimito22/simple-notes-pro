/**
 * Sincronização de ANEXOS (imagens e áudios das notas) com o Drive.
 *
 * O backup `backup_notas.json` salva só o HTML das notas — os anexos moram em
 * arquivos locais (`imagens_notas/` e `audios_notas/`). Este módulo sobe cada
 * anexo para o appDataFolder da conta logada (`anexo_<nome>`) e, ao restaurar
 * um backup em outro aparelho, baixa de volta os arquivos que faltam. Assim,
 * apagar os dados do aparelho não perde imagem/áudio: voltam com o backup.
 *
 * Design:
 * - UM arquivo no Drive por anexo, nome `anexo_<nomeDoArquivo>`. O nome local
 *   já é único por construção (timestamp no editor: img_<ts>.jpg, audio_<ts>.m4a).
 * - Idempotente: sobe só o que ainda não existe no Drive; baixa só o que não
 *   existe localmente. Repetir nunca duplica.
 * - Best-effort e silencioso: falha de rede/quotas não quebra o fluxo do app —
 *   o próximo ciclo (backup/restauração) tenta de novo.
 * - Lista de arquivos do appDataFolder é lida UMA vez por ciclo e mantida em
 *   cache local para não listar a cada anexo.
 */

import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

export const DIR_IMAGENS = Platform.OS === 'web' ? null : new Directory(Paths.document, 'imagens_notas');
export const DIR_AUDIOS = Platform.OS === 'web' ? null : new Directory(Paths.document, 'audios_notas');

const PREFIXO = 'anexo_';
const T = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Tipos MIME conhecidos (o upload binário precisa do Content-Type certo).
const mimePorExtensao = (nome: string): string => {
  const ext = nome.split('.').pop()?.toLowerCase() || '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'm4a') return 'audio/mp4';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'aac') return 'audio/aac';
  if (ext === 'ogg') return 'audio/ogg';
  return 'application/octet-stream';
};

/** Todos os anexos referenciados pelo HTML das notas (img src e audio src locais). */
const extrairAnexosLocais = (htmls: string[]): { nome: string; caminho: string }[] => {
  const nomes = new Set<string>();
  const padrao = /(?:src|data-audio-uri)=["']([^"']*)["']/gi;
  for (const html of htmls) {
    if (!html) continue;
    let m: RegExpExecArray | null;
    while ((m = padrao.exec(html)) !== null) {
      const uri = m[1];
      if (!uri || !uri.startsWith('file://')) continue;
      // Só anexos do app (não data: URIs nem arquivos de fora do app)
      const nome = uri.split('/').pop() || '';
      if (nome.startsWith('img_') || nome.startsWith('audio_')) nomes.add(nome);
    }
  }
  const lista: { nome: string; caminho: string }[] = [];
  for (const nome of nomes) {
    const dir = nome.startsWith('img_') ? DIR_IMAGENS : DIR_AUDIOS;
    if (!dir) continue;
    lista.push({ nome, caminho: new File(dir, nome).uri });
  }
  return lista;
};

const buscarToken = async (): Promise<string | null> => {
  try {
    await GoogleSignin.signInSilently().catch(() => {});
    const tokens = await GoogleSignin.getTokens();
    return tokens.accessToken || null;
  } catch {
    return null;
  }
};

/** Anexos já no Drive da conta (cache do ciclo): id, tamanho e se o conteúdo
 *  é base64-em-texto (fallback para fetch do RN que rejeita corpo binário).
 *  O tamanho importa: um anexo_ com size 0 é lixo de um upload que falhou na
 *  metade — precisa reenviar. */
const listarAnexosDrive = async (token: string): Promise<Map<string, { id: string; size: number; b64: boolean }>> => {
  const mapa = new Map<string, { id: string; size: number; b64: boolean }>();
  try {
    const busca = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name contains '${PREFIXO}' and parents in 'appDataFolder'&spaces=appDataFolder&fields=files(id,name,size,appProperties)&pageSize=200`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const dados = await busca.json();
    for (const f of dados?.files || []) {
      if (f?.name?.startsWith(PREFIXO)) {
        mapa.set(f.name, {
          id: f.id,
          size: Number(f.size || 0),
          b64: !!(f.appProperties && f.appProperties.snB64),
        });
      }
    }
  } catch {
    // offline: mapa vazio — upload tenta de novo no próximo ciclo
  }
  return mapa;
};

/** Uint8Array → base64 sem depender de btoa/Buffer (Hermes pode não ter nenhum). */
const bytesParaBase64 = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i], b2 = bytes[i + 1], b3 = bytes[i + 2];
    out += T[b1 >> 2];
    out += T[((b1 & 3) << 4) | ((b2 ?? 0) >> 4)];
    out += b2 === undefined ? '=' : T[((b2 & 15) << 2) | ((b3 ?? 0) >> 6)];
    out += b3 === undefined ? '=' : T[b3 & 63];
  }
  return out;
};

/** base64 → Uint8Array (decodifica anexo baixado como texto). */
const base64ParaBytes = (b64: string): Uint8Array => {
  const limpo = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const len = Math.floor((limpo.length * 3) / 4);
  const out = new Uint8Array(len);
  let p = 0, acc = 0, bits = 0;
  for (const ch of limpo) {
    const v = ch === '=' ? -1 : T.indexOf(ch);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, p);
};

/**
 * Um upload por vez: o backup, o ciclo automático e a restauração chamavam
 * isto em paralelo, cada um listava o Drive e nenhum via o anexo do outro — o
 * mesmo arquivo subia 2-3x (a conta chegou a ter 28 anexos para 10 reais), o
 * que também deixava a sincronização lenta.
 */
let uploadEmAndamento: Promise<number> | null = null;

export const sincronizarAnexosUpload = async (htmls: string[]): Promise<number> => {
  if (uploadEmAndamento) return uploadEmAndamento;
  uploadEmAndamento = subirAnexos(htmls).finally(() => { uploadEmAndamento = null; });
  return uploadEmAndamento;
};

const subirAnexos = async (htmls: string[]): Promise<number> => {
  if (Platform.OS === 'web') return 0;
  try {
    const user = await GoogleSignin.getCurrentUser();
    if (!user) return 0;
    const token = await buscarToken();
    if (!token) return 0;

    const anexos = extrairAnexosLocais(htmls);
    if (anexos.length === 0) return 0;

    const existentes = await listarAnexosDrive(token);
    let enviados = 0;

    for (const anexo of anexos) {
      const nomeDrive = PREFIXO + anexo.nome;
      // Já existe COM conteúdo? pula. Não existe, ou existe vazio (size 0 =
      // lixo de falha antiga)? (re)envia por cima.
      const existente = existentes.get(nomeDrive);
      if (existente && existente.size > 0) continue;

      const arquivo = new File(anexo.caminho);
      if (!arquivo.exists) continue; // anexo citado no HTML mas apagado localmente

      try {
        // Sem criar-então-patch: um único multipart com o conteúdo já dentro.
        // O caminho antigo (POST de metadados + PATCH binário) deixava anexo
        // vazio no Drive quando o PATCH falhava, e como o próximo ciclo via o
        // nome existente nunca reenviava — pílula venenosa para a hidratação.
        // O binário vai em base64-no-texto (appProperties.snB64) porque o fetch
        // do RN rejeita corpo binário em várias versões — o PC e este módulo
        // sabem decodificar. Deleta o lixo antigo vazio, se houver.
        if (existente) {
          try {
            await fetch(`https://www.googleapis.com/drive/v3/files/${existente.id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            });
          } catch { /* segue — se não apagar, o upload cria duplicado e ok */ }
        }

        const bytes = await arquivo.bytes();
        const b64 = bytesParaBase64(bytes);
        const limite = `--anexo_b`;
        // SEM Content-Transfer-Encoding: base64 — o parser multipart do Drive
        // DECODIFICA CTE base64 e armazena o binário cru, aí a marca snB64
        // mentia e o PC removia caracteres do binário (imagem/áudio corrompidos).
        // Como texto puro, o base64 é armazenado literal e decodificável.
        const corpo =
          `${limite}\nContent-Type: application/json\n\n` +
          `${JSON.stringify({ name: nomeDrive, parents: ['appDataFolder'], appProperties: { snB64: '1' } })}\n` +
          `${limite}\nContent-Type: text/plain\n\n` +
          `${b64}\n` +
          `${limite}--\n`;

        const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=anexo_b`,
          },
          body: corpo,
        });
        if (up.ok) {
          enviados++;
        } else {
          console.log('[Anexos] upload multipart falhou para', anexo.nome, 'HTTP', up.status);
        }
      } catch (e) {
        console.log('[Anexos] falha no upload de', anexo.nome, (e as any)?.message || e);
        // anexo individual falhou — segue para os demais (e o próximo ciclo tenta)
      }
    }
    return enviados;
  } catch {
    return 0;
  }
};

/**
 * Baixa do Drive os anexos citados pelas notas que faltam localmente.
 * Chamado ao restaurar um backup. Retorna a quantidade de anexos restaurados.
 */
export const restaurarAnexosDownload = async (htmls: string[]): Promise<number> => {
  if (Platform.OS === 'web') return 0;
  try {
    const user = await GoogleSignin.getCurrentUser();
    if (!user) return 0;

    // Garante as pastas locais
    for (const dir of [DIR_IMAGENS, DIR_AUDIOS]) {
      if (dir && !dir.exists) {
        try { await dir.create({ intermediates: true, idempotent: true }); } catch { /* ignora */ }
      }
    }

    const anexos = extrairAnexosLocais(htmls);
    if (anexos.length === 0) return 0;

    const faltantes = anexos.filter(a => !new File(a.caminho).exists);
    if (faltantes.length === 0) return 0;

    const token = await buscarToken();
    if (!token) return 0;
    const existentes = await listarAnexosDrive(token);
    let restaurados = 0;

    for (const anexo of faltantes) {
      const info = existentes.get(PREFIXO + anexo.nome);
      if (!info || info.size === 0) continue; // nunca subiu, ou vazio de falha antiga
      try {
        const destino = new File(anexo.caminho);
        // Conteúdo pode ser binário puro OU base64-em-texto (fallback do upload
        // mobile). Baixa como texto, checa se parece base64 e decodifica.
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${info.id}?alt=media`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) continue;
        const texto = await r.text();
        if (info.b64) {
          const bytes = base64ParaBytes(texto);
          if (bytes.length === 0) continue;
          await destino.write(bytes, { encoding: 'binary' } as any);
        } else {
          // binário puro baixado como text corrompe; usa via arrayBuffer quando disponível
          const ab = await r.arrayBuffer();
          await destino.write(new Uint8Array(ab), { encoding: 'binary' } as any);
        }
        if (destino.exists) restaurados++;
      } catch {
        // individual falhou — tenta no próximo ciclo
      }
    }
    return restaurados;
  } catch {
    return 0;
  }
};

/**
 * Quantos anexos citados pelas notas ainda FALTAM no Drive (ou estão vazios).
 * Para a barra de progresso do celular: usuário vê "3 imagens/áudios pendentes".
 * Leve: 1 listagem de metadados.
 */
export const anexosPendentesUpload = async (htmls: string[]): Promise<number> => {
  try {
    const user = await GoogleSignin.getCurrentUser();
    if (!user) return 0;
    const anexos = extrairAnexosLocais(htmls);
    if (anexos.length === 0) return 0;
    const token = await buscarToken();
    if (!token) return 0;
    const existentes = await listarAnexosDrive(token);
    let faltam = 0;
    for (const a of anexos) {
      const info = existentes.get(PREFIXO + a.nome);
      if (!info || info.size === 0) faltam++;
    }
    return faltam;
  } catch { return 0; }
};

/**
 * Remove do Drive os anexos órfãos (arquivos no Drive que não são mais
 * citados por nenhuma nota local). Só roda com conta logada e online.
 * Opcional/seguro: nunca apaga anexo citado por qualquer HTML passado na sessão.
 */
export const apagarAnexosOrfaos = async (htmlsAtuais: string[]): Promise<number> => {
  if (Platform.OS === 'web') return 0;
  try {
    const user = await GoogleSignin.getCurrentUser();
    if (!user) return 0;
    const token = await buscarToken();
    if (!token) return 0;

    const citados = new Set(extrairAnexosLocais(htmlsAtuais).map(a => PREFIXO + a.nome));
    const existentes = await listarAnexosDrive(token);
    let apagados = 0;
    for (const [nome, info] of existentes) {
      if (citados.has(nome)) continue;
      try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${info.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok || res.status === 404) apagados++;
      } catch {
        // segue
      }
    }
    return apagados;
  } catch {
    return 0;
  }
};
