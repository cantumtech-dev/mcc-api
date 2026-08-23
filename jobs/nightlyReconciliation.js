/**
 * Nightly reconciliation job.
 *
 * Run once a day (cron, Render Cron Job, Railway Cron, or `node-cron` in-process)
 * AFTER the day's bank feed file/API pull is available. Matches each posted
 * payment to a bank deposit by date + amount, and writes a status back so the
 * dashboard's /reconciliation endpoint reflects it the next morning.
 *
 * Usage: node jobs/nightlyReconciliation.js
 */
const { load, save } = require("../lib/store");

function runReconciliation() {
  const db = load();

  db.payments.forEach((payment) => {
    const postedDate = payment.posted_at.slice(0, 10);
    const match = db.bank_feed.find(
      (b) => b.date === postedDate && Math.abs(b.amount - payment.posted_amount) < 0.01
    );

    if (match) {
      payment.bank_deposit_id = match.deposit_id;
      payment.bank_matched_amount = match.amount;
      payment.reconciliation_status = "matched";
    } else {
      const sameDayDeposit = db.bank_feed.find((b) => b.date === postedDate);
      if (sameDayDeposit) {
        payment.bank_deposit_id = sameDayDeposit.deposit_id;
        payment.bank_matched_amount = sameDayDeposit.amount;
        payment.reconciliation_status = "variance"; // amount mismatch — flagged, not auto-cleared
      } else {
        payment.reconciliation_status = "pending"; // bank feed not in yet
      }
    }
  });

  save(db);
  console.log(`[${new Date().toISOString()}] Nightly reconciliation complete: ${db.payments.length} payments checked.`);
}

if (require.main === module) {
  runReconciliation();
}

module.exports = { runReconciliation };
