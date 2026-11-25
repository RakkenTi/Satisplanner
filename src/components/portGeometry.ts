import { ITEMS, RECIPES } from '../data/catalog';
import { resolveLogisticsItemId } from '../engine/solver';
import type { FactoryEdge, FactoryNode } from '../engine/types';

export const RECIPE_NODE_WIDTH = 288;
export const COMPACT_NODE_WIDTH = 204;

// Exact vertical layout constants matching NodeCard CSS
const HEADER_HEIGHT = 48;
const METRICS_HEIGHT = 39;
const PORTS_TOP_PAD = 7;
const PORT_ROW_HEIGHT = 28;
const PORT_ROW_GAP = 4;

export function getNodeWidth(node: FactoryNode): number {
  return node.kind === 'recipe' ? RECIPE_NODE_WIDTH : COMPACT_NODE_WIDTH;
}

export function getNodePortLists(
  node: FactoryNode,
  edges: FactoryEdge[],
): { inputs: string[]; outputs: string[] } {
  if (node.kind === 'recipe' && node.recipeId && RECIPES[node.recipeId]) {
    const r = RECIPES[node.recipeId];
    return {
      inputs: Object.keys(r.in),
      outputs: Object.keys(r.out),
    };
  }
  const itemId = resolveLogisticsItemId(node, edges) ?? '__any__';
  if (node.kind === 'input') return { inputs: [], outputs: [itemId] };
  if (node.kind === 'sink') return { inputs: [itemId], outputs: [] };
  return { inputs: [itemId], outputs: [itemId] };
}

export function getNodeHeightEstimate(node: FactoryNode, edges: FactoryEdge[]): number {
  const { inputs, outputs } = getNodePortLists(node, edges);
  const rows = Math.max(inputs.length, outputs.length, 1);
  if (node.kind === 'recipe') {
    return HEADER_HEIGHT + METRICS_HEIGHT + PORTS_TOP_PAD * 2 + rows * PORT_ROW_HEIGHT + (rows - 1) * PORT_ROW_GAP;
  }
  // Compact node (splitter / merger / input / sink) has header + 1 port row
  return 44 + PORTS_TOP_PAD * 2 + PORT_ROW_HEIGHT;
}

export function getPortAnchor(
  node: FactoryNode,
  direction: 'input' | 'output',
  itemId: string,
  edges: FactoryEdge[],
): { x: number; y: number } {
  const width = getNodeWidth(node);
  const x = direction === 'input' ? node.x : node.x + width;

  if (node.kind !== 'recipe') {
    // Compact logistics node: header (44px) + top pad (7px) + half row (14px)
    return { x, y: node.y + 44 + PORTS_TOP_PAD + PORT_ROW_HEIGHT / 2 };
  }

  const { inputs, outputs } = getNodePortLists(node, edges);
  const list = direction === 'input' ? inputs : outputs;
  const idx = Math.max(0, list.indexOf(itemId));
  const y =
    node.y +
    HEADER_HEIGHT +
    METRICS_HEIGHT +
    PORTS_TOP_PAD +
    idx * (PORT_ROW_HEIGHT + PORT_ROW_GAP) +
    PORT_ROW_HEIGHT / 2;

  return { x, y };
}

export function isItemFluid(itemId: string): boolean {
  return Boolean(ITEMS[itemId]?.isFluid);
}
