// Prova de sync com a conta Drive REAL (sem UI, sem Electron).
// Usa google-auth.js (mesmo tokenDeAcesso que o app) e store.js (hidratar real).
// Round trip: envia alteração marcada → modifiedTime avança → conteúdo volta
// igual → restaura o original. Anexos: listagem com size + hidratação real.
const os = require('os'), path = require('path'), fs = require('fs');
const auth = require('../src/google-auth.js');
const store = require('../src/store.js');
const TMPUSER = path.join(os.tmpdir(), 'simple-notes-pro-desktop', 'userData');

function falha(msg){ console.error('FALHOU:', msg); process.exit(1); }
function ok(msg){ console.log('OK:', msg); }

async function listaAnexos(token){
  const r = await fetch("https://www.googleapis.com/drive/v3/files?q=name%20contains%20%27anexo_%27%20and%20parents%20in%20%27appDataFolder%27&spaces=appDataFolder&fields=files(id,name,size,modifiedTime)&pageSize=200", { headers:{ Authorization:'Bearer '+token } });
  const j = await r.json();
  return j.files || [];
}
async function obterIdBackup(token){
  const r = await fetch("https://www.googleapis.com/drive/v3/files?q=name%3D%27backup_notas.json%27+and+parents+in+%27appDataFolder%27&spaces=appDataFolder&fields=files(id,modifiedTime,size)", { headers:{ Authorization:'Bearer '+token } });
  const j = await r.json();
  return (j.files && j.files[0]) || null;
}
async function baixarBackup(token, id){
  const r = await fetch('https://www.googleapis.com/drive/v3/files/'+id+'?alt=media', { headers:{ Authorization:'Bearer '+token } });
  if(!r.ok) falha('download backup HTTP '+r.status);
  return r.json();
}
async function subirBackup(token, id, obj){
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files/'+id+'?uploadType=media', {
    method:'PATCH', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify(obj),
  });
  if(!r.ok) falha('upload backup HTTP '+r.status);
  return true;
}

(async () => {
  // 0) Sessão + token real
  const sessao = auth.carregarSessao();
  if(!sessao || !sessao.user) falha('sem sessao.json em '+TMPUSER);
  console.log('Conta:', sessao.user.email);
  const token = await auth.tokenDeAcesso();
  ok('token de acesso renovado via refresh (google-auth.js real)');

  // 1) Listagem real: backup + anexos com size/modifiedTime
  const backupMeta = await obterIdBackup(token);
  console.log('backup_notas.json:', backupMeta ? ('id='+backupMeta.id+' size='+backupMeta.size+' modifiedTime='+backupMeta.modifiedTime) : 'AUSENTE');
  if(!backupMeta) falha('sem backup no Drive');
  const anexos = await listaAnexos(token);
  const vazios = anexos.filter(a => Number(a.size||0) === 0);
  console.log('anexos_* no Drive:', anexos.length, '| vazios (size 0):', vazios.length);
  anexos.slice(0, 10).forEach(a => console.log('  -', a.name, 'size='+a.size, a.modifiedTime));

  // 2) ROUND TRIP marcado
  const original = await baixarBackup(token, backupMeta.id);
  const antes = backupMeta.modifiedTime;
  await new Promise(r => setTimeout(r, 1500));
  const marcado = JSON.parse(JSON.stringify(original));
  marcado.notas = marcado.notas || [];
  marcado.notas.push({ id:'prova-sync-'+Date.now(), titulo:'__PROVA_SYNC__', conteudo:'<p>nota de prova — será removida</p>', data:new Date().toISOString() });
  await subirBackup(token, backupMeta.id, marcado);
  ok('alteração marcada enviada');

  // modifiedTime deve avançar
  let meta2 = await obterIdBackup(token);
  if(!meta2 || !(meta2.modifiedTime > antes)) falha('modifiedTime não avançou: antes='+antes+' depois='+(meta2&&meta2.modifiedTime));
  ok('modifiedTime avançou: '+antes+' -> '+meta2.modifiedTime);

  // conteúdo volta igual (marcado presente)
  const volta = await baixarBackup(token, meta2.id);
  const achou = (volta.notas||[]).some(n => n && n.titulo === '__PROVA_SYNC__');
  if(!achou) falha('nota marcada não voltou no download');
  ok('conteúdo volta íntegro (nota marcada presente)');
  console.log('  ultimaSincronizacao no backup:', volta.ultimaSincronizacao || '(sem)');

  // 3) Hidratação REAL contra a listagem real
  const copiaHidr = JSON.parse(JSON.stringify(volta));
  const temFileUri = (copiaHidr.notas||[]).some(n => String((n&&n.conteudo)||'').indexOf('file://') !== -1);
  console.log('notas com file:// no backup:', temFileUri ? 'sim' : 'não');
  const n = await store.hidratarNotasComAnexos(token, copiaHidr);
  console.log('hidratarNotasComAnexos ->', n, 'anexo(s) convertido(s) para data:uri');
  if(n > 0){
    let imgs=0, auds=0;
    (copiaHidr.notas||[]).forEach(nn => {
      const c = String((nn&&nn.conteudo)||'');
      const m1 = c.match(/src="data:image\/[^"]{50}/g); if(m1) imgs += m1.length;
      const m2 = c.match(/src="data:audio\/[^"]{50}/g); if(m2) auds += m2.length;
    });
    ok('data:uri gerados: imagem='+imgs+' audio='+auds);
    const sobrouFile = (copiaHidr.notas||[]).some(nn => String((nn&&nn.conteudo)||'').indexOf('file://') !== -1);
    if(vazios.length === 0 && sobrouFile) console.log('ATENÇÃO: ainda sobrou file:// — pode ser anexo que nunca subiu');
    else if(sobrouFile && vazios.length > 0) ok('file:// restante corresponde a anexo vazio (pulado corretamente, celular vai reenviar)');
  } else if(temFileUri){
    const nomes = new Set();
    (copiaHidr.notas||[]).forEach(nn => { const c=String((nn&&nn.conteudo)||''); let m, re=/file:\/\/[^"?]*?((?:img|audio)_[^\/"?#]+)/gi; while((m=re.exec(c))) nomes.add(m[1]); });
    const faltando = [...nomes].filter(x => !anexos.some(a => a.name === 'anexo_'+x));
    console.log('Nenhum hidratado. Citados:', [...nomes].join(', ') || '(nenhum)');
    console.log('Sem anexo no Drive:', faltando.join(', ') || '(nenhum — todos citados existem, vazios foram pulados)');
  }

  // 4) RESTAURA original — dados do usuário intactos
  await new Promise(r => setTimeout(r, 1500));
  await subirBackup(token, backupMeta.id, original);
  const meta3 = await obterIdBackup(token);
  const restaurado = await baixarBackup(token, meta3.id);
  const limpo = !(restaurado.notas||[]).some(nn => nn && nn.titulo === '__PROVA_SYNC__');
  if(!limpo) falha('original não foi restaurado');
  ok('original restaurado — dados do usuário intactos (modifiedTime='+meta3.modifiedTime+')');
  console.log('\nPROVA COMPLETA ✔');
})().catch(e => { falha(e && (e.stack || e.message) || String(e)); });
