"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { InvestigationRun } from "@/lib/dashboard/types";
import { flowEdges, pathOf, transferDuration, type FlowEdge, type FlowNode, type NodeBox } from "./flow-geometry";
import styles from "./audit-flow.module.css";

type Activity = { id: string; node: FlowNode; run?: InvestigationRun };
type Snapshot = { id: string; node: FlowNode; started?: string; steps: { id: string; status: string; started_at: string; completed_at: string | null }[] };
export type FlowEvent = { id: string; from: FlowNode; to: FlowNode; duration: number; at: number };
const isActive = (node: FlowNode) => node === "checking" || node === "investigations";
const recordedStart = (value: string | undefined, now: number) => value && Number.isFinite(Date.parse(value)) ? Math.min(now, Date.parse(value)) : now;

/** Observe published transitions; elapsed time never estimates future progress. */
export function useFlowActivity(items: Activity[]) {
  const previous = useRef<Map<string, Snapshot> | null>(null);
  const starts = useRef(new Map<string, number>());
  const [state, setState] = useState<{ starts: Record<string, number>; events: FlowEvent[] }>({ starts: {}, events: [] });
  const [now, setNow] = useState(0);
  const key = JSON.stringify(items.map(({ id, node, run }) => ({ id, node, started: run?.started_at, steps: run?.steps.map(({ id, status, started_at, completed_at }) => ({ id, status, started_at, completed_at })) ?? [] })));
  const running = items.some(item => isActive(item.node));
  useEffect(() => {
    const time = Date.now();
    const current = new Map((JSON.parse(key) as Snapshot[]).map(item => [item.id, item]));
    const events: FlowEvent[] = [];
    for (const [id, item] of current) {
      const prior = previous.current?.get(id);
      const began = starts.current.get(id) ?? time;
      if (prior && prior.node !== item.node && (isActive(prior.node) || isActive(item.node))) {
        events.push({ id: `${id}-${item.node}-${time}`, from: prior.node, to: item.node, at: time, duration: transferDuration(isActive(prior.node) ? time - began : 0) });
      }
      if (item.node === "investigations" && prior?.node === "investigations") {
        for (const step of item.steps) {
          if (step.status !== "completed" || prior.steps.some(old => old.id === step.id && old.status === "completed")) continue;
          const duration = step.completed_at ? Date.parse(step.completed_at) - Date.parse(step.started_at) : time - began;
          events.push({ id: `${id}-${step.id}`, from: "investigations", to: "investigations", at: time, duration: transferDuration(Number.isFinite(duration) ? Math.max(0, duration) : 0) });
        }
      }
      if (isActive(item.node)) {
        if (!prior || prior.node !== item.node) starts.current.set(id, item.node === "investigations" ? recordedStart(item.started, time) : time);
      } else starts.current.delete(id);
    }
    for (const id of starts.current.keys()) if (!current.has(id)) starts.current.delete(id);
    previous.current = current;
    setNow(time);
    setState(old => ({ starts: Object.fromEntries(starts.current), events: [...old.events.filter(event => event.at + event.duration > time), ...events] }));
  }, [key]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  useEffect(() => {
    if (!state.events.length) return;
    const timer = window.setTimeout(() => setState(old => ({ ...old, events: [] })), Math.max(...state.events.map(event => event.at + event.duration)) - Date.now() + 50);
    return () => window.clearTimeout(timer);
  }, [state.events]);
  return { events: state.events, elapsed: (id: string) => state.starts[id] ? `${Math.max(0, Math.floor((now - state.starts[id]) / 1000))}s elapsed` : "Starting…" };
}

const beginMotion = (node: SVGElement | null) => { (node as SVGAnimationElement | null)?.beginElement(); };

export function FlowConnectors({ graph, events }: { graph: RefObject<HTMLDivElement | null>; events: FlowEvent[] }) {
  const marker = useId();
  const [layout, setLayout] = useState<{ width: number; height: number; edges: FlowEdge[]; investigation: [number, number] } | null>(null);
  useEffect(() => {
    const element = graph.current;
    if (!element) return;
    let frame = 0;
    const nodes = [...element.querySelectorAll<HTMLElement>("[data-flow-node]")];
    const measure = () => {
      const outer = element.getBoundingClientRect();
      const boxes = Object.fromEntries(nodes.map(node => {
        const box = node.getBoundingClientRect();
        return [node.dataset.flowNode, { left: box.left - outer.left, top: box.top - outer.top, right: box.right - outer.left, bottom: box.bottom - outer.top }];
      })) as Record<FlowNode, NodeBox>;
      if (Object.keys(boxes).length !== 7) return;
      const next = { width: outer.width, height: outer.height, edges: flowEdges(boxes, outer.width), investigation: [(boxes.investigations.left + boxes.investigations.right) / 2, boxes.investigations.top] as [number, number] };
      setLayout(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    };
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); });
    observer.observe(element);
    nodes.forEach(node => observer.observe(node));
    measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [graph]);
  if (!layout) return null;
  return <svg className={styles.graphConnectors} width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
    <defs><marker id={marker} viewBox="0 0 6 6" refX="6" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L6 3L0 6" className={styles.arrowhead} /></marker></defs>
    {layout.edges.map(edge => <path key={`${edge.from}-${edge.to}`} data-flow-edge={`${edge.from}-${edge.to}`} d={pathOf(edge.points)} className={styles.graphEdge} markerEnd={`url(#${marker})`} />)}
    {events.map(event => {
      if (event.from === event.to) return <circle key={event.id} cx={layout.investigation[0]} cy={layout.investigation[1]} r="5" className={styles.stepPulse} style={{ animationDuration: `${event.duration}ms` }} />;
      const edge = layout.edges.find(edge => edge.from === event.from && edge.to === event.to);
      const reverse = !edge && layout.edges.find(edge => edge.to === event.from && edge.from === event.to);
      const points = edge?.points ?? (reverse ? [...reverse.points].reverse() : null);
      return points && <circle key={event.id} r="3.5" className={styles.destinationDot} data-destination={event.to}>
        <animateMotion ref={beginMotion} begin="indefinite" dur={`${event.duration}ms`} repeatCount="1" fill="freeze" path={pathOf(points)} />
      </circle>;
    })}
  </svg>;
}
