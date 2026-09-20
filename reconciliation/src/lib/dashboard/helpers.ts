import type { ReviewsResponse } from "./types";

export const statusLabel = (value: string) => value.replaceAll("_", " ");
export function money(value: number | null | undefined, currency: string | null = "USD") {
  if (value == null || !Number.isFinite(value) || !currency) return "—";
  if (currency !== "USD") return `${(value / 100).toFixed(2)} ${currency}`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
}
export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(date);
}
export function percent(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "Not provided" : `${(value * 100).toFixed(1)}%`;
}
export class DashboardError extends Error {
  constructor(public readonly code: string, message: string, public readonly status?: number) {
    super(message);
    this.name = "DashboardError";
  }
}
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal, method?: string): Promise<T> {
  const response = await fetch(path, {
    method: method ?? (body === undefined ? "GET" : "POST"), credentials: "same-origin", cache: "no-store", signal,
    ...(body === undefined ? {} : body instanceof FormData ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new DashboardError(
    data?.error?.code || "REQUEST_FAILED",
    data?.error?.message || `Request failed (${response.status}).`, response.status,
  );
  if (!data || typeof data !== "object") throw new DashboardError("INVALID_RESPONSE", "The API returned an empty or invalid response.");
  return data as T;
}
export function validateReviews(data: ReviewsResponse): ReviewsResponse {
  if (data?.contract_version !== 2) throw new DashboardError("CONTRACT_VERSION", "The review API needs the v2 upgrade. Open the explicit preview to explore the interface.");
  if (!Array.isArray(data.submissions) || !data.summary || !data.execution ||
      typeof data.snapshot_token !== "string" || !Number.isInteger(data.knowledge_revision) ||
      typeof data.demo_mode !== "boolean" || !Number.isFinite(data.summary.approved_amount_minor)) {
    throw new DashboardError("INVALID_RESPONSE", "The reviews API returned an incompatible v2 response.");
  }
  return data;
}
