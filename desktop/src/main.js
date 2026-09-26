// Simple Notes Pro - Desktop (Electron)
const {app, BrowserWindow, ipcMain, nativeTheme, shell, Notification, Tray, Menu} = require('electron');
// autoUpdater da biblioteca electron-updater (o do Electron puro não tem checkForUpdatesAndNotify)
const {autoUpdater} = require('electron-updater');
const path=require('path'), os=require('os'), fs=require('fs');

// ---- Auto-update via GitHub Releases (electron-updater) ----
// Verifica no boot + de hora em hora; baixa sozinho e instala quando o app fechar.
function iniciarAutoUpdate(){
  // Só no app INSTALADO — em dev/portable não há onde instalar
  if (!app.isPackaged) return;
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: (m)=>console.log('[update]', m), warn: (m)=>console.warn('[update]', m), error: (m)=>console.error('[update]', m) };
    autoUpdater.on('update-downloaded', (info)=>{
      console.log('[update] baixado:', info && info.version);
      splashStatus('Atualização pronta — instala ao fechar', 100);
      try {
        const n = new Notification({ title: 'Atualização baixada', body: 'A versão nova do Simple Notes Pro será instalada quando você fechar o app.', silent: false });
        n.show();
      } catch {}
    });
    autoUpdater.on('download-progress', (p)=>{
      const pct = p && p.percent != null ? p.percent : null;
      splashStatus('Baixando atualização…', pct);
      try { if(janela && !janela.isDestroyed()) janela.webContents.send('update:progresso', { percent: pct }); } catch {}
    });
    autoUpdater.on('error', (e)=>{ console.warn('[update] erro:', e && (e.message || e)); });
    // checa 8s depois do boot (não trava a abertura) e depois de hora em hora
    setTimeout(()=>{ autoUpdater.checkForUpdatesAndNotify().catch((e)=>console.warn('[update] check falhou:', e && (e.message||e))); }, 8000);
    setInterval(()=>{ autoUpdater.checkForUpdatesAndNotify().catch(()=>{}); }, 60*60*1000);
  } catch(e) { console.warn('[update] falha ao iniciar:', e && e.message); }
}

// Aceleração de hardware ativada — usa GPU dedicada quando disponível (PC potente).
// Em headless/CI o Chromium faz fallback sozinho; não forçamos disable-gpu aqui.
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// cache em disco normal (Electron gerencia); evita EBUSY de tmpdir em headless apagando só o cache antigo
if (process.platform === 'win32') app.commandLine.appendSwitch('no-sandbox');
try {
  const legacy = path.join(os.tmpdir(), 'sn-desktop-cache');
  if (fs.existsSync(legacy)) { try { fs.rmSync(legacy, { recursive: true, force: true }); } catch {} }
} catch {}

// ---- Instância única: abrir o app 2x/3x = um processo só (o resto foca a janela existente) ----
const pegouLock = app.requestSingleInstanceLock();
if (!pegouLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    try {
      if (janela && !janela.isDestroyed()) {
        if (janela.isMinimized()) janela.restore();
        janela.show();
        janela.focus();
      } else {
        criarJanela();
      }
    } catch {}
  });
}

let janela=null; let store=null, googleAuth=null;
let splash=null;
function deps(){ if(!store) store=require('./store'); if(!googleAuth) googleAuth=require('./google-auth'); return {store,googleAuth}; }

// ---- Splash tipo Steam: janela pequena com ícone + barra, fecha quando o app carrega ----
function splashStatus(texto, progresso){
  try { if(splash && !splash.isDestroyed()) splash.webContents.send('splash:status', { texto, progresso: progresso==null?null:progresso }); } catch {}
}
function criarSplash(){
  if(splash || process.platform!=='win32') return;
  try{
    splash=new BrowserWindow({
      width:360,height:240,frame:false,resizable:false,show:false,alwaysOnTop:true,
      backgroundColor:'#050506',skipTaskbar:true,
      icon:path.join(__dirname,'shell','icone.png'),
      webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:false}
    });
    splash.loadFile(path.join(__dirname,'ui','splash.html'));
    splash.once('ready-to-show',()=>{ try{ if(splash&&!splash.isDestroyed()) splash.show(); }catch{} });
  }catch(e){ console.warn('[splash] falhou:',e&&e.message); }
}
function fecharSplash(){
  try{
    if(splash && !splash.isDestroyed()){
      splashStatus('Pronto', 100);
      setTimeout(()=>{ try{ if(splash && !splash.isDestroyed()) splash.close(); }catch{} splash=null; }, 250);
    } else splash=null;
  }catch(e){ splash=null; }
}

const { proximoDisparo } = require('./lib/alarme');
const timersAlarme = new Map();
function limparTimer(id){ const t=timersAlarme.get(id); if(t) clearTimeout(t); timersAlarme.delete(id); }
function dispararAlarme({ id, titulo, recorrencia, horario }){
  // Notification nativa — som do sistema (sound:true força som mesmo em foco)
  try {
    const n = new Notification({ title: '⏰ Lembrete', body: titulo || 'Tarefa', urgency: 'critical', sound: true });
    n.on('click', ()=>{ if(janela){
      if(janela.isMinimized()) janela.restore();
      janela.show(); janela.focus();
      janela.webContents.send('alarme:disparou', { id, titulo, recorrencia, horario });
    }});
    n.show();
  } catch(e){ console.error('[alarme] Notification fail', e && e.message); }
  try { if(janela && !janela.isDestroyed()) janela.webContents.send('alarme:disparou', { id, titulo, recorrencia, horario }); } catch {}
  if (recorrencia && recorrencia !== 'Uma vez'){
    const prox = proximoDisparo(recorrencia, horario);
    if (prox) agendarTimer(id, titulo, prox, recorrencia, horario);
  }
}
function agendarTimer(id, titulo, quandoMs, recorrencia, horario){
  limparTimer(id);
  let delay = quandoMs - Date.now();
  if (delay < 1000) delay = 1000;
  const t = setTimeout(()=> dispararAlarme({ id, titulo, recorrencia, horario }), delay);
  if (t.unref) t.unref();
  timersAlarme.set(id, t);
}

ipcMain.on('janela:minimizar',()=>janela&&janela.minimize());
ipcMain.on('janela:maximizar',()=>{ if(!janela) return; janela.isMaximized()?janela.unmaximize():janela.maximize(); });
ipcMain.on('janela:fechar',()=>janela&&janela.close());
ipcMain.handle('store:ler',()=>deps().store.lerLocal());
ipcMain.handle('store:salvar',(_e,d)=>{deps().store.salvarLocal(d); return true;});
ipcMain.handle('store:apagarTudo',async()=>{
  // PADRÃO DE SINCRONIZAÇÃO CORRETO (igual empresas grandes):
  // 1. Lê os IDs das notas atuais e cria TOMBSTONES
  // 2. SOBE um backup vazio + tombstones pro Drive (NUNCA deleta o arquivo)
  // 3. Apaga o local
  // Sem isto: o celular via "Drive vazio", o merge mantinha tudo local
  // dele e RE-SUBIA as notas apagadas.
  try{
    const store = deps().store;
    const {tokenDeAcesso}=deps().googleAuth;
    let nuvemOk=true;

    // Lê as notas atuais antes de apagar (pra criar os tombstones)
    const dados = store.lerLocal();
    const todosIds = [];
    for (const campo of ['notas','listas','pastas','tarefas']) {
      (dados?.[campo]||[]).forEach(it => { if (it?.id != null) todosIds.push(String(it.id)); });
    }

    // Se logado, sobe backup VAZIO com os tombstones (não deleta!)
    try{
      const t=await tokenDeAcesso();
      if(t && todosIds.length > 0){
        const agora = Date.now();
        const apagados = todosIds.map(id => ({ id, ts: agora }));
        const backupVazio = { notas: [], listas: [], pastas: [], tarefas: [], apagados: apagados };
        const r = await store.enviarBackupDrive(t, backupVazio);
        nuvemOk = r?.ok ?? false;
      } else if (t) {
        // Sem notas locais (já vazio): só sobe o backup vazio
        const r = await store.enviarBackupDrive(t, { notas: [], listas: [], pastas: [], tarefas: [], apagados: [] });
        nuvemOk = r?.ok ?? false;
      }
    }catch(e){ nuvemOk=false; }

    // Apaga o local
    store.apagarTudoLocal();

    // cancela timers
    for(const k of timersAlarme.keys()) limparTimer(k);
    return {ok:true, nuvemOk};
  }catch(e){ return {ok:false, erro:String(e.message||e).slice(0,200)}; }
});
ipcMain.handle('config:ler',()=>deps().store.lerConfig());
ipcMain.handle('config:salvar',(_e,patch)=>deps().store.salvarConfig(patch||{}));

// ---- Iniciar com o Windows + bandeja (segundo plano p/ alarmes) ----
/**
 * Entrada do Windows para iniciar sozinho — `--hidden` abre direto na bandeja.
 *
 * A LEITURA tem de usar o MESMO path+args da gravação: o Windows indexa a
 * entrada pelo comando completo. Lendo sem argumentos, o app não achava a
 * entrada que ele mesmo tinha acabado de criar (o registro ficava lá, com
 * `--hidden`), o interruptor voltava sozinho e aparecia "Não consegui alterar".
 */
function caminhoAppInstalado(){
  // Prioriza o app FINAL instalado. Em dev, process.execPath é o electron dev do
  // node_modules — se o toggle gravasse isso no registro, o Windows abriria a
  // janela/terminal de desenvolvimento no boot (parecendo o Expo), não o app final.
  if (!app.isPackaged) {
    const cand = path.join('C:\\Program Files\\Simple Notes Pro', 'Simple Notes Pro.exe');
    if (fs.existsSync(cand)) return cand;
    return process.execPath;
  }
  return process.execPath;
}
function opcoesLoginItem(){
  // Em dev roda pelo electron.exe; instalado, roda pelo exe do app.
  // `name`: sem ele o nome da entrada sai como "electron.app.Electron" na lista
  // de Inicialização do Windows (Gerenciador de Tarefas) — ilegível para o usuário.
  return { path: caminhoAppInstalado(), args: ['--hidden'], name: 'Simple Notes Pro' };
}
function lerIniciarComWindows(){
  try{
    var o=opcoesLoginItem();
    if(app.getLoginItemSettings(o).openAtLogin) return true;
    // entradas criadas por versões antigas (sem `name`)
    if(app.getLoginItemSettings({ path:o.path, args:o.args }).openAtLogin) return true;
    return !!app.getLoginItemSettings().openAtLogin;
  }catch(e){ return false; }
}
// Devolve o estado RESULTANTE (ligado/desligado de verdade), não "consegui":
// é o que o interruptor da interface precisa para não mentir.
function definirIniciarComWindows(ativar){
  try{
    var o=opcoesLoginItem();
    app.setLoginItemSettings({ openAtLogin: !!ativar, enabled: !!ativar, name: o.name, path: o.path, args: o.args });
    // Entradas criadas por versões antigas (sem `name`): desligar precisa
    // alcançá-las também, senão o interruptor continuaria "ligado".
    app.setLoginItemSettings({ openAtLogin: !!ativar, enabled: !!ativar, path: o.path, args: o.args });
  }catch(e){}
  return lerIniciarComWindows();
}
ipcMain.handle('app:iniciarComWindows:ler',()=>lerIniciarComWindows());
ipcMain.handle('app:iniciarComWindows:set',(_e,v)=>definirIniciarComWindows(v));
ipcMain.handle('app:versao',()=>{ try{ return app.getVersion(); }catch(e){ return '0.0.0'; } });

// --hidden: iniciou com o Windows → abre direto na bandeja (janela oculta)
const ABRIU_OCULTO=process.argv.includes('--hidden');

let tray=null;
function criarBandeja(){
  if(tray || process.platform!=='win32') return;
  try{
    tray=new Tray(path.join(__dirname,'shell','icone.png'));
    tray.setToolTip('Simple Notes Pro');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label:'Abrir Simple Notes', click:()=>{ if(janela){ janela.show(); janela.focus(); } } },
      { label:'Sair', click:()=>{ app.quittandoDeVerdade=true; app.quit(); } },
    ]));
    // clique esquerdo no ícone da bandeja reabre a janela
    tray.on('click',()=>{ if(janela){ janela.show(); janela.focus(); } });
  }catch(e){ console.warn('[tray] falhou:',e&&e.message); }
}
ipcMain.handle('alarme:agendar',(_e,{id,titulo,quandoMs,recorrencia,horario})=>{
  if(!id) return false;
  const q = Number(quandoMs) || proximoDisparo(recorrencia, horario) || (Date.now()+60000);
  agendarTimer(id, titulo||'', q, recorrencia, horario);
  return true;
});
ipcMain.handle('alarme:cancelar',(_e,{id})=>{ if(id) limparTimer(id); return true; });
ipcMain.handle('alarme:testar',(_e,payload)=>{
  const t=(payload&&payload.titulo)||'Teste de alarme';
  try{ const n=new Notification({title:'Teste de alarme', body:t, sound:true}); n.show(); }catch{}
  try{ if(janela && !janela.isDestroyed()) janela.webContents.send('alarme:disparou', { id:'teste', titulo:t, recorrencia:'Uma vez', horario:'' }); }catch{}
  return true;
});
// Devolve o backup REMOTO como veio. Antes ele era gravado no store local aqui
// (antes do merge do renderer): nota só-local era apagada do disco e, se o app
// fechasse nesse intervalo, a alteração sumia de vez. O merge e a gravação são
// responsabilidade do renderer (Merge.mesclar), que sabe o que é local.
ipcMain.handle('store:sync:baixar',async()=>{ try{ const t=await deps().googleAuth.tokenDeAcesso(); const r=await deps().store.buscarBackupDrive(t); if(!r) return {ok:true,vazio:true}; try{ const a=await deps().store.hidratarNotasComAnexos(t,r); if(a>0) console.log('[sync] anexos hidratados',a); }catch(e){ console.warn('[sync] hidratar falhou',e&&e.message);} return {ok:true,dados:r}; }catch(e){return {ok:false,erro:String(e.message||e).slice(0,200)}; }});
ipcMain.handle('store:sync:meta', async()=>{ try{ const t=await deps().googleAuth.tokenDeAcesso(); const m=await deps().store.obterMetadadosBackupDrive(t); return {ok:true, meta:m}; }catch(e){ return {ok:false, erro:String(e.message||e).slice(0,200)}; }});
// Antes de subir, DESIDRATA o payload: extrai as imagens/áudios data:uri do
// HTML, sobe cada um como anexo_* no Drive (mesma convenção do celular) e
// troca por file:// — o backup_notas.json fica PEQUENO (antes o base64 inteiro
// ia dentro do JSON e a sincronização ficava lenta). Devolve também o
// `modifiedTime` da gravação (relógio do Google): é o marcador
// que o renderer usa para saber se a nuvem mudou — sem depender do relógio do PC.
ipcMain.handle('store:sync:enviar',async(_e,d)=>{ try{ const t=await deps().googleAuth.tokenDeAcesso(); let dados=d; try{ dados=await deps().store.desidratarNotasParaEnvio(t, d); }catch(e){ console.warn('[sync] desidratar falhou:', e&&e.message); } const r=await deps().store.enviarBackupDrive(t,dados); return {ok:!!(r&&r.ok), modifiedTime:(r&&r.modifiedTime)||null}; }catch(e){return {ok:false,erro:String(e.message||e).slice(0,200)}; }});
// Anexos: baixa imagens/áudios (anexo_*) do Drive e troca file:// por data:uri
// nas notas locais — sem baixar nada quando todas já estão hidratadas.
ipcMain.handle('store:anexos:hidratar',async()=>{ try{
  const t=await deps().googleAuth.tokenDeAcesso(); if(!t) return {ok:false, erro:'sem token'};
  const local=deps().store.lerLocal();
  const total=await deps().store.hidratarNotasComAnexos(t,{ notas: local.notas });
  return {ok:true, total};
}catch(e){ return {ok:false, erro:String(e.message||e).slice(0,200)}; }});
ipcMain.handle('google:entrar',()=>deps().googleAuth.entrarComGoogle());
ipcMain.handle('google:sair',async()=>{deps().googleAuth.apagarSessao(); return true;});
ipcMain.handle('google:usuario',()=>{ const s=deps().googleAuth.carregarSessao(); return s && s.user ? s.user : null; });
ipcMain.handle('google:tokens',async()=>{ try{return {accessToken:await deps().googleAuth.tokenDeAcesso()};}catch{return null;}});
ipcMain.handle('google:temSecret',()=>{ try{ const hit = deps().googleAuth.obterInfo(); return !!hit.temSecret; }catch{ return false; }});
ipcMain.handle('google:info',()=>{ try{ return deps().googleAuth.obterInfo(); }catch(e){ return { erro: String(e.message||e).slice(0,300) }; }});
ipcMain.handle('ia:perguntar', async(_e,{pergunta, chaveApi})=>{
  try{
    const body = await new Promise(function(res, rej){
      const https=require('https');
      const payload=JSON.stringify({ pergunta: String(pergunta||''), chaveApi: String(chaveApi||'') });
      const req=https.request({ hostname:'openrouter.ai', path:'/api/v1/chat/completions', method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+String(chaveApi||''), 'HTTP-Referer':'https://simple-notes.app','X-Title':'Simple Notes', 'Content-length': Buffer.byteLength(payload)}}, function(r){
        var d=''; r.on('data',function(c){d+=c;}); r.on('end',function(){ if(r.statusCode===401) return rej(new Error('AUTH')); if(r.statusCode===429) return rej(new Error('RATE')); if(r.statusCode>=400) return rej(new Error('API '+r.statusCode+': '+d.slice(0,120))); try{ res(JSON.parse(d)); }catch(e){ rej(e); }});
      }); req.on('error', rej); req.write(payload); req.end();
    });
    return {ok:true, body};
  }catch(e){ return {ok:false, erro:String(e.message||e).slice(0,300)}; }
});

function criarJanela(){
  janela=new BrowserWindow({
    width:1180,height:780,minWidth:920,minHeight:560,show:false,backgroundColor:'#000000',frame:false,titleBarStyle:'hidden',
    icon:path.join(__dirname,'shell','icone.png'),
    // backgroundThrottling:false — o app vive na BANDEJA (fechar só esconde a
    // janela). Sem isso o Chromium estrangula os timers da página oculta (até
    // 1x por minuto), a sincronização automática e a fila de envio quase param.
    webPreferences:{preload:path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false, sandbox:false, backgroundThrottling:false}
  });
  janela.webContents.on('render-process-gone',(_e,d)=>console.error('[electron] render-process-gone',d.reason,d.exitCode));
  janela.webContents.on('did-finish-load',()=>console.log('[electron] did-finish-load'));
  nativeTheme.themeSource='dark';
  janela.webContents.setWindowOpenHandler(({url})=>{ if(url.startsWith('http')){shell.openExternal(url); return {action:'deny'};} return {action:'deny'}; });
  janela.loadFile(path.join(__dirname,'ui','index.html'));
  // Splash tipo Steam: fecha quando o app carrega (com folga para o primeiro render)
  janela.webContents.once('did-finish-load', ()=>{ setTimeout(fecharSplash, 500); });
  janela.on('close',(e)=>{
    // Segundo plano: fechar (X) apenas esconde para a BANDEJA — os timers de
    // alarme e o processo continuam vivos. Sai de verdade só pela bandeja (Sair)
    // ou quando o usuário marcou sair de verdade.
    if(!app.quittandoDeVerdade){
      e.preventDefault();
      janela.hide();
    }
  });
  janela.on('closed',()=>{ janela=null; });
  criarBandeja();
  if(ABRIU_OCULTO){ /* iniciou com o Windows: fica na bandeja, alarmes ativos */ }
  else janela.once('ready-to-show',()=>{ if(janela&&!janela.isDestroyed()) janela.show(); });
}
app.whenReady().then(()=>{
  criarSplash();
  criarJanela();
  iniciarAutoUpdate();
  // segurança: se o splash ainda estiver aberto depois de 20s, fecha
  setTimeout(fecharSplash, 20000);
  // (ready-to-show do show é resolvido dentro de criarJanela conforme --hidden)
});
app.on('window-all-closed',()=>{
  // Com bandeja ativa, fechar a janela NÃO encerra: alarmes seguem em 2º plano.
  if(process.platform==='darwin') return;
  if(tray){ return; }
  app.quit();
});
app.on('before-quit',()=>{ app.quittandoDeVerdade=true; });
app.on('activate',()=>{ if(!janela) criarJanela(); });
