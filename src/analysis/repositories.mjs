import {
  readFile,
  realpath,
  mkdtemp,
  mkdir,
  writeFile,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { hash } from "./contract.mjs";
import { validateSystem, safeRepoPath } from "./system-contract.mjs";

export const refPath = (ref) => `${ref.repository}/${safeRepoPath(ref.path)}`;
export async function captureSystem(root, manifestPath, { includeCandidates = true } = {}) {
  const manifest = validateSystem(
    JSON.parse(await readFile(path.resolve(root, manifestPath), "utf8")),
  );
  const repositories = new Map(),
    files = new Map(),
    provenance = {};
  // Only local, explicitly supplied repositories. No clone, fetch, checkout or hooks.
  for (const repo of manifest.repositories) {
    const location = await realpath(path.resolve(root, repo.path));
    const git = (args) =>
      execFileSync("git", ["-C", location, ...args], {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
      });
    if (
      (await realpath(git(["rev-parse", "--show-toplevel"]).trim())) !==
      location
    )
      throw Error(`Repository path must name its root: ${repo.id}`);
    const commit = git([
      "rev-parse",
      "--verify",
      `${repo.revision}^{commit}`,
    ]).trim();
    if (commit !== repo.revision)
      throw Error(`Expected a commit object for ${repo.id}`);
    const entries = new Map(
      git(["ls-tree", "-rz", "--full-tree", commit])
        .split("\0")
        .filter(Boolean)
        .map((line) => {
          const tab = line.indexOf("\t"),
            [mode, type, sha] = line.slice(0, tab).split(" ");
          return [line.slice(tab + 1), { mode, type, sha }];
        }),
    );
    repositories.set(repo.id, { git, entries, commit });
  }
  function read(ref) {
    const name = refPath(ref);
    if (files.has(name)) return name;
    const repo = repositories.get(ref.repository),
      entry = repo.entries.get(ref.path);
    if (
      !entry ||
      entry.type !== "blob" ||
      !["100644", "100755"].includes(entry.mode)
    )
      throw Error(`Missing or unsupported Git input: ${name}`);
    const content = repo.git(["cat-file", "blob", entry.sha]);
    files.set(name, content);
    provenance[name] = {
      repository: ref.repository,
      revision: repo.commit,
      path: ref.path,
      contentHash: hash(content),
    };
    return name;
  }
  const selected = new Map(),
    charts = new Map();
  for (const env of manifest.environments) {
    const paths = new Set();
    for (const i of env.instances) {
      const service = manifest.services.find((s) => s.id === i.service);
      for (const ref of [...service.source.files, ...i.propertyFiles])
        paths.add(read(ref));
      for(const b of i.configuration?.importBindings??[]){paths.add(read(b.from));paths.add(read(b.file));}
      for(const b of i.configuration?.profileBindings??[]){paths.add(read(b.from));if(b.file!==null)paths.add(read(b.file));}
      if(includeCandidates && service.source.candidateFile)paths.add(read(service.source.candidateFile));
    }
    for (const release of env.releases) {
      const repo = repositories.get(release.chart.repository);
      const chartFiles = [...repo.entries.keys()]
        .filter((p) => p.startsWith(release.chart.path + "/"))
        .sort();
      if (!chartFiles.length)
        throw Error(`Empty chart: ${refPath(release.chart)}`);
      const names = chartFiles.map((p) =>
        read({ repository: release.chart.repository, path: p }),
      );
      charts.set(`${env.id}/${release.id}`, names);
      names.forEach((n) => paths.add(n));
      release.values.forEach((ref) => paths.add(read(ref)));
    }
    selected.set(env.id, [...paths].sort());
  }
  return {
    manifest,
    files,
    charts,
    provenance,
    lockFor(env, tools, renders) {
      const names = selected.get(env.id),
        used = new Set(names.map((n) => provenance[n].repository));
      const services = manifest.services.filter((s) =>
        env.instances.some((i) => i.service === s.id),
      );
      const scoped = {
        schemaVersion: manifest.schemaVersion,
        simulation: manifest.simulation,
        environment: env,
        services,
        projects: manifest.projects.filter((p) =>
          services.some((s) => s.project === p.id),
        ),
        repositories: manifest.repositories
          .filter((r) => used.has(r.id))
          .map(({ id, revision }) => ({ id, revision })),
      };
      return {
        mode: "git-revision-vector",
        manifestHash: hash(scoped),
        revisionVector: Object.fromEntries(
          manifest.repositories
            .filter((r) => used.has(r.id))
            .map((r) => [r.id, r.revision]),
        ),
        files: Object.fromEntries(names.map((n) => [n, provenance[n]])),
        tools,
        renders,
      };
    },
    async materialize() {
      const dir = await mkdtemp(path.join(os.tmpdir(), "archi-system-"));
      try {
        for (const [name, content] of files) {
          await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
          await writeFile(path.join(dir, name), content);
        }
      } catch (error) {
        await rm(dir, { recursive: true, force: true });
        throw error;
      }
      return {
        root: dir,
        close: () => rm(dir, { recursive: true, force: true }),
      };
    },
  };
}