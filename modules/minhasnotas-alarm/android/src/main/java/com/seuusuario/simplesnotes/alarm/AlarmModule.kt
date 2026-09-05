package com.seuusuario.simplesnotes.alarm

import android.app.AlarmManager
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.app.KeyguardManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Ponte JS <-> nativa do alarme em tela cheia (Android).
 *
 * - scheduleAlarm / cancelAlarm: Agenda/cancela o alarme exato (AlarmManager).
 * - getLaunchAlarm: Retorna o alarme que abriu o app (ex.: via fullScreenIntent).
 * - onAlarmFired: Evento emitido quando o alarme dispara com o app rodando.
 * - Funções de permissão (tela cheia, bateria, sobreposição, Xiaomi): usadas pela
 *   tela "Permissões do alarme".
 */
class AlarmModule : Module() {

  private val context: Context?
    get() = appContext.reactContext

  override fun definition() = ModuleDefinition {
    Name("MinhasNotasAlarm")

    Events("onAlarmFired")

    AsyncFunction("scheduleAlarm") { key: String, tarefaId: String, titulo: String, timestampMs: Double, recorrencia: String, horario: String, tipo: String ->
      context?.let {
        AlarmScheduler.schedule(it, key, tarefaId, titulo, timestampMs.toLong(), recorrencia, horario, tipo)
      }
    }

    AsyncFunction("cancelAlarm") { key: String ->
      context?.let { AlarmScheduler.cancel(it, key) }
    }

    AsyncFunction("getLaunchAlarm") {
      context?.let { AlarmStore.consumeLaunch(it) }
    }

    // --- SOM DO ALARME (personalizado + volume máximo / stream de alarme) ---

    // Salva o som escolhido pelo usuário (usado na hora do disparo, app fechado)
    AsyncFunction("definirSomAlarme") { nome: String ->
      context?.let { AlarmSound.definir(it, nome) }
    }

    // Toca o som em loop no stream de ALARME com volume MÁXIMO (app aberto/overlay)
    AsyncFunction("tocarSom") { nome: String ->
      context?.let { AlarmSound.tocar(it, nome) }
    }

    // Prévia única (seletor de sons) — sem forçar volume
    AsyncFunction("previewSom") { nome: String ->
      context?.let { AlarmSound.preview(it, nome) }
    }

    // Para o som e restaura o volume de alarme anterior
    AsyncFunction("pararSom") {
      context?.let { AlarmSound.parar(it) }
    }

    // SOM PRÓPRIO: abre o seletor de arquivos de áudio (SAF), copia para o app
    // e salva como som personalizado. Retorna { cancelado } ou { nome }.
    AsyncFunction("escolherSomPersonalizado") Coroutine { ->
      if (appContext.currentActivity == null) {
        return@Coroutine mapOf("cancelado" to true, "erro" to "Sem atividade em primeiro plano")
      }
      val uri = somLauncher.launch(SomAudioRequest())
      if (uri == null) return@Coroutine mapOf("cancelado" to true)
      val ctx = context ?: return@Coroutine mapOf("cancelado" to true, "erro" to "Sem contexto")
      // Cópia do arquivo em thread de I/O (arquivos grandes não travam a UI)
      val resultado = withContext(Dispatchers.IO) {
        AlarmSound.salvarPersonalizado(ctx, uri)
      }
      if (!resultado.ok) {
        return@Coroutine mapOf("cancelado" to false, "erro" to (resultado.erro ?: "Erro ao copiar o arquivo"))
      }
      mapOf("cancelado" to false, "nome" to (resultado.nome ?: "Meu som"))
    }

    // Remove o som personalizado (arquivo + preferências)
    AsyncFunction("removerSomPersonalizado") {
      context?.let { AlarmSound.removerPersonalizado(it) }
    }

    // Há um som personalizado salvo?
    AsyncFunction("temSomPersonalizado") {
      context?.let { AlarmSound.temPersonalizado(it) } ?: false
    }

    RegisterActivityContracts {
      somLauncher = registerForActivityResult(SomAudioContract()) { _, _ -> }
    }

    AsyncFunction("canUseFullScreenIntent") {
      val ctx = context ?: return@AsyncFunction false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.canUseFullScreenIntent()
      } else {
        true
      }
    }

    // Abre o acesso especial "Tela cheia" do Android 14+
    AsyncFunction("openFullScreenIntentSettings") {
      val ctx = context
      if (ctx != null) {
        try {
          ctx.startActivity(
            Intent(
              "android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT",
              Uri.parse("package:${ctx.packageName}")
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          )
        } catch (_: Exception) {
          // dispositivo/ROM sem essa tela de configurações
        }
      }
    }

    // --- PERMISSÕES (tela de permissões do alarme) ---

    // Android 12+: verifica se alarmes exatos estão liberados (sem atraso)
    AsyncFunction("canScheduleExactAlarms") {
      val ctx = context ?: return@AsyncFunction false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.canScheduleExactAlarms()
      } else {
        true
      }
    }

    AsyncFunction("openExactAlarmSettings") {
      val ctx = context
      if (ctx != null) {
        try {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ctx.startActivity(
              Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${ctx.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
          } else {
            openAppDetails(ctx)
          }
        } catch (_: Exception) {
          openAppDetails(ctx)
        }
      }
    }

    // Verifica se o app está isento da otimização de bateria
    AsyncFunction("isIgnoringBatteryOptimizations") {
      val ctx = context ?: return@AsyncFunction false
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(ctx.packageName)
    }

    AsyncFunction("openBatteryOptimizationSettings") {
      val ctx = context
      if (ctx != null) {
        try {
          ctx.startActivity(
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}"))
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          )
        } catch (_: Exception) {
          try {
            ctx.startActivity(
              Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
          } catch (_: Exception) {
            openAppDetails(ctx)
          }
        }
      }
    }

    // Sobreposição: Android "Exibir sobre outros apps" / MIUI "Exibir pop-ups em segundo plano"
    AsyncFunction("canShowOverlays") {
      val ctx = context ?: return@AsyncFunction false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        Settings.canDrawOverlays(ctx)
      } else {
        true
      }
    }

    AsyncFunction("openOverlaySettings") {
      val ctx = context
      if (ctx != null) {
        try {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            ctx.startActivity(
              Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
          } else {
            openAppDetails(ctx)
          }
        } catch (_: Exception) {
          openAppDetails(ctx)
        }
      }
    }

    AsyncFunction("openNotificationSettings") {
      val ctx = context
      if (ctx != null) {
        try {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startActivity(
              Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
          } else {
            openAppDetails(ctx)
          }
        } catch (_: Exception) {
          openAppDetails(ctx)
        }
      }
    }

    // Detecta MIUI / HyperOS (Xiaomi, Redmi, POCO)
    AsyncFunction("isXiaomi") {
      val marca = (Build.MANUFACTURER ?: "") + " " +
        (Build.BRAND ?: "") + " " +
        (Build.DEVICE ?: "") + " " +
        (Build.MODEL ?: "")
      val m = marca.lowercase()
      m.contains("xiaomi") || m.contains("redmi") || m.contains("poco") ||
        m.contains("blackshark") || temPropriedadeMiui()
    }

    // MIUI "Iniciar automaticamente" (Autostart) — best-effort com fallback
    AsyncFunction("openAutostartSettings") {
      val ctx = context
      if (ctx != null) {
        val tentativas = listOf(
          Intent("miui.intent.action.OP_AUTO_START").apply {
            setPackage("com.miui.securitycenter")
            putExtra("miui.intent.extra.PACKAGE_NAME", ctx.packageName)
          },
          Intent().apply {
            component = ComponentName(
              "com.miui.securitycenter",
              "com.miui.permcenter.autostart.AutoStartManagementActivity"
            )
            putExtra("miui.intent.extra.PACKAGE_NAME", ctx.packageName)
          }
        )
        val abriu = tentativas.any { intent ->
          try {
            ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
          } catch (_: Exception) {
            false
          }
        }
        if (!abriu) openAppDetails(ctx)
      }
    }

    // MIUI editor de permissões ("Exibir pop-ups em segundo plano" etc.) — best-effort
    AsyncFunction("openMiuiPermissionEditor") {
      val ctx = context
      if (ctx != null) {
        val tentativas = listOf(
          Intent("miui.intent.action.APP_PERM_EDITOR").apply {
            setPackage("com.miui.securitycenter")
            putExtra("extra_pkgname", ctx.packageName)
          },
          Intent("miui.intent.action.APP_PERM_EDITOR").apply {
            component = ComponentName(
              "com.miui.permcenter",
              "com.miui.permcenter.permissions.PermissionsEditorActivity"
            )
            putExtra("extra_pkgname", ctx.packageName)
          }
        )
        val abriu = tentativas.any { intent ->
          try {
            ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
          } catch (_: Exception) {
            false
          }
        }
        if (!abriu) openAppDetails(ctx)
      }
    }

    OnCreate {
      val ctx = context ?: return@OnCreate
      try {
        // Android 14+ exige RECEIVER_NOT_EXPORTED/RECEIVER_EXPORTED em receivers de contexto
        ctx.registerReceiver(
          firedReceiver,
          IntentFilter(AlarmScheduler.ACTION_ALARM_FIRED),
          Context.RECEIVER_NOT_EXPORTED
        )
      } catch (_: Exception) {
        // já registrado ou contexto indisponível
      }
      // Se o app NÃO abriu pelo alarme (ex.: usuário abriu normal depois de o
      // alarme ter sido forçado ao máximo), restaura o volume de alarme anterior.
      // Quando abre pelo alarme, o overlay re-força o volume ao tocar.
      try {
        if (!AlarmStore.temLaunchPendente(ctx)) {
          AlarmSound.restaurarVolume(ctx)
        }
      } catch (_: Exception) {
        // ignora
      }
    }

    OnDestroy {
      try {
        context?.unregisterReceiver(firedReceiver)
      } catch (_: Exception) {
        // não registrado
      }
    }
  }

  private fun openAppDetails(ctx: Context) {
    try {
      ctx.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    } catch (_: Exception) {
      // sem tela de configurações disponível
    }
  }

  private fun temPropriedadeMiui(): Boolean {
    return try {
      val clazz = Class.forName("android.os.SystemProperties")
      val method = clazz.getMethod("get", String::class.java)
      val valor = method.invoke(null, "ro.miui.ui.version.name") as? String
      val temMiui = !valor.isNullOrEmpty()
      temMiui
    } catch (_: Exception) {
      false
    }
  }

  private lateinit var somLauncher: AppContextActivityResultLauncher<SomAudioRequest, Uri?>

  private val firedReceiver = object : BroadcastReceiver() {
    override fun onReceive(c: Context?, intent: Intent?) {
      val tarefaId = intent?.getStringExtra(AlarmScheduler.EXTRA_TAREFA_ID) ?: return
      val titulo = intent?.getStringExtra(AlarmScheduler.EXTRA_TITULO) ?: "Tarefa"
      val tipo = intent?.getStringExtra(AlarmScheduler.EXTRA_TIPO) ?: "tarefa"
      sendEvent("onAlarmFired", mapOf("tarefaId" to tarefaId, "titulo" to titulo, "tipo" to tipo))
    }
  }
}
