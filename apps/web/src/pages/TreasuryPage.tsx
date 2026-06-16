import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import type { TreasuryAgentRun, TreasuryGoal, TreasuryGoalCreate } from "@treasury/shared";

import { api } from "../lib/api.js";

const CURRENCIES = ["USD", "EUR", "CHF", "GBP"];

const DEFAULT_GOAL: TreasuryGoalCreate = {
  name: "Monthly supplier payment",
  beneficiaryName: "Acme Supplies AG",
  beneficiaryAddress: "rVENDOR0000000000000000000000000000",
  beneficiaryCountry: "US",
  receiverEntityType: "company",
  amount: 1000,
  currency: "USD",
  reference: "INV-AUTO-001",
  purpose: "supplier_payment",
  triggerIntervalHours: 0.001, // ~3.6 s — fires immediately for demo
};

export function TreasuryPage() {
  const [goals, setGoals] = useState<TreasuryGoal[]>([]);
  const [runs, setRuns] = useState<TreasuryAgentRun[]>([]);
  const [form, setForm] = useState<TreasuryGoalCreate>(DEFAULT_GOAL);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [g, r] = await Promise.all([api.listTreasuryGoals(), api.listTreasuryRuns()]);
      setGoals(g);
      setRuns(r);
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const addGoal = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createTreasuryGoal(form);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [form, refresh]);

  const deleteGoal = useCallback(async (id: string) => {
    try {
      await api.deleteTreasuryGoal(id);
      await refresh();
    } catch (cause) {
      setError(String(cause));
    }
  }, [refresh]);

  const triggerRun = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      await api.triggerTreasuryRun();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  }, [refresh]);

  const field = (key: keyof TreasuryGoalCreate) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.type === "number" ? Number(e.target.value) : e.target.value }));

  return (
    <section className="send-flow" aria-label="Autonomous treasury agent">
      <div className="send-left">
        <div className="send-topbar">
          <div>
            <span className="eyebrow">Autonomous agent · Phase 2.3</span>
            <h1>Treasury payment goals</h1>
          </div>
          <span className="policy-pill">code decides · LLM narrates</span>
        </div>

        <p className="tagline">
          The agent evaluates goals on each cycle and fires those whose deterministic trigger condition
          is met. The <strong>only actuator</strong> is <code>orchestrator.process_payment</code> — the
          full compliance screen and Firefly hardware veto still apply. Large payments triggered by the
          agent are still locked on-chain.
        </p>

        {error && <p className="error">{error}</p>}

        {/* Add goal form */}
        <section className="recipient-panel" aria-label="New goal">
          <div className="section-heading">
            <span className="eyebrow">New goal</span>
            <strong>Payment target &amp; trigger</strong>
          </div>
          <label><span>Goal name</span>
            <input value={form.name} onChange={field("name")} disabled={busy} />
          </label>
          <label><span>Beneficiary name</span>
            <input value={form.beneficiaryName} onChange={field("beneficiaryName")} disabled={busy} />
          </label>
          <label><span>Beneficiary XRPL address</span>
            <input value={form.beneficiaryAddress} onChange={field("beneficiaryAddress")} disabled={busy} spellCheck={false} />
          </label>
          <div className="recipient-meta">
            <label><span>Country</span>
              <input value={form.beneficiaryCountry} onChange={field("beneficiaryCountry")} disabled={busy} />
            </label>
            <label><span>Currency</span>
              <select value={form.currency} onChange={field("currency")} disabled={busy}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <div className="recipient-meta">
            <label><span>Amount</span>
              <input type="number" value={form.amount} onChange={field("amount")} disabled={busy} min={0} />
            </label>
            <label><span>Trigger interval (hours)</span>
              <input type="number" value={form.triggerIntervalHours} onChange={field("triggerIntervalHours")} disabled={busy} min={0} step={0.001} />
            </label>
          </div>
          <label><span>Reference</span>
            <input value={form.reference} onChange={field("reference")} disabled={busy} />
          </label>
          <label><span>Purpose</span>
            <input value={form.purpose} onChange={field("purpose")} disabled={busy} />
          </label>
        </section>

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button className="primary-action" type="button" disabled={busy} onClick={() => void addGoal()}>
            {busy ? "Adding..." : "Add goal"}
          </button>
          <button className="primary-action" type="button" disabled={running || goals.length === 0} onClick={() => void triggerRun()}>
            {running ? "Running..." : "Run agent cycle now"}
          </button>
        </div>

        {/* Active goals */}
        <section className="queue">
          <h2>Active goals ({goals.length})</h2>
          {goals.length === 0 && <p className="muted">No goals yet. Add one above to get started.</p>}
          {goals.map((goal) => (
            <article className="decision-row" key={goal.id}>
              <div>
                <strong>{goal.name}</strong>
                <p className="muted">
                  {goal.amount.toLocaleString()} {goal.currency} → {goal.beneficiaryName} ({goal.beneficiaryCountry})
                  · every {goal.triggerIntervalHours}h
                </p>
                <p className="muted">
                  {goal.lastTriggeredAt
                    ? `Last fired: ${new Date(goal.lastTriggeredAt).toLocaleString()}`
                    : "Never triggered"}
                </p>
              </div>
              <div className="decision-actions">
                <span className={`dashboard-status ${goal.enabled ? "status-settled" : "status-blocked"}`}>
                  {goal.enabled ? "Enabled" : "Disabled"}
                </span>
                <button className="text-action" type="button" onClick={() => void deleteGoal(goal.id)}>
                  Remove
                </button>
              </div>
            </article>
          ))}
        </section>

        {/* Run history */}
        <section className="queue">
          <h2>Recent runs ({runs.length})</h2>
          {runs.length === 0 && <p className="muted">No runs yet. Click "Run agent cycle now" above.</p>}
          {runs.map((run) => (
            <article className="decision-row" key={run.id}>
              <div>
                <strong>
                  {run.goalsTriggered}/{run.goalsEvaluated} goals fired
                  <span className={`dashboard-status status-${run.goalsTriggered > 0 ? "settled" : "routing"}`} style={{ marginLeft: "0.5rem" }}>
                    {run.status}
                  </span>
                </strong>
                <p className="muted">{new Date(run.startedAt).toLocaleString()}</p>
                {run.narration && <p className="audit">{run.narration}</p>}
                <ul className="credential-log">
                  {run.triggerLog.map((line, i) => (
                    <li key={i} className="muted">{line}</li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </section>
      </div>
    </section>
  );
}
