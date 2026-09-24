// Simple Notes Pro — Desktop: store local + sync Drive
// Backup: { notas, listas, pastas, tarefas, chaveIA, anexos } em drive.appdata
// Mídia (imagens/áudios) já entra como data:uri no HTML — vai direto no backup.
const fs = require('fs');
const path = require('path');
// Política de sincronização compartilhada com o celular (fonte única):
// contexto de arquivo em desktop/src/lib/politica-sync.js.
const PoliticaSync = require('./lib/politica-sync.js');

const CONFIG_PADRAO = {
  exigirBiometriaApp: false,
  protegerNotasIndividuais: false,
  tempoBloqueio: 0,
  exibirAjudaFAB: true,
  tempoSoneca: 10,
  somAlarme: 'classico',
  chaveIA: '',
  idioma: 'pt',
  pinDesbloqueio: '',
  temaEscuro: true,
  modeloPc: '',
};
const VALID_SOM = new Set(['classico','digital','suave','urgente','eco','ondas']);
const VALID_IDIOMA = new Set(['pt','en','es']);

function arqLocal() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'store.json');
}
function normalizarConfig(j){
  const c = Object.assign({}, CONFIG_PADRAO, j || {});
  if (c.somAlarme != null && !VALID_SOM.has(c.somAlarme)) c.somAlarme = CONFIG_PADRAO.somAlarme;
  if (!VALID_IDIOMA.has(c.idioma)) c.idioma = 'pt';
  c.exigirBiometriaApp = !!c.exigirBiometriaApp;
  c.pinDesbloqueio = String(c.pinDesbloqueio || '');
  c.temaEscuro = c.temaEscuro !== false;
  c.tempoBloqueio = Number(c.tempoBloqueio) || 0;
  c.tempoSoneca = Number(c.tempoSoneca) || 10;
  c.chaveIA = String(c.chaveIA || '');
  c.modeloPc = String(c.modeloPc || '');
  return c;
}

function lerLocal() {
  try {
    const j = JSON.parse(fs.readFileSync(arqLocal(), 'utf8'));
    return {
      notas: Array.isArray(j.notas) ? j.notas : [],
      listas: Array.isArray(j.listas) ? j.listas : [],
      pastas: Array.isArray(j.pastas) ? j.pastas : [],
      tarefas: Array.isArray(j.tarefas) ? j.tarefas : [],
      chaveIA: typeof j.chaveIA === 'string' ? j.chaveIA : '',
      config: normalizarConfig(j.config),
      ultimaSincronizacao: typeof j.ultimaSincronizacao === 'string' ? j.ultimaSincronizacao : null,
    };
  } catch { return { notas: [], listas: [], pastas: [], tarefas: [], chaveIA: '', config: Object.assign({}, CONFIG_PADRAO), ultimaSincronizacao: null }; }
}
function lerConfig(){ return lerLocal().config; }
function salvarLocal(d) {
  try {
    const p = arqLocal();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const cur = lerLocal();
    const merged = Object.assign({}, cur, d);
    if (d.config) merged.config = normalizarConfig(Object.assign({}, cur.config, d.config));
    if (typeof d.ultimaSincronizacao === 'string') merged.ultimaSincronizacao = d.ultimaSincronizacao;
    else if (d.ultimaSincronizacao === null) merged.ultimaSincronizacao = null;
    // JSON compacto (sem pretty-print): com anexos no store o pretty dobrava o
    // tamanho — e o writeFileSync roda a cada salvamento (debounce de digitação).
    fs.writeFileSync(p, JSON.stringify(merged), 'utf8');
  } catch {}
}
function salvarConfig(patch){
  const cur = lerLocal();
  const config = normalizarConfig(Object.assign({}, cur.config, patch));
  salvarLocal({ config });
  // Upload para Drive agora é responsabilidade única do renderer (app.js:salvarLocal→syncEnviar)
  // — evita duplo fire-and-forget e última-escrita-vence silencioso.
  return config;
}
function apagarTudoLocal(){
  try { fs.unlinkSync(arqLocal()); } catch {}
  try {
    const { app } = require('electron');
    const s1=path.join(app.getPath('userData'),'sessao.json');
    try{ fs.unlinkSync(s1); }catch{}
    const s2=path.join(__dirname,'..','sessao.json');
    try{ fs.unlinkSync(s2); }catch{}
  } catch {}
}

// ---- Drive ---- (backup_notas.json em appDataFolder — mesma conta = mesmos dados do celular)
//
// BACKUP CANÔNICO: a conta pode acabar com MAIS DE UM backup_notas.json (dois
// aparelhos criando o arquivo, ou um "apagar tudo" que removeu só o primeiro).
// Pegar sempre `files[0]` de uma lista sem ordem garantida fazia o PC ler um
// arquivo e gravar em outro — a alteração "não salvava na nuvem". Agora todos os
// caminhos usam o MESMO critério: o arquivo MAIS RECENTE é o canônico, e os
// duplicados são removidos depois de um push bem-sucedido.
var fileIdCache = null;
var duplicadosChecados = false;
var ultimaPoda = 0;
function camposArquivo(){ return 'files(id%2CmodifiedTime%2Csize)'; }
async function listarBackupsDrive(token){
  try{
    const r = await fetch('https://www.googleapis.com/drive/v3/files?q=name%3D%27backup_notas.json%27+and+parents+in+%27appDataFolder%27&spaces=appDataFolder&fields='+camposArquivo()+'&orderBy=modifiedTime%20desc', { headers:{Authorization:'Bearer '+token, 'Cache-Control':'no-cache'}, signal:AbortSignal.timeout(15000) });
    const j = await r.json().catch(()=>({}));
    // ordena localmente também: `orderBy` não é garantido para appDataFolder
    return PoliticaSync.ordenarBackups((j.files||[]).filter(f=>f && f.id));
  }catch{ return []; }
}
/** Remove os backups duplicados, mantendo só o canônico. */
async function removerDuplicadosDrive(token, manterId){
  const files = await listarBackupsDrive(token);
  const dups = files.filter(f=>f.id!==manterId);
  let removidos=0;
  for(const d of dups){
    try{ const r=await fetch('https://www.googleapis.com/drive/v3/files/'+d.id, { method:'DELETE', headers:{Authorization:'Bearer '+token} }); if(r.ok||r.status===204) removidos++; }catch(e){}
  }
  return removidos;
}
/** Poda duplicados no máximo 1x/minuto — a listagem já mostrou que existem. */
function talvezPodar(token, files){
  if(!files || files.length < 2) return;
  if(Date.now() - ultimaPoda < 60000) return;
  ultimaPoda = Date.now();
  removerDuplicadosDrive(token, files[0].id).catch(()=>{});
}
async function obterMetadadosBackupDrive(token){
  const { canonico: f, duplicados } = PoliticaSync.escolherCanonico(await listarBackupsDrive(token));
  if(!f) { fileIdCache=null; return null; }
  fileIdCache = f.id;
  talvezPodar(token, [f].concat(duplicados));
  return {id:f.id, modifiedTime:f.modifiedTime||null, size:f.size||null, duplicados: duplicados.length};
}
async function buscarBackupDrive(token) {
  const { canonico: f, duplicados } = PoliticaSync.escolherCanonico(await listarBackupsDrive(token));
  if (!f) return null;
  fileIdCache = f.id;
  talvezPodar(token, [f].concat(duplicados));
  const dl = await fetch('https://www.googleapis.com/drive/v3/files/' + f.id + '?alt=media', {
    headers: { Authorization: 'Bearer ' + token, 'Cache-Control':'no-cache' },
    signal: AbortSignal.timeout(60000),
  });
  if (!dl.ok) return null;
  return dl.json().catch(() => null);
}
/**
 * Sobe o backup e devolve `{ ok, modifiedTime }`.
 *
 * O `modifiedTime` é o carimbo do SERVIDOR da gravação — o desktop usa isso
 * como "até onde eu já vi a nuvem". Antes o app comparava o relógio do PC com
 * o do Google: com o PC 2 minutos adiantado o pull automático NUNCA disparava
 * e a sincronização só acontecia clicando em Sincronizar.
 */
async function enviarBackupDrive(token, dados) {
  const body = JSON.stringify(dados);
  // A âncora (fileId) só é usada sem verificação depois de uma listagem na
  // sessão: nela garantimos que existe UM arquivo e passamos a gravar nele —
  // push fica com 1 request.
  let fileId = duplicadosChecados ? fileIdCache : null;
  if (!fileId) {
    const { canonico, ordenados } = PoliticaSync.escolherCanonico(await listarBackupsDrive(token));
    fileId = canonico && canonico.id;
    if (fileId && !duplicadosChecados) { duplicadosChecados = true; talvezPodar(token, ordenados); }
  }
  if (fileId) {
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=media&fields=modifiedTime', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(60000),
    });
    if (r.ok) {
      fileIdCache = fileId;
      const j = await r.json().catch(() => ({}));
      return { ok: true, modifiedTime: (j && j.modifiedTime) || null };
    }
    if (r.status === 404) { fileIdCache = null; return enviarBackupDrive(token, dados); } // apagado no celular: recria
    return { ok: false, modifiedTime: null };
  }
  const metadata = { name: 'backup_notas.json', parents: ['appDataFolder'] };
  const boundary = 'sn_boundary';
  const multipart =
    '--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + JSON.stringify(metadata) +
    '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n--' + boundary + '--';
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=' + boundary },
    body: multipart,
    signal: AbortSignal.timeout(60000),
  });
  if (r.ok) {
    const j = await r.json().catch(()=>({}));
    fileIdCache = (j && j.id) || null;
    return { ok: true, modifiedTime: (j && j.modifiedTime) || null };
  }
  return { ok: false, modifiedTime: null };
}
async function apagarBackupDrive(token){
  try{
    // Apaga TODOS os backups (antes removia só o primeiro — deixava duplicado
    // para trás, que voltava a ser escolhido depois de um "apagar tudo").
    const files = await listarBackupsDrive(token);
    if(!files.length) { fileIdCache = null; return true; }
    fileIdCache = null;
    let ok = true;
    for(const f of files){
      try{ const del = await fetch('https://www.googleapis.com/drive/v3/files/'+f.id, { method:'DELETE', headers:{ Authorization:'Bearer ' + token }, signal:AbortSignal.timeout(30000) }); if(!(del.ok||del.status===204)) ok = false; }catch(e){ ok = false; }
    }
    return ok;
  }catch{ return false; }
}

// Hidrata notas com URIs file:// (imagens img_* e áudios audio_* do celular)
// baixando os anexos do Drive (anexo_*) e trocando por data:uri — assim a nota
// abre no PC mesmo sem os arquivos locais. Substituição PRECISA por URI: cada
// src file:// que termina com o nome do anexo vira o seu próprio data:uri
// (antes, um replace global sobrescrevia TODOS os srcs com a mesma imagem e
// áudios nunca eram hidratados).
function escapeRe(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function mimePorNome(nome){
  if (nome.endsWith('.png')) return 'image/png';
  if (nome.endsWith('.webp')) return 'image/webp';
  if (nome.endsWith('.gif')) return 'image/gif';
  if (nome.endsWith('.m4a')) return 'audio/mp4';
  if (nome.endsWith('.mp3')) return 'audio/mpeg';
  if (nome.endsWith('.wav')) return 'audio/wav';
  if (nome.endsWith('.aac')) return 'audio/aac';
  if (nome.endsWith('.ogg')) return 'audio/ogg';
  if (nome.indexOf('audio_') === 0) return 'audio/mp4';
  return 'image/jpeg';
}
async function hidratarNotasComAnexos(token, dados){
  if(!dados || !Array.isArray(dados.notas) || !token) return 0;
  // 1) Nomes citados por src/data-audio-uri file:// (imagens E áudios)
  var reNome=/(?:src|data-audio-uri)="file:\/\/[^"?]*?((?:img|audio)_[^\/"'?#]+)"/gi;
  var nomes=new Set();
  for(var i=0;i<dados.notas.length;i++){
    var h=String((dados.notas[i]&&dados.notas[i].conteudo)||''); var m;
    reNome.lastIndex=0;
    while((m=reNome.exec(h))!==null) nomes.add(m[1]);
  }
  if(!nomes.size) return 0;
  // 2) Mapa anexo_* no Drive da conta (com tamanho: anexo vazio = lixo de um
  // upload que falhou no celular — pula, o celular vai reenviá-lo no próximo ciclo.
  // appProperties.snB64 marca conteúdo base64-em-texto — o fetch do celular não
  // consegue enviar binário, então manda base64 e aqui decodifica)
  var r=await fetch('https://www.googleapis.com/drive/v3/files?q=name%20contains%20%27anexo_%27%20and%20parents%20in%20%27appDataFolder%27&spaces=appDataFolder&fields=files(id,name,size,appProperties)&pageSize=200', { headers:{Authorization:'Bearer '+token}, signal:AbortSignal.timeout(30000)});
  var j=await r.json().catch(function(){return {};});
  var map=new Map(); (j.files||[]).forEach(function(f){ if(f.name&&f.name.indexOf('anexo_')===0 && Number(f.size||0)>0) map.set(f.name.slice(6), { id:f.id, b64: !!(f.appProperties&&f.appProperties.snB64) }); });
  if(!map.size) return 0;
  // 3) Baixa cada anexo e troca SÓ as URIs file:// que terminam com o nome dele
  var cnt=0;
  for(var nome of nomes){
    var info=map.get(nome); if(!info) continue;
    try{
      var dl=await fetch('https://www.googleapis.com/drive/v3/files/'+info.id+'?alt=media', { headers:{Authorization:'Bearer '+token}, signal:AbortSignal.timeout(30000)});
      if(!dl.ok) continue;
      var b64;
      if(info.b64){
        // conteúdo é base64-em-texto (upload mobile): limpa e usa direto
        b64=(await dl.text()).replace(/[^A-Za-z0-9+\/=]/g,'');
      }else{
        var buf=await dl.arrayBuffer();
        b64=Buffer.from(buf).toString('base64');
      }
      var dataUri='data:'+mimePorNome(nome)+';base64,'+b64;
      var reUri=new RegExp('((?:src|data-audio-uri)=")file://[^"?]*?'+escapeRe(nome)+'(")','g');
      for(var p=0;p<dados.notas.length;p++){
        var c=(dados.notas[p]||{}).conteudo; if(!c || typeof c!=='string') continue;
        if(c.indexOf(nome)===-1) continue;
        reUri.lastIndex=0;
        if(!reUri.test(c)) continue;
        reUri.lastIndex=0;
        dados.notas[p].conteudo=c.replace(reUri, function(mm, pre, pos){ return pre+dataUri+pos; });
        cnt++;
      }
    }catch(e){}
  }
  if(cnt>0){
    // Persiste o hidratado MESCLANDO por id: antes o array do backup (remoto)
    // substituía as notas locais inteiras — quem tinha nota só-local perdia a
    // nota ao hidratar anexos.
    try{
      var cur=lerLocal();
      var porId=new Map((cur.notas||[]).map(function(n){ return [String(n.id), n]; }));
      (dados.notas||[]).forEach(function(n){
        if(!n||n.id==null) return;
        var ex=porId.get(String(n.id));
        if(ex && typeof n.conteudo==='string') ex.conteudo=n.conteudo;
      });
      salvarLocal({ notas: cur.notas });
    }catch(e){}
  }
  return cnt;
}
module.exports = { lerLocal, salvarLocal, lerConfig, salvarConfig, CONFIG_PADRAO, buscarBackupDrive, obterMetadadosBackupDrive, enviarBackupDrive, apagarTudoLocal, apagarBackupDrive, hidratarNotasComAnexos, listarBackupsDrive, removerDuplicadosDrive, desidratarNotasParaEnvio };

/* ---------------------------------------------------------------------------
 * DESIDRATAÇÃO DE ENVIO (gargalo do payload) — o celular sobe os anexos como
 * arquivos `anexo_*` separados e o backup JSON fica pequeno. O PC embutia o
 * base64 `data:uri` INTEIRO no backup_notas.json: com algumas fotos o JSON
 * passava de dezenas de MB — upload/download lento, JSON.parse travando e a
 * conta re-baixando tudo a cada mudança.
 *
 * Antes de subir: extrai cada data:uri do HTML das notas, sobe como
 * `anexo_<hash>` (mesma convenção do celular: prefixo img_/audio_ + appProperties
 * snB64, então AMBOS os lados sabem hidratar de volta) e troca o src por
 * file://. Nome derivado do SHA-1 do conteúdo: a mesma imagem nunca duplica no
 * Drive e pushes seguintes não re-enviam (idempotente por conteúdo).
 * ------------------------------------------------------------------------- */
var PREFIXO_ANEXO = 'anexo_';
var desidratarEmAndamento = null;

function mimeParaExt(mime){
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'audio/mp4') return 'm4a';
  if (mime === 'audio/mpeg') return 'mp3';
  if (mime === 'audio/wav') return 'wav';
  if (mime === 'audio/aac') return 'aac';
  if (mime === 'audio/ogg') return 'ogg';
  return 'jpg';
}

async function listarAnexosDriveMapa(token){
  const mapa = new Map();
  try{
    const r = await fetch('https://www.googleapis.com/drive/v3/files?q=name%20contains%20%27anexo_%27%20and%20parents%20in%20%27appDataFolder%27&spaces=appDataFolder&fields=files(id,name,size)&pageSize=200', { headers:{Authorization:'Bearer '+token}, signal:AbortSignal.timeout(30000) });
    const j = await r.json().catch(()=>({}));
    (j.files||[]).forEach(function(f){
      if (f && f.name && String(f.name).indexOf(PREFIXO_ANEXO)===0 && Number(f.size||0)>0) mapa.set(f.name, { id:f.id, size:Number(f.size||0) });
    });
  }catch{}
  return mapa;
}

async function subirAnexoDrive(token, nomeDrive, b64){
  const metadata = { name: nomeDrive, parents: ['appDataFolder'], appProperties: { snB64: '1' } };
  const boundary = 'anexo_pc';
  const corpo =
    '--'+boundary+'\nContent-Type: application/json\n\n'+JSON.stringify(metadata)+
    '\n--'+boundary+'\nContent-Type: text/plain\n\n'+b64+'\n--'+boundary+'--';
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization:'Bearer '+token, 'Content-Type': 'multipart/related; boundary='+boundary },
    body: corpo,
    signal: AbortSignal.timeout(60000),
  });
  return r.ok;
}

async function desidratarNotasParaEnvio(token, dados){
  if(!dados || !Array.isArray(dados.notas) || !token) return dados;
  if (desidratarEmAndamento) return desidratarEmAndamento;
  desidratarEmAndamento = (async function(){
    try{
      // 1) Coleta TODAS as data:uri (imagens e áudios) — dedupe por conteúdo
      var reData = /(src|data-audio-uri)="data:([^;]+);base64,([^"]+)"/g;
      var unicos = new Map(); // b64 -> { mime }
      for (var i=0;i<dados.notas.length;i++){
        var h = String((dados.notas[i] && dados.notas[i].conteudo) || ''); var m;
        reData.lastIndex = 0;
        while ((m = reData.exec(h)) !== null) {
          if (!unicos.has(m[3])) unicos.set(m[3], { mime: m[2] });
        }
      }
      if (!unicos.size) return dados;

      // 2) Nome estável por conteúdo (SHA-1 truncado): nunca duplica no Drive
      var crypto = require('crypto');
      var nomes = new Map(); // b64 -> { nome, nomeDrive }
      for (var [b64, info] of unicos) {
        var hash = crypto.createHash('sha1').update(b64).digest('hex').slice(0,16);
        var nome = (info.mime && info.mime.indexOf('audio')===0 ? 'audio_' : 'img_') + hash + '.' + mimeParaExt(info.mime);
        nomes.set(b64, { nome: nome, nomeDrive: PREFIXO_ANEXO + nome });
      }

      // 3) Sobe só o que ainda não existe no Drive (idempotente: push barato)
      var existentes = await listarAnexosDriveMapa(token);
      var subidos = 0;
      for (var [b64b, n] of nomes) {
        if (existentes.has(n.nomeDrive)) continue;
        try { if (await subirAnexoDrive(token, n.nomeDrive, b64b)) subidos++; } catch(e){}
      }
      if (subidos) console.log('[sync] anexos separados do JSON:', subidos);

      // 4) Troca data:uri -> file://anexo no PAYLOAD (o store local fica intacto)
      var trocas = 0;
      for (var [b64c, n2] of nomes) {
        var ref = 'file://imagens_notas/' + n2.nome;
        if (n2.nome.indexOf('audio_') === 0) ref = 'file://audios_notas/' + n2.nome;
        // troca precisa: o par data:uri completo que casa com ESTE b64 vira a sua própria referência
        for (var p=0;p<dados.notas.length;p++){
          var c = (dados.notas[p] || {}).conteudo; if (!c || typeof c !== 'string') continue;
          if (c.indexOf(b64c) === -1) continue;
          var literal = 'data:' + (unicos.get(b64c).mime) + ';base64,' + b64c;
          var reLit = new RegExp('((?:src|data-audio-uri)=")' + escapeRe(literal) + '(")', 'g');
          dados.notas[p].conteudo = c.replace(reLit, function(mm, pre, pos){ trocas++; return pre + ref + pos; });
        }
      }
      if (trocas) console.log('[sync] payload desidratado:', trocas, 'anexo(s) virou(m) referencia file://');
      return dados;
    }catch(e){
      console.warn('[sync] desidratar falhou (enviando como estava):', e && e.message);
      return dados;
    }
  })();
  const resultado = await desidratarEmAndamento;
  desidratarEmAndamento = null;
  return resultado;
}
