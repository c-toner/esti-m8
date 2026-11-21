import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Civil Estimator",
  description: "Evidence-led civil construction estimating",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
