"use client";

import type { ShapContribution } from "@fx/shared";

/** Diverging SHAP contribution bars: red pushes risk up, green pulls it down. */
export function ShapBars({ shap, score }: { shap: ShapContribution[]; score: number }) {
  const max = Math.max(0.05, ...shap.map((s) => Math.abs(s.contribution)));
  const sorted = [...shap].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 5);
  return (
    <div>
      <div className="status-line" style={{ marginBottom: 4 }}>
        risk score {score.toFixed(3)} · SHAP drivers
      </div>
      {sorted.map((s) => {
        const w = (Math.abs(s.contribution) / max) * 50;
        return (
          <div key={s.feature} className="shap-row" title={`value: ${s.value}`}>
            <span className="feat">{s.feature}</span>
            <div className="shap-track">
              <span className="mid" />
              <span
                className={`bar ${s.contribution >= 0 ? "pos" : "neg"}`}
                style={{ width: `${w}%` }}
              />
            </div>
            <span className="val">
              {s.contribution >= 0 ? "+" : ""}
              {s.contribution.toFixed(3)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
