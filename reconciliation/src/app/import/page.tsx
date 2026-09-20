import { AppShell } from "@/components/business/AppShell";
import ImportWorkspace from "./import-workspace";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  const mode = process.env.RECONCILIATION_EXTRACTION_MODE || process.env.RECONCILIATION_INTAKE_MODE;
  return (
    <AppShell view="sources" preview={false}>
      <header className="mb-6">
        <h1 className="text-[28px] font-semibold leading-9 tracking-tight">Data sources</h1>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">Inspect source files and connect evidence before importing claims.</p>
      </header>
      <ImportWorkspace simulatedReview={process.env.RECONCILIATION_MODE === "simulated"} mode={mode === "demo" ? "demo" : mode === "live" ? "live" : "unconfigured"} />
    </AppShell>
  );
}
