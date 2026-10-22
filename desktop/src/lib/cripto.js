/**
 * CRIPTOGRAFIA — fonte ÚNICA, consumida pelo PC e pelo celular.
 *
 * AES-256-CBC com IV aleatório. Chave derivada de SHA-256 do email Google.
 *
 * UMD: `module.exports` para Metro/Electron, `globalThis.Cripto` para renderer.
 */
(function (raiz, fabrica) {
  var api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (raiz) raiz.Cripto = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Obtém CryptoJS (require no main/Metro, globalThis no renderer). */
  function _crypto() {
    if (typeof require === 'function') {
      try { return require('crypto-js'); } catch (e) {}
    }
    if (typeof globalThis.CryptoJS !== 'undefined') return globalThis.CryptoJS;
    return null;
  }

  /** Chave AES-256 derivada do email da conta Google (SHA-256 com sal). */
  function derivarChave(emailGoogle) {
    if (!emailGoogle || typeof emailGoogle !== 'string') return null;
    var C = _crypto();
    if (!C) return null;
    try {
      var email = emailGoogle.toLowerCase().trim();
      // 4 rodadas de SHA-256 com sal (dificulta rainbow table)
      var h = C.SHA256(email + '::sn-pro-v1').toString();
      h = C.SHA256(h + email + '::sn-pro-v2').toString();
      h = C.SHA256(h + '::sn-pro-v3').toString();
      return C.SHA256(h + email + '::final').toString();
    } catch (e) {
      return null;
    }
  }

  /** AES-256-CBC: encripta texto plano. Retorna {iv, dados} em hex. */
  function encriptar(texto, chaveHex) {
    if (!texto || !chaveHex) return null;
    var C = _crypto();
    if (!C) return null;
    try {
      var chave = C.enc.Hex.parse(chaveHex.substring(0, 64));
      var iv = C.lib.WordArray.random(16);
      var enc = C.AES.encrypt(texto, chave, { iv: iv, mode: C.mode.CBC, padding: C.pad.Pkcs7 });
      return { iv: iv.toString(), dados: enc.ciphertext.toString() };
    } catch (e) {
      return null;
    }
  }

  /** AES-256-CBC: descriptografa {iv, dados}. Retorna texto ou null. */
  function descriptografar(payload, chaveHex) {
    if (!payload || !payload.iv || !payload.dados || !chaveHex) return null;
    var C = _crypto();
    if (!C) return null;
    try {
      var chave = C.enc.Hex.parse(chaveHex.substring(0, 64));
      var iv = C.enc.Hex.parse(payload.iv);
      var dados = C.lib.CipherParams.create({ ciphertext: C.enc.Hex.parse(payload.dados) });
      var bytes = C.AES.decrypt(dados, chave, { iv: iv, mode: C.mode.CBC, padding: C.pad.Pkcs7 });
      return bytes.toString(C.enc.Utf8) || null;
    } catch (e) {
      return null;
    }
  }

  /** Encripta um objeto JSON. Retorna string JSON com envelope. */
  function encriptarJSON(obj, chaveHex) {
    if (!obj || !chaveHex) return null;
    var enc = encriptar(JSON.stringify(obj), chaveHex);
    if (!enc) return null;
    return JSON.stringify({ __enc: 'AES-256-CBC', v: 1, iv: enc.iv, dados: enc.dados });
  }

  /** Descriptografa envelope JSON. Retorna objeto ou null. Formato antigo passa direto. */
  function descriptografarJSON(envelope, chaveHex) {
    if (!envelope) return null;
    try {
      var obj = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
      if (!obj || obj.__enc !== 'AES-256-CBC') return obj; // formato antigo: sem criptografia
      if (!chaveHex) return null;
      var texto = descriptografar(obj, chaveHex);
      return texto ? JSON.parse(texto) : null;
    } catch (e) {
      return null;
    }
  }

  /** Verifica se um payload está encriptado (formato antigo CBC). */
  function estaEncriptado(payload) {
    if (!payload) return false;
    try {
      var obj = typeof payload === 'string' ? JSON.parse(payload) : payload;
      return !!(obj && obj.__enc === 'AES-256-CBC');
    } catch (e) {
      return false;
    }
  }

  /* ======================================================================
   * v2 — AES-256-CTR + HMAC-SHA256 (Encrypt-then-MAC), chave ALEATÓRIA.
   *
   * A chave de dados (DEK, 32 bytes) é gerada com CSPRNG pelo chamador e
   * embrulhada com uma KEK derivada por PBKDF2-SHA256 de um CÓDIGO DE
   * RECUPERAÇÃO aleatório (160 bits). O envelope leva a DEK embrulhada,
   * então um aparelho novo só precisa do código — nunca do e-mail.
   *
   * Funções puras: IV/salt/chave vêm de fora (CSPRNG do PC ou do celular).
   * ====================================================================== */

  var AAD_BACKUP = 'sn-pro-backup-v2';
  var AAD_CHAVE = 'sn-pro-wrap-v2';
  var ALFABETO32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford (sem I, L, O, U)

  /** Converte 20 bytes em hex para um código de 32 caracteres (8 grupos de 4). */
  function codigoDeHex(hex) {
    if (!/^[0-9a-f]{40}$/i.test(String(hex || ''))) return null;
    var bytes = String(hex).match(/.{2}/g).map(function (h) { return parseInt(h, 16); });
    var bits = 0, valor = 0, saida = '';
    for (var i = 0; i < bytes.length; i++) {
      valor = (valor << 8) | bytes[i];
      bits += 8;
      while (bits >= 5) { saida += ALFABETO32[(valor >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) saida += ALFABETO32[(valor << (5 - bits)) & 31];
    if (saida.length !== 32) return null;
    return saida.match(/.{4}/g).join('-');
  }

  /** Normaliza o código digitado (maiúsculas, sem separadores, I/L→1, O→0). */
  function normalizarCodigo(codigo) {
    var s = String(codigo || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    s = s.replace(/[IL]/g, '1').replace(/O/g, '0');
    if (s.length !== 32) return null;
    for (var i = 0; i < s.length; i++) {
      if (ALFABETO32.indexOf(s.charAt(i)) < 0) return null;
    }
    return s;
  }

  /** Deriva a KEK do código (PBKDF2-SHA256). */
  function _kek(codigo, saltHex, iteracoes) {
    var C = _crypto();
    var s = normalizarCodigo(codigo);
    if (!C || !s || !/^[0-9a-f]{32,64}$/i.test(String(saltHex || ''))) return null;
    var it = Math.max(10000, Math.min(1000000, Number(iteracoes) || 100000));
    try {
      return C.PBKDF2(s, C.enc.Hex.parse(saltHex), {
        keySize: 256 / 32,
        iterations: it,
        hasher: C.algo.SHA256
      }).toString();
    } catch (e) { return null; }
  }

  /** Subchaves independentes para cifra e MAC (domain separation). */
  function _subchaves(chaveHex) {
    var C = _crypto();
    if (!C || !/^[0-9a-f]{64}$/i.test(String(chaveHex || ''))) return null;
    var chave = C.enc.Hex.parse(String(chaveHex).slice(0, 64));
    return {
      enc: C.HmacSHA256(C.enc.Utf8.parse('sn-pro-v2-enc'), chave),
      mac: C.HmacSHA256(C.enc.Utf8.parse('sn-pro-v2-mac'), chave)
    };
  }

  function _mac(C, macKey, aad, ivHex, dadosHex) {
    return C.HmacSHA256(String(aad || '') + '|' + ivHex + '|' + dadosHex, macKey).toString();
  }

  /** Comparação em tempo constante (hex). */
  function _iguais(a, b) {
    a = String(a || ''); b = String(b || '');
    if (a.length !== b.length || !a.length) return false;
    var r = 0;
    for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  }

  /** Cifra autenticada (CTR + HMAC). IV de 16 bytes vindo do CSPRNG. */
  function cifrarAutenticado(texto, chaveHex, ivHex, aad) {
    var C = _crypto();
    var sub = _subchaves(chaveHex);
    if (!C || !sub || !/^[0-9a-f]{32}$/i.test(String(ivHex || ''))) return null;
    try {
      var iv = C.enc.Hex.parse(ivHex);
      var enc = C.AES.encrypt(String(texto), sub.enc, { iv: iv, mode: C.mode.CTR, padding: C.pad.NoPadding });
      var dados = enc.ciphertext.toString();
      return { dados: dados, mac: _mac(C, sub.mac, aad, ivHex, dados) };
    } catch (e) { return null; }
  }

  /** Decifra SÓ depois de verificar o MAC. */
  function decifrarAutenticado(payload, chaveHex, ivHex, aad) {
    var C = _crypto();
    var sub = _subchaves(chaveHex);
    if (!C || !sub || !payload || !payload.dados || !payload.mac) return null;
    if (!/^[0-9a-f]{32}$/i.test(String(ivHex || ''))) return null;
    try {
      var esperado = _mac(C, sub.mac, aad, ivHex, payload.dados);
      if (!_iguais(esperado, payload.mac)) return null;
      var iv = C.enc.Hex.parse(ivHex);
      var dados = C.lib.CipherParams.create({ ciphertext: C.enc.Hex.parse(payload.dados) });
      var bytes = C.AES.decrypt(dados, sub.enc, { iv: iv, mode: C.mode.CTR, padding: C.pad.NoPadding });
      return bytes.toString(C.enc.Utf8) || null;
    } catch (e) { return null; }
  }

  /** Embrulha a DEK com a KEK derivada do código. */
  function embrulharChave(chaveHex, codigo, saltHex, ivHex, iteracoes) {
    var kek = _kek(codigo, saltHex, iteracoes);
    if (!kek) return null;
    var blob = cifrarAutenticado(chaveHex, kek, ivHex, AAD_CHAVE);
    if (!blob) return null;
    blob.iv = ivHex;
    return blob;
  }

  /** Desembrulha a DEK; null se o código estiver errado ou o blob adulterado. */
  function desembrulharChave(blob, codigo, saltHex, iteracoes) {
    var kek = _kek(codigo, saltHex, iteracoes);
    if (!kek) return null;
    var chave = decifrarAutenticado(blob, kek, blob && blob.iv, AAD_CHAVE);
    return chave && /^[0-9a-f]{64}$/i.test(chave) ? chave : null;
  }

  /** Monta o envelope v2 completo (dados + DEK embrulhada). */
  function montarEnvelopeV2(obj, chaveHex, codigo, opts) {
    opts = opts || {};
    if (!obj || !chaveHex || !normalizarCodigo(codigo)) return null;
    if (!opts.ivDados || !opts.ivChave || !opts.salt) return null;
    var it = Math.max(10000, Math.min(1000000, Number(opts.iteracoes) || 100000));
    var dados = cifrarAutenticado(JSON.stringify(obj), chaveHex, opts.ivDados, AAD_BACKUP);
    var chave = embrulharChave(chaveHex, codigo, opts.salt, opts.ivChave, it);
    if (!dados || !chave) return null;
    return {
      __enc: 'AES-256-CTR-HMAC',
      v: 2,
      kdf: { alg: 'PBKDF2-SHA256', it: it, salt: opts.salt },
      chave: chave,
      iv: opts.ivDados,
      dados: dados.dados,
      mac: dados.mac
    };
  }

  /** Monta o envelope v2 reaproveitando a DEK já embrulhada (sem PBKDF2). */
  function montarEnvelopeV2ComChaveEmbrulhada(obj, chaveHex, kdf, chaveBlob, opts) {
    opts = opts || {};
    if (!obj || !chaveHex || !kdf || !chaveBlob || !opts.ivDados) return null;
    if (!kdf.alg || !kdf.salt || !chaveBlob.iv || !chaveBlob.dados || !chaveBlob.mac) return null;
    var dados = cifrarAutenticado(JSON.stringify(obj), chaveHex, opts.ivDados, AAD_BACKUP);
    if (!dados) return null;
    return {
      __enc: 'AES-256-CTR-HMAC',
      v: 2,
      kdf: { alg: kdf.alg, it: kdf.it, salt: kdf.salt, tipo: kdf.tipo || 'codigo' },
      chave: { iv: chaveBlob.iv, dados: chaveBlob.dados, mac: chaveBlob.mac },
      iv: opts.ivDados,
      dados: dados.dados,
      mac: dados.mac
    };
  }

  /** Lê o envelope v2 com a DEK já desembrulhada. */
  function lerEnvelopeV2(envelope, chaveHex) {    if (!ehV2(envelope)) return null;
    var texto = decifrarAutenticado(
      { dados: envelope.dados, mac: envelope.mac },
      chaveHex,
      envelope.iv,
      AAD_BACKUP
    );
    if (!texto) return null;
    try { return JSON.parse(texto); } catch (e) { return null; }
  }

  /** Recupera a DEK a partir do envelope + código de recuperação. */
  function abrirEnvelopeComCodigo(envelope, codigo) {
    if (!ehV2(envelope)) return null;
    var kdf = envelope.kdf || {};
    var it = Number(kdf.it) || 0;
    if (kdf.alg !== 'PBKDF2-SHA256' || it < 10000 || it > 1000000) return null;
    return desembrulharChave(envelope.chave, codigo, kdf.salt, it);
  }

  /** Verifica se é envelope v2. */
  function ehV2(payload) {
    if (!payload) return false;
    try {
      var o = typeof payload === 'string' ? JSON.parse(payload) : payload;
      return !!(o && o.__enc === 'AES-256-CTR-HMAC' && o.v === 2);
    } catch (e) { return false; }
  }

  return {
    derivarChave: derivarChave,
    encriptar: encriptar,
    descriptografar: descriptografar,
    encriptarJSON: encriptarJSON,
    descriptografarJSON: descriptografarJSON,
    estaEncriptado: estaEncriptado,
    // v2
    codigoDeHex: codigoDeHex,
    normalizarCodigo: normalizarCodigo,
    cifrarAutenticado: cifrarAutenticado,
    decifrarAutenticado: decifrarAutenticado,
    embrulharChave: embrulharChave,
    desembrulharChave: desembrulharChave,
    montarEnvelopeV2: montarEnvelopeV2,
    montarEnvelopeV2ComChaveEmbrulhada: montarEnvelopeV2ComChaveEmbrulhada,
    lerEnvelopeV2: lerEnvelopeV2,
    abrirEnvelopeComCodigo: abrirEnvelopeComCodigo,
    ehV2: ehV2
  };
});
