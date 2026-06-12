import type { ReactNode } from "react";
import "./globals.css";

// Fonts are local stacks (globals.css) — no build-time/CDN font fetch, so the console
// builds and renders identically on venue Wi-Fi or fully offline (SPEC: boring reliability).
export const metadata = {
  title: "FX-SENTINEL · treasury operations console",
  description:
    "Compliance-gated FX treasury agent on XRPL Testnet — AI reads, policy decides, hardware signs.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
