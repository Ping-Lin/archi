import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHelmPortabilityFixture } from '../../scripts/helm-portability-fixture.mjs';
import { analyzeSystem } from '../../src/analysis/system-run.mjs';
import { checkOracle } from '../../src/analysis/run.mjs';
import { validateSystem } from '../../src/analysis/system-contract.mjs';
let root, fixture, baseline;
let helm = true;
try { execFileSync(process.env.HELM_BIN ?? 'helm', ['version','--short'], {stdio:'ignore'}); } catch { helm = false; }
if (process.env.CI && !helm) throw Error('Helm required for portability gate');
const options = { asOf: '2026-09-28T00:00:00Z' };
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'archi-helm-portability-'));
  fixture = await createHelmPortabilityFixture(path.join(root, 'inputs'));
  if (helm) baseline = await analyzeSystem(fixture.root, 'system.json', options);
});
after(async () => { if (root) await rm(root, {recursive:true,force:true}); });
test('portability fixture is pinned, synthetic, explicitly bound and refuses overwrite', async () => {
  validateSystem(fixture.manifest);
  assert.equal(fixture.manifest.simulation, true);
  assert.equal(new Set(fixture.manifest.environments[0].releases.map(r=>r.chart.path)).size, 2);
  await assert.rejects(createHelmPortabilityFixture(fixture.root), /already exists/);
});
test('nested values, helper names, omitted namespaces and independent charts preserve the handwritten oracle', {skip:!helm}, async () => {
  await checkOracle(baseline, fileURLToPath(new URL('../fixtures/cross-repo-oracle.json', import.meta.url)));
  const repeated = await analyzeSystem(fixture.root, 'system.json', {asOf:'2026-09-29T00:00:00Z'});
  assert.deepEqual(repeated.snapshots.map(s=>s.contentHash), baseline.snapshots.map(s=>s.contentHash));
  assert.deepEqual(baseline.snapshots.map(s=>s.dependencies.length), [5,4]);
});
test('reversing CD values order changes resolution rather than silently keeping the intended graph', {skip:!helm}, async () => {
  const manifest = structuredClone(fixture.manifest);
  manifest.environments[0].releases.find(r=>r.id==='portal').values.reverse();
  await writeFile(path.join(fixture.root,'reversed.json'), JSON.stringify(manifest));
  const result = await analyzeSystem(fixture.root,'reversed.json',options);
  const candidate = result.snapshots[0].candidates.find(c=>c.source==='portal'&&c.name==='downstream');
  assert.equal(candidate.targetResolution,'unresolved');
  assert.equal(candidate.target,null);
  assert.equal(result.snapshots[0].dependencies.length,4);
  assert.equal(result.snapshots[1].contentHash,baseline.snapshots[1].contentHash);
});
test('an incorrect helper-generated endpoint binding cannot create a relationship by logical service name', {skip:!helm}, async () => {
  const manifest = structuredClone(fixture.manifest);
  manifest.environments[0].instances.find(i=>i.id==='orders').endpoint.name='api';
  await writeFile(path.join(fixture.root,'wrong-binding.json'),JSON.stringify(manifest));
  const result = await analyzeSystem(fixture.root,'wrong-binding.json',options);
  const candidate = result.snapshots[0].candidates.find(c=>c.source==='portal'&&c.name==='downstream');
  assert.notEqual(candidate.targetResolution,'unique');
  assert.ok(!result.snapshots[0].dependencies.some(e=>e.source==='portal'&&e.target==='orders'));
});
