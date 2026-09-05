package com.seuusuario.simplesnotes.alarm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat

/**
 * Disparado pelo AlarmManager na hora do alarme:
 * 1. Reagenda a próxima ocorrência (diária/semanal) — funciona com o app fechado.
 * 2. Guarda o alarme para o JS buscar ao abrir.
 * 3. Emite broadcast para o módulo (caso o app esteja rodando).
 * 4. Tenta abrir o POPUP direto (startActivity) — Android ≤13 com permissão de sobreposição.
 * 5. Fallback: notificação fullScreenIntent (abre o app em tela cheia, mesmo bloqueado).
 */
class AlarmTriggerReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    val key = intent.getStringExtra(AlarmScheduler.EXTRA_KEY) ?: return
    val tarefaId = intent.getStringExtra(AlarmScheduler.EXTRA_TAREFA_ID) ?: return
    val titulo = intent.getStringExtra(AlarmScheduler.EXTRA_TITULO) ?: "Tarefa"
    val recorrencia = intent.getStringExtra(AlarmScheduler.EXTRA_RECORRENCIA) ?: "Uma vez"
    val horario = intent.getStringExtra(AlarmScheduler.EXTRA_HORARIO) ?: ""
    val tipo = intent.getStringExtra(AlarmScheduler.EXTRA_TIPO) ?: "tarefa"

    // 1. Reagenda a próxima ocorrência. "Uma vez" (e sonecas) não re-arma.
    if (recorrencia != "Uma vez" && horario.isNotEmpty()) {
      val proximo = AlarmScheduler.proximoDisparo(recorrencia, horario)
      if (proximo > 0) {
        AlarmScheduler.schedule(context, key, tarefaId, titulo, proximo, recorrencia, horario, tipo)
      }
    } else {
      AlarmStore.remove(context, key)
    }

    // Lembretes de revisão de nota também usam o alarme COMPLETO das tarefas
    // (popup com som/vibração e os botões Vou fazer / Soneca / Deixar para depois)

    // 2. Guarda o alarme para o JS abrir o overlay ao iniciar
    AlarmStore.saveLaunch(context, tarefaId, titulo, tipo)

    // 3. Avisa o JS (se o app estiver rodando)
    try {
      context.sendBroadcast(
        Intent(AlarmScheduler.ACTION_ALARM_FIRED).apply {
          setPackage(context.packageName)
          putExtra(AlarmScheduler.EXTRA_TAREFA_ID, tarefaId)
          putExtra(AlarmScheduler.EXTRA_TITULO, titulo)
          putExtra(AlarmScheduler.EXTRA_TIPO, tipo)
        }
      )
    } catch (_: Exception) {
      // ignora — o fullScreenIntent cuida do caso do app fechado
    }

    // Som selecionado pelo usuário + volume de alarme no MÁXIMO (despertador de verdade)
    val som = AlarmSound.somAtual(context)
    AlarmSound.forcarVolumeMaximo(context)

    // 4. Tenta abrir o POPUP direto (sem depender da notificação):
    //    - Android 9 e anteriores: abrir em background é sempre permitido.
    //    - Android 10-13: permitido se o app tem permissão de sobreposição
    //      (MIUI "Exibir pop-ups em segundo plano" / Android "Exibir sobre outros apps").
    //    - Android 14+: o sistema bloqueia — só o fullScreenIntent abre (se permitido).
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      putExtra(AlarmScheduler.EXTRA_TAREFA_ID, tarefaId)
      putExtra(AlarmScheduler.EXTRA_TITULO, titulo)
      putExtra(AlarmScheduler.EXTRA_TIPO, tipo)
    }

    // Tenta abrir o POPUP direto (sem notificação) quando o sistema permite:
    //  - Android 9 e anteriores: abrir em background é sempre permitido.
    //  - Android 10+ (inclusive 14): permitido se o app tem a permissão de
    //    sobreposição (SYSTEM_ALERT_WINDOW é exceção de BAL) — no Xiaomi é o
    //    "Exibir pop-ups em segundo plano", no Android "Exibir sobre outros apps".
    //    Com essa permissão o app abre por cima de TUDO, mesmo com a tela ligada
    //    e destravada. Com showWhenLocked na MainActivity, abre também bloqueado.
    //  - Sem essa permissão: cai na notificação fullScreenIntent (tela cheia só
    //    com a tela bloqueada/desligada; com a tela ligada vira aviso no topo).
    var abriuDireto = false
    if (launchIntent != null) {
      val podeAbrirEmBackground =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.R ||
          Settings.canDrawOverlays(context)
      if (podeAbrirEmBackground) {
        try {
          context.startActivity(launchIntent)
          abriuDireto = true
        // Toca o som via AlarmManager stream (backup: o overlay também toca ao abrir)
        AlarmSound.tocar(context, som)
        } catch (_: Exception) {
          // bloqueado pelo sistema/ROM — cai na notificação fullScreenIntent
        }
      }
    }

    // 5. Se não abriu direto, mostra a notificação (fullScreenIntent abre o app em tela cheia)
    if (!abriuDireto) {
      postAlarmNotification(context, tarefaId, titulo, launchIntent, som, tipo)
    }
  }

  private fun postAlarmNotification(context: Context, tarefaId: String, titulo: String, launchIntent: Intent?, som: String, tipo: String) {
    val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    // Cria um canal POR SOM (o som de um canal não pode mudar depois de criado).
    // O canal toca no stream de ALARME (USAGE_ALARM) — usa o volume de alarme do
    // celular, independente do modo silencioso. O volume é forçado ao máximo no disparo.
    val audioAlarme = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    val somUri = AlarmSound.uriDoSom(context, som)
    // O som de um canal não muda depois de criado. Para o som próprio, que o
    // usuário pode trocar, o canal leva a VERSÃO — cada troca gera um canal novo.
    val canalId = AlarmScheduler.CHANNEL_ID + "_" + som +
      (if (som == "personalizado") "_" + AlarmSound.versaoPersonalizado(context) else "")

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val canal = NotificationChannel(
        canalId,
        "Alarme de tarefas",
        NotificationManager.IMPORTANCE_MAX
      ).apply {
        description = "Alarme em tela cheia para as tarefas"
        setSound(somUri ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), audioAlarme)
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 500, 300, 500, 900)
        lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
      }
      notificationManager.createNotificationChannel(canal)
    }

    val contentIntent = launchIntent?.let {
      PendingIntent.getActivity(
        context,
        tarefaId.hashCode(),
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }

    val builder = NotificationCompat.Builder(context, canalId)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle(titulo)
      .setContentText(
        if (tipo == "lembrete") "Está na hora de revisar esta nota!" else "Está na hora de fazer isso!"
      )
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setAutoCancel(true)
      .setContentIntent(contentIntent)

    // Android 14+: sem a permissão especial, o fullScreenIntent degrada para heads-up
    val podeTelaCheia = Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
      notificationManager.canUseFullScreenIntent()

    if (podeTelaCheia && contentIntent != null) {
      builder.setFullScreenIntent(contentIntent, true)
    }

    val notificacao = builder.build()
    // FLAG_INSISTENT: o som/vibração continuam tocando (igual a um despertador)
    // até o usuário agir. Quando o app abre (fullScreenIntent/overlay), a
    // notificação é dispensada e o overlay assume o som próprio em loop.
    notificacao.flags = notificacao.flags or android.app.Notification.FLAG_INSISTENT
    notificationManager.notify(AlarmScheduler.NOTIFICATION_ID_BASE, notificacao)
  }
}
