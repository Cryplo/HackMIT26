import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sift · Reimbursements",
  description: "A workspace for reviewing travel claims and original receipt evidence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
