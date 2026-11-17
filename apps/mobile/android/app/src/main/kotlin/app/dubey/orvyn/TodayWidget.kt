package app.dubey.orvyn

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import es.antonborri.home_widget.HomeWidgetLaunchIntent
import es.antonborri.home_widget.HomeWidgetProvider
import org.json.JSONObject

/**
 * Today on the home screen (spec 0002 M5): what's still ahead today and what's waiting, written by the app
 * (lib/app/home_widget.dart) whenever tasks or events change. Tapping the list opens Today; "+" opens it ready
 * to type. Colours come from the design tokens (orvyn_colors.xml in values and values-night, generated).
 */
class TodayWidget : HomeWidgetProvider() {
    private val rows = listOf(
        Triple(R.id.row0, R.id.when0, R.id.title0),
        Triple(R.id.row1, R.id.when1, R.id.title1),
        Triple(R.id.row2, R.id.when2, R.id.title2),
        Triple(R.id.row3, R.id.when3, R.id.title3),
        Triple(R.id.row4, R.id.when4, R.id.title4),
    )

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
        widgetData: SharedPreferences,
    ) {
        val snapshot = try {
            JSONObject(widgetData.getString("today", null) ?: "{}")
        } catch (_: Exception) {
            JSONObject()
        }
        for (id in appWidgetIds) {
            val views = RemoteViews(context.packageName, R.layout.today_widget)
            val open = HomeWidgetLaunchIntent.getActivity(context, MainActivity::class.java, Uri.parse("orvyn://today"))
            val add = HomeWidgetLaunchIntent.getActivity(context, MainActivity::class.java, Uri.parse("orvyn://add"))
            views.setOnClickPendingIntent(R.id.widget_root, open)
            views.setOnClickPendingIntent(R.id.widget_add, add)

            if (!snapshot.optBoolean("signedIn", false)) {
                views.setTextViewText(R.id.widget_empty, context.getString(R.string.widget_signed_out))
                views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
                rows.forEach { views.setViewVisibility(it.first, View.GONE) }
                views.setViewVisibility(R.id.widget_more, View.GONE)
                appWidgetManager.updateAppWidget(id, views)
                continue
            }

            // what has ended since the app last wrote is dropped here
            val now = System.currentTimeMillis()
            val all = snapshot.optJSONArray("lines")
            val lines = (0 until (all?.length() ?: 0))
                .map { all!!.getJSONObject(it) }
                .filter { !it.has("until") || it.optLong("until") > now }
            val count = minOf(lines.size, rows.size)
            rows.forEachIndexed { i, (row, whenId, titleId) ->
                if (i < count) {
                    val l = lines[i]
                    views.setViewVisibility(row, View.VISIBLE)
                    views.setTextViewText(whenId, l.optString("when"))
                    views.setTextViewText(titleId, l.optString("title"))
                    views.setTextColor(
                        whenId,
                        context.getColor(if (l.optBoolean("late")) R.color.orvyn_danger else R.color.orvyn_accent),
                    )
                } else {
                    views.setViewVisibility(row, View.GONE)
                }
            }
            val more = snapshot.optInt("more", 0) + (lines.size - count)
            views.setViewVisibility(R.id.widget_more, if (more > 0) View.VISIBLE else View.GONE)
            views.setTextViewText(R.id.widget_more, context.getString(R.string.widget_more, more))
            views.setViewVisibility(R.id.widget_empty, if (count == 0) View.VISIBLE else View.GONE)
            views.setTextViewText(R.id.widget_empty, context.getString(R.string.widget_clear))
            appWidgetManager.updateAppWidget(id, views)
        }
    }
}
