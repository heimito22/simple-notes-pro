package com.seuusuario.simplesnotes.ime

import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Ponte JS <-> nativa da ALTURA REAL do teclado (Android).
 *
 * O inset nativo do IME (WindowInsetsCompat.Type.ime) é a medida do SISTEMA:
 * inclui a faixa de sugestões do teclado Samsung, a barra extra do SwiftKey
 * (área de transferência/tradução/pesquisa), teclados flutuantes/partidos —
 * qualquer modelo, qualquer tamanho. Diferente dos eventos do React Native
 * (que disparam só no show/hide), o inset muda JUNTO com o teclado: quando a
 * barra extra do SwiftKey aparece no meio da digitação, a nova altura chega
 * na hora.
 *
 * - onImeChange: evento contínuo { height } em dp (0 = fechado).
 * - getImeHeight: altura atual em dp (consulta pontual; -1 = indisponível).
 *
 * Em API < 30 o Android não despacha inset de IME (reporta 0 sempre) — o JS
 * detecta e cai nos eventos do RN. Aqui só a verdade quando ela existe.
 */
class ImeModule : Module() {

  private var observado: View? = null
  private var ultimaAlturaDp = -1

  override fun definition() = ModuleDefinition {
    Name("MinhasNotasIme")

    Events("onImeChange")

    OnCreate {
      observar()
    }

    OnDestroy {
      observado?.let { ViewCompat.setOnApplyWindowInsetsListener(it, null) }
      observado = null
    }

    AsyncFunction("getImeHeight") { promise: Promise ->
      // Reobserva antes de responder: cobre recriação de activity e o primeiro
      // uso do módulo depois do app já aberto.
      observar()
      promise.resolve(alturaAtualDp())
    }
  }

  private fun activity() = appContext.currentActivity

  private fun alturaAtualDp(): Int {
    val a = activity() ?: return -1
    val raiz = a.window?.decorView ?: return -1
    val insets = ViewCompat.getRootWindowInsets(raiz) ?: return -1
    val px = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
    if (px <= 0) return 0
    val densidade = a.resources.displayMetrics.density
    return Math.round(px / densidade)
  }

  private fun observar() {
    val a = activity() ?: return
    val raiz = a.window?.decorView ?: return
    // Escuta no CONTENT VIEW (não no decor): recebe o dispatch completo de
    // insets sem substituir a política de insets do DecorView (barras do
    // sistema/edge-to-edge ficam intactas).
    val conteudo = raiz.findViewById<View>(android.R.id.content) ?: raiz
    if (observado === conteudo) return
    observado?.let { ViewCompat.setOnApplyWindowInsetsListener(it, null) }
    observado = conteudo
    ultimaAlturaDp = -1
    val densidade = a.resources.displayMetrics.density
    ViewCompat.setOnApplyWindowInsetsListener(conteudo) { _, insets ->
      val px = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      val hDp = if (px <= 0) 0 else Math.round(px / densidade)
      // Dedupe: a animação do teclado despacha insets a cada frame. Emite só
      // quando muda de verdade (>=2dp) ou ao zerar — o JS re-renderiza pouco
      // e a toolbar acompanha a animação com suavidade.
      if (hDp != ultimaAlturaDp && (kotlin.math.abs(hDp - ultimaAlturaDp) >= 2 || hDp == 0 || ultimaAlturaDp < 0)) {
        ultimaAlturaDp = hDp
        sendEvent("onImeChange", mapOf("height" to hDp))
      }
      insets
    }
  }
}
