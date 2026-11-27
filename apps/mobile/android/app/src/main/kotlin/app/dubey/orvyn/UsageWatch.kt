package app.dubey.orvyn

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.provider.Settings
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import io.flutter.FlutterInjector
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.dart.DartExecutor
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * My Day on this phone (spec 0024): which app was in front, from Android's own usage record. Nothing about what is
 * inside an app is read. The Dart side (lib/activity/phone_day.dart) turns the events into spans and sends them.
 */
object UsageWatch {
    private const val WORK = "orvyn-my-day"
    private var engine: FlutterEngine? = null

    fun allowed(ctx: Context): Boolean {
        val ops = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        @Suppress("DEPRECATION")
        val mode = ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
        return mode == AppOpsManager.MODE_ALLOWED
    }

    private val KEEP = setOf(
        UsageEvents.Event.ACTIVITY_RESUMED,
        UsageEvents.Event.ACTIVITY_PAUSED,
        UsageEvents.Event.ACTIVITY_STOPPED,
        UsageEvents.Event.SCREEN_INTERACTIVE,
        UsageEvents.Event.SCREEN_NON_INTERACTIVE,
        UsageEvents.Event.KEYGUARD_SHOWN,
        UsageEvents.Event.KEYGUARD_HIDDEN,
        UsageEvents.Event.DEVICE_SHUTDOWN,
        UsageEvents.Event.DEVICE_STARTUP,
    )

    fun events(ctx: Context, from: Long, to: Long): List<Map<String, Any?>> {
        val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val list = usm.queryEvents(from, to)
        val out = ArrayList<Map<String, Any?>>()
        val e = UsageEvents.Event()
        while (list.hasNextEvent()) {
            list.getNextEvent(e)
            if (e.eventType !in KEEP) continue
            out.add(mapOf("t" to e.timeStamp, "type" to e.eventType, "pkg" to e.packageName))
        }
        return out
    }

    /** An app's name as the phone shows it; null when it isn't installed any more. */
    private fun labels(ctx: Context, pkgs: List<String>): Map<String, String?> {
        val pm = ctx.packageManager
        return pkgs.associateWith { p ->
            runCatching { pm.getApplicationLabel(pm.getApplicationInfo(p, 0)).toString() }.getOrNull()
        }
    }

    /** What kind of app is the home screen: never a place of its own. */
    private fun home(ctx: Context): String? =
        ctx.packageManager.resolveActivity(
            Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME),
            PackageManager.MATCH_DEFAULT_ONLY,
        )?.activityInfo?.packageName

    fun schedule(ctx: Context, on: Boolean) {
        val wm = WorkManager.getInstance(ctx)
        if (on) {
            wm.enqueueUniquePeriodicWork(
                WORK,
                ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<Sender>(1, TimeUnit.HOURS).build(),
            )
        } else {
            wm.cancelUniqueWork(WORK)
        }
    }

    fun bind(messenger: BinaryMessenger, ctx: Context): MethodChannel {
        val ch = MethodChannel(messenger, "orvyn/usage")
        ch.setMethodCallHandler { call, result ->
            when (call.method) {
                "allowed" -> result.success(allowed(ctx))
                "openSettings" -> {
                    ctx.startActivity(
                        Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                    result.success(null)
                }
                "events" -> {
                    if (!allowed(ctx)) return@setMethodCallHandler result.success(null)
                    val from = (call.argument<Number>("from"))!!.toLong()
                    val to = (call.argument<Number>("to"))!!.toLong()
                    // a week of events is many thousands: read off the main thread
                    Thread {
                        val ev = runCatching { events(ctx, from, to) }.getOrDefault(emptyList())
                        val names = labels(ctx, ev.mapNotNull { it["pkg"] as String? }.distinct())
                        val answer = mapOf("events" to ev, "labels" to names, "home" to home(ctx))
                        Handler(Looper.getMainLooper()).post { result.success(answer) }
                    }.start()
                }
                "schedule" -> {
                    schedule(ctx, call.arguments as? Boolean ?: false)
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
        return ch
    }

    /** Every hour, even with ORVYN closed: run lib/activity/phone_day.dart's sender once, then stop. */
    class Sender(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
        override fun doWork(): Result {
            if (!allowed(applicationContext)) return Result.success()
            val done = CountDownLatch(1)
            Handler(Looper.getMainLooper()).post {
                synchronized(UsageWatch) {
                    if (engine != null) return@post done.countDown()
                    val loader = FlutterInjector.instance().flutterLoader()
                    loader.startInitialization(applicationContext)
                    loader.ensureInitializationComplete(applicationContext, null)
                    val e = FlutterEngine(applicationContext)
                    engine = e
                    bind(e.dartExecutor.binaryMessenger, applicationContext)
                    MethodChannel(e.dartExecutor.binaryMessenger, "orvyn/usage_bg").setMethodCallHandler { call, result ->
                        result.success(null)
                        if (call.method == "done") done.countDown()
                    }
                    e.dartExecutor.executeDartEntrypoint(
                        DartExecutor.DartEntrypoint(loader.findAppBundlePath(), "package:orvyn/activity/phone_day.dart", "phoneDayMain"),
                    )
                }
            }
            done.await(90, TimeUnit.SECONDS)
            Handler(Looper.getMainLooper()).post {
                synchronized(UsageWatch) {
                    engine?.destroy()
                    engine = null
                }
            }
            return Result.success()
        }
    }
}
