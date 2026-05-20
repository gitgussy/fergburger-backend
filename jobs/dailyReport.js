'use strict';
const nodemailer = require('nodemailer');
const pool       = require('../db/pool');

// ── Config (from env vars) ───────────────────────────────────
const GMAIL_USER   = process.env.GMAIL_USER;
const GMAIL_PASS   = process.env.GMAIL_APP_PASSWORD;
const REPORT_TO    = process.env.REPORT_EMAIL_TO;

// ── Helpers ──────────────────────────────────────────────────
function fmtTime(secs) {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

function pad(n) { return String(n).padStart(2, '0'); }

function barChart(value, max) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return `
    <div style="display:flex;align-items:center;gap:8px;margin:3px 0;">
      <div style="width:${pct}%;max-width:200px;height:14px;background:#002F6C;border-radius:2px;min-width:${value>0?4:0}px;"></div>
      <span style="font-size:12px;color:#334155;">${value}</span>
    </div>`;
}

// ── Main export ──────────────────────────────────────────────
async function sendDailyReport(targetDate) {
  // Default to yesterday NZ time if no date given
  const tz = 'Pacific/Auckland';
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  const date = targetDate || (() => {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  })();

  const dtFrom = `${date} 00:00:00`;
  const dtTo   = `${date} 23:59:59`;

  // ── Queries ──
  const [rows] = await pool.query(
    `SELECT order_number, ready_at, collected_at,
       CASE WHEN collected_at IS NOT NULL
            THEN TIMESTAMPDIFF(SECOND, ready_at, collected_at)
            ELSE NULL END AS elapsed_seconds
     FROM orders_history
     WHERE ready_at BETWEEN ? AND ?
     ORDER BY ready_at ASC`,
    [dtFrom, dtTo]
  );

  // Yesterday comparison
  const [prevDate] = (() => {
    const d = new Date(date);
    d.setDate(d.getDate() - 1);
    return [d.toISOString().split('T')[0]];
  })();
  const [prevRows] = await pool.query(
    `SELECT COUNT(*) as cnt FROM orders_history WHERE ready_at BETWEEN ? AND ?`,
    [`${prevDate} 00:00:00`, `${prevDate} 23:59:59`]
  );
  const prevTotal = prevRows[0].cnt;

  // ── Stats ──
  const total     = rows.length;
  const collected = rows.filter(r => r.collected_at).length;
  const uncollected = total - collected;
  const collectedRows = rows.filter(r => r.elapsed_seconds !== null);
  const avgWait   = collectedRows.length
    ? Math.round(collectedRows.reduce((s, r) => s + r.elapsed_seconds, 0) / collectedRows.length)
    : null;
  const maxWait   = collectedRows.length
    ? Math.max(...collectedRows.map(r => r.elapsed_seconds))
    : null;

  // Hourly breakdown
  const hourly = {};
  for (let h = 0; h < 24; h++) hourly[h] = 0;
  rows.forEach(r => {
    const h = new Date(r.ready_at).getHours();
    hourly[h]++;
  });
  const maxHourCount  = Math.max(...Object.values(hourly));
  const busiestHour   = Object.entries(hourly).find(([,v]) => v === maxHourCount);
  const busiestLabel  = busiestHour
    ? `${busiestHour[0] % 12 || 12}${parseInt(busiestHour[0]) < 12 ? 'am' : 'pm'} (${busiestHour[1]} orders)`
    : '—';

  // Rush hours
  const lunchOrders  = rows.filter(r => { const h = new Date(r.ready_at).getHours(); return h >= 12 && h < 14; }).length;
  const dinnerOrders = rows.filter(r => { const h = new Date(r.ready_at).getHours(); return h >= 18 && h < 20; }).length;

  // vs yesterday
  const vsYest = prevTotal > 0
    ? `${total > prevTotal ? '+' : ''}${Math.round(((total - prevTotal) / prevTotal) * 100)}%`
    : '—';
  const vsColor = total >= prevTotal ? '#166534' : '#991B1B';
  const vsArrow = total >= prevTotal ? '↑' : '↓';

  // ── Email HTML ──
  const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-NZ', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  // Only show hours with orders (or key hours)
  const keyHours = [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22];
  const hourRows = keyHours.map(h => {
    const count = hourly[h];
    const label = `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
    const isBusiest = count === maxHourCount && count > 0;
    return `
      <tr style="background:${isBusiest ? '#EFF6FF' : 'transparent'}">
        <td style="padding:4px 12px;font-size:12px;color:#475569;width:50px;">${label}</td>
        <td style="padding:4px 8px;">${barChart(count, maxHourCount)}</td>
        <td style="padding:4px 8px;font-size:11px;color:#94A3B8;">${isBusiest ? '🏆' : ''}</td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <!-- Header -->
  <tr>
    <td style="background:linear-gradient(180deg,#002F6C 0%,#446688 100%);padding:28px 32px;border-radius:8px 8px 0 0;">
      <p style="margin:0;font-size:24px;font-weight:700;color:#FFFFFF;letter-spacing:2px;">🍔 FERGBURGER</p>
      <p style="margin:4px 0 0;font-size:14px;color:#C5B783;font-weight:600;">Daily Order Report — ${dateLabel}</p>
    </td>
  </tr>

  <!-- Summary Cards -->
  <tr>
    <td style="background:#FFFFFF;padding:24px 32px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          ${[
            ['TOTAL ORDERS', total, '#002F6C'],
            ['COLLECTED', `${collected}<span style="font-size:14px;color:#64748B"> (${total>0?Math.round(collected/total*100):0}%)</span>`, '#166534'],
            ['AVG WAIT', fmtTime(avgWait), '#1e4d8c'],
            ['BUSIEST HOUR', busiestHour ? `${busiestHour[0]%12||12}${parseInt(busiestHour[0])<12?'am':'pm'}` : '—', '#C5B783'],
          ].map(([lbl, val, col]) => `
            <td width="25%" style="text-align:center;padding:0 8px;">
              <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:16px 8px;">
                <div style="font-size:22px;font-weight:700;color:${col};">${val}</div>
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#64748B;margin-top:4px;">${lbl}</div>
              </div>
            </td>`).join('')}
        </tr>
      </table>
    </td>
  </tr>

  <!-- Rush Hours -->
  <tr>
    <td style="background:#FFFFFF;padding:0 32px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="50%" style="padding-right:8px;">
            <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:14px 16px;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#1e4d8c;font-weight:700;">🍔 Lunch Rush 12–2pm</div>
              <div style="font-size:26px;font-weight:700;color:#002F6C;margin-top:4px;">${lunchOrders}</div>
              <div style="font-size:11px;color:#64748B;">orders</div>
            </div>
          </td>
          <td width="50%" style="padding-left:8px;">
            <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:14px 16px;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#C2410C;font-weight:700;">🍔 Dinner Rush 6–8pm</div>
              <div style="font-size:26px;font-weight:700;color:#9A3412;margin-top:4px;">${dinnerOrders}</div>
              <div style="font-size:11px;color:#64748B;">orders</div>
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Hourly Breakdown -->
  <tr>
    <td style="background:#FFFFFF;padding:0 32px 24px;">
      <p style="margin:0 0 12px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#64748B;font-weight:700;border-top:1px solid #F1F5F9;padding-top:16px;">Hourly Breakdown</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${hourRows}
      </table>
    </td>
  </tr>

  <!-- Stats Row -->
  <tr>
    <td style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:16px 32px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:12px;color:#64748B;">
            Max wait time: <strong>${fmtTime(maxWait)}</strong> &nbsp;·&nbsp;
            Uncollected: <strong style="color:${uncollected>0?'#DC2626':'#166534'}">${uncollected}</strong> &nbsp;·&nbsp;
            vs Yesterday: <strong style="color:${vsColor}">${vsArrow} ${vsYest}</strong>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#002F6C;padding:16px 32px;border-radius:0 0 8px 8px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#C5B783;letter-spacing:1px;">FERGBURGER · QUEENSTOWN, NEW ZEALAND · ferglovesyou.com</p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  // ── Send ──
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });

  await transporter.sendMail({
    from:    `"Fergburger Reports" <${GMAIL_USER}>`,
    to:      REPORT_TO,
    subject: `🍔 Fergburger Daily Report — ${dateLabel} — ${total} orders`,
    html,
  });

  console.log(`✅ Daily report sent for ${date} (${total} orders)`);
  return { date, total };
}

module.exports = { sendDailyReport };
