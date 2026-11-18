package app.dubey.orvyn

import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine

// local_auth (app lock) needs a FragmentActivity for the biometric prompt.
class MainActivity : FlutterFragmentActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Money capture: while ORVYN is open, new payment notifications are read straight away
        val ch = MoneyListener.bind(flutterEngine.dartExecutor.binaryMessenger, applicationContext)
        MoneyListener.onArrived = { ch.invokeMethod("arrived", null) }
    }

    override fun onDestroy() {
        MoneyListener.onArrived = null
        super.onDestroy()
    }
}
