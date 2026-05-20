const router      = require('express').Router();
const pool        = require('../db/pool');
const requireAuth = require('../middleware/auth');

// GET /api/reports?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&time_from=HH:MM&time_to=HH:MM
router.get('/', requireAuth, async (req, res) => {
  const { date_from, date_to, time_from, time_to } = req.query;

  const from = date_from || new Date().toISOString().split('T')[0];
  const to   = date_to   || new Date().toISOString().split('T')[0];

  // Build datetime range — combine date + optional time
  const dtFrom = time_from ? `${from} ${time_from}:00` : `${from} 00:00:00`;
  const dtTo   = time_to   ? `${to} ${time_to}:00`     : `${to} 23:59:59`;

  try {
    const [rows] = await pool.query(
      `SELECT
         id,
         order_number,
         ready_at,
         collected_at,
         CASE
           WHEN collected_at IS NOT NULL
           THEN TIMESTAMPDIFF(SECOND, ready_at, collected_at)
           ELSE NULL
         END AS elapsed_seconds,
         CASE
           WHEN collected_at IS NOT NULL
           THEN SEC_TO_TIME(TIMESTAMPDIFF(SECOND, ready_at, collected_at))
           ELSE NULL
         END AS elapsed_time
       FROM orders_history
       WHERE ready_at BETWEEN ? AND ?
       ORDER BY ready_at ASC`,
      [dtFrom, dtTo]
    );

    const collected       = rows.filter(r => r.collected_at !== null);
    const totalOrders     = rows.length;
    const totalCollected  = collected.length;
    const totalUncollected = rows.length - collected.length;
    const avgSeconds      = collected.length
      ? Math.round(collected.reduce((sum, r) => sum + r.elapsed_seconds, 0) / collected.length)
      : null;

    const formatTime = (secs) => {
      if (secs === null) return null;
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      return `${m}m ${s}s`;
    };

    res.json({
      date_from: from,
      date_to:   to,
      time_from: time_from || null,
      time_to:   time_to   || null,
      summary: {
        total_orders:     totalOrders,
        total_collected:  totalCollected,
        uncollected:      totalUncollected,
        avg_elapsed:      formatTime(avgSeconds),
        avg_elapsed_secs: avgSeconds,
      },
      orders: rows.map(r => ({
        ...r,
        elapsed_display: formatTime(r.elapsed_seconds),
      })),
    });
  } catch (err) {
    console.error('Reports error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
