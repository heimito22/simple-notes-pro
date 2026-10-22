**Versão 1.5.34**

- Corrige a corrida que criava uma **chave provisória** quando a listagem do Drive falhava: agora um erro de rede cancela o envio em vez de criar outra chave
- Antes de sobrescrever o backup, o PC confere se a chave local realmente abre o v2; se não abrir, pede o código correto — **nunca gera dois códigos**
- Se o backup remoto for de outra chave, o app pede o código em vez de ficar num beco sem saída
- Mantém a cópia local do v1 antes da migração e todas as proteções da 1.5.33
