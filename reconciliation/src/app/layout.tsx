import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Fieldnotes · Hackathon reimbursements",
  description: "Synthetic hackathon reimbursement demo",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
