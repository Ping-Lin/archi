import { candidateHash, verifyAiBundle } from './ai-candidates.mjs';
import { validateSystem } from './system-contract.mjs';

// Review commands read the same pinned bundle as analysis, never a workspace draft.
export function loadReviewBundle(inputs, service) {
  if (service.source.adapter !== 'ai-evidence/1') throw Error('Service does not use ai-evidence/1');
  const ref = service.source.candidateFile;
  const raw = inputs.files.get(`${ref.repository}/${ref.path}`);
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 2 * 1024 * 1024)
    throw Error('AI candidate input missing or exceeds 2 MiB');
  return verifyAiBundle(JSON.parse(raw), {
    service, simulation: inputs.manifest.simulation,
    files: inputs.files, provenance: inputs.provenance,
  });
}

export function reviewQueue(inputs, service) {
  const bundle = loadReviewBundle(inputs, service);
  const hashes = new Set(bundle.candidates.map(c => candidateHash(bundle, c)));
  const candidates = inputs.manifest.environments.flatMap(env =>
    env.instances.filter(i => i.service === service.id).flatMap(instance =>
      bundle.candidates.map(c => {
        const digest = candidateHash(bundle, c);
        const review = service.source.reviews.find(r => r.candidateHash === digest &&
          r.environment === env.id && r.instance === instance.id);
        return {
          id: c.id, name: c.name, candidateHash: digest,
          environment: env.id, instance: instance.id,
          status: review?.decision ?? 'unreviewed',
          reviewer: review?.reviewer ?? null, reason: review?.reason ?? null,
          protocol: c.protocol, endpointKey: c.endpointKey,
          conditions: c.conditions, unknowns: c.unknowns, evidence: c.evidence,
        };
      })));
  return { service: service.id, simulation: bundle.simulation,
    meaning: 'Pinned evidence verified; declared reviews are not semantic or runtime proof. Endpoint resolution has not run.',
    candidates, staleReviews: service.source.reviews.filter(r => !hashes.has(r.candidateHash)) };
}

export function applyCandidateReview(inputs, service, request) {
  const bundle = loadReviewBundle(inputs, service);
  const c = bundle.candidates.find(c => c.id === request.candidate);
  if (!c) throw Error('Unknown candidate ID');
  const digest = candidateHash(bundle, c);
  if (request.hash !== digest) throw Error('Candidate hash changed or does not match; inspect the queue again');
  const env = inputs.manifest.environments.find(e => e.id === request.environment);
  if (!env?.instances.some(i => i.id === request.instance && i.service === service.id))
    throw Error('Review scope does not belong to this service');
  if (!['accepted', 'rejected', 'unreviewed'].includes(request.decision))
    throw Error('Decision must be accepted, rejected or unreviewed');
  if (!request.reviewer?.trim() || !request.reason?.trim())
    throw Error('Explicit reviewer and reason are required');
  const manifest = structuredClone(inputs.manifest);
  const source = manifest.services.find(s => s.id === service.id).source;
  const matches = r => r.candidateHash === digest && r.environment === env.id && r.instance === request.instance;
  const previous = source.reviews.find(matches) ?? null;
  source.reviews = source.reviews.filter(r => !matches(r));
  const review = { candidateHash: digest, environment: env.id, instance: request.instance,
    decision: request.decision, reviewer: request.reviewer.trim(), reason: request.reason.trim() };
  if (request.decision !== 'unreviewed') source.reviews.push(review);
  validateSystem(manifest);
  return { manifest, change: { service: service.id, candidate: c.id, previous, requested: review,
    meaning: request.decision === 'unreviewed' ? 'Review removed; this is not a persisted audit log.' :
      'Declared operator review only. Reanalyze to resolve conditions and endpoints; acceptance does not guarantee an edge.' } };
}
