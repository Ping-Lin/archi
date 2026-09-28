import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { createCrossRepoFixture } from './cross-repo-fixture.mjs';

// Controlled portability regression, not a blinded onboarding evaluation.
// Uses existing source specimens but a different chart/values/render naming shape.
export async function createHelmPortabilityFixture(destination) {
  const fixture = await createCrossRepoFixture(destination);
  const deploy = path.join(fixture.root, 'deploy');
  const chart = fileURLToPath(new URL('../examples/helm-portability/chart/', import.meta.url));
  for (const name of ['platform/charts/shared', 'teams/stock/chart'])
    await cp(chart, path.join(deploy, name), { recursive: true });
  await mkdir(path.join(deploy, 'overlays'), { recursive: true });
  await writeFile(path.join(deploy, 'overlays/common.yaml'), stringify({ workload: { settings: {
    clients: { 'downstream.url': 'https://unmapped-default.example.invalid' },
  } } }));
  for (const env of fixture.manifest.environments) {
    for (const release of env.releases) {
      const original = parse(await readFile(path.join(deploy, release.values[0].path), 'utf8'));
      const clients = { ...original.application };
      for (const [key, value] of Object.entries(clients)) {
        let endpoint = value;
        for (const target of env.releases)
          endpoint = endpoint.replace(`api.${target.namespace}.svc.cluster.local`, `${target.name}-endpoint.${target.namespace}.svc.cluster.local`);
        clients[key] = endpoint;
      }
      const overlay = `overlays/${env.id}/${release.id}.yaml`;
      await mkdir(path.dirname(path.join(deploy, overlay)), { recursive: true });
      await writeFile(path.join(deploy, overlay), stringify({ workload: {
        artifact: original.image, settings: { profile: original.profile, clients },
      } }));
      release.chart.path = release.id === 'inventory' ? 'teams/stock/chart' : 'platform/charts/shared';
      release.values = ['overlays/common.yaml', overlay].map(p => ({ repository: 'deploy', path: p }));
      const instance = env.instances.find(i => i.release === release.id);
      instance.workload = `${release.name}-workload`;
      instance.endpoint.name = `${release.name}-endpoint`;
    }
  }
  const git = args => execFileSync('git', ['-C', deploy, ...args], { encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Archi fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Archi fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      GIT_AUTHOR_DATE: '2026-09-28T00:00:00Z', GIT_COMMITTER_DATE: '2026-09-28T00:00:00Z' } });
  git(['add', '.']);
  git(['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Nested Helm portability inputs']);
  fixture.manifest.repositories.find(r => r.id === 'deploy').revision = git(['rev-parse', 'HEAD']).trim();
  fixture.manifest.name = 'Synthetic Helm portability · nested values and independent charts';
  await writeFile(fixture.path, JSON.stringify(fixture.manifest, null, 2) + '\n');
  return fixture;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw Error('Usage: node scripts/helm-portability-fixture.mjs NEW_DESTINATION');
    const result = await createHelmPortabilityFixture(path.resolve(process.argv[2]));
    console.log(`Synthetic fixture created: ${result.path}`);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
