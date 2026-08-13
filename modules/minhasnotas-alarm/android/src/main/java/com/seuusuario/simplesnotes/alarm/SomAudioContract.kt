package com.seuusuario.simplesnotes.alarm

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import java.io.Serializable

/** Input serializável do contrato (requisito do launcher do expo-modules-core). */
class SomAudioRequest : Serializable

/**
 * Contrato para o seletor de arquivo de áudio (Storage Access Framework).
 * Não exige permissão: só retorna o content:// do arquivo escolhido.
 */
class SomAudioContract : AppContextActivityResultContract<SomAudioRequest, Uri?> {

  override fun createIntent(context: Context, input: SomAudioRequest): Intent =
    Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "audio/*"
      putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("audio/*", "application/ogg", "application/octet-stream"))
    }

  override fun parseResult(input: SomAudioRequest, resultCode: Int, intent: Intent?): Uri? {
    if (resultCode != Activity.RESULT_OK) return null
    return intent?.data
  }
}
