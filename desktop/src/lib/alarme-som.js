// Alarme sonoro no renderer — Web Audio puro, sem arquivos (não depende de assets).
// Cada "som" é um padrão de osciladores. Toca em loop até parar().
(function(root){
  var ctx=null, nodes=[], timer=null;
  function getCtx(){
    if(!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if(ctx.state==='suspended') ctx.resume().catch(function(){});
    return ctx;
  }
  var PATTERNS={
    classico: [{freq:880,dur:0.12,gap:0.12, type:'sine'},{freq:880,dur:0.12,gap:0.5,type:'sine'}],
    digital: [{freq:1200,dur:0.08,gap:0.08,type:'square'},{freq:1500,dur:0.08,gap:0.4,type:'square'}],
    suave: [{freq:523,dur:0.4,gap:0.15,type:'sine'},{freq:659,dur:0.4,gap:0.15,type:'sine'},{freq:784,dur:0.6,gap:0.8,type:'sine'}],
    urgente: [{freq:1000,dur:0.1,gap:0.05,type:'square'},{freq:1000,dur:0.1,gap:0.05,type:'square'},{freq:1000,dur:0.1,gap:0.6,type:'square'}],
    eco: [{freq:600,dur:0.18,gap:0.22,type:'sine'},{freq:450,dur:0.35,gap:0.7,type:'sine'}],
    ondas: [{freq:330,dur:0.6,gap:0.25,type:'triangle'},{freq:392,dur:0.6,gap:1.2,type:'triangle'}],
  };
  function beep(c, freq, dur, type){
    var o=c.createOscillator(), g=c.createGain();
    o.type=type||'sine'; o.frequency.value=freq;
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(0.85, c.currentTime+0.02);
    g.gain.exponentialRampToValueAtTime(0.01, c.currentTime+dur);
    o.connect(g).connect(c.destination);
    o.start(); o.stop(c.currentTime+dur);
    nodes.push(o,g);
  }
  function loop(pattern){
    var c=getCtx();
    var t=0;
    pattern.forEach(function(p){
      setTimeout(function(){ try{ beep(getCtx(), p.freq, p.dur, p.type);}catch(e){} }, t*1000);
      t += p.dur + p.gap;
    });
    timer=setTimeout(function(){ if(timer) loop(pattern); }, t*1000);
  }
  function tocar(chave){
    parar();
    var pat=PATTERNS[chave]||PATTERNS.classico;
    loop(pat);
  }
  function parar(){
    if(timer){ clearTimeout(timer); timer=null; }
    nodes.forEach(function(n){ try{ n.disconnect(); }catch(e){} });
    nodes=[];
  }
  root.alarmeSom={ tocar: tocar, parar: parar, PATTERNS: PATTERNS };
})(typeof self!=='undefined'?self:this);
