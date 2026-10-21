**Versão 1.5.31**

- Backup no Drive agora usa uma **chave aleatória de 256 bits** guardada no cofre do Windows (DPAPI) — não depende mais do e-mail da conta
- **Código de recuperação** de 32 caracteres abre o backup em outro aparelho: Ajustes → Chave de segurança
- Criptografia **autenticada** (AES-256 + HMAC): qualquer alteração no backup é detectada e recusada
- **Nunca sobe backup em claro**: se a criptografia falhar, o envio é cancelado e você é avisado
- **Migração automática** dos backups antigos já no primeiro sync; depois que a chave nova existe, backup antigo/sem proteção é recusado (anti-downgrade)
- Atualize o PC e o celular juntos: o primeiro aparelho mostra o código, o segundo pede uma vez
