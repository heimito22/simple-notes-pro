package com.seuusuario.simplesnotes.alarm

import android.content.ContentResolver
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import java.io.FileOutputStream

/**
 * Som do alarme com controle de VOLUME e suporte a SOM PRÓPRIO do usuário (Android).
 *
 * - Toca no stream de ALARME (STREAM_ALARM): usa o volume de alarme do celular,
 *   que é independente do modo silencioso/vibração e do volume de mídia.
 * - Ao tocar, força o volume de alarme ao MÁXIMO (guardando o anterior).
 * - Ao parar, restaura o volume anterior.
 * - Sons embutidos: res/raw/som_<chave>.wav (definido via definir()).
 * - Som próprio: arquivo escolhido pelo usuário é COPIADO para filesDir (fica
 *   no armazenamento privado do app, sem depender de permissão de URI) e tocado
 *   quando a chave é "personalizado".
 */
object AlarmSound {
  private const val PREFS = "minhasnotas_som"
  private const val KEY_SOM = "som_alarme"
  private const val KEY_FORCADO = "volume_forcado"
  private const val KEY_ANTERIOR = "volume_anterior"
  private const val KEY_PERSONALIZADO = "som_personalizado"
  private const val KEY_PERSONALIZADO_NOME = "som_personalizado_nome"
  private const val KEY_PERSONALIZADO_VER = "som_personalizado_ver"

  private const val SOM_PERSONALIZADO = "personalizado"

  private var atual: MediaPlayer? = null

  data class Resultado(val ok: Boolean, val nome: String?, val erro: String?)

  /** Salva o som selecionado pelo usuário (lido na hora do disparo). */
  fun definir(context: Context, nome: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit().putString(KEY_SOM, nome).apply()
  }

  /** Som atualmente selecionado. */
  fun somAtual(context: Context): String =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_SOM, "classico") ?: "classico"

  /** Copia o arquivo escolhido (SAF content://) para o armazenamento do app. */
  fun salvarPersonalizado(context: Context, uri: Uri): Resultado {
    return try {
      val cr = context.contentResolver
      val nome = nomeDoUri(cr, uri) ?: "meu-som"
      val ext = nome.substringAfterLast('.', "").ifEmpty { "m4a" }
      val destino = File(context.filesDir, "som_personalizado.$ext")

      // Limite de tamanho (50 MB) — alarme não precisa de arquivo gigante
      val tamanho = tamanhoDoUri(cr, uri)
      if (tamanho > 50L * 1024 * 1024) {
        return Resultado(false, null, "O arquivo é muito grande (máximo 50 MB).")
      }

      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      // Apaga o arquivo anterior se a extensão mudou (evita órfão)
      val antigo = prefs.getString(KEY_PERSONALIZADO, null)
      if (antigo != null && antigo != destino.absolutePath) {
        try { File(antigo).delete() } catch (_: Exception) {}
      }

      val input = cr.openInputStream(uri)
        ?: return Resultado(false, null, "Não foi possível ler o arquivo escolhido.")
      input.use { entrada ->
        FileOutputStream(destino).use { saida -> entrada.copyTo(saida) }
      }

      prefs.edit()
        .putString(KEY_PERSONALIZADO, destino.absolutePath)
        .putString(KEY_PERSONALIZADO_NOME, nome)
        .putInt(KEY_PERSONALIZADO_VER, prefs.getInt(KEY_PERSONALIZADO_VER, 0) + 1)
        .apply()
      Resultado(true, nome, null)
    } catch (e: Exception) {
      Resultado(false, null, e.message ?: "Erro ao copiar o arquivo.")
    }
  }

  /** Remove o som próprio (arquivo + preferências). */
  fun removerPersonalizado(context: Context) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val caminho = prefs.getString(KEY_PERSONALIZADO, null)
    if (caminho != null) {
      try { File(caminho).delete() } catch (_: Exception) {}
    }
    prefs.edit()
      .remove(KEY_PERSONALIZADO)
      .remove(KEY_PERSONALIZADO_NOME)
      .apply()
  }

  fun temPersonalizado(context: Context): Boolean =
    caminhoPersonalizado(context)?.let { File(it).exists() } ?: false

  fun nomePersonalizado(context: Context): String? =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_PERSONALIZADO_NOME, null)

  /** Versão do som próprio — incrementa a cada troca (usada no canal por versão). */
  fun versaoPersonalizado(context: Context): Int =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getInt(KEY_PERSONALIZADO_VER, 0)

  private fun caminhoPersonalizado(context: Context): String? =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_PERSONALIZADO, null)

  /** Toca o som em loop (alarme). Opcionalmente força o volume de alarme ao máximo. */
  fun tocar(context: Context, nome: String, loop: Boolean = true, forcarVolume: Boolean = true) {
    parar(context)
    val fonte = fonteDoSom(context, nome) ?: return
    if (forcarVolume) forcarVolumeMaximo(context)

    val player = MediaPlayer().apply {
      setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )
      isLooping = loop
      setVolume(1.0f, 1.0f)
      if (!loop) {
        setOnCompletionListener { p ->
          if (atual === p) atual = null
          try { p.release() } catch (_: Exception) {}
        }
      }
    }

    try {
      when (fonte) {
        is FonteArquivo -> {
          player.setDataSource(fonte.arquivo.absolutePath)
          player.prepare()
        }
        is FonteRecurso -> {
          val fd = context.resources.openRawResourceFd(fonte.resId)
          try {
            player.setDataSource(fd.fileDescriptor, fd.startOffset, fd.length)
            player.prepare()
          } finally {
            try { fd.close() } catch (_: Exception) {}
          }
        }
      }
    } catch (_: Exception) {
      try { player.release() } catch (_: Exception) {}
      return
    }

    try {
      player.start()
    } catch (_: Exception) {
      try { player.release() } catch (_: Exception) {}
      return
    }
    atual = player
  }

  /** Prévia: toca uma única vez, sem forçar o volume (usado no seletor de sons). */
  fun preview(context: Context, nome: String) {
    tocar(context, nome, loop = false, forcarVolume = false)
  }

  /** Para o som e restaura o volume de alarme anterior. */
  fun parar(context: Context) {
    val p = atual
    atual = null
    if (p != null) {
      try { p.stop() } catch (_: Exception) {}
      try { p.release() } catch (_: Exception) {}
    }
    restaurarVolume(context)
  }

  /** Força o volume de alarme ao máximo (guarda o anterior para restaurar). */
  fun forcarVolumeMaximo(context: Context) {
    val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(KEY_FORCADO, false)) {
      prefs.edit()
        .putBoolean(KEY_FORCADO, true)
        .putInt(KEY_ANTERIOR, am.getStreamVolume(AudioManager.STREAM_ALARM))
        .apply()
    }
    am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
  }

  /** Restaura o volume de alarme anterior (se tiver sido forçado). */
  fun restaurarVolume(context: Context) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (prefs.getBoolean(KEY_FORCADO, false)) {
      val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      am.setStreamVolume(AudioManager.STREAM_ALARM, prefs.getInt(KEY_ANTERIOR, 0), 0)
      prefs.edit().remove(KEY_FORCADO).remove(KEY_ANTERIOR).apply()
    }
  }

  /** URI do som selecionado para a notificação nativa (resource ou arquivo). */
  fun uriDoSom(context: Context, nome: String): Uri? {
    return when (val fonte = fonteDoSom(context, nome)) {
      is FonteArquivo -> Uri.fromFile(fonte.arquivo)
      is FonteRecurso -> Uri.parse("android.resource://${context.packageName}/${fonte.resId}")
      null -> null
    }
  }

  private sealed class Fonte
  private class FonteArquivo(val arquivo: File) : Fonte()
  private class FonteRecurso(val resId: Int) : Fonte()

  private fun fonteDoSom(context: Context, nome: String): Fonte? {
    if (nome == SOM_PERSONALIZADO) {
      val caminho = caminhoPersonalizado(context)
      val arquivo = caminho?.let { File(it) }
      if (arquivo != null && arquivo.exists()) return FonteArquivo(arquivo)
      // Arquivo sumiu (ex.: pasta limpa) — cai no som clássico em vez de silêncio
      val res = context.resources.getIdentifier("som_classico", "raw", context.packageName)
      return if (res == 0) null else FonteRecurso(res)
    }
    val res = context.resources.getIdentifier("som_${nome.lowercase()}", "raw", context.packageName)
    return if (res == 0) null else FonteRecurso(res)
  }

  private fun nomeDoUri(cr: ContentResolver, uri: Uri): String? {
    return try {
      cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun tamanhoDoUri(cr: ContentResolver, uri: Uri): Long {
    return try {
      cr.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else -1L
      } ?: -1L
    } catch (_: Exception) {
      -1L
    }
  }
}
