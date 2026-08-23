const express = require("express");
const cors = require("cors");
const { load, filterClaims } = require("./lib/store");

const app = express();
app.use(cors());
app.use(express.json());

function getFilters(req) {
  const { provider_id, location_id, payer_id, start_date, end_date } = req.query;
  return { provider_id, location_id, payer_id, start_date, end_date };
}

// GET /filters/options
app.get("/api/v1/filters/options", (req, res) => {
  const db = load();
  res.json({ providers: db.providers, locations: db.locations, payers: db.payers });
});

// GET /kpis
app.get("/api/v1/kpis", (req, res) => {
  const db = load();
  const filters = getFilters(req);
  const claims = filterClaims(db, filters);

  const chargesBilled = claims.reduce((s, c) => s + c.charge_amount, 0);
  const cleanCount = claims.filter((c) => c.clean_first_pass).length;
  const cleanClaimRate = claims.length ? +(100 * cleanCount / claims.length).toFixed(1) : 0;
  const deniedCount = claims.filter((c) => c.status === "denied").length;
  const denialRate = claims.length ? +(100 * deniedCount / claims.length).toFixed(1) : 0;

  const within24h = claims.filter((c) => {
    if (!c.provider_signed_at || !c.submitted_at) return false;
    const hrs = (new Date(c.submitted_at) - new Date(c.provider_signed_at)) / 36e5;
    return hrs <= 24;
  }).length;
  const submittedWithin24hPct = claims.length ? +(100 * within24h / claims.length).toFixed(1) : 0;

  const openClaims = claims.filter((c) => !["paid"].includes(c.status));
  const totalOpenAr = openClaims.reduce((s, c) => s + c.charge_amount, 0);

  res.json({
    period: { start: filters.start_date || null, end: filters.end_date || null },
    charges_billed: chargesBilled,
    clean_claim_rate: cleanClaimRate,
    denial_rate: denialRate,
    submitted_within_24h_pct: submittedWithin24hPct,
    total_open_ar: totalOpenAr,
    claim_count: claims.length,
  });
});

// GET /trends (grouped by date_of_service — MVP groups by day; swap for week/month bucketing as volume grows)
app.get("/api/v1/trends", (req, res) => {
  const db = load();
  const filters = getFilters(req);
  const claims = filterClaims(db, filters);

  const byDate = {};
  claims.forEach((c) => {
    const key = c.date_of_service;
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(c);
  });

  const points = Object.keys(byDate).sort().map((date) => {
    const dayClaims = byDate[date];
    const clean = +(100 * dayClaims.filter((c) => c.clean_first_pass).length / dayClaims.length).toFixed(1);
    const denial = +(100 * dayClaims.filter((c) => c.status === "denied").length / dayClaims.length).toFixed(1);
    const within24h = dayClaims.filter((c) => {
      const hrs = (new Date(c.submitted_at) - new Date(c.provider_signed_at)) / 36e5;
      return hrs <= 24;
    }).length;
    const submitted24h = +(100 * within24h / dayClaims.length).toFixed(1);
    return { period: date, clean_claim_rate: clean, denial_rate: denial, submitted_within_24h_pct: submitted24h };
  });

  res.json({ interval: "daily", points });
});

// GET /ar-aging
app.get("/api/v1/ar-aging", (req, res) => {
  const db = load();
  const filters = getFilters(req);
  const claims = filterClaims(db, filters).filter((c) => c.status !== "paid");
  const now = new Date();
  const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };

  claims.forEach((c) => {
    const days = Math.floor((now - new Date(c.date_of_service)) / 86400000);
    if (days <= 30) buckets["0-30"] += c.charge_amount;
    else if (days <= 60) buckets["31-60"] += c.charge_amount;
    else if (days <= 90) buckets["61-90"] += c.charge_amount;
    else buckets["90+"] += c.charge_amount;
  });

  res.json({ buckets: Object.entries(buckets).map(([range, amount]) => ({ range, amount })) });
});

// GET /denials/reasons
app.get("/api/v1/denials/reasons", (req, res) => {
  const db = load();
  const filters = getFilters(req);
  const claimIds = new Set(filterClaims(db, filters).map((c) => c.claim_id));
  const denials = db.denials.filter((d) => claimIds.has(d.claim_id));

  const counts = {};
  denials.forEach((d) => { counts[d.reason_code] = (counts[d.reason_code] || 0) + 1; });
  const total = denials.length || 1;

  res.json({
    total_denials: denials.length,
    reasons: Object.entries(counts).map(([code, count]) => ({
      code,
      count,
      pct: +(100 * count / total).toFixed(0),
    })),
  });
});

// GET /reconciliation
app.get("/api/v1/reconciliation", (req, res) => {
  const db = load();
  const { start_date, end_date } = getFilters(req);
  const rows = db.payments
    .filter((p) => !start_date || !end_date || (p.posted_at >= start_date && p.posted_at <= end_date + "T23:59:59Z"))
    .map((p) => ({
      date: p.posted_at.slice(0, 10),
      posted: p.posted_amount,
      bank_matched: p.bank_matched_amount,
      variance_amount: p.bank_matched_amount == null ? null : +(p.posted_amount - p.bank_matched_amount).toFixed(2),
      status: p.reconciliation_status,
    }));
  res.json({ days: rows });
});

// GET /providers/performance
app.get("/api/v1/providers/performance", (req, res) => {
  const db = load();
  const filters = getFilters(req);
  const claims = filterClaims(db, filters);

  const rows = db.providers.map((prov) => {
    const provClaims = claims.filter((c) => c.provider_id === prov.id);
    const charges = provClaims.reduce((s, c) => s + c.charge_amount, 0);
    const clean = provClaims.length
      ? +(100 * provClaims.filter((c) => c.clean_first_pass).length / provClaims.length).toFixed(1)
      : 0;
    const denialRate = provClaims.length
      ? +(100 * provClaims.filter((c) => c.status === "denied").length / provClaims.length).toFixed(1)
      : 0;
    return {
      provider_id: prov.id,
      provider: prov.name,
      claims: provClaims.length,
      charges,
      clean_claim_rate: clean,
      denial_rate: denialRate,
    };
  });

  res.json({ rows });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`MCC dashboard API listening on :${PORT}`));

module.exports = app;
