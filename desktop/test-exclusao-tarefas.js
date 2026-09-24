// Prova: tarefa excluída no PC fica excluída no celular (tombstone no push do PC)
global.self = global;
require('./src/lib/tombstones.js');
const T = global.self.Tombstones;

// 1) Tarefa t1 excluída no PC agora → tombstone registrado
T.registrar('t1');

// 2) Backup do PC enviado ao Drive inclui os apagados
const payloadPc = { tarefas: [], apagados: T.serializar() };
console.log('T1 apagados no payload:', JSON.stringify(payloadPc.apagados));

// 3) Celular carrega os tombstones do backup e faz o merge:
//    local tinha t1 (velha, ainda não sabia da exclusão) e t2 (nova, criada agora)
T.carregar(payloadPc.apagados);
const locaisCelular = [
  { id: 't1', titulo: 'Tarefa excluída no PC', data: '2026-09-01' },
  { id: 't2', titulo: 'Tarefa nova do celular', data: '2026-09-12' },
];
const remotos = [];
const mesclado = T.aplicar(remotos, locaisCelular);
console.log('T2 t1 excluída persiste:', !mesclado.some(t => t.id === 't1'));
console.log('T3 t2 (nova, sem tombstone) mantida:', mesclado.some(t => t.id === 't2'));

// 4) Inverso: celular excluiu t3 → PC recebe tombstone e não ressuscita
T.registrar('t3');
const backupCelular = { tarefas: [{ id: 't9', titulo: 'outra' }], apagados: T.serializar() };
T.carregar(backupCelular.apagados);
const locaisPc = [{ id: 't3', titulo: 'Tarefa excluída no celular', data: '2026-09-01' }];
const noPc = T.aplicar(backupCelular.tarefas, locaisPc);
console.log('T4 t3 não ressuscita no PC:', !noPc.some(t => t.id === 't3'));

// 5) Editada depois da exclusão volta (conflito por tempo)
T.registrar('t5');
const remotoEditado = [{ id: 't5', titulo: 'editada depois', data: new Date(Date.now() + 1000).toISOString() }];
const comEdicao = T.aplicar(remotoEditado, []);
console.log('T5 editada-depois-da-exclusão vence:', comEdicao.some(t => t.id === 't5'));
