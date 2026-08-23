const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "db.json");

function load() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

function save(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// --- filtering helpers -------------------------------------------------
function inRange(dateStr, start, end) {
  if (!start && !end) return true;
  const d = new Date(dateStr);
  if (start && d < new Date(start)) return false;
  if (end && d > new Date(end)) return false;
  return true;
}

function filterClaims(db, { provider_id, location_id, payer_id, start_date, end_date }) {
  return db.claims.filter((c) => {
    if (provider_id && c.provider_id !== provider_id) return false;
    if (location_id && c.location_id !== location_id) return false;
    if (payer_id && c.payer_id !== payer_id) return false;
    if (!inRange(c.date_of_service, start_date, end_date)) return false;
    return true;
  });
}

module.exports = { load, save, filterClaims, inRange, DB_PATH };
