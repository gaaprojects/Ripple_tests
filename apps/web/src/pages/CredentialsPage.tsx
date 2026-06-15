import { useCallback, useEffect, useState } from "react";
import type { CredentialIssueRequest, CredentialRecord } from "@treasury/shared";

import { api } from "../lib/api.js";

const STATUS_LABEL: Record<CredentialRecord["status"], string> = {
  issued: "Issued · awaiting accept",
  accepted: "Accepted",
  verified: "Verified on-ledger",
  refused: "Refused in code",
  failed: "Failed",
};

const SUBJECTS = [
  { label: "Vendor Alpha", name: "Vendor Alpha", account: "rVENDOR0000000000000000000000000000" },
  { label: "Supplier Zurich", name: "Supplier Zurich", account: "rSUPPLIER000000000000000000000000000" },
  { label: "Unverified counterparty", name: "Unverified Co", account: "rUNVERIFIED00000000000000000000000" },
  { label: "Sanctioned (refusal demo)", name: "ACME Shell Co", account: "rSANCTIONED000000000000000000000000" },
];

export function CredentialsPage() {
  const [records, setRecords] = useState<CredentialRecord[]>([]);
  const [subjectIndex, setSubjectIndex] = useState(0);
  const [subject, setSubject] = useState(SUBJECTS[0].account);
  const [subjectName, setSubjectName] = useState(SUBJECTS[0].name);
  const [credentialType, setCredentialType] = useState("KYC");
  const [uri, setUri] = useState("https://kyc.example/vc/123");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRecords(await api.listCredentials());
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const selected = SUBJECTS[subjectIndex];
    setSubject(selected.account);
    setSubjectName(selected.name);
  }, [subjectIndex]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const req: CredentialIssueRequest = {
        subject: subject.trim(),
        subjectName: subjectName.trim() || null,
        credentialType: credentialType.trim() || null,
        uri: uri.trim() || null,
      };
      await api.issueCredential(req);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [subject, subjectName, credentialType, uri, refresh]);

  const act = useCallback(
    async (action: () => Promise<CredentialRecord>) => {
      setError(null);
      try {
        await action();
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [refresh],
  );

  return (
    <section className="send-flow" aria-label="Credential issuing agent">
      <div className="send-topbar">
        <div>
          <span className="eyebrow">Credential agent</span>
          <h1>Issue XRPL credentials</h1>
        </div>
        <span className="policy-pill">XLS-70 · code decides</span>
      </div>

      <p className="tagline">
        A second agent issues on-ledger KYC credentials (CredentialCreate). A deterministic
        sanctions screen — not the AI — decides whether issuance is allowed. The subject must
        accept before the credential is usable.
      </p>

      {error && <p className="error">{error}</p>}

      <section className="recipient-panel" aria-label="New credential">
        <div className="section-heading">
          <span className="eyebrow">New credential</span>
          <strong>Subject &amp; type</strong>
        </div>
        <label>
          <span>Saved subject</span>
          <select value={subjectIndex} onChange={(e) => setSubjectIndex(Number(e.target.value))} disabled={busy}>
            {SUBJECTS.map((option, index) => (
              <option key={option.account} value={index}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Subject name</span>
          <input value={subjectName} onChange={(e) => setSubjectName(e.target.value)} disabled={busy} />
        </label>
        <label>
          <span>Subject address</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={busy} spellCheck={false} />
        </label>
        <div className="recipient-meta">
          <label>
            <span>Credential type</span>
            <input value={credentialType} onChange={(e) => setCredentialType(e.target.value)} disabled={busy} />
          </label>
          <label>
            <span>VC URI (off-chain)</span>
            <input value={uri} onChange={(e) => setUri(e.target.value)} disabled={busy} spellCheck={false} />
          </label>
        </div>
      </section>

      <button
        className="primary-action"
        type="button"
        disabled={busy || subject.trim().length === 0}
        onClick={() => void submit()}
      >
        {busy ? "Issuing..." : "Issue credential"}
      </button>

      <section className="queue">
        <h2>Issued credentials</h2>
        {records.length === 0 && <p className="muted">No credentials issued yet.</p>}
        {records.map((record) => (
          <article className="decision-row" key={record.id}>
            <div>
              <strong>
                {record.credentialType} for {record.subjectName ?? record.subject}
              </strong>
              <p>
                <span className={`dashboard-status status-${record.status}`}>
                  {STATUS_LABEL[record.status]}
                </span>{" "}
                {record.auditExplanation ?? record.refusedReason ?? ""}
              </p>
              <code>{record.subject.slice(0, 18)}...</code>
              {record.txHash && <code> · create {record.txHash.slice(0, 12)}...</code>}
              {record.acceptTxHash && <code> · accept {record.acceptTxHash.slice(0, 12)}...</code>}
            </div>
            <div className="decision-actions">
              {record.explorerUrl && (
                <a href={record.explorerUrl} target="_blank" rel="noreferrer">
                  Explorer
                </a>
              )}
              {(record.status === "issued" || record.status === "accepted") && (
                <button
                  className="text-action"
                  type="button"
                  onClick={() => void act(() => api.acceptCredential(record.id))}
                >
                  Accept (subject)
                </button>
              )}
              {record.status !== "refused" && record.status !== "failed" && (
                <button
                  className="text-action"
                  type="button"
                  onClick={() => void act(() => api.verifyCredential(record.id))}
                >
                  Verify
                </button>
              )}
            </div>
          </article>
        ))}
      </section>
    </section>
  );
}
