// View-only projection: never synthesize an edge from a candidate or observation.
export function projectServiceGraph(snapshot, query = '') {
  const candidates = new Map(snapshot.candidates.map(c => [c.id, c]));
  const resolutions = new Set(snapshot.resolutions.map(r => r.id));
  const q = query.trim().toLowerCase();
  const included = snapshot.dependencies.filter(edge => {
    const c = candidates.get(edge.candidateId);
    return edge.environment === snapshot.environment && c?.eligibility === 'enabled' &&
      c.targetResolution === 'unique' && c.target === edge.target &&
      c.source === edge.source && c.resolutionId === edge.resolutionId && resolutions.has(edge.resolutionId);
  });
  const edges = included.filter(e => `${e.source} ${e.target} ${candidates.get(e.candidateId).name}`.toLowerCase().includes(q))
    .map(e => ({...e, name: candidates.get(e.candidateId).name, consistency: candidates.get(e.candidateId).consistency}));
  const sourceIds = [...new Set((q ? edges : snapshot.candidates).map(c => c.source))].sort();
  const targetIds = [...new Set(edges.map(e => e.target))].filter(id => !sourceIds.includes(id)).sort();
  const height = Math.max(340, Math.max(sourceIds.length, targetIds.length) * 125 + 100);
  const place = (ids, x, kind) => ids.map((id, i) => ({id, x, y: (height / (ids.length + 1)) * (i + 1),
    kind: kind ?? edges.find(e => e.target === id)?.targetKind ?? 'service'}));
  const nodes = [...place(sourceIds, 40, 'service'), ...place(targetIds, 440)];
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const edge of edges) {
    const a = byId.get(edge.source), b = byId.get(edge.target);
    const peers = edges.filter(e => e.source === edge.source && e.target === edge.target);
    const offset = (peers.indexOf(edge) - (peers.length - 1) / 2) * 42;
    const x1 = a.x + 180, x2 = b.x, y1 = a.y + offset, y2 = b.y + offset;
    edge.path = a.id === b.id ? `M ${a.x+60} ${a.y-34} C ${a.x+10} ${a.y-110}, ${a.x+170} ${a.y-110}, ${a.x+130} ${a.y-34}` :
      `M ${x1} ${y1} C ${x1+100} ${y1}, ${x2-100} ${y2}, ${x2} ${y2}`;
    edge.labelX = a.id === b.id ? a.x+95 : (x1+x2)/2;
    edge.labelY = a.id === b.id ? a.y-84 : (y1+y2)/2;
  }
  const edgeCandidates = new Set(included.map(e => e.candidateId));
  const excluded = snapshot.candidates.filter(c => !edgeCandidates.has(c.id) && `${c.source} ${c.target??''} ${c.name}`.toLowerCase().includes(q));
  return {nodes, edges, excluded, width:660, height};
}
