/**
 * CSV -> db.json importer.
 *
 * Point this at a folder of CSVs shaped like the templates in /templates
 * (claims.csv, denials.csv, payments.csv, bank_feed.csv — any subset is fine,
 * missing files are just skipped) and it merges them into data/db.json,
 * which server.js reads directly. No restart needed for the API to see new
 * data — it reads the file fresh on every request.
 *
 * Usage:
 *   node scripts/importCsv.js path/to/csv-folder
 *   node scripts/importCsv.js path/to/csv-folder --replace   (wipe existing records of that type first)
 *
 * Provider / location / payer are matched by NAME, not internal id — if a
 * name in the CSV doesn't exist yet in db.json, a new lookup entry is
 * created automatically so whoever exports from eCW never has to know or
 * generate internal ids.
 */
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const { load, save } = require("../lib/store");

const VALID_CLAIM_STATUS = ["draft", "scrubbed", "submitted", "accepted", "denied", "paid", "appealed"];
const VALID_REASON_CODE = ["auth_referral", "modifier", "eligibility", "coding_mismatch", "hcfa_error", "timely_filing", "other"];
const VALID_APPEAL_STATUS = ["none", "filed", "in_review", "won", "lost"];
const VALID_RECON_STATUS = ["matched", "variance", "unmatched", "pending"];

function readCsv(folder, filename) {
  const file = path.join(folder, filename);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf-8");
  return parse(raw, { columns: true, skip_empty_lines: true, trim: true });
}

function slugId(prefix, name) {
  return `${prefix}_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

function findOrCreate(list, name, prefix, extra = {}) {
  if (!name) return null;
  let entry = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!entry) {
    entry = { id: slugId(prefix, name), name, ...extra };
    list.push(entry);
    console.log(`  + created new ${prefix} lookup: "${name}" -> ${entry.id}`);
  }
  return entry.id;
}

function toBool(v) {
  if (typeof v === "boolean") return v;
  return String(v).trim().toLowerCase() === "true";
}

function validateEnum(value, allowed, field, rowLabel, warnings) {
  if (value && !allowed.includes(value)) {
    warnings.push(`${rowLabel}: "${field}" value "${value}" is not one of [${allowed.join(", ")}] — kept as-is, but check the source data.`);
  }
}

function importClaims(db, rows, replace, warnings) {
  if (!rows) return 0;
  if (replace) db.claims = [];
  let count = 0;
  rows.forEach((r, i) => {
    const rowLabel = `claims.csv row ${i + 2}`;
    if (!r.claim_id) { warnings.push(`${rowLabel}: missing claim_id, skipped.`); return; }

    const provider_id = findOrCreate(db.providers, r.provider_name, "p");
    const location_id = findOrCreate(db.locations, r.location_name, "l", { facility_type: "clinic" });
    const payer_id = findOrCreate(db.payers, r.payer_name, "pay");

    validateEnum(r.status, VALID_CLAIM_STATUS, "status", rowLabel, warnings);

    const record = {
      claim_id: r.claim_id,
      provider_id, location_id, payer_id,
      date_of_service: r.date_of_service,
      provider_signed_at: r.provider_signed_at || null,
      submitted_at: r.submitted_at || null,
      status: r.status || "submitted",
      charge_amount: Number(r.charge_amount) || 0,
      clean_first_pass: toBool(r.clean_first_pass),
    };

    const existingIdx = db.claims.findIndex((c) => c.claim_id === record.claim_id);
    if (existingIdx >= 0) db.claims[existingIdx] = record;
    else db.claims.push(record);
    count++;
  });
  return count;
}

function importDenials(db, rows, replace, warnings) {
  if (!rows) return 0;
  if (replace) db.denials = [];
  let count = 0;
  rows.forEach((r, i) => {
    const rowLabel = `denials.csv row ${i + 2}`;
    if (!r.denial_id || !r.claim_id) { warnings.push(`${rowLabel}: missing denial_id or claim_id, skipped.`); return; }
    if (!db.claims.find((c) => c.claim_id === r.claim_id)) {
      warnings.push(`${rowLabel}: claim_id "${r.claim_id}" not found in claims — imported anyway, but check it.`);
    }
    validateEnum(r.reason_code, VALID_REASON_CODE, "reason_code", rowLabel, warnings);
    validateEnum(r.appeal_status, VALID_APPEAL_STATUS, "appeal_status", rowLabel, warnings);

    const record = {
      denial_id: r.denial_id,
      claim_id: r.claim_id,
      denied_at: r.denied_at || null,
      reason_code: r.reason_code || "other",
      resubmitted_at: r.resubmitted_at || null,
      appeal_status: r.appeal_status || "none",
      resolved_at: r.resolved_at || null,
    };
    const existingIdx = db.denials.findIndex((d) => d.denial_id === record.denial_id);
    if (existingIdx >= 0) db.denials[existingIdx] = record;
    else db.denials.push(record);
    count++;
  });
  return count;
}

function importPayments(db, rows, replace, warnings) {
  if (!rows) return 0;
  if (replace) db.payments = [];
  let count = 0;
  rows.forEach((r, i) => {
    const rowLabel = `payments.csv row ${i + 2}`;
    if (!r.payment_id || !r.claim_id) { warnings.push(`${rowLabel}: missing payment_id or claim_id, skipped.`); return; }
    validateEnum(r.reconciliation_status, VALID_RECON_STATUS, "reconciliation_status", rowLabel, warnings);

    const record = {
      payment_id: r.payment_id,
      claim_id: r.claim_id,
      posted_at: r.posted_at || null,
      posted_amount: Number(r.posted_amount) || 0,
      bank_deposit_id: r.bank_deposit_id || null,
      bank_matched_amount: r.bank_matched_amount ? Number(r.bank_matched_amount) : null,
      reconciliation_status: r.reconciliation_status || "pending",
    };
    const existingIdx = db.payments.findIndex((p) => p.payment_id === record.payment_id);
    if (existingIdx >= 0) db.payments[existingIdx] = record;
    else db.payments.push(record);
    count++;
  });
  return count;
}

function importBankFeed(db, rows, replace) {
  if (!rows) return 0;
  if (replace) db.bank_feed = [];
  rows.forEach((r) => {
    const record = { date: r.date, deposit_id: r.deposit_id, amount: Number(r.amount) || 0 };
    const existingIdx = db.bank_feed.findIndex((b) => b.deposit_id === record.deposit_id);
    if (existingIdx >= 0) db.bank_feed[existingIdx] = record;
    else db.bank_feed.push(record);
  });
  return rows.length;
}

function main() {
  const folder = process.argv[2];
  const replace = process.argv.includes("--replace");

  if (!folder) {
    console.error("Usage: node scripts/importCsv.js <folder-with-csvs> [--replace]");
    process.exit(1);
  }
  if (!fs.existsSync(folder)) {
    console.error(`Folder not found: ${folder}`);
    process.exit(1);
  }

  const db = load();
  const warnings = [];

  console.log(`Importing from ${folder}${replace ? " (--replace: existing records of matched types will be cleared)" : ""}\n`);

  const claimsRows = readCsv(folder, "claims.csv");
  const denialsRows = readCsv(folder, "denials.csv");
  const paymentsRows = readCsv(folder, "payments.csv");
  const bankFeedRows = readCsv(folder, "bank_feed.csv");

  const claimsCount = importClaims(db, claimsRows, replace, warnings);
  const denialsCount = importDenials(db, denialsRows, replace, warnings);
  const paymentsCount = importPayments(db, paymentsRows, replace, warnings);
  const bankFeedCount = importBankFeed(db, bankFeedRows, replace);

  // Backup before overwriting, in case something looks wrong after.
  const backupPath = path.join(__dirname, "..", "data", `db.backup.${Date.now()}.json`);
  fs.copyFileSync(path.join(__dirname, "..", "data", "db.json"), backupPath);

  save(db);

  console.log(`\nImported: ${claimsCount} claims, ${denialsCount} denials, ${paymentsCount} payments, ${bankFeedCount} bank feed rows.`);
  console.log(`Backup of previous data.json saved to: ${path.relative(process.cwd(), backupPath)}`);

  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`);
    warnings.forEach((w) => console.log(`  - ${w}`));
  }
  if (!claimsRows && !denialsRows && !paymentsRows && !bankFeedRows) {
    console.log("\nNo recognized CSV files found (looked for claims.csv, denials.csv, payments.csv, bank_feed.csv). Nothing imported.");
  }
}

main();
