// View-only projection: never synthesize an edge from a candidate or observation.
export function projectServiceGraph(snapshot, query = "") {
  const candidates = new Map(snapshot.candidates.map((c) => [c.id, c]));
  const resolutions = new Set(snapshot.resolutions.map((r) => r.id));
  const q = query.trim().toLowerCase();
  const included = snapshot.dependencies.filter((edge) => {
    const c = candidates.get(edge.candidateId);
    return (
      edge.environment === snapshot.environment &&
      c?.eligibility === "enabled" &&
      c.targetResolution === "unique" &&
      c.target === edge.target &&
      c.source === edge.source &&
      c.resolutionId === edge.resolutionId &&
      resolutions.has(edge.resolutionId)
    );
  });
  const edges = included
    .filter((e) =>
      `${e.source} ${e.target} ${candidates.get(e.candidateId).name}`
        .toLowerCase()
        .includes(q),
    )
    .map((e) => ({
      ...e,
      name: candidates.get(e.candidateId).name,
      consistency: candidates.get(e.candidateId).consistency,
    }));
  const sourceIds = [
    ...new Set(
      q
        ? edges.map((c) => c.source)
        : [
            ...snapshot.candidates.map((c) => c.source),
            ...(snapshot.callers ?? []),
          ],
    ),
  ].sort();
  const targetIds = [...new Set(edges.map((e) => e.target))]
    .filter((id) => !sourceIds.includes(id))
    .sort();
  let height = Math.max(
      340,
      Math.max(sourceIds.length, targetIds.length) * 125 + 100,
    ),
    width = 660;
  const place = (ids, x, kind) =>
    ids.map((id, i) => ({
      id,
      x,
      y: (height / (ids.length + 1)) * (i + 1),
      kind: kind ?? edges.find((e) => e.target === id)?.targetKind ?? "service",
    }));
  const nodes = [...place(sourceIds, 40, "service"), ...place(targetIds, 440)];
  const multi =
    (snapshot.callers?.length ??
      new Set(snapshot.candidates.map((c) => c.source)).size) > 1;
  if (multi && nodes.length) {
    // Condense mutually reachable nodes so cycles never cause infinite ranking.
    const reachable = (id) => {
      const seen = new Set(),
        queue = [id];
      while (queue.length) {
        const current = queue.pop();
        if (seen.has(current)) continue;
        seen.add(current);
        queue.push(
          ...edges.filter((e) => e.source === current).map((e) => e.target),
        );
      }
      return seen;
    };
    const reach = new Map(nodes.map((n) => [n.id, reachable(n.id)]));
    const groups = [],
      groupOf = new Map();
    for (const n of nodes) {
      if (groupOf.has(n.id)) continue;
      const group = nodes.filter(
        (m) => reach.get(n.id).has(m.id) && reach.get(m.id).has(n.id),
      );
      group.forEach((m) => groupOf.set(m.id, groups.length));
      groups.push(group);
    }
    const ranks = new Map();
    const rank = (g) => {
      if (ranks.has(g)) return ranks.get(g);
      const parents = edges
        .filter(
          (e) => groupOf.get(e.target) === g && groupOf.get(e.source) !== g,
        )
        .map((e) => groupOf.get(e.source));
      const result = parents.length ? Math.max(...parents.map(rank)) + 1 : 0;
      ranks.set(g, result);
      return result;
    };
    const rows = [];
    groups.forEach((g, i) => (rows[rank(i)] ??= []).push(...g));
    width = Math.max(660, ...rows.map((r) => r.length * 260 + 100));
    height = rows.length * 190 + 80;
    rows.forEach((row, r) =>
      row
        .sort((a, b) => a.id.localeCompare(b.id))
        .forEach((n, i) => {
          n.x = (width / (row.length + 1)) * (i + 1) - 90;
          n.y = 110 + r * 190;
        }),
    );
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of edges) {
    const a = byId.get(edge.source),
      b = byId.get(edge.target);
    const peers = edges.filter(
      (e) => e.source === edge.source && e.target === edge.target,
    );
    const offset = (peers.indexOf(edge) - (peers.length - 1) / 2) * 42;
    const x1 = a.x + 180,
      x2 = b.x,
      y1 = a.y + offset,
      y2 = b.y + offset;
    edge.path =
      a.id === b.id
        ? `M ${a.x + 60} ${a.y - 34} C ${a.x + 10} ${a.y - 110}, ${a.x + 170} ${a.y - 110}, ${a.x + 130} ${a.y - 34}`
        : `M ${x1} ${y1} C ${x1 + 100} ${y1}, ${x2 - 100} ${y2}, ${x2} ${y2}`;
    edge.labelX = a.id === b.id ? a.x + 95 : (x1 + x2) / 2;
    edge.labelY = a.id === b.id ? a.y - 84 : (y1 + y2) / 2;
    if (multi && a.id !== b.id) {
      if (a.y !== b.y) {
        const ax = a.x + 90 + offset,
          bx = b.x + 90 + offset,
          ay = a.y + 34,
          by = b.y - 34;
        edge.path = `M ${ax} ${ay} C ${ax} ${ay + 75}, ${bx} ${by - 75}, ${bx} ${by}`;
        // Position labels toward the destination so fan-out labels do not overlap.
        const t = 0.7,
          u = 1 - t;
        edge.labelX =
          (u * u * u + 3 * u * u * t) * ax + (3 * u * t * t + t * t * t) * bx;
        edge.labelY =
          u * u * u * ay +
          3 * u * u * t * (ay + 75) +
          3 * u * t * t * (by - 75) +
          t * t * t * by +
          offset;
      } else {
        const above = a.x < b.x,
          y = a.y + (above ? -34 : 34),
          bend = y + (above ? -65 : 65) + offset;
        edge.path = `M ${a.x + 90} ${y} C ${a.x + 90} ${bend}, ${b.x + 90} ${bend}, ${b.x + 90} ${y}`;
        edge.labelX = (a.x + b.x) / 2 + 90;
        edge.labelY = y + (bend - y) * 0.75;
      }
    }
  }
  const edgeCandidates = new Set(included.map((e) => e.candidateId));
  const excluded = snapshot.candidates.filter(
    (c) =>
      !edgeCandidates.has(c.id) &&
      `${c.source} ${c.target ?? ""} ${c.name}`.toLowerCase().includes(q),
  );
  return { nodes, edges, excluded, width, height };
}
