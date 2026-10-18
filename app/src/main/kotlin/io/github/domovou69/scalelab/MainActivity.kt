package io.github.domovou69.scalelab

import android.app.Activity
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.ViewTreeObserver
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

// Stage 1 spike screen, chosen by intent extras:
//   mode  stack      layers of 200 cells (20 rows × 10) stacked on top of each other, all on screen
//         offscreen  the same, every layer but the first moved off screen (a closed drawer, other pages)
//         invisible  the same, every layer but the first View.INVISIBLE
//         scroll     one ScrollView with all cells, most of them below the fold
//         deep       a chain of nested layouts `depth` levels deep, a marker every 5 levels
//   n     number of cells (default 2000); the last 100 cells get resource-ids t000..t099
//   depth chain depth for `deep` (default 100)
// Cell i: text "Item L.R.C", content-desc "Cell L.R.C" (layer, row, column).
class MainActivity : Activity() {
    private val cellsPerLayer = 200
    private val cols = 10
    private val screenW by lazy { resources.displayMetrics.widthPixels }
    private val screenH by lazy { resources.displayMetrics.heightPixels }
    // exact sizes (no layout weights) so every view is measured once; weights in nested
    // LinearLayouts measure each cell 4× and the first frame of 2000 cells took > 5 s (ANR)
    private val cellW by lazy { screenW / cols }
    private val rowH by lazy { screenH / (cellsPerLayer / cols) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val n = intent.getIntExtra("n", 2000)
        val t0 = SystemClock.uptimeMillis()
        setContentView(
            when (intent.getStringExtra("mode")) {
                "stack" -> layers(n, hide = null)
                "offscreen" -> layers(n) { it.translationX = 100_000f }
                "invisible" -> layers(n) { it.visibility = View.INVISIBLE }
                "scroll" -> scroll(n)
                "deep" -> deep(intent.getIntExtra("depth", 100))
                else -> TextView(this).apply { text = "ScaleLab" }
            }
        )
        val built = SystemClock.uptimeMillis() - t0
        window.decorView.viewTreeObserver.addOnDrawListener(object : ViewTreeObserver.OnDrawListener {
            var logged = false
            override fun onDraw() {
                if (logged) return
                logged = true
                Log.i("ScaleLab", "built ${built} ms, first draw ${SystemClock.uptimeMillis() - t0} ms")
            }
        })
    }

    private fun cell(i: Int, n: Int, layer: Int, row: Int, col: Int) = TextView(this).apply {
        text = "Item $layer.$row.$col"
        contentDescription = "Cell $layer.$row.$col"
        textSize = 7f
        if (i >= n - 100) id = resources.getIdentifier("t%03d".format(i - maxOf(0, n - 100)), "id", packageName)
    }

    private fun row(first: Int, count: Int, n: Int, layer: Int, r: Int) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        for (c in 0 until count) addView(cell(first + c, n, layer, r, c), LinearLayout.LayoutParams(cellW, rowH))
    }

    private fun layers(n: Int, hide: ((View) -> Unit)?) = FrameLayout(this).apply {
        var i = 0
        var layer = 0
        while (i < n) {
            val inLayer = minOf(cellsPerLayer, n - i)
            val grid = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                var r = 0
                while (r * cols < inLayer) {
                    addView(row(i + r * cols, minOf(cols, inLayer - r * cols), n, layer, r), LinearLayout.LayoutParams(screenW, rowH))
                    r++
                }
            }
            if (layer > 0) hide?.invoke(grid)
            addView(grid, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
            i += inLayer
            layer++
        }
    }

    private fun scroll(n: Int) = ScrollView(this).apply {
        addView(LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.VERTICAL
            var r = 0
            while (r * cols < n) {
                addView(row(r * cols, minOf(cols, n - r * cols), n, 0, r), LinearLayout.LayoutParams(screenW, rowH))
                r++
            }
        })
    }

    private fun deep(depth: Int): View {
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        var parent = root
        for (level in 1..depth) {
            val child = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            if (level % 5 == 0) parent.addView(TextView(this).apply {
                text = "Depth $level"
                contentDescription = "depth-$level"
                id = R.id.marker
                textSize = 7f
            }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            parent.addView(child, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            parent = child
        }
        return root
    }
}
