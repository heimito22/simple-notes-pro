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

  /** Verifica se um payload está encriptado. */
  function estaEncriptado(payload) {
    if (!payload) return false;
    try {
      var obj = typeof payload === 'string' ? JSON.parse(payload) : payload;
      return !!(obj && obj.__enc === 'AES-256-CBC');
    } catch (e) {
      return false;
    }
  }

  return {
    derivarChave: derivarChave,
    encriptar: encriptar,
    descriptografar: descriptografar,
    encriptarJSON: encriptarJSON,
    descriptografarJSON: descriptografarJSON,
    estaEncriptado: estaEncriptado
  };
});
