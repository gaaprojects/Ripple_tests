import type { ReactNode } from "react";

export const metadata = {
  title: "fx-sentinel",
  description: "Compliance-gated FX treasury agent on XRPL",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          background: "#0b0e14",
          color: "#d7dce5",
        }}
      >
        {children}
      </body>
    </html>
  );
}
