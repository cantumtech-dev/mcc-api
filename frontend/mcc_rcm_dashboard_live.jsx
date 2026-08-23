import React, { useEffect, useState } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from "recharts";
import {
  ChevronDown, CheckCircle2, AlertTriangle, Clock, FileCheck2, Landmark,
  TrendingUp, TrendingDown, ShieldCheck, Loader2,
} from "lucide-react";

/* ---------------------------------------------------------------
   TOKENS — same ledger/audit-statement aesthetic as the mock build.
----------------------------------------------------------------*/
const INK = "#14213D";
const INK_SOFT = "#4A5568";
const PAPER = "#F5F6F3";
const PAPER_RAISED = "#FFFFFF";
const RULE = "#DCDFE3";
const TEAL = "#0F6E66";
const TEAL_SOFT = "#E4F0EE";
const BRICK = "#A5321F";
const BRICK_SOFT = "#F6E7E3";
const AMBER = "#96661B";

const fontDisplay = "'Source Serif 4', Georgia, serif";
const fontMono = "'IBM Plex Mono', 'SFMono-Regular', Menlo, monospace";
const fontUI = "'Inter', -apple-system, sans-serif";

// Point this at wherever the MVP backend (server.js) is running/deployed.
const API_BASE =
  (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE) ||
  "http://localhost:4000/api/v1";

const DENIAL_REASON_META = {
  auth_referral: { label: "Auth / referral missing", color: BRICK },
  modifier: { label: "Modifier error", color: AMBER },
  eligibility: { label: "Eligibility", color: "#5B7A99" },
  coding_mismatch: { label: "Coding mismatch", color: "#7A6BA6" },
  hcfa_error: { label: "HCFA form error", color: "#8A5A44" },
  timely_filing: { label: "Timely filing", color: "#6B7B8C" },
  other: { label: "Other", color: "#94A0AC" },
};

const PERIODS = ["Daily", "Weekly", "Monthly"];

const fmtUSD = (n) =>
  (n || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

async function getJSON(path, params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v))
  ).toString();
  const res = await fetch(`${API_BASE}${path}${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

/* ---------------------------------------------------------------
   SMALL UI PRIMITIVES
----------------------------------------------------------------*/
function Dropdown({ label, value, options, onChange }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontFamily: fontUI }}>
      <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: INK_SOFT }}>
        {label}
      </span>
      <div style={{ position: "relative" }}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            appearance: "none", WebkitAppearance: "none", background: PAPER_RAISED,
            border: `1px solid ${RULE}`, borderRadius: 4, padding: "8px 30px 8px 10px",
            fontSize: 13, color: INK, fontFamily: fontUI, minWidth: 150, cursor: "pointer",
          }}
        >
          {options.map((o) => (
            <option key={o.id || o} value={o.id || o}>{o.name || o}</option>
          ))}
        </select>
        <ChevronDown size={14} color={INK_SOFT} style={{ position: "absolute", right: 10, top: 10, pointerEvents: "none" }} />
      </div>
    </label>
  );
}

function KpiCard({ label, value, icon: Icon, accent }) {
  return (
    <div style={{ background: PAPER_RAISED, border: `1px solid ${RULE}`, borderTop: `3px solid ${accent}`, borderRadius: 6, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: fontUI, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: INK_SOFT }}>{label}</span>
        <Icon size={15} color={accent} />
      </div>
      <div style={{ fontFamily: fontMono, fontSize: 26, color: INK, fontWeight: 600, letterSpacing: "-0.01em" }}>{value}</div>
    </div>
  );
}

function SectionHeading({ eyebrow, title }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {eyebrow && <div style={{ fontFamily: fontUI, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: TEAL, marginBottom: 4 }}>{eyebrow}</div>}
      <h3 style={{ fontFamily: fontDisplay, fontSize: 18, color: INK, margin: 0, fontWeight: 600 }}>{title}</h3>
    </div>
  );
}

function Panel({ children, style }) {
  return <div style={{ background: PAPER_RAISED, border: `1px solid ${RULE}`, borderRadius: 6, padding: 20, ...style }}>{children}</div>;
}

function LoadingRow({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: INK_SOFT, fontFamily: fontUI, fontSize: 12, padding: "24px 0" }}>
      <Loader2 size={14} className="spin" style={{ animation: "spin 1s linear infinite" }} />
      {label}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ErrorNote({ message }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: BRICK, background: BRICK_SOFT, borderRadius: 4, padding: "8px 12px", fontFamily: fontUI, fontSize: 12 }}>
      <AlertTriangle size={13} /> {message}
    </div>
  );
}

/* ---------------------------------------------------------------
   MAIN DASHBOARD — fetches everything from the MVP API in server.js
----------------------------------------------------------------*/
export default function RCMDashboardLive() {
  const [options, setOptions] = useState({ providers: [], locations: [], payers: [] });
  const [provider, setProvider] = useState("");
  const [location, setLocation] = useState("");
  const [payer, setPayer] = useState("");
  const [period, setPeriod] = useState("Weekly");

  const [kpis, setKpis] = useState(null);
  const [trend, setTrend] = useState([]);
  const [arAging, setArAging] = useState([]);
  const [denialReasons, setDenialReasons] = useState([]);
  const [reconciliation, setReconciliation] = useState([]);
  const [providerTable, setProviderTable] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load dropdown options once.
  useEffect(() => {
    getJSON("/filters/options").then(setOptions).catch(() => {});
  }, []);

  // Re-fetch everything whenever a filter changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = { provider_id: provider, location_id: location, payer_id: payer };

    Promise.all([
      getJSON("/kpis", params),
      getJSON("/trends", params),
      getJSON("/ar-aging", params),
      getJSON("/denials/reasons", params),
      getJSON("/reconciliation", {}),
      getJSON("/providers/performance", params),
    ])
      .then(([k, t, ar, dr, rc, pt]) => {
        if (cancelled) return;
        setKpis(k);
        setTrend(t.points || []);
        setArAging(ar.buckets || []);
        setDenialReasons(
          (dr.reasons || []).map((r) => ({
            name: DENIAL_REASON_META[r.code]?.label || r.code,
            value: r.pct,
            color: DENIAL_REASON_META[r.code]?.color || "#94A0AC",
          }))
        );
        setReconciliation(rc.days || []);
        setProviderTable(pt.rows || []);
      })
      .catch((e) => !cancelled && setError(`Couldn't reach the dashboard API (${API_BASE}). Is the backend running? — ${e.message}`))
      .finally(() => !cancelled && setLoading(false));

    return () => { cancelled = true; };
  }, [provider, location, payer]);

  const agingOver30Pct = arAging.length
    ? Math.round((arAging.filter((b) => b.range !== "0-30").reduce((s, b) => s + b.amount, 0) / (arAging.reduce((s, b) => s + b.amount, 0) || 1)) * 100)
    : 0;

  return (
    <div style={{ background: PAPER, minHeight: "100%", padding: "28px 28px 40px", fontFamily: fontUI }}>
      {/* HEADER */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16, marginBottom: 22, borderBottom: `1px solid ${RULE}`, paddingBottom: 18 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: TEAL, marginBottom: 6 }}>
            Cantum RCM &nbsp;·&nbsp; Live Client Dashboard
          </div>
          <h1 style={{ fontFamily: fontDisplay, fontSize: 30, color: INK, margin: 0, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Medical Care Center — Revenue Cycle Dashboard
          </h1>
          <div style={{ fontFamily: fontMono, fontSize: 12, color: INK_SOFT, marginTop: 6 }}>
            Data source: {API_BASE}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: TEAL_SOFT, border: `1px solid ${TEAL}30`, borderRadius: 6, padding: "8px 12px" }}>
          <ShieldCheck size={16} color={TEAL} />
          <span style={{ fontSize: 12, color: TEAL, fontWeight: 600 }}>Reconciled via nightly batch job</span>
        </div>
      </div>

      {/* FILTER BAR */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "flex-end", background: PAPER_RAISED, border: `1px solid ${RULE}`, borderRadius: 6, padding: "16px 18px", marginBottom: 24 }}>
        <Dropdown label="Provider" value={provider} options={[{ id: "", name: "All Providers" }, ...options.providers]} onChange={setProvider} />
        <Dropdown label="Location / Facility" value={location} options={[{ id: "", name: "All Locations" }, ...options.locations]} onChange={setLocation} />
        <Dropdown label="Payer" value={payer} options={[{ id: "", name: "All Payers" }, ...options.payers]} onChange={setPayer} />
        <Dropdown label="Reporting Interval" value={period} options={PERIODS} onChange={setPeriod} />
      </div>

      {error && <div style={{ marginBottom: 20 }}><ErrorNote message={error} /></div>}
      {loading && !kpis && <LoadingRow label="Loading live figures…" />}

      {kpis && (
        <>
          {/* KPI STRIP */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 28 }}>
            <KpiCard label="Charges Billed" value={fmtUSD(kpis.charges_billed)} icon={Landmark} accent={TEAL} />
            <KpiCard label="First-Pass Clean Claim Rate" value={`${kpis.clean_claim_rate}%`} icon={FileCheck2} accent={TEAL} />
            <KpiCard label="Denial Rate" value={`${kpis.denial_rate}%`} icon={AlertTriangle} accent={BRICK} />
            <KpiCard label="Claims Out <24hrs of Signature" value={`${kpis.submitted_within_24h_pct}%`} icon={Clock} accent={TEAL} />
            <KpiCard label="Total Open AR" value={fmtUSD(kpis.total_open_ar)} icon={CheckCircle2} accent={AMBER} />
            <KpiCard label="AR Aged 30+ Days" value={`${agingOver30Pct}%`} icon={AlertTriangle} accent={AMBER} />
          </div>

          {/* ROW: TRENDS + DENIAL REASONS */}
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 18, marginBottom: 22 }}>
            <Panel>
              <SectionHeading eyebrow="Performance trend" title="Clean claims vs. denials over time" />
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={trend} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={RULE} vertical={false} />
                  <XAxis dataKey="period" tick={{ fontFamily: fontMono, fontSize: 11, fill: INK_SOFT }} axisLine={{ stroke: RULE }} tickLine={false} />
                  <YAxis tick={{ fontFamily: fontMono, fontSize: 11, fill: INK_SOFT }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip contentStyle={{ fontFamily: fontUI, fontSize: 12, border: `1px solid ${RULE}`, borderRadius: 4 }} formatter={(v) => `${v}%`} />
                  <Line type="monotone" dataKey="clean_claim_rate" name="Clean claim rate" stroke={TEAL} strokeWidth={2.5} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="denial_rate" name="Denial rate" stroke={BRICK} strokeWidth={2.5} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="submitted_within_24h_pct" name="Out <24hrs" stroke={AMBER} strokeWidth={2} strokeDasharray="4 3" dot={false} />
                  <Legend wrapperStyle={{ fontFamily: fontUI, fontSize: 11, paddingTop: 8 }} />
                </LineChart>
              </ResponsiveContainer>
            </Panel>

            <Panel>
              <SectionHeading eyebrow="Root cause" title="Denial reasons this period" />
              {denialReasons.length ? (
                <ResponsiveContainer width="100%" height={230}>
                  <PieChart>
                    <Pie data={denialReasons} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={2}>
                      {denialReasons.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ fontFamily: fontUI, fontSize: 12, border: `1px solid ${RULE}`, borderRadius: 4 }} formatter={(v) => `${v}%`} />
                    <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontFamily: fontUI, fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ color: INK_SOFT, fontSize: 12, padding: "40px 0", textAlign: "center" }}>No denials in this period.</div>
              )}
            </Panel>
          </div>

          {/* ROW: AR AGING + RECONCILIATION */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 18, marginBottom: 22 }}>
            <Panel>
              <SectionHeading eyebrow="Working the difficult 40%" title="AR aging by bucket" />
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={arAging} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={RULE} vertical={false} />
                  <XAxis dataKey="range" tick={{ fontFamily: fontMono, fontSize: 11, fill: INK_SOFT }} axisLine={{ stroke: RULE }} tickLine={false} />
                  <YAxis tick={{ fontFamily: fontMono, fontSize: 10, fill: INK_SOFT }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v / 1000}k`} />
                  <Tooltip contentStyle={{ fontFamily: fontUI, fontSize: 12, border: `1px solid ${RULE}`, borderRadius: 4 }} formatter={(v) => fmtUSD(v)} />
                  <Bar dataKey="amount" radius={[3, 3, 0, 0]}>
                    {arAging.map((b, i) => <Cell key={i} fill={i >= 2 ? BRICK : i === 1 ? AMBER : TEAL} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel>
              <SectionHeading eyebrow="Daily payment posting" title="Posted vs. bank statement reconciliation (nightly batch)" />
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: fontUI, fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: INK_SOFT, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    <th style={{ padding: "6px 8px", borderBottom: `1px solid ${RULE}` }}>Date</th>
                    <th style={{ padding: "6px 8px", borderBottom: `1px solid ${RULE}` }}>Posted</th>
                    <th style={{ padding: "6px 8px", borderBottom: `1px solid ${RULE}` }}>Bank matched</th>
                    <th style={{ padding: "6px 8px", borderBottom: `1px solid ${RULE}` }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciliation.map((r, i) => (
                    <tr key={i}>
                      <td style={{ padding: "8px 8px", fontFamily: fontMono, borderBottom: `1px solid ${RULE}` }}>{r.date}</td>
                      <td style={{ padding: "8px 8px", fontFamily: fontMono, borderBottom: `1px solid ${RULE}` }}>{fmtUSD(r.posted)}</td>
                      <td style={{ padding: "8px 8px", fontFamily: fontMono, borderBottom: `1px solid ${RULE}` }}>{r.bank_matched != null ? fmtUSD(r.bank_matched) : "—"}</td>
                      <td style={{ padding: "8px 8px", borderBottom: `1px solid ${RULE}` }}>
                        {r.status === "matched" && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: TEAL_SOFT, color: TEAL, borderRadius: 4, padding: "3px 8px", fontSize: 11, fontWeight: 600 }}>
                            <CheckCircle2 size={12} /> Matched
                          </span>
                        )}
                        {r.status === "variance" && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: BRICK_SOFT, color: BRICK, borderRadius: 4, padding: "3px 8px", fontSize: 11, fontWeight: 600 }}>
                            <AlertTriangle size={12} /> Variance {r.variance_amount != null ? fmtUSD(r.variance_amount) : ""}
                          </span>
                        )}
                        {r.status === "pending" && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#EEE", color: INK_SOFT, borderRadius: 4, padding: "3px 8px", fontSize: 11, fontWeight: 600 }}>
                            <Clock size={12} /> Pending nightly run
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </div>

          {/* PROVIDER BREAKDOWN TABLE */}
          <Panel>
            <SectionHeading eyebrow="By provider" title="Performance breakdown" />
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: fontUI, fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: INK_SOFT, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  <th style={{ padding: "6px 8px", borderBottom: `1px solid ${RULE}` }}>Provider</th>
                  <th style={{ padding: "6px 8px", borderBottom: `1px solid ${RULE}` }}>Claims</th>
                  <th style={{ padding: "6px 8px", borderBottom: `1px solid ${RULE}` }}>Charges</th>
                  <th style={{ padding: "6px 8px", borderBottom: `1px solid ${RULE}` }}>Clean claim %</th>
                  <th style={{ padding: "6px 8px", borderBottom: `1px solid ${RULE}` }}>Denial rate</th>
                </tr>
              </thead>
              <tbody>
                {providerTable.map((p, i) => (
                  <tr key={i}>
                    <td style={{ padding: "9px 8px", borderBottom: `1px solid ${RULE}`, fontWeight: 600, color: INK }}>{p.provider}</td>
                    <td style={{ padding: "9px 8px", borderBottom: `1px solid ${RULE}`, fontFamily: fontMono }}>{p.claims}</td>
                    <td style={{ padding: "9px 8px", borderBottom: `1px solid ${RULE}`, fontFamily: fontMono }}>{fmtUSD(p.charges)}</td>
                    <td style={{ padding: "9px 8px", borderBottom: `1px solid ${RULE}`, fontFamily: fontMono, color: p.clean_claim_rate >= 96 ? TEAL : INK }}>{p.clean_claim_rate}%</td>
                    <td style={{ padding: "9px 8px", borderBottom: `1px solid ${RULE}`, fontFamily: fontMono, color: p.denial_rate >= 5 ? BRICK : INK }}>{p.denial_rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </div>
  );
}
