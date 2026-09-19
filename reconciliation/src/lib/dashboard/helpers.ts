import type { ReviewsResponse } from "./types";
export const statusLabel = (value: string) => value.replaceAll("_", " ");
export function money(
  value: number | null | undefined,
  currency: string | null = "USD",
) {
  if (value == null || !currency) return "Unknown";
  if (currency !== "USD")
    return `${(value / 100).toFixed(2)} ${currency} · unsupported`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value / 100);
}
export function percent(value: number | null | undefined) {
  return value == null || !Number.isFinite(value)
    ? "Not provided"
    : `${(value * 100).toFixed(1)}%`;
}
export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      data?.error?.message || `Request failed (${response.status}).`,
    );
  if (data === null)
    throw new Error("The API returned an empty or invalid response.");
  return data as T;
}
export function validateReviews(data: ReviewsResponse): ReviewsResponse {
  if (
    !data ||
    !Array.isArray(data.submissions) ||
    !data.summary ||
    typeof data.demo_mode !== "boolean" ||
    !Number.isFinite(data.summary.approved_amount_minor) ||
    !Number.isFinite(data.summary.flag_rate) ||
    !Array.isArray(data.summary.top_flag_reasons)
  )
    throw new Error("The reviews API returned an incompatible response.");
  return data;
}
