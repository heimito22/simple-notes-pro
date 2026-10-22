/**
 * SYNC DO BACKUP — lógica pura (testável) usada pelos handlers do main.js.
 *
 * v2: DEK aleatória + envelope AES-256-CTR/HMAC + DEK embrulhada por um código
 * de recuperação. v1 (CBC derivado do e-mail) só é lido para MIGRAR.
 *
 * Regras de ouro:
 *  - NUNCA sobe em claro: se não criptografar, aborta.
 *  - Se já existe backup v2 e este aparelho não tem a DEK, pede o código e
 *    NÃO sobrescreve nada.
 *  - Se este aparelho tem DEK e o backup remoto é v1/claro, RECUSA (downgrade).
 */
const crypto = require('crypto');
const Cripto = require('./cripto.js');

let ultimoEnvelope = null;
let ultimoEmail = null;
let chaveOkEmail = null;

function aleatorio(n) { return crypto.randomBytes(n).toString('hex'); }

function reset() { ultimoEnvelope = null; ultimoEmail = null; chaveOkEmail = null; }

/**
 * Envia o backup. Retorna {ok, modifiedTime, codigoNovo?, precisaCodigo?, erro?}.
 */
async function enviar(p) {
  const { email, store, token, chaveBackup } = p;
  let dados = p.dados;
  try { dados = await store.desidratarNotasParaEnvio(token, dados); } catch (e) {}

  let ks = chaveBackup.obter(email);
  let codigoNovo = null;

  // Chave já existe, mas ainda não foi conferida contra a nuvem nesta sessão:
  // se o backup remoto for v2 de OUTRA chave, NÃO sobrescreve — pede o código.
  if (ks && chaveOkEmail !== email) {
    let filesOk = true;
    let files = [];
    if (typeof store.listarBackupsDriveSeguro === 'function') {
      const lista = await store.listarBackupsDriveSeguro(token);
      filesOk = lista.ok;
      files = lista.files || [];
    }
    if (!filesOk) {
      return { ok: false, erro: 'Não consegui verificar o backup no Drive — envio cancelado.' };
    }
    if (files.length) {
      const atual = await store.buscarBackupDrive(token).catch(() => null);
      if (!atual) {
        return { ok: false, erro: 'Não consegui baixar o backup para verificar — envio cancelado.' };
      }
      if (Cripto.ehV2(atual)) {
        if (!Cripto.lerEnvelopeV2(atual, ks.chave)) {
          ultimoEnvelope = atual;
          ultimoEmail = email;
          return { ok: false, precisaCodigo: true };
        }
      } else {
        return { ok: false, erro: 'Backup antigo/sem proteção recusado (possível downgrade).' };
      }
    }
    chaveOkEmail = email;
  }

  if (!ks) {
    // Já existe backup v2 de outro aparelho? Então NÃO cria chave nova:
    // pede o código e preserva o backup (evita sobrescrever dados alheios).
    const atual = await store.buscarBackupDrive(token).catch(() => null);
    if (atual && Cripto.ehV2(atual)) {
      ultimoEnvelope = atual;
      ultimoEmail = email;
      return { ok: false, precisaCodigo: true };
    }
    // Vai migrar v1/claro para v2: guarda uma cópia antes de sobrescrever.
    if (atual && typeof p.aoMigrar === 'function') {
      try { p.aoMigrar(atual); } catch (e) {}
    }
    ks = chaveBackup.criar(email);
    if (!ks) return { ok: false, erro: 'Cofre do Windows indisponível — backup NÃO enviado' };
    codigoNovo = ks.codigo;
    chaveOkEmail = email;
  }

  // Reutiliza o blob da DEK embrulhada: o PBKDF2 NÃO roda a cada push.
  let env;
  if (ks.kdf && ks.chaveEmbrulhada) {
    env = Cripto.montarEnvelopeV2ComChaveEmbrulhada(dados, ks.chave, ks.kdf, ks.chaveEmbrulhada, {
      ivDados: aleatorio(16)
    });
  } else {
    env = Cripto.montarEnvelopeV2(dados, ks.chave, ks.codigo, {
      ivDados: aleatorio(16),
      ivChave: aleatorio(16),
      salt: aleatorio(16),
      iteracoes: 100000
    });
    if (env && typeof chaveBackup.salvarEmbrulho === 'function') {
      try { chaveBackup.salvarEmbrulho(email, env.kdf, env.chave); } catch (e) {}
    }
  }
  if (!env) return { ok: false, erro: 'Falha ao criptografar — backup NÃO enviado' };

  const r = await store.enviarBackupDrive(token, env);
  return {
    ok: !!(r && r.ok),
    modifiedTime: (r && r.modifiedTime) || null,
    codigoNovo: codigoNovo || undefined
  };
}

/**
 * Baixa o backup. Retorna {ok, dados, vazio?, migrarV2?, precisaCodigo?, erro?}.
 */
async function baixar(p) {
  const { email, store, token, chaveBackup } = p;
  const r = await store.buscarBackupDrive(token);
  if (!r) return { ok: true, vazio: true };

  const ks = email ? chaveBackup.obter(email) : null;
  let dados = null;
  let migrarV2 = false;

  if (Cripto.ehV2(r)) {
    if (!ks) {
      ultimoEnvelope = r;
      ultimoEmail = email;
      return { ok: false, precisaCodigo: true };
    }
    dados = Cripto.lerEnvelopeV2(r, ks.chave);
    if (!dados) {
      // Pode ser chave errada (aparelho antigo) ou backup adulterado. Pede o
      // código em vez de ficar num beco sem saída; o MAC decide.
      ultimoEnvelope = r;
      ultimoEmail = email;
      return { ok: false, precisaCodigo: true };
    }
    ultimoEnvelope = null;
    ultimoEmail = null;
    chaveOkEmail = email;
  } else {
    // Backup antigo (v1 CBC) ou em claro. Se este aparelho já tem chave v2,
    // RECUSA: aceitar seria permitir um downgrade silencioso.
    if (ks) return { ok: false, erro: 'Backup antigo/sem proteção recusado (possível downgrade).' };
    migrarV2 = true;
    if (Cripto.estaEncriptado(r)) {
      const chave = email ? Cripto.derivarChave(email) : null;
      dados = chave ? Cripto.descriptografarJSON(r, chave) : null;
      if (!dados) return { ok: false, erro: 'Falha na descriptografia do backup antigo (conta errada?)' };
    } else {
      dados = r;
    }
  }

  try { await store.hidratarNotasComAnexos(token, dados); } catch (e) {}
  return { ok: true, dados, migrarV2, raw: migrarV2 ? r : undefined };
}

/** Desbloqueia o backup v2 baixado com o código de recuperação. */
async function definirCodigo(p) {
  const { email, codigo, chaveBackup } = p;
  if (!email || !ultimoEnvelope) return { ok: false, erro: 'Nenhum backup para desbloquear' };
  if (ultimoEmail && email !== ultimoEmail) {
    // Conta trocou no meio do caminho: o envelope é de outra conta.
    ultimoEnvelope = null;
    ultimoEmail = null;
    return { ok: false, erro: 'A conta mudou — sincronize de novo.' };
  }
  const ks = chaveBackup.definirComCodigo(email, ultimoEnvelope, codigo);
  if (!ks) return { ok: false, erro: 'Código incorreto' };
  ultimoEnvelope = null;
  ultimoEmail = null;
  chaveOkEmail = email;
  return { ok: true };
}

module.exports = { enviar, baixar, definirCodigo, reset, aleatorio };
