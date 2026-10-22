/**
 * COFRE LOCAL DA CHAVE DE BACKUP (PC) — Electron safeStorage (DPAPI no Windows).
 *
 * A DEK (32 bytes) e o código de recuperação ficam cifrados pelo SO, um arquivo
 * por conta Google. Nada disso vai para o Drive: o envelope do backup carrega
 * só a DEK embrulhada com o código (PBKDF2), então um aparelho novo precisa do
 * código — não do e-mail.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Cripto = require('./cripto.js');
const ITERACOES = 100000;

function pasta() {
  const { app } = require('electron');
  const p = path.join(app.getPath('userData'), 'chaves');
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/** Nome do arquivo por conta — evita usar a chave da conta A na conta B. */
function arquivo(email) {
  const slug = String(email || 'local').toLowerCase().trim()
    .replace(/[^a-z0-9]/g, '_').slice(0, 80) || 'local';
  return path.join(pasta(), 'chave-' + slug + '.bin');
}

function disponivel() {
  try {
    const { safeStorage } = require('electron');
    return !!(safeStorage && safeStorage.isEncryptionAvailable());
  } catch (e) { return false; }
}

/** Lê a chave da conta. Retorna {chave, codigo} ou null. */
function obter(email) {
  try {
    if (!disponivel()) return null;
    const { safeStorage } = require('electron');
    const buf = fs.readFileSync(arquivo(email));
    const texto = safeStorage.decryptString(buf);
    const obj = JSON.parse(texto);
    if (!obj || !/^[0-9a-f]{64}$/i.test(String(obj.chave || ''))) return null;
    return {
      chave: String(obj.chave).toLowerCase(),
      codigo: String(obj.codigo || ''),
      kdf: obj.kdf || undefined,
      chaveEmbrulhada: obj.chaveEmbrulhada || undefined
    };
  } catch (e) { return null; }
}

/** Grava {chave, codigo} cifrado pelo SO. */
function salvar(email, dados) {
  try {
    if (!disponivel()) return false;
    if (!dados || !/^[0-9a-f]{64}$/i.test(String(dados.chave || ''))) return false;
    const { safeStorage } = require('electron');
    const buf = safeStorage.encryptString(JSON.stringify({
      chave: String(dados.chave).toLowerCase(),
      codigo: String(dados.codigo || ''),
      kdf: dados.kdf || undefined,
      chaveEmbrulhada: dados.chaveEmbrulhada || undefined,
      criadoEm: dados.criadoEm || new Date().toISOString()
    }));
    fs.writeFileSync(arquivo(email), buf);
    return true;
  } catch (e) { return false; }
}

/** Cria uma DEK aleatória + código e embrulha UMA vez (PBKDF2). */
function criar(email) {
  const chave = crypto.randomBytes(32).toString('hex');
  const codigo = Cripto.codigoDeHex(crypto.randomBytes(20).toString('hex'));
  if (!codigo) return null;
  const salt = crypto.randomBytes(16).toString('hex');
  const ivChave = crypto.randomBytes(16).toString('hex');
  const chaveEmbrulhada = Cripto.embrulharChave(chave, codigo, salt, ivChave, ITERACOES);
  if (!chaveEmbrulhada) return null;
  const kdf = { alg: 'PBKDF2-SHA256', it: ITERACOES, salt, tipo: 'codigo' };
  if (!salvar(email, { chave, codigo, kdf, chaveEmbrulhada })) return null;
  return { chave, codigo, kdf, chaveEmbrulhada };
}

/** Guarda o blob da DEK embrulhada para reutilizar nos próximos pushes. */
function salvarEmbrulho(email, kdf, chaveEmbrulhada) {
  try {
    if (!kdf || !chaveEmbrulhada) return false;
    const atual = obter(email);
    if (!atual) return false;
    return salvar(email, { ...atual, kdf, chaveEmbrulhada });
  } catch (e) { return false; }
}

/** Abre a DEK do envelope com o código digitado e guarda no cofre. */
function definirComCodigo(email, envelope, codigo) {
  const chave = Cripto.abrirEnvelopeComCodigo(envelope, codigo);
  if (!chave) return null;
  const normalizado = Cripto.normalizarCodigo(codigo) || '';
  const kdf = envelope && envelope.kdf;
  const chaveEmbrulhada = envelope && envelope.chave;
  if (!salvar(email, { chave, codigo: normalizado, kdf, chaveEmbrulhada })) return null;
  return { chave, codigo: normalizado, kdf, chaveEmbrulhada };
}

/** Código para mostrar em Ajustes (null se não houver chave). */
function revelar(email) {
  const o = obter(email);
  return o ? o.codigo : null;
}

/** Remove a chave da conta (apagar tudo). */
function apagar(email) {
  try { fs.unlinkSync(arquivo(email)); } catch (e) {}
}

module.exports = { disponivel, obter, criar, definirComCodigo, salvarEmbrulho, revelar, apagar };
