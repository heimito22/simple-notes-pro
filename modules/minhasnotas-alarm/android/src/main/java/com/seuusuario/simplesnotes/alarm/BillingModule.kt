package com.seuusuario.simplesnotes.alarm

import android.content.Context
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/**
 * Ponte JS <-> Google Play Billing (Android).
 *
 * Compra in-app NÃO-consumível "remover_anuncios": uma compra única que libera
 * os anúncios para sempre. O pagamento é feito DIRETO pela Play Store (o valor
 * é definido no Play Console, não no código — o desenvolvedor pode alterar o
 * preço depois sem recompilar o app).
 *
 * - comprarRemoverAnuncios: abre a janela de pagamento da Play Store.
 * - temCompraAtiva: verifica se o usuário já comprou (restauração).
 * - onCompraAtualizada: evento emitido quando uma compra é concluída/cancelada.
 */
class BillingModule : Module() {

  private val context: Context?
    get() = appContext.reactContext

  private var billingClient: BillingClient? = null
  private var conectado = false

  private val productId = "removeranuncios"

  private val purchasesUpdatedListener = PurchasesUpdatedListener { billingResult, purchases ->
    if (billingResult.responseCode == BillingClient.BillingResponseCode.OK && purchases != null) {
      for (purchase in purchases) {
        if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED) {
          concederEntitlement(purchase)
        }
      }
      appContext.modulesQueue.launch {
        sendEvent("onCompraAtualizada", mapOf("comprado" to consultarCompra()))
      }
    } else if (billingResult.responseCode == BillingClient.BillingResponseCode.USER_CANCELED) {
      sendEvent("onCompraAtualizada", mapOf("comprado" to false, "cancelado" to true))
    } else {
      sendEvent(
        "onCompraAtualizada",
        mapOf("comprado" to false, "erro" to "Código ${billingResult.responseCode}")
      )
    }
  }

  override fun definition() = ModuleDefinition {
    Name("SimpleNotesBilling")

    Events("onCompraAtualizada")

    // Abre a janela de pagamento da Play Store para o produto "remover_anuncios"
    AsyncFunction("comprarRemoverAnuncios") Coroutine { ->
      if (!conectarSeNecessario()) {
        return@Coroutine mapOf("ok" to false, "erro" to "Billing indisponível (sem Play Store neste aparelho?)")
      }
      val activity = appContext.currentActivity
      if (activity == null) {
        return@Coroutine mapOf("ok" to false, "erro" to "Sem atividade em primeiro plano")
      }
      val client = billingClient ?: return@Coroutine mapOf("ok" to false, "erro" to "Billing indisponível")

      val productList = listOf(
        QueryProductDetailsParams.Product.newBuilder()
          .setProductId(productId)
          .setProductType(BillingClient.ProductType.INAPP)
          .build()
      )
      val params = QueryProductDetailsParams.newBuilder().setProductList(productList).build()

      val resultado = suspendCancellableCoroutine<BillingResult> { cont ->
        client.queryProductDetailsAsync(params) { result, details ->
          if (result.responseCode == BillingClient.BillingResponseCode.OK && !details.isNullOrEmpty()) {
            val flowParams = BillingFlowParams.newBuilder()
              .setProductDetailsParamsList(
                listOf(
                  BillingFlowParams.ProductDetailsParams.newBuilder()
                    .setProductDetails(details[0])
                    .build()
                )
              )
              .build()
            val launchResult = client.launchBillingFlow(activity, flowParams)
            cont.resume(launchResult)
          } else {
            cont.resume(result)
          }
        }
      }

      if (resultado.responseCode != BillingClient.BillingResponseCode.OK) {
        return@Coroutine mapOf(
          "ok" to false,
          "erro" to "Produto indisponível na Play Store (publique o app e crie o produto \"removeranuncios\" no Play Console)"
        )
      }
      mapOf("ok" to true)
    }

    // Verifica se o usuário já comprou a remoção de anúncios (restauração ao abrir)
    AsyncFunction("temCompraAtiva") Coroutine { ->
      if (!conectarSeNecessario()) return@Coroutine false
      consultarCompra()
    }

    AsyncFunction("restaurarCompras") Coroutine { ->
      if (!conectarSeNecessario()) return@Coroutine false
      consultarCompra()
    }

    // Preço exibido na tela (lido do Play Console — o valor real é definido lá)
    AsyncFunction("obterPrecoRemoverAnuncios") Coroutine { ->
      if (!conectarSeNecessario()) return@Coroutine null
      val client = billingClient ?: return@Coroutine null
      val productList = listOf(
        QueryProductDetailsParams.Product.newBuilder()
          .setProductId(productId)
          .setProductType(BillingClient.ProductType.INAPP)
          .build()
      )
      val params = QueryProductDetailsParams.newBuilder().setProductList(productList).build()
      val preco = suspendCancellableCoroutine<String?> { cont ->
        client.queryProductDetailsAsync(params) { result, details ->
          val p = if (result.responseCode == BillingClient.BillingResponseCode.OK && !details.isNullOrEmpty()) {
            details[0].oneTimePurchaseOfferDetails?.formattedPrice
          } else null
          cont.resume(p)
        }
      }
      preco
    }

    OnDestroy {
      try {
        billingClient?.endConnection()
      } catch (_: Exception) {
        // ignora
      }
      billingClient = null
      conectado = false
    }
  }

  /**
   * Conecta ao Play Billing (idempotente), aguardando o callback de conexão.
   * Timeout de 8s: em devices sem Play Store / app não publicado, retorna false
   * em vez de travar a UI para sempre.
   */
  private suspend fun conectarSeNecessario(): Boolean {
    val ctx = context ?: return false
    if (billingClient == null) {
      billingClient = BillingClient.newBuilder(ctx)
        .setListener(purchasesUpdatedListener)
        .enablePendingPurchases(
          PendingPurchasesParams.newBuilder().enableOneTimeProducts().build()
        )
        .build()
    }
    if (conectado) return true

    return withTimeoutOrNull(8_000) {
      suspendCancellableCoroutine { cont ->
        try {
          billingClient?.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
              conectado = result.responseCode == BillingClient.BillingResponseCode.OK
              // Reconcilia compras já feitas (ex.: comprou e o app foi fechado antes de confirmar)
              if (conectado) {
                appContext.modulesQueue.launch {
                  if (consultarCompra()) {
                    sendEvent("onCompraAtualizada", mapOf("comprado" to true))
                  }
                }
              }
              if (cont.isActive) cont.resume(conectado)
            }

            override fun onBillingServiceDisconnected() {
              conectado = false
              if (cont.isActive) cont.resume(false)
            }
          })
        } catch (_: Exception) {
          if (cont.isActive) cont.resume(false)
        }
      }
    } ?: false
  }

  /** Confirma (acknowledge) a compra — obrigatório em até 3 dias para não-consumíveis. */
  private fun concederEntitlement(purchase: Purchase) {
    if (!purchase.isAcknowledged) {
      val params = AcknowledgePurchaseParams.newBuilder()
        .setPurchaseToken(purchase.purchaseToken)
        .build()
      try {
        billingClient?.acknowledgePurchase(params) { _ -> }
      } catch (_: Exception) {
        // ignora
      }
    }
  }

  /** Consulta (suspende) se existe compra ativa do produto. */
  private suspend fun consultarCompra(): Boolean {
    val client = billingClient ?: return false
    return suspendCancellableCoroutine { cont ->
      try {
        val params = QueryPurchasesParams.newBuilder()
          .setProductType(BillingClient.ProductType.INAPP)
          .build()
        client.queryPurchasesAsync(params) { result, purchases ->
          val comprado = result.responseCode == BillingClient.BillingResponseCode.OK &&
            purchases.any { it.products.contains(productId) && it.purchaseState == Purchase.PurchaseState.PURCHASED }
          if (comprado) {
            purchases.firstOrNull { it.products.contains(productId) && !it.isAcknowledged }?.let { concederEntitlement(it) }
          }
          cont.resume(comprado)
        }
      } catch (_: Exception) {
        cont.resume(false)
      }
    }
  }
}
