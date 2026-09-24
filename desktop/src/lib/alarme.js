// Único dono do cálculo de próximo disparo (main + renderer file:// compatível)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.proximoDisparo = factory().proximoDisparo;
}(typeof self !== 'undefined' ? self : this, function () {
  function proximoDisparo(recorrencia, horario) {
    if (!horario) return null;
    var m = String(horario).match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    var h = parseInt(m[1], 10), mn = parseInt(m[2], 10);
    var agora = new Date(), alvo = new Date();
    alvo.setHours(h, mn, 0, 0);
    if (recorrencia === 'Diária' || recorrencia === 'Uma vez') {
      if (alvo.getTime() <= agora.getTime()) alvo.setDate(alvo.getDate() + 1);
    } else {
      var dias = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
      var diff = (dias.indexOf(recorrencia) - agora.getDay() + 7) % 7;
      alvo.setDate(alvo.getDate() + diff);
      if (alvo.getTime() <= agora.getTime()) alvo.setDate(alvo.getDate() + 7);
    }
    return alvo.getTime();
  }
  return { proximoDisparo: proximoDisparo };
}));
