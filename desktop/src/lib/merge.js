/**
 * CARIMBO e MERGE no PC.
 *
 * A POLÍTICA de merge (quem vence o conflito, o que um tombstone faz) vive em
 * politica-sync.js — a mesma fonte que o celular usa. Aqui ficam só as duas
 * partes que são DO DESKTOP:
 *
 *  1. o snapshot em memória, que faz o carimbo ser preciso: `carimbarAlterados`
 *     compara com o último estado conhecido e marca `dataModificacao` só no que
 *     mudou de verdade — abrir o app não "modifica" nada.
 *  2. a exposição de `window.Merge`, que o app.js já consome.
 *
 * Antes o merge era "remoto vence" (o backup sobrescrevia a versão local de
 * qualquer item existente nos dois lados) e a edição feita antes do push chegar
 * era descartada pelo primeiro pull — "minhas alterações não salvam".
 */
(function (root) {
  var P = root.PoliticaSync;
  var CAMPOS = ['notas', 'listas', 'pastas', 'tarefas'];
  var snapshot = {}; // id -> JSON do item como o app já conhece

  /** Itens que aparecem no store mas não no snapshot (pós-boot/merge). */
  function registrar(store) {
    CAMPOS.forEach(function (k) {
      (store && store[k] || []).forEach(function (it) {
        if (!it || it.id == null) return;
        snapshot[String(it.id)] = JSON.stringify(it);
      });
    });
  }
  function reset() { snapshot = {}; }

  /** Carimba com `agora` os itens cujo conteúdo mudou desde o último snapshot. */
  function carimbarAlterados(store) {
    var agora = Date.now(), alterados = 0;
    CAMPOS.forEach(function (k) {
      (store && store[k] || []).forEach(function (it) {
        if (!it || it.id == null) return;
        var id = String(it.id);
        if (snapshot[id] === JSON.stringify(it)) return; // nada mudou
        it.dataModificacao = agora;
        snapshot[id] = JSON.stringify(it);
        alterados++;
      });
    });
    return alterados;
  }

  /** Mescla remotos + locais aplicando os tombstones do PC. */
  function mesclar(remotos, locais) {
    return P.mesclarPorItem(remotos, locais, root.Tombstones);
  }

  root.Merge = {
    CAMPOS: CAMPOS, tsDe: P.tsDoItem, registrar: registrar, reset: reset,
    carimbarAlterados: carimbarAlterados, mesclar: mesclar,
  };
})(window);
