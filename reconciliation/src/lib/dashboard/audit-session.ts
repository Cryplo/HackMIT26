"use client";

import * as React from "react";
import { checkClaims, getWorkspaceStore } from "./client";
import type { ReviewRow } from "./types";
import type { SourceAudit } from '../inbox/schema';
import { readSourceActivity, recordSourceActivity } from '../inbox/activity';

export interface AuditSnapshot {
  status: "idle" | "running" | "stopping" | "complete" | "failed";
  total: number;
  done: number;
  checkingIds: string[];
  completedIds: string[];
  error: string;
  notice: string;
  startedAt: number | null;
  sources: SourceAudit | null;
}

const initial: AuditSnapshot = {
  status: "idle", total: 0, done: 0, checkingIds: [], completedIds: [], error: "", notice: "", startedAt: null, sources: null,
};

export function isAuditEligible(row: ReviewRow) {
  return row.decision_status === "pending" && row.decision_source !== "human"
    && !row.decisions.some(check => check.check_method === "human")
    && !row.assessment_status && !row.latest_run_id && row.processing_status === "idle"
    && row.latest_investigation?.status !== "running"
    && (!row.receipt || row.receipt.extraction_status === "succeeded");
}

type Workspace = Pick<ReturnType<typeof getWorkspaceStore>, "client" | "refresh" | "getSnapshot">;

/** The session owns the loop; leaving a page only unsubscribes its view. */
export function createAuditSession(workspace: Workspace, sourceRequest?: (advance: boolean) => Promise<SourceAudit>) {
  let snapshot = initial;
  let stopRequested = false;
  const listeners = new Set<() => void>();
  // Uncertain writes require individual review, never a retry through Resume.
  const attempted = new Set<string>();
  const failures = new Map<string, string>();
  function publish(next: Partial<AuditSnapshot>) {
    snapshot = { ...snapshot, ...next };
    listeners.forEach(listener => listener());
  }
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async loadSources() {
      if (!sourceRequest || snapshot.status === 'running' || snapshot.status === 'stopping') return;
      try { publish({ sources: await sourceRequest(false) }); }
      catch { publish({ error: 'Could not load incoming sources. Reload before starting a source audit.' }); }
    },
    stop() {
      if (snapshot.status !== "running") return;
      stopRequested = true;
      publish({ status: "stopping" });
    },
    async start() {
      if (snapshot.status === "running" || snapshot.status === "stopping") return;
      stopRequested = false;
      publish({ ...initial, sources: snapshot.sources, status: "running", startedAt: Date.now() });
      let error = "";
      let emailWarnings = 0;
      try {
        if (sourceRequest) {
          let sources = await sourceRequest(false);
          publish({ sources });
          while (sources.enabled && sources.phase !== 'ready' && sources.phase !== 'failed' && !stopRequested) {
            sources = await sourceRequest(true);
            publish({ sources });
          }
          if (sources.enabled && sources.phase === 'failed') throw new Error(sources.error);
        }
        await workspace.refresh();
        const data = workspace.getSnapshot().data;
        if (!data) throw new Error("Unable to load claims for this audit.");
        const ids = data.submissions.filter(row => isAuditEligible(row) && !attempted.has(row.id))
          .sort((a, b) => Date.parse(a.submitted_at) - Date.parse(b.submitted_at) || a.id.localeCompare(b.id))
          .map(row => row.id);
        const cadence = workspace.client.mode === "preview" || data.demo_mode ? 450 : 0;
        publish({ total: ids.length });
        let next = 0;
        async function worker() {
          while (next < ids.length && !stopRequested) {
            const id = ids[next++];
            const current = workspace.getSnapshot().data?.submissions.find(row => row.id === id);
            // A human decision or another checker may have changed the queued row.
            if (!current || !isAuditEligible(current)) {
              publish({ total: snapshot.total - 1 });
              continue;
            }
            const began = Date.now();
            attempted.add(id);
            try {
              const result = await checkClaims(workspace.client, [id], progress => {
                publish({ checkingIds: progress.checkingIds.length ? [...snapshot.checkingIds, id] : snapshot.checkingIds.filter(checking => checking !== id),
                  ...(progress.done ? { done: snapshot.done + progress.done, completedIds: [...snapshot.completedIds, ...progress.completedIds] } : {}),
                });
              });
              emailWarnings += result.emailWarnings?.length ?? 0;
              if (emailWarnings) publish({ notice: `${emailWarnings} email notice${emailWarnings === 1 ? " needs" : "s need"} attention. Claim checks are saved; open applicant communication to review delivery.` });
            } catch (failure) {
              const message = `${failure instanceof Error ? failure.message : "Claim check failed."} Review claim ${id} before checking it again; Resume skips failed attempts.`;
              failures.set(id, message);
              error ||= message;
              stopRequested = true;
              publish({ status: "stopping", error, checkingIds: snapshot.checkingIds.filter(checking => checking !== id) });
              return;
            }
            const remaining = cadence - (Date.now() - began);
            if (remaining > 0 && !stopRequested) await new Promise(resolve => setTimeout(resolve, remaining));
          }
        }
        // Match backend concurrency while exposing each saved claim immediately.
        await Promise.all(Array.from({ length: Math.min(3, ids.length) }, () => worker()));
      } catch (failure) {
        error = failure instanceof Error ? failure.message : "Audit could not finish.";
      }
      try {
        await workspace.refresh();
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : "Unable to refresh saved claims.";
        error = error ? `${error} Refresh failed: ${message}` : `Refresh failed: ${message}`;
      }
      const unresolved = workspace.getSnapshot().data?.submissions.filter(row => failures.has(row.id) && isAuditEligible(row)) ?? [];
      if (unresolved.length) {
        error = `${unresolved.length} failed attempt${unresolved.length === 1 ? " remains" : "s remain"} for individual review. ${error || failures.get(unresolved[0].id)}`;
      }
      publish({ status: error ? "failed" : stopRequested ? "idle" : "complete", checkingIds: [], error });
    },
  };
}

const sessions = new Map<boolean, ReturnType<typeof createAuditSession>>();

async function sourceRequest(advance: boolean): Promise<SourceAudit> {
  const response = await fetch('/api/inbox/audit', advance ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } : undefined);
  const state = await response.json();
  if (!response.ok) throw new Error(state.error?.message || 'Could not read incoming sources.');
  if (state.enabled && advance) {
    const used = new Set((state as SourceAudit).imports.flatMap(item => item.document_ids));
    const previous = readSourceActivity();
    for (const document of (state as SourceAudit).documents) {
      const status = document.error ? 'failed' : used.has(document.id) ? 'confirmed' : 'parsed';
      if (previous.some(item => item.id === document.id && item.status === status)) continue;
      recordSourceActivity({ id: document.id, name: document.filename,
      source: document.file_type === 'text/csv' ? 'forms' : document.evidence?.document_kind === 'email' ? 'email' : 'dropbox',
      status, at: Date.now() });
    }
  }
  return state;
}

export function useAudit(preview: boolean) {
  let session = sessions.get(preview);
  if (!session) {
    session = createAuditSession(getWorkspaceStore(preview ? "preview" : "api"), preview ? undefined : sourceRequest);
    sessions.set(preview, session);
  }
  const snapshot = React.useSyncExternalStore(session.subscribe, session.getSnapshot, session.getServerSnapshot);
  React.useEffect(() => { void session.loadSources(); }, [session]);
  return { ...snapshot, start: session.start, stop: session.stop };
}
