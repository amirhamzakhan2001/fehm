import { BASE_CONFIG, box, FONT, LABEL_H, type LayoutConfig, type LayoutInputNode } from "./layout.js";
import { measure } from "./text.js";
import type { Confidence, DiagramLayout, LayoutEdge, LayoutNode, Lifeline, RelationshipType, ViewType } from "./types.js";

/**
 * Sequence (timeline) layout for the runtime view: participants in a row,
 * a lifeline under each, one message per row in call order. Each label sits
 * in the gap beside its caller's lifeline, and that gap is widened to fit it,
 * so no label ever crosses another lifeline.
 */

export interface SequenceMessage {
  id: string;
  source: string;
  target: string;
  label: string;
  type: RelationshipType;
  confidence: Confidence;
  order: number;
}

export interface SequenceInput {
  kind: "sequence";
  view: ViewType;
  focus?: string;
  participants: LayoutInputNode[];
  messages: SequenceMessage[];
}

export function layoutSequence(input: SequenceInput, config: LayoutConfig = BASE_CONFIG): DiagramLayout {
  const boxes = input.participants.map((p) => box(p));
  const index = new Map(boxes.map((b, i) => [b.id, i]));
  const height = Math.max(0, ...boxes.map((b) => b.height));
  // Gap i separates the centers of participants i and i+1.
  const gaps = boxes.slice(1).map((b, i) => boxes[i]!.width / 2 + b.width / 2 + config.nodeGap);
  const messages = input.messages.filter((m) => index.has(m.source) && index.has(m.target) && m.source !== m.target);
  const labelW = (m: SequenceMessage): number => Math.ceil(measure(m.label, FONT.label, 500)) + 12;
  for (const m of messages) {
    const a = index.get(m.source)!;
    const b = index.get(m.target)!;
    const g = a < b ? a : a - 1; // the gap beside the caller, toward the callee
    gaps[g] = Math.max(gaps[g]!, labelW(m) + 2 * 12);
  }
  const xs: number[] = [config.margin + (boxes[0]?.width ?? 0) / 2];
  for (let i = 0; i < gaps.length; i += 1) xs.push(xs[i]! + gaps[i]!);
  const top = config.margin;
  const nodes: LayoutNode[] = boxes.map((b, i) => ({ ...b, x: round(xs[i]! - b.width / 2), y: round(top + (height - b.height) / 2), layer: 0 }));
  const row = LABEL_H + 16 + config.trackGap;
  let y = top + height + 26 + LABEL_H;
  const edges: LayoutEdge[] = [];
  for (const m of [...messages].sort((p, q) => p.order - q.order)) {
    const a = index.get(m.source)!;
    const b = index.get(m.target)!;
    const x1 = xs[a]!;
    const x2 = xs[b]!;
    const w = labelW(m);
    const lx = a < b ? x1 + 10 : x1 - 10 - w;
    edges.push({
      id: m.id,
      source: m.source,
      target: m.target,
      points: [{ x: round(x1), y: round(y) }, { x: round(x2), y: round(y) }],
      weight: 1,
      type: m.type,
      confidence: m.confidence,
      order: m.order,
      label: { text: m.label, x: round(lx), y: round(y - 5 - LABEL_H), width: w, height: LABEL_H },
    });
    y += row;
  }
  const bottom = y - row + 26;
  const lifelines: Lifeline[] = nodes.map((n, i) => ({ node: n.id, x: round(xs[i]!), y1: n.y + n.height, y2: round(Math.max(bottom, n.y + n.height + 40)) }));
  const right = Math.max(...nodes.map((n) => n.x + n.width), ...edges.map((e) => e.label!.x + e.label!.width), config.margin);
  const minX = Math.min(0, ...edges.map((e) => e.label!.x - config.margin));
  const out: DiagramLayout = {
    view: input.view,
    kind: "sequence",
    nodes,
    edges,
    boundaries: [],
    lifelines,
    viewBox: { x: minX, y: 0, width: round(right + config.margin - minX), height: round(Math.max(...lifelines.map((l) => l.y2), top + height) + config.margin) },
    metrics: { crossings: 0, bends: 0, layers: 1 },
  };
  if (input.focus) out.focus = input.focus;
  return out;
}

function round(v: number): number {
  return Math.round(v * 2) / 2;
}
