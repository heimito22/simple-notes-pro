# 📣 Simple Notes Pro — Produção dos Vídeos

> Pipeline REAL (não é só roteiro): gravação de tela do app, narração neural,
> montagem no ffmpeg, legendas queimadas. Data: Out/2026.

---

## 1. POSICIONAMENTO

**O app INTEIRO é o herói.** A mensagem central: *"pare de usar 4 apps diferentes"* —
notas, listas, tarefas com alarme e pastas em UM só lugar, sincronizados entre PC e
celular, grátis, em português.

**A IA é UM dos superpoderes, não o tema:** entra como um beat ("e se você quiser, é só
pedir") — porque o app também funciona 100% manual. Quem não gosta de IA continua
servido; quem gosta, se encanta.

---

## 2. O QUE A PESQUISA MANDA (aplicado)

| Regra (2026) | Dado | Aplicação |
|---|---|---|
| Hook em 1-3s | 50-60% do abandono acontece aqui | Abrir com "PARE DE USAR 4 APPS" + corte seco |
| Duração 22-45s | Melhor retenção | Short de ~39s |
| Legendas queimadas | +15-25% de retenção | Toda fala vira texto grande na tela |
| Cortes a cada 1-2s | Segura o dedo | 20+ cortes no roteiro |
| Loop | Replay = retenção | Fecha voltando à frase do hook |
| Thumbnail: alto contraste OU rosto | 89% dos virais | Alto contraste (marca azul/amarelo no escuro) |
| Texto 3-5 palavras + contorno | +30% CTR | "TUDO EM 1 APP" / "TUDO EM 1 SÓ APP" |
| Texto no topo | Duração ocupa o canto inf-direito | ✓ |
| Setas/círculos (1-2) | +25% CTR | Seta PC ↔ celular |
| Antes/depois | +35% em how-to | "4 apps → 1 app" |

---

## 3. ROTEIRO DO SHORT (39s, 1080x1920) — com tempos REAIS da narração

Narração: **Antônio** (edge-tts, pt-BR neural) · Voz gravada linha a linha em
`video/audio/short-NN.mp3` (durações medidas).

| # | Áudio (segundos) | Imagem (gravação real) | Texto queimado na tela |
|---|---|---|---|
| 1 | 3,3s "Pare de usar quatro apps diferentes." | Card do título (fundo escuro + logo) com zoom | **PARE DE USAR 4 APPS** |
| 2 | 6,0s "Notas, listas, tarefas e pastas. Tudo em um só lugar." | Celular: lista de notas → abre uma nota → aba de listas | **TUDO EM 1 LUGAR** |
| 3 | 4,8s "Um editor de verdade: imagens, áudio e hashtags." | Celular: editor digitando, toolbar, #tag sendo usada | **EDITOR DE VERDADE** |
| 4 | 4,1s "Tarefas com alarme que toca mesmo com o app fechado." | Celular: aba Tarefas, criando tarefa com horário | **ALARME QUE TOCA** |
| 5 | 5,7s "E se você quiser, é só pedir: a inteligência artificial cria por você." | Celular: chat da IA → pedido → cartão "Permitir" → resultado | **E AINDA TEM IA ✨** |
| 6 | 4,6s "Tudo aparece no computador também. Sozinho." | PC (gravação real): mesma nota aparecendo/digitada | **PC = CELULAR** |
| 7 | 4,2s "Grátis, em português, e com backup encriptado." | Celular: pastas + modo escuro + tela de segurança | **GRÁTIS · SEGURO** |
| 8 | 4,5s "Baixe agora. O link está na descrição." | Card final com botão + seta | **BAIXE AGORA** → **loop** pro frame 1 |

**Total**: ~37s de narração + gaps = ~39s (dentro da faixa ideal 22-45s).

---

## 4. ROTEIRO DO VÍDEO LONGO (~4min, 1920x1080)

| Bloco | Tempo | Conteúdo | Fala (voz Antônio) |
|---|---|---|---|
| HOOK | 0:00-0:20 | Montagem rápida: as 4 funções em 4 cortes | "Eu usava quatro apps pra me organizar. Esse aqui substituiu todos — e roda no celular e no PC." |
| O PROBLEMA | 0:20-0:50 | B-roll: apps trocados, post-it, print perdido | "Nota num lugar, tarefa em outro, lista no papel... e nada se acha quando precisa." |
| TOUR 1 — NOTAS | 0:50-1:35 | Editor real: digitar, formatar, imagem, áudio, #tags | "Aqui as notas têm editor de verdade: negrito, listas, imagens, áudio e hashtags pra achar tudo depois." |
| TOUR 2 — LISTAS E PASTAS | 1:35-2:05 | Checklist marcando + pastas + busca com filtro | "Listas de compras que você marca item por item. Pastas pra organizar. E busca que acha." |
| TOUR 3 — TAREFAS | 2:05-2:35 | Tarefa com dia/hora + alarme | "Tarefas com recorrência e horário — e o alarme toca de verdade, mesmo com o app fechado." |
| IA (BÔNUS) | 2:35-3:05 | Chat da IA: pedir, cartão, confirmar | "E se você quiser, tem uma IA que FAZ: pede uma nota, uma tarefa, uma pasta... ela monta. Sempre com sua permissão." |
| SINCRONIZAÇÃO | 3:05-3:30 | Celular → PC (as duas gravações reais) | "Anotou no celular? Aparece no computador. Sozinho, sem configurar nada." |
| SEGURANÇA | 3:30-3:50 | PIN/biometria + backup encriptado | "Backup encriptado no seu Google Drive, bloqueio por PIN ou biometria." |
| CTA | 3:50-4:15 | Card final: download + pergunta | "Grátis, em português, sem anúncio chato. Baixa pelo link da descrição e me diz nos comentários qual função você mais gostou." |

---

## 5. THUMBNAILS (geradas com capturas reais)

- **Longo (1280x720)**: "TUDO EM 1 APP" amarelo + selo "GRÁTIS" + celular real + editor do PC + seta azul
- **Short (1080x1920)**: "PARE DE USAR 4 APPS" + "TUDO EM 1 SÓ APP" + celular real + 4 chips (NOTAS · LISTAS · TAREFAS · PASTAS) + "GRÁTIS · PC + CELULAR"

---

## 6. STATUS DA PRODUÇÃO (pipeline)

| Etapa | Status |
|---|---|
| Estratégia + pesquisa | ✅ `estrategia-videos.md` (este arquivo) |
| Thumbnails (2) | ✅ `marketing/thumb-*.png` |
| Narração do Short (8 linhas, voz Antônio) | ✅ `video/audio/short-NN.mp3` |
| Gravação real do PC (CDP screencast) | ✅ `video/clip-pc.mp4` (5,7s) |
| Gravação real do CELULAR (adb screenrecord) | ⏳ precisa do USB reconectado |
| Montagem final (ffmpeg) + legendas | ⏳ após a gravação do celular |
| Narração do vídeo longo | ⏳ próxima etapa |
| Música em alta | 👤 adicionar no app do YouTube na hora de postar (2 toques, ajuda no alcance) |

## 7. PUBLICAÇÃO

1. Postar o Short primeiro (com a música em alta do YouTube)
2. No dia seguinte, o vídeo longo (o Short já aqueceu os inscritos)
3. Mesmo vertical vai pro TikTok/Instagram Reels sem mudanças
4. Depois de 7 dias: olhar retenção — se cair nos 3s, testar outro hook
5. Thumbnails: usar Test and Compare do Studio (variar só a cor do texto)
