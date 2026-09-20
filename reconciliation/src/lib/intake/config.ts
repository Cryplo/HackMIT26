import "server-only";
import { IntakeError } from "./schema";
export function intakeMode() {
  if (process.env.RECONCILIATION_SYNTHETIC_ONLY !== "true")
    throw new IntakeError(
      "demo_scope_disabled",
      "Receipt upload is not enabled for this workspace.",
      503,
    );
  const mode = process.env.RECONCILIATION_INTAKE_MODE;
  if (mode !== "demo" && mode !== "live")
    throw new IntakeError(
      "mode_required",
      "Configure intake mode explicitly as demo or live.",
      503,
    );
  return mode;
}
