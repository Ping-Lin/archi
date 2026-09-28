export function filterCandidates(candidates, query = '', filter = 'all') {
  const needle = query.trim().toLowerCase();
  return candidates.filter(c => {
    const status = c.extraction?.status;
    const matches = filter === 'all' || (filter === 'ai' && !!c.extraction) ||
      (['unreviewed', 'accepted', 'rejected'].includes(filter) && status === filter) ||
      (filter === 'investigate' && (c.eligibility === 'unknown' || c.targetResolution !== 'unique'));
    return matches && (!needle || [c.name, c.source, c.sourceService, c.target, c.key,
      c.extraction?.reviewer].some(value => String(value ?? '').toLowerCase().includes(needle)));
  });
}
