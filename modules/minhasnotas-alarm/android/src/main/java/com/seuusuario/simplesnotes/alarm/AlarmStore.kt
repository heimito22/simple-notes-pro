package com.seuusuario.simplesnotes.alarm

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Persistência dos alarmes em SharedPreferences.
 * Necessária para reagendar após reiniciar o celular (os alarmes do AlarmManager
 * são limpos no reboot) e para entregar ao JS o alarme que abriu o app.
 */
object AlarmStore {
  private const val PREFS = "minhasnotas_alarmes"
  private const val KEY_ALARMES = "alarmes"
  private const val KEY_LAUNCH = "launch_alarm"

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun save(
    context: Context,
    key: String,
    tarefaId: String,
    titulo: String,
    timestampMs: Long,
    recorrencia: String,
    horario: String,
    tipo: String = "tarefa"
  ) {
    val lista = getAll(context)
    val nova = JSONArray()
    for (i in 0 until lista.length()) {
      val item = lista.optJSONObject(i) ?: continue
      if (item.optString("key") != key) nova.put(item)
    }
    nova.put(
      JSONObject().apply {
        put("key", key)
        put("tarefaId", tarefaId)
        put("titulo", titulo)
        put("timestamp", timestampMs)
        put("recorrencia", recorrencia)
        put("horario", horario)
        put("tipo", tipo)
      }
    )
    prefs(context).edit().putString(KEY_ALARMES, nova.toString()).apply()
  }

  fun remove(context: Context, key: String) {
    val lista = getAll(context)
    val nova = JSONArray()
    for (i in 0 until lista.length()) {
      val item = lista.optJSONObject(i) ?: continue
      if (item.optString("key") != key) nova.put(item)
    }
    prefs(context).edit().putString(KEY_ALARMES, nova.toString()).apply()
  }

  fun getAll(context: Context): JSONArray {
    val raw = prefs(context).getString(KEY_ALARMES, "[]") ?: "[]"
    return try {
      JSONArray(raw)
    } catch (_: Exception) {
      JSONArray()
    }
  }

  /** Guarda qual alarme abriu o app (para o JS buscar ao iniciar). */
  fun saveLaunch(context: Context, tarefaId: String, titulo: String, tipo: String = "tarefa") {
    val payload = JSONObject().apply {
      put("tarefaId", tarefaId)
      put("titulo", titulo)
      put("tipo", tipo)
    }.toString()
    prefs(context).edit().putString(KEY_LAUNCH, payload).apply()
  }

  /** Há um alarme pendente que abriu (ou vai abrir) o app? (sem consumir) */
  fun temLaunchPendente(context: Context): Boolean =
    prefs(context).getString(KEY_LAUNCH, null) != null

  /** Lê e limpa o alarme pendente. */
  fun consumeLaunch(context: Context): Map<String, String>? {
    val raw = prefs(context).getString(KEY_LAUNCH, null) ?: return null
    prefs(context).edit().remove(KEY_LAUNCH).apply()
    return try {
      val obj = JSONObject(raw)
      mapOf(
        "tarefaId" to obj.optString("tarefaId"),
        "titulo" to obj.optString("titulo", "Tarefa"),
        "tipo" to obj.optString("tipo", "tarefa")
      )
    } catch (_: Exception) {
      null
    }
  }
}
