package com.seuusuario.simplesnotes.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.util.Calendar

/**
 * Agenda/cancela alarmes exatos via AlarmManager (funcionam com o app fechado)
 * e reagenda todos os alarmes persistidos (ex.: após reiniciar o celular).
 */
object AlarmScheduler {
  const val ACTION_ALARM_FIRED = "com.seuusuario.simplesnotes.alarm.ACTION_ALARM_FIRED"

  const val EXTRA_KEY = "key"
  const val EXTRA_TAREFA_ID = "tarefaId"
  const val EXTRA_TITULO = "titulo"
  const val EXTRA_RECORRENCIA = "recorrencia"
  const val EXTRA_HORARIO = "horario"
  const val EXTRA_TIMESTAMP = "timestamp"
  const val EXTRA_TIPO = "tipo"

  // v2: canal novo com importância MÁXIMA (Importance.MAX) para o popup fullScreen
  const val CHANNEL_ID = "alarme_tarefas_v2"
  const val NOTIFICATION_ID_BASE = 9001

  fun schedule(
    context: Context,
    key: String,
    tarefaId: String,
    titulo: String,
    timestampMs: Long,
    recorrencia: String,
    horario: String,
    tipo: String = "tarefa"
  ) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pendingIntent = buildPendingIntent(context, key, tarefaId, titulo, recorrencia, horario, timestampMs, tipo)

    try {
      // Android 12+: sem permissão de alarme exato, usa inexato (pode atrasar alguns minutos)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, timestampMs, pendingIntent)
      } else {
        alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, timestampMs, pendingIntent)
      }
    } catch (_: SecurityException) {
      alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, timestampMs, pendingIntent)
    }

    AlarmStore.save(context, key, tarefaId, titulo, timestampMs, recorrencia, horario, tipo)
  }

  fun cancel(context: Context, key: String) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pendingIntent = buildPendingIntent(context, key, "", "", "", "", 0L, "")
    alarmManager.cancel(pendingIntent)
    AlarmStore.remove(context, key)
  }

  /** Próxima ocorrência futura (ms) de uma recorrência. Retorna 0 se inválida. */
  fun proximoDisparo(recorrencia: String, horario: String): Long {
    val partes = horario.split(":")
    if (partes.size < 2) return 0L
    val hora = partes[0].toIntOrNull() ?: return 0L
    val minuto = partes[1].toIntOrNull() ?: return 0L

    val agora = Calendar.getInstance()
    val alvo = Calendar.getInstance().apply {
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
      set(Calendar.HOUR_OF_DAY, hora)
      set(Calendar.MINUTE, minuto)
    }

    if (recorrencia == "Diária") {
      if (alvo.timeInMillis <= agora.timeInMillis) alvo.add(Calendar.DAY_OF_YEAR, 1)
    } else if (recorrencia.startsWith("A cada")) {
      // "A cada N dias": mantém o mesmo horário, pulando N dias a partir de agora.
      // O alarme dispara no horário, então agora ≈ horário — o próximo fica em ~N dias.
      val n = recorrencia.filter { it.isDigit() }.toIntOrNull() ?: return 0L
      if (n <= 0) return 0L
      if (alvo.timeInMillis <= agora.timeInMillis) alvo.add(Calendar.DAY_OF_YEAR, 1)
      alvo.add(Calendar.DAY_OF_YEAR, n - 1)
    } else {
      val dias = mapOf(
        "Domingo" to Calendar.SUNDAY,
        "Segunda" to Calendar.MONDAY,
        "Terça" to Calendar.TUESDAY,
        "Quarta" to Calendar.WEDNESDAY,
        "Quinta" to Calendar.THURSDAY,
        "Sexta" to Calendar.FRIDAY,
        "Sábado" to Calendar.SATURDAY
      )
      val diaAlvo = dias[recorrencia] ?: return 0L
      var diff = (diaAlvo - alvo.get(Calendar.DAY_OF_WEEK) + 7) % 7
      if (diff == 0) diff = 7 // o de hoje já tocou — sempre a próxima semana
      alvo.add(Calendar.DAY_OF_YEAR, diff)
      if (alvo.timeInMillis <= agora.timeInMillis) alvo.add(Calendar.DAY_OF_YEAR, 7)
    }
    return alvo.timeInMillis
  }

  /**
   * Reagenda todos os alarmes persistidos após o boot.
   * Recorrências que venceram com o celular desligado são reagendadas para a
   * próxima ocorrência futura (em vez de serem descartadas); pontuais vencidas são removidas.
   */
  fun rearmAll(context: Context) {
    val agora = System.currentTimeMillis()
    val lista = AlarmStore.getAll(context)
    for (i in 0 until lista.length()) {
      val item = lista.optJSONObject(i) ?: continue
      val key = item.optString("key", "")
      if (key.isEmpty()) continue
      val tarefaId = item.optString("tarefaId", "")
      val titulo = item.optString("titulo", "Tarefa")
      val recorrencia = item.optString("recorrencia", "Uma vez")
      val horario = item.optString("horario", "")
      val tipo = item.optString("tipo", "tarefa")
      var timestamp = item.optLong("timestamp", 0L)

      if (timestamp <= agora) {
        if (recorrencia == "Uma vez") {
          // Pontual vencida enquanto o celular estava desligado — descarta
          AlarmStore.remove(context, key)
          continue
        }
        val proximo = proximoDisparo(recorrencia, horario)
        if (proximo <= 0) {
          AlarmStore.remove(context, key)
          continue
        }
        timestamp = proximo
      }

      schedule(context, key, tarefaId, titulo, timestamp, recorrencia, horario, tipo)
    }
  }

  private fun buildPendingIntent(
    context: Context,
    key: String,
    tarefaId: String,
    titulo: String,
    recorrencia: String,
    horario: String,
    timestampMs: Long,
    tipo: String
  ): PendingIntent {
    val intent = Intent(context, AlarmTriggerReceiver::class.java).apply {
      putExtra(EXTRA_KEY, key)
      putExtra(EXTRA_TAREFA_ID, tarefaId)
      putExtra(EXTRA_TITULO, titulo)
      putExtra(EXTRA_RECORRENCIA, recorrencia)
      putExtra(EXTRA_HORARIO, horario)
      putExtra(EXTRA_TIMESTAMP, timestampMs)
      putExtra(EXTRA_TIPO, tipo)
    }
    return PendingIntent.getBroadcast(
      context,
      key.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }
}
