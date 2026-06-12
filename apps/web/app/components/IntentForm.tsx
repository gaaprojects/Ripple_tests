"use client";

import { useState } from "react";
import { createIntent, type Counterparties } from "../lib/api";

type Preset = { key: keyof Counterparties; label: string; amount: number; currency: "RLUSD" | "EUD" | "XRP"; purpose: string };

/** The scripted demo beats — one click each (SPEC §9 demo flow). */
const PRESETS: Preset[] = [
  { key: "ok", label: "AUTO · 5 EUD invoice", amount: 5, currency: "EUD", purpose: "Supplier invoice #1041" },
  { key: "ok", label: "VETO · 400 RLUSD (over max)", amount: 400, currency: "RLUSD", purpose: "Quarterly settlement" },
  { key: "fresh", label: "VETO · uncredentialed", amount: 20, currency: "RLUSD", purpose: "New vendor onboarding" },
  { key: "sanctioned", label: "BLOCK · sanctioned", amount: 50, currency: "RLUSD", purpose: "Should never settle" },
  { key: "hot", label: "VETO · refill float 300 RLUSD", amount: 300, currency: "RLUSD", purpose: "Hot float replenishment" },
];

export function IntentForm({
  counterparties,
  onSubmitted,
}: {
  counterparties: Counterparties | null;
  onSubmitted: () => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [value, setValue] = useState("25");
  const [currency, setCurrency] = useState<"RLUSD" | "EUD" | "XRP">("RLUSD");
  const [purpose, setPurpose] = useState("");
  const [corridor, setCorridor] = useState("CH-EU");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const applyPreset = (p: Preset) => {
    const cp = counterparties?.[p.key];
    if (!cp) return;
    setName(cp.label);
    setAddress(cp.address);
    setValue(String(p.amount));
    setCurrency(p.currency);
    setPurpose(p.purpose);
  };

  const submit = async () => {
    if (!address || !Number(value)) return;
    setBusy(true);
    setResult(null);
    const res = await createIntent({
      beneficiary: { name: name || undefined, address },
      amount: { value: Number(value), currency },
      purpose,
      corridor,
    });
    setBusy(false);
    if (res.ok) {
      const d = res.data as { decision?: { outcome: string; matched_rule: string } };
      setResult(`→ ${d.decision?.outcome ?? "?"} (rule: ${d.decision?.matched_rule ?? "?"})`);
    } else {
      setResult(`✗ rejected: ${JSON.stringify(res.data)}`);
    }
    onSubmitted();
  };

  return (
    <div className="form-grid">
      <div className="preset-row">
        {PRESETS.map((p) => (
          <button key={p.label} className="preset" onClick={() => applyPreset(p)} disabled={!counterparties}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="field">
        <label>Beneficiary name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alpine Suppliers AG" />
      </div>
      <div className="field">
        <label>Destination address</label>
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="r…" spellCheck={false} />
      </div>
      <div className="row2">
        <div className="field">
          <label>Amount</label>
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" />
        </div>
        <div className="field">
          <label>Currency</label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value as never)}>
            <option>RLUSD</option>
            <option>EUD</option>
            <option>XRP</option>
          </select>
        </div>
      </div>
      <div className="row2">
        <div className="field">
          <label>Purpose</label>
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="invoice / settlement…" />
        </div>
        <div className="field">
          <label>Corridor</label>
          <select value={corridor} onChange={(e) => setCorridor(e.target.value)}>
            <option>CH-EU</option>
            <option>EU-US</option>
            <option>CH-US</option>
            <option value="">UNKNOWN</option>
          </select>
        </div>
      </div>
      <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !address}>
        {busy ? "Running pipeline…" : "Submit intent"}
      </button>
      {result && <div className="submit-result">{result}</div>}
    </div>
  );
}
