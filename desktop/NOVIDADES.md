**Versão 1.5.33**

- Antes de migrar o backup antigo (v1) para o novo (v2), o PC guarda uma **cópia local** em `backup_v1_<data>.json` na pasta de dados do app — dá para voltar atrás se algo der errado
- Mantém as correções da 1.5.32: desbloqueio da chave amarrado à conta (troca de conta não mistura cofres) e todo o backup v2 (chave aleatória, código de recuperação, AES-256 + HMAC, fail-closed e anti-downgrade)
