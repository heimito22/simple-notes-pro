**Versão 1.5.32**

- Corrige o desbloqueio da chave ao **trocar de conta**: um código da conta A não pode mais ser salvo no cofre da conta B
- O envelope pendente fica amarrado à conta que o baixou; se a conta mudar, ele é descartado
- Mantém todo o backup v2 da 1.5.31 (chave aleatória, código de recuperação, AES-256 + HMAC, fail-closed, migração e anti-downgrade)
