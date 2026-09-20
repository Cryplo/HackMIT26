"use client";

import { useSyncExternalStore } from "react";
import { getWorkspaceStore } from "./client";

/** Session memory only. Preview and API snapshots never share a client or cache. */
export function useWorkspace(preview: boolean) {
  const store = getWorkspaceStore(preview ? "preview" : "api");
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return { client: store.client, ...snapshot, refresh: store.refresh };
}

export { checkClaims, type CheckProgress } from "./client";
