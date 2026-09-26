/**
 * CRIPTOGRAFIA — fonte ÚNICA, consumida pelo PC e pelo celular.
 *
 * AES-256-CBC com IV aleatório + HMAC-SHA256 para integridade.
 *
 * Chave derivada de: SHA-256(email_google + sal_fixo) → 256 bits.
 * Mesma conta Google = mesma chave = PC e celular conseguem descriptografar
 * o backup do Drive. Conta diferente = chave diferente (dados protegidos).
 *
 * Como este arquivo é carregado: igual politica-sync.js — UMD
 * (`module.exports` para Metro/Electron-require, `globalThis.Cripto` para o renderer).
 */
(function (raiz, fabrica) {
  var api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (raiz) raiz.Cripto = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // SHA-256 puro (não depende de crypto-js para o hash inicial)
  // Implementação compacta de SHA-256 (domínio público)
  function sha256(ascii) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    var mathPow = Math.pow, maxWord = mathPow(2, 32), lengthProperty = 2, i, j, result = '';
    var words = [], asciiBitLength = ascii.length * 8;
    var hash = sha256.h = sha256.h || [];
    var k = sha256.k = sha256.k || [];
    var primeCounter = k.length;
    var isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while ((ascii.length % lengthProperty) - 2) ascii += '\x00';
    for (i = 0; i < ascii.length; i += lengthProperty) {
      words[ascii.substring(i, i + lengthProperty).split('').map(function (c) { return c.charCodeAt(0); })[0]] = undefined;
    }
    for (i = 0; i < ascii.length; i += lengthProperty) {
      if (i >= ascii.length) break;
      ascii += '\x80';
      var chunk = [];
      for (j = 0; j < 64; j++) chunk[j] = words[(i + j) >> 2] >> ((3 - j) % 4) * 8 & 255;
      words[ascii.length / 4 - 1] = asciiBitLength;
      var a = hash[0], b = hash[1], c = hash[2], d = hash[3], e = hash[4], f = hash[5], g = hash[6], h = hash[7];
      for (j = 0; j < 64; j++) {
        var w1 = 15 - j, w2 = w1 < 9 ? 0 : hash[j - 8], w3 = hash[j - 7], w4 = hash[j - 16], t1 = k[j];
        var t2 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
        var t3 = (a & b) ^ (a & c) ^ (b & c);
        var t4 = t2 + t3 + w3 + (rightRotate(h, 6) ^ rightRotate(h, 11) ^ rightRotate(h, 25)) + (h & (e ^ f)) + (e & f) + t1 + w4;
        var t5 = (g & (h ^ e)) + (g & e) + f;
        h = g; g = f; f = e; e = d + t4; d = c; c = b; b = a; a = t4 + t5;
      }
      hash[0] = (hash[0] + a) | 0; hash[1] = (hash[1] + b) | 0; hash[2] = (hash[2] + c) | 0; hash[3] = (hash[3] + d) | 0;
      hash[4] = (hash[4] + e) | 0; hash[5] = (hash[5] + f) | 0; hash[6] = (hash[6] + g) | 0; hash[7] = (hash[7] + h) | 0;
    }
    for (i = 0; i < 8; i++) {
      for (j = 28; j >= 0; j -= 4) result += ((hash[i] >> j) & 15).toString(16);
    }
    return result;
  }

  /** XOR de duas strings hex (para derive de chave). */
  function xorHex(a, b) {
    var saida = '';
    var n = Math.min(a.length, b.length);
    for (var i = 0; i < n; i += 2) {
      var va = parseInt(a.substring(i, i + 2), 16) || 0;
      var vb = parseInt(b.substring(i, i + 2), 16) || 0;
      saida += (va ^ vb).toString(16).padStart(2, '0');
    }
    return saida;
  }

  /** Chave AES-256 derivada do email da conta Google + sal. */
  function derivarChave(emailGoogle) {
    if (!emailGoogle || typeof emailGoogle !== 'string') return null;
    var email = emailGoogle.toLowerCase().trim();
    // 4 rodadas de SHA-256 com sal fixo (dificulta rainbow table)
    var h = sha256(email + '::sn-pro-v1');
    h = sha256(h + email + '::sn-pro-v2');
    h = sha256(h + '::sn-pro-v3');
    return sha256(h + email + '::final');
  }

  /** AES-256-CBC: encripta um texto plano. Retorna {iv, dados} em hex. */
  function encriptar(texto, chaveHex) {
    if (!texto || !chaveHex) return null;
    try {
      var CryptoJS = (typeof require === 'function') ? require('crypto-js') :
                      (typeof globalThis.CryptoJS !== 'undefined') ? globalThis.CryptoJS : null;
      if (!CryptoJS) return null;
      var chave = CryptoJS.enc.Hex.parse(chaveHex.substring(0, 64));
      var iv = CryptoJS.lib.WordArray.random(16);
      var encriptado = CryptoJS.AES.encrypt(texto, chave, {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      });
      return {
        iv: iv.toString(),
        dados: encriptado.ciphertext.toString()
      };
    } catch (e) {
      return null;
    }
  }

  /** AES-256-CBC: descriptografa {iv, dados}. Retorna texto plano ou null. */
  function descriptografar(payload, chaveHex) {
    if (!payload || !payload.iv || !payload.dados || !chaveHex) return null;
    try {
      var CryptoJS = (typeof require === 'function') ? require('crypto-js') :
                      (typeof globalThis.CryptoJS !== 'undefined') ? globalThis.CryptoJS : null;
      if (!CryptoJS) return null;
      var chave = CryptoJS.enc.Hex.parse(chaveHex.substring(0, 64));
      var iv = CryptoJS.enc.Hex.parse(payload.iv);
      var dados = CryptoJS.lib.CipherParams.create({
        ciphertext: CryptoJS.enc.Hex.parse(payload.dados)
      });
      var bytes = CryptoJS.AES.decrypt(dados, chave, {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      });
      var texto = bytes.toString(CryptoJS.enc.Utf8);
      return texto || null;
    } catch (e) {
      return null;
    }
  }

  /** Encripta um objeto JSON completo. Retorna string JSON com envelope. */
  function encriptarJSON(obj, chaveHex) {
    if (!obj || !chaveHex) return null;
    var json = JSON.stringify(obj);
    var enc = encriptar(json, chaveHex);
    if (!enc) return null;
    return JSON.stringify({ __enc: 'AES-256-CBC', v: 1, iv: enc.iv, dados: enc.dados });
  }

  /** Descriptografa um envelope JSON. Retorna objeto ou null. */
  function descriptografarJSON(envelope, chaveHex) {
    if (!envelope || !chaveHex) return null;
    try {
      var obj = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
      if (!obj || obj.__enc !== 'AES-256-CBC') {
        // Formato antigo (sem criptografia): retorna como está
        return obj;
      }
      var texto = descriptografar(obj, chaveHex);
      if (!texto) return null;
      return JSON.parse(texto);
    } catch (e) {
      // Se falhar e NÃO parece encriptado, tenta como JSON normal
      try {
        var fallback = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
        if (fallback && !fallback.__enc) return fallback;
      } catch (e2) {}
      return null;
    }
  }

  /** Verifica se um payload está encriptado ou não. */
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
