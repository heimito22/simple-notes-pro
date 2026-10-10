/* Reproduz o render dos cards com os DADOS REAIS do store local — caça o erro da tela preta. */
global.window = {};
require('./tags.js');
var T = window.TagsSync;
var fs = require('fs');
var store = JSON.parse(fs.readFileSync('C:/Users/Pichau/AppData/Roaming/simple-notes-pro-desktop/store.json', 'utf8'));
console.log('notas=' + (store.notas || []).length + ' listas=' + (store.listas || []).length + ' pastas=' + (store.pastas || []).length);

function esc(s) { return String(s || '').replace(/&/g, '&').replace(/</g, '<'); }

var erros = 0;
(store.notas || []).forEach(function (n, i) {
  try {
    var tags = T.extrairTags(n.conteudo || '');
    var prev = String(n.conteudo || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
    var chips = tags.map(function (tg) {
      var cor = T.corDaTag(tg);
      return '<span style="background:' + cor + '22;color:' + cor + '">#' + tg + '</span>';
    }).join('');
    var html = '<div>' + chips + (prev ? '<b>' + esc(prev) + '</b>' : '—') + '</div>';
    if (html.length < 1) throw new Error('html vazio');
  } catch (e) {
    erros++;
    console.log('ERRO nota[' + i + '] id=' + (n && n.id) + ': ' + e.message);
  }
});
console.log('ERROS_NAS_NOTAS=' + erros);

(store.listas || []).forEach(function (l, i) {
  try { T.extrairTags(l.titulo || ''); } catch (e) { console.log('ERRO lista[' + i + ']: ' + e.message); }
});
console.log('OK_LISTAS');

// E o catálogo (o que os chips mostram):
console.log('CATALOGO:', JSON.stringify(T.tagsDeItens(store.notas || []).slice(0, 10)));
