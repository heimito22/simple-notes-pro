package com.seuusuario.simplesnotes.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Reagenda todos os alarmes persistidos depois que o celular reinicia
 * (o Android limpa os alarmes do AlarmManager no reboot).
 */
class AlarmBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_REBOOT,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      "android.intent.action.QUICKBOOT_POWERON" -> AlarmScheduler.rearmAll(context)
    }
  }
}
