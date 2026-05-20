'use strict';
const { sendDailyReport } = require('./dailyReport');

// Cron: run every day at 09:30 UTC = 9:30pm NZ (NZST UTC+12)
// Adjust REPORT_CRON env var to change schedule
// Format: "minute hour * * *"
const CRON = process.env.REPORT_CRON || '30 9 * * *';

function startScheduler() {
  try {
    const cron = require('node-cron');
    if (!cron.validate(CRON)) {
      console.error('❌ Invalid REPORT_CRON expression:', CRON);
      return;
    }
    cron.schedule(CRON, async () => {
      console.log('⏰ Running daily report...');
      try {
        await sendDailyReport();
      } catch (err) {
        console.error('❌ Daily report error:', err.message);
      }
    }, { timezone: 'UTC' });
    console.log(`📧 Daily report scheduler started — cron: ${CRON} UTC`);
  } catch (err) {
    console.error('❌ Scheduler failed to start:', err.message);
  }
}

module.exports = { startScheduler };
