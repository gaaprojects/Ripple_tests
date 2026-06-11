// Dashboard skeleton (SPEC §5.14). Full views (pipeline feed, approval queue, treasury,
// audit explorer) land in P2/P4/P5. This boot page proves the app + bridge wiring.
async function getBridgeInfo(): Promise<
  { pubkey: string; fw_version: string; simulated: boolean } | null
> {
  const port = process.env.BRIDGE_HTTP_PORT ?? "8787";
  try {
    const res = await fetch(`http://127.0.0.1:${port}/device/info`, { cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export default async function Home() {
  const device = await getBridgeInfo();
  return (
    <main style={{ padding: "2rem", maxWidth: 880 }}>
      <h1 style={{ fontSize: "1.4rem" }}>fx-sentinel</h1>
      <p style={{ color: "#8b93a7" }}>
        Compliance-gated FX treasury agent on XRPL Testnet. Dashboard skeleton (P0).
      </p>

      {device?.simulated && (
        <div
          style={{
            background: "#3a1d1d",
            border: "1px solid #ff5c5c",
            color: "#ff9b9b",
            padding: "0.5rem 0.9rem",
            borderRadius: 6,
            margin: "1rem 0",
            fontWeight: 700,
            letterSpacing: "0.04em",
          }}
        >
          ⚠ SIMULATED DEVICE — not a physical Firefly (D12)
        </div>
      )}

      <section style={{ marginTop: "1.5rem" }}>
        <h2 style={{ fontSize: "1rem", color: "#8b93a7" }}>Device bridge</h2>
        {device ? (
          <pre style={{ background: "#11151f", padding: "1rem", borderRadius: 6, overflowX: "auto" }}>
            {JSON.stringify(device, null, 2)}
          </pre>
        ) : (
          <p style={{ color: "#ff9b9b" }}>Bridge not reachable — start it with `pnpm dev:bridge`.</p>
        )}
      </section>
    </main>
  );
}
