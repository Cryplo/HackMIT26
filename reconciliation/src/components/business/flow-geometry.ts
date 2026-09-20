export type FlowNode = "waiting" | "checking" | "investigations" | "passed" | "uncertain" | "failed";
export type NodeBox = { left: number; top: number; right: number; bottom: number };
export type Point = [number, number];
export type FlowEdge = { from: FlowNode; to: FlowNode; points: Point[] };
export const transferDuration = (elapsedMs: number) => Math.max(200, Math.min(1500, elapsedMs * .15));
export const pathOf = (points: Point[]) => points.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`).join(" ");

/** Routes use only node borders and the gutters reserved by the graph grid. */
export function flowEdges(boxes: Record<FlowNode, NodeBox>, width: number): FlowEdge[] {
  const { waiting: w, checking: c, investigations: i, passed: p } = boxes;
  const cx = (box: NodeBox) => (box.left + box.right) / 2;
  const cy = (box: NodeBox) => (box.top + box.bottom) / 2;
  const mobile = c.top >= w.bottom;
  const desktop = p.left > c.right;
  const edges: FlowEdge[] = [{ from: "waiting", to: "checking", points: mobile
    ? [[cx(w), w.bottom], [cx(w), (w.bottom + c.top) / 2], [cx(c), (w.bottom + c.top) / 2], [cx(c), c.top]]
    : [[w.right, cy(w)], [(w.right + c.left) / 2, cy(w)], [(w.right + c.left) / 2, cy(c)], [c.left, cy(c)]] },
  { from: "checking", to: "investigations", points: [[cx(c), c.bottom], [cx(c), i.top]] }];
  for (const destination of ["passed", "uncertain", "failed"] as const) {
    const d = boxes[destination];
    for (const source of ["checking", "investigations"] as const) {
      const s = boxes[source];
      let points: Point[];
      if (desktop) {
        const trunk = (c.right + p.left) / 2;
        points = [[s.right, cy(s)], [trunk, cy(s)], [trunk, cy(d)], [d.left, cy(d)]];
      } else if (mobile) {
        const trunk = Math.max(8, Math.min(c.left, i.left, d.left) / 2);
        points = [[s.left, cy(s)], [trunk, cy(s)], [trunk, cy(d)], [d.left, cy(d)]];
      } else {
        const junction = (i.bottom + p.top) / 2;
        points = source === "checking"
          ? [[c.right, cy(c)], [width - 9, cy(c)], [width - 9, junction], [cx(d), junction], [cx(d), d.top]]
          : [[cx(i), i.bottom], [cx(i), junction], [cx(d), junction], [cx(d), d.top]];
      }
      edges.push({ from: source, to: destination, points });
    }
  }
  return edges;
}
