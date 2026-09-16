/** Versioned contract. No runtime observation is inferred from a tag. */
export class ContractError extends Error {}
const require = (ok, message) => { if (!ok) throw new ContractError(message); };
const idPattern = /^[a-z][a-z0-9-]{0,47}$/;
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const nonempty = x => typeof x === 'string' && x.trim().length > 0;
function index(items, kind) {
  require(Array.isArray(items), `${kind}: expected array`);
  const result = new Map();
  for (const item of items) {
    require(isObject(item) && typeof item.id === 'string' && idPattern.test(item.id), `${kind}: invalid id`);
    require(!result.has(item.id), `${kind}: duplicate id ${item.id}`);
    result.set(item.id, item);
  }
  return result;
}
function imageValid(image) {
  require(isObject(image) && typeof image.repository === 'string' && /^[a-zA-Z0-9./:_-]+$/.test(image.repository), 'invalid image repository');
  require(typeof image.tag === 'string' && /^[\w][\w.-]{0,127}$/.test(image.tag), 'invalid image tag');
}
function commitValid(sha) { require(sha === null || (typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha)), 'sourceCommit must be null or a full SHA'); }
function https(value) { try { return new URL(value).protocol === 'https:'; } catch { return false; } }
export function validate(config, snapshot) {
  require(config?.apiVersion === 'archi/v1alpha1', 'unsupported config apiVersion');
  require(snapshot?.apiVersion === 'archi/v1alpha1', 'unsupported observations apiVersion');
  require(config.system?.simulation === true, 'PoC requires an explicitly simulated system');
  require(nonempty(config.system.id) && nonempty(config.system.name), 'system id and name required');
  const groups = Object.fromEntries(['projects','services','contexts','deployments','dependencies','evidence','views'].map(k => [k,index(config[k],k)]));
  const { projects, services, contexts, deployments, evidence } = groups;
  require(projects.size && services.size && contexts.size, 'projects, services and contexts must be nonempty');
  require(['L1','L2','deployment'].every(level => config.views.some(v => v.level === level)), 'L1, L2 and deployment views required');
  for (const e of evidence.values()) require(['declared','observed','inferred'].includes(e.kind) && nonempty(e.source), 'invalid evidence');
  for (const p of projects.values()) require(nonempty(p.name) && nonempty(p.owner) && https(p.repo), 'project requires name, owner and HTTPS repo');
  const ports = new Set();
  for (const s of services.values()) {
    require(projects.has(s.project), `${s.id}: unknown project`);
    require(!projects.has(s.id), `${s.id}: project and service identity collision`);
    require(['edge','domain','integration'].includes(s.layer), `${s.id}: invalid layer`);
    require(nonempty(s.name) && nonempty(s.description), `${s.id}: name and description required`);
    require(Number.isInteger(s.port) && s.port >= 1024 && s.port <= 65535 && !ports.has(s.port), 'service port must be unique, 1024..65535');
    ports.add(s.port);
    require(s.repoPath === `services/${s.id}`, 'repoPath must be services/<id>');
  }
  for (const c of contexts.values()) {
    require(nonempty(c.name), 'context name required');
    for (const key of ['environment','cluster','namespace']) require(typeof c[key] === 'string' && idPattern.test(c[key]), `invalid context ${key}`);
  }
  for (const edge of config.dependencies) {
    require(services.has(edge.source) && services.has(edge.target), `${edge.id}: dangling dependency`);
    require(edge.source !== edge.target, 'self dependency unsupported');
    require(['HTTP','gRPC','AMQP','TCP'].includes(edge.protocol), 'unsupported protocol');
    require(evidence.has(edge.evidence), 'unknown dependency evidence');
  }
  const pairs = new Set();
  for (const d of deployments.values()) {
    require(services.has(d.service) && contexts.has(d.context), 'unknown deployment service/context');
    const pair = `${d.context}/${d.service}`;
    require(!pairs.has(pair), 'duplicate service deployment in context'); pairs.add(pair);
    require(Number.isInteger(d.replicas) && d.replicas >= 0 && d.replicas <= 100, 'replicas must be 0..100');
    require(evidence.has(d.evidence), 'unknown deployment evidence');
    imageValid(d.image); commitValid(d.sourceCommit);
    require(isObject(d.links) && Object.values(d.links).every(https), 'deployment links must be HTTPS');
  }
  for (const c of contexts.keys()) for (const e of config.dependencies) {
    if (pairs.has(`${c}/${e.source}`)) require(pairs.has(`${c}/${e.target}`), `${c}: dependency target has no deployment`);
  }
  require(Array.isArray(snapshot.observations), 'observations must be an array');
  const seen = new Set();
  for (const o of snapshot.observations) {
    require(deployments.has(o.deployment), 'orphan observation');
    require(!seen.has(o.deployment), 'duplicate observation'); seen.add(o.deployment);
    require(evidence.get(o.evidence)?.kind === 'observed', 'observation requires observed evidence');
    imageValid(o.image); commitValid(o.sourceCommit);
    require(Number.isInteger(o.readyReplicas) && o.readyReplicas >= 0, 'invalid readyReplicas');
    require(typeof o.observedAt === 'string' && /(Z|[+-]\d\d:\d\d)$/.test(o.observedAt) && Number.isFinite(Date.parse(o.observedAt)), 'observedAt requires valid timestamp with timezone');
  }
  return groups;
}
export function projectGraph(config, snapshot) {
  validate(config, snapshot);
  const observed = new Map(snapshot.observations.map(o => [o.deployment,o]));
  const instances = config.deployments.map(d => {
    const o = observed.get(d.id) ?? null;
    const drift = [];
    if (o) {
      if (o.image.repository !== d.image.repository || o.image.tag !== d.image.tag) drift.push('image');
      if (o.readyReplicas !== d.replicas) drift.push('replicas');
      if (o.sourceCommit && d.sourceCommit && o.sourceCommit !== d.sourceCommit) drift.push('commit');
    }
    return { ...d, observed:o, drift, status: !o ? 'unknown' : drift.length ? 'drift' : 'aligned' };
  });
  return { ...config, nodes:[...config.projects.map(p => ({...p,kind:'project'})),...config.services.map(s=>({...s,kind:'service'}))], edges:config.dependencies, instances, snapshotMode:'Fixture snapshot · not live' };
}
