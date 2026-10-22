# HANDOFF — Simple Notes Pro (+ OUTRICO / Focas)

## Usuário
Pichau (GitHub heimito22), PT-BR sempre. Windows 11, PowerShell 5.1, 2 monitores.
Quer resultado profissional, liberdade criativa ("sem dó"). Modelo atual NÃO lê imagens.

## PROJETO 1 — SIMPLE NOTES PRO (foco)
App de notas com IA agente e sync PC↔celular.
- Mobile: `C:\MinhasNotas` (Expo SDK 56, RN 0.85.3, React 19, expo-router, TS)
- Desktop: `C:\MinhasNotas\desktop` (Electron; renderer em `src/ui`, lógica em `src/lib`)
- Site: `C:\Users\Pichau\Downloads\simple-notes-pro-site`

### Versões
- Play Store: v1.7.14 (code 39) pronta para subir — backup v2 com DEK aleatória no SecureStore, código de recuperação (PBKDF2 + AES-256-CTR/HMAC), fail-closed, migração v1→v2 e anti-downgrade; tudo do 1.7.11 (correção de tag, parser tolerante, cores, concorrência, etc.). Produção em 1.7.3/28. AAB/APK na Área de Trabalho.
- Desktop: 1.5.34 publicada — mesmo backup v2 (DEK no safeStorage/DPAPI, código de recuperação), fail-closed, migração e anti-downgrade; mantém as correções de tag/IA da 1.5.29.
- Desktop anterior: 1.5.28 (IA só propõe ações e não diz que criou/falhou antes da confirmação).
- Desktop anterior: 1.5.27 (bloqueio de envio concorrente, reparo de JSON e [c=#HEX]).
- Desktop anterior: 1.5.26 (executa todos os blocos, apaga pasta, herda pasta nova mesmo com campo vazio, aceita [color=] e \n literal).
- Desktop anterior: 1.5.24 (corrige ação da IA que aparecia como JSON cru e não executava; aceita ação solta/lista/aninhados).
- Desktop anterior: 1.5.23 (chat da IA com negrito/markdown e cores, paleta "A" no editor, cores preservadas na edição da IA; atalhos editáveis em Ctrl+/, Ctrl+W fecha só o editor, Ctrl+Alt+L bloqueia o app).
- Repo: `origin/main` = último commit do dia (mobile e PC).

### Idioma (recém-corrigido, não regredir)
- Idioma é POR APARELHO: não vai no backup do Drive nem é aplicado de prefs remotas.
- `ThemeContext`: `atualizarConfig` compõe via ref; use `atualizarConfigs` para várias chaves juntas (duas chamadas seguidas perdem a primeira).
- `idiomaEscolhido` true = escolha manual; false/undefined = segue dispositivo (`expo-localization.getLocales()`).
- Migração `idiomaEscolhaVersao: 2` destrava configs antigas presas em inglês.

### Arquitetura crítica
- IA agente: protocolo `{"acoes":[...]}` (criar nota/lista/tarefa/pasta, mover, fixar, apagar, lembretes). Cartão "Quero fazer isto — permitir?" antes de executar. Executor: `context/ia-acoes.ts` (mobile) e `desktop/src/lib/ia-acoes.js` — ambos usam funções oficiais dos contexts → sync perfeita.
- IA pronta (sem chave): Worker próprio em `server/ia-proxy/worker.js` (Cloudflare) — `https://simple-notes-ia.heitoruliacchrabeloreis.workers.dev`. Guarda a chave OpenRouter no servidor, valida access token do Google, cota 120/dia por conta + 4000/dia global, fallback grátis no Workers AI (`AI` binding). App usa o proxy quando não há chave (`constants/ia-proxy.ts`); com chave própria vai direto e ilimitado.
- Provider IA (chave própria): OpenRouter, modelo `openrouter/auto` com `openrouter/free` de reserva; conteúdo sempre como array de partes.
- Sync: Drive `appDataFolder`, `backup_notas.json` + `anexo_*`. Merge por item com `dataModificacao` + tombstones, pull-first/push depois, marcador pelo `modifiedTime` do servidor. Backup encriptado AES-256 (chave derivada do e-mail).
- Imagens: tudo em base64 (`File.write` não tem encoding 'binary' no expo-file-system); refs virtuais `file://imagens_notas/` resolvidas no WebView (`converterMarcadores`).
- Editor PC: lista 28% (max 340px), editor ~67%; `.rich-editable ol{padding-left:36px}`.
- Android: módulo nativo `modules/minhasnotas-ime` (altura do teclado via WindowInsets.ime), orientação portrait só em <600dp, R8 ativo, edge-to-edge.

### Build
- Mobile: `cd C:\MinhasNotas\android; $env:JAVA_HOME=jdk-21; .\gradlew.bat :app:assembleRelease` (ou `bundleRelease`)
  - Obrigatório: `--no-daemon "-Dorg.gradle.vfs.watch=false" "-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m"` (sem isso: crash do file watcher/erro apksig). PowerShell precisa das flags ENTRE ASPAS.
  - Keystore: `android/app/simple-notes-release.keystore`. versionCode/versionName em `app.json` E `android/app/build.gradle` (android/ é ignorado pelo git).
- Desktop: `cd desktop; npm run dist` + `npm run publicar-github` (GITHUB_TOKEN).
- Validação: `cd C:\MinhasNotas; npx tsc --noEmit`.

### Marketing (pronto)
- `marketing/estrategia-videos.md` (roteiros, títulos A/B, plano de publicação)
- Thumbs em `marketing/` (`thumb-video-longo-1280x720.png`, `thumb-short-1080x1920.png`)
- Vídeos: `Documents\SHORT-simple-notes-1080x1920.mp4` (40s) e `Documents\LONGO-simple-notes-1920x1080.mp4` (2:24)
- Posicionamento: o APP é o herói ("pare de usar 4 apps"); IA é superpoder bônus.

## HERMES (relatórios automáticos)
- Pasta: `C:\Users\Pichau\AppData\Local\hermes`. Config: provider NVIDIA, modelo `z-ai/glm-5.3` (lento, ~10 min/chamada).
- Cron job `8837a2e22923` "testar-projetos-diario": 10:00, gera `Desktop\RELATORIO_DIARIO.json` + `.pdf`.
- `scripts/abrir_relatorio.py` é um VIGIA residente: abre o PDF do dia (nunca de ontem), marcador só depois de abrir e só vale se mais novo que o JSON. Tarefa "Hermes Abrir Relatorio": logon + diária 10:00 repetindo a cada 15 min por 14h, sem limite de tempo.
- Manual: `Desktop\Relatorio agora.cmd` (`hermes cron run 8837a2e22923` + tick + vigia).
- Diagnóstico: `scripts\abrir_relatorio.log`, `logs\agent.log`, `hermes cron runs`.

## PROJETO 2 — OUTRICO (Godot 4.7.1)
`C:\Users\Pichau\Documents\outrico`. Jogo de tanques multiplayer. Pode mexer sem dó.
- Validar sempre: `& "C:\Users\Pichau\Desktop\Godot_v4.7.1-stable_win64.exe" --headless --path Documents/outrico -s res://tools/validar.gd` → `TUDO_OK`.
- Lição: corpo integra entre callbacks → o raio é SWEEP da posição anterior; `hit_from_inside` desligado; exclusões por RID.

## PROJETO 3 — FOCAS ADVENTURES (GameMaker, parado)
Pendência: tiles do Room7 não commitados; falta verificação visual do usuário.
REGRA: editar arquivos só com a IDE do GameMaker FECHADA.

## QUIRKS DO AMBIENTE (lições caras)
- PowerShell 5.1: `>` corrompe binário (usar cmd /c); `$var:` = drive (usar `${var}`); `[math]::Round` usa vírgula em BR.
- ffmpeg: escapar `C\:/`; `zoompan d=N` em vídeo multiplica frames; PNG em `-loop 1` sem `-t` = encode infinito.
- Play: versionCode nunca se repete, mesmo descartando rascunho.

## PENDÊNCIAS
1. Play Console: pausar tracks de teste interno/fechado (só Produção ativa).
2. Postar SHORT + LONGO (escolher música em alta no YouTube na hora).
3. Focas: conferir tiles do Room7 → commitar/descartar.
