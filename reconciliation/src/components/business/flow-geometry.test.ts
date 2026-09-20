import assert from "node:assert/strict";
import { test } from "node:test";
import { flowEdges, transferDuration, type FlowNode, type NodeBox } from "./flow-geometry";

const box = (left: number, top: number, width: number, height: number): NodeBox => ({ left, top, right: left + width, bottom: top + height });
const layouts: { width: number; boxes: Record<FlowNode, NodeBox> }[] = [
  { width: 1000, boxes: { waiting: box(26, 26, 240, 240), checking: box(310, 26, 240, 240), investigations: box(26, 310, 524, 250), passed: box(594, 26, 380, 170), uncertain: box(594, 208, 380, 170), failed: box(594, 390, 380, 170) } },
  { width: 700, boxes: { waiting: box(18, 22, 300, 215), checking: box(356, 22, 316, 215), investigations: box(18, 275, 654, 250), passed: box(18, 563, 211, 186), uncertain: box(239, 563, 211, 186), failed: box(460, 563, 212, 186) } },
  { width: 360, boxes: { waiting: box(36, 22, 308, 176), checking: box(36, 230, 308, 190), investigations: box(36, 452, 308, 260), passed: box(36, 744, 308, 156), uncertain: box(36, 932, 308, 156), failed: box(36, 1120, 308, 156) } },
];

test("measured routes meet every node border without crossing any card, and timing follows observed work", () => {
  assert.equal(transferDuration(100), 200);
  assert.equal(transferDuration(4000), 600);
  assert.equal(transferDuration(60000), 1500);
  for (const { boxes, width } of layouts) {
    const edges = flowEdges(boxes, width);
    assert.equal(edges.length, 8);
    for (const edge of edges) {
      const border = ([x, y]: number[], b: NodeBox) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom && (x === b.left || x === b.right || y === b.top || y === b.bottom);
      assert.ok(border(edge.points[0], boxes[edge.from]), `${edge.from} starts on its border`);
      assert.ok(border(edge.points.at(-1)!, boxes[edge.to]), `${edge.to} ends on its border`);
      for (let i = 1; i < edge.points.length; i++) {
        const [x1, y1] = edge.points[i - 1], [x2, y2] = edge.points[i];
        assert.ok(x1 === x2 || y1 === y2, "routes are orthogonal");
        for (const b of Object.values(boxes)) {
          const crosses = x1 === x2
            ? x1 > b.left && x1 < b.right && Math.max(y1, y2) > b.top && Math.min(y1, y2) < b.bottom
            : y1 > b.top && y1 < b.bottom && Math.max(x1, x2) > b.left && Math.min(x1, x2) < b.right;
          assert.ok(!crosses, `${edge.from} → ${edge.to} does not cross a card`);
        }
      }
    }
  }
});
