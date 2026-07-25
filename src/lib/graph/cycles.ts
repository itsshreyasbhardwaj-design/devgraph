/**
 * Strongly-connected-component analysis.
 *
 * Implemented iteratively (explicit stack rather than recursion) because real
 * repositories produce dependency graphs deep enough to blow the call stack.
 */

export interface AdjacencyList {
  nodes: string[];
  edges: Map<string, string[]>;
}

export function buildAdjacency(
  nodes: Iterable<string>,
  edges: Iterable<{ source: string; target: string }>,
): AdjacencyList {
  const nodeList = [...nodes];
  const map = new Map<string, string[]>();
  for (const node of nodeList) map.set(node, []);
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    const list = map.get(edge.source);
    if (!list) continue;
    if (!map.has(edge.target)) continue;
    if (!list.includes(edge.target)) list.push(edge.target);
  }
  return { nodes: nodeList, edges: map };
}

/** Tarjan's strongly connected components, in reverse topological order. */
export function stronglyConnectedComponents(graph: AdjacencyList): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  for (const root of graph.nodes) {
    if (index.has(root)) continue;

    // Each frame is [node, nextNeighbourIndex].
    const work: [string, number][] = [[root, 0]];
    index.set(root, counter);
    lowlink.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const [node, cursor] = frame;
      const neighbours = graph.edges.get(node) ?? [];

      if (cursor < neighbours.length) {
        frame[1] += 1;
        const next = neighbours[cursor];
        if (!index.has(next)) {
          index.set(next, counter);
          lowlink.set(next, counter);
          counter += 1;
          stack.push(next);
          onStack.add(next);
          work.push([next, 0]);
        } else if (onStack.has(next)) {
          lowlink.set(node, Math.min(lowlink.get(node)!, index.get(next)!));
        }
        continue;
      }

      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1][0];
        lowlink.set(parent, Math.min(lowlink.get(parent)!, lowlink.get(node)!));
      }

      if (lowlink.get(node) === index.get(node)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== node);
        components.push(component);
      }
    }
  }

  return components;
}

/**
 * Cycles worth reporting: any SCC with more than one member, plus explicit
 * self-loops. Members are ordered so the rendered cycle reads sensibly.
 */
export function findCycles(graph: AdjacencyList, selfLoops: string[] = []): string[][] {
  const cycles = stronglyConnectedComponents(graph)
    .filter((component) => component.length > 1)
    .map((component) => orderCycle(component, graph));
  for (const node of selfLoops) cycles.push([node]);
  return cycles.sort((a, b) => b.length - a.length);
}

/** Walk the component to produce a readable A → B → C → A ordering. */
function orderCycle(component: string[], graph: AdjacencyList): string[] {
  const members = new Set(component);
  const start = [...component].sort()[0];
  const ordered = [start];
  const visited = new Set([start]);
  let current = start;

  while (ordered.length < component.length) {
    const next = (graph.edges.get(current) ?? []).find((n) => members.has(n) && !visited.has(n));
    if (!next) {
      const remaining = component.filter((n) => !visited.has(n));
      for (const node of remaining) {
        ordered.push(node);
        visited.add(node);
      }
      break;
    }
    ordered.push(next);
    visited.add(next);
    current = next;
  }

  return ordered;
}

/** Edges that close a cycle, keyed as `source->target`. */
export function cyclicEdgeKeys(cycles: string[][]): Set<string> {
  const keys = new Set<string>();
  for (const cycle of cycles) {
    for (let i = 0; i < cycle.length; i += 1) {
      const source = cycle[i];
      const target = cycle[(i + 1) % cycle.length];
      keys.add(`${source}->${target}`);
    }
  }
  return keys;
}

/**
 * Longest-path layering for a DAG-ish graph. Nodes inside a cycle collapse onto
 * the same layer so the layered renderer stays stable.
 */
export function computeLayers(graph: AdjacencyList): Map<string, number> {
  const inDegree = new Map<string, number>();
  for (const node of graph.nodes) inDegree.set(node, 0);
  for (const [, targets] of graph.edges) {
    for (const target of targets) inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
  }

  const layer = new Map<string, number>();
  const queue: string[] = [];
  for (const node of graph.nodes) {
    if ((inDegree.get(node) ?? 0) === 0) {
      layer.set(node, 0);
      queue.push(node);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const node = queue[head];
    head += 1;
    const current = layer.get(node) ?? 0;
    for (const target of graph.edges.get(node) ?? []) {
      layer.set(target, Math.max(layer.get(target) ?? 0, current + 1));
      const remaining = (inDegree.get(target) ?? 0) - 1;
      inDegree.set(target, remaining);
      if (remaining === 0) queue.push(target);
    }
  }

  // Anything left is inside a cycle — park it just past its deepest predecessor.
  for (const node of graph.nodes) {
    if (!layer.has(node)) layer.set(node, 0);
  }

  return layer;
}

/** Maximum depth of the layering, useful for graph stats. */
export function graphDepth(layers: Map<string, number>): number {
  let max = 0;
  for (const value of layers.values()) max = Math.max(max, value);
  return max;
}
