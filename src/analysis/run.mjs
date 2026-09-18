import { mkdir, writeFile, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { captureInputs } from "./inputs.mjs";
import {
  createLedger,
  VERSION,
  hash,
  callersFor,
  assertSnapshot,
} from "./contract.mjs";
import { runAdapter } from "./adapters.mjs";
import {
  readObservations,
  buildSnapshot,
  assessFreshness,
} from "./resolve.mjs";

export async function analyze(
  root,
  configPath,
  { revision = null, asOf = new Date().toISOString(), binary } = {},
) {
  if (!Number.isFinite(Date.parse(asOf)))
    throw new Error("Invalid assessment time");
  const inputs = await captureInputs(root, configPath, { revision }),
    captured = await inputs.materialize();
  const snapshots = [],
    manifests = {};
  try {
    for (const env of inputs.config.environments) {
      const ledger = createLedger(env.id);
      const helm = runAdapter("helm-template/1", {
        root: captured.root,
        config: inputs.config,
        env,
        ledger,
        binary,
        files: inputs.files,
        chartFiles: inputs.chartFiles,
      });
      const parts = [];
      const inputLock = inputs.lockFor(env, {
        helm: helm.version,
        javaParser: "3.0.1",
        yaml: "2.9.1",
        rule: "spring-explicit-bean/1",
      });
      inputLock.renderHash = helm.outputHash;
      for (const { source, env: scope } of callersFor(inputs.config, env)) {
        const callerLedger = inputs.config.sources
          ? createLedger(env.id, source.service)
          : ledger;
        if (callerLedger !== ledger) {
          callerLedger.evidence.push(...ledger.evidence);
          callerLedger.facts.push(...ledger.facts);
        }
        const context = {
          files: inputs.files,
          source,
          env: scope,
          ledger: callerLedger,
          resources: helm.resources,
        };
        const extracted = runAdapter("spring-explicit-bean/1", context);
        const properties = runAdapter("spring-properties/1", context);
        const observations = readObservations(
          scope.observations ? inputs.files.get(scope.observations) : null,
          scope,
          callerLedger,
        );
        parts.push(
          buildSnapshot({
            env: scope,
            inputLock,
            ledger: callerLedger,
            helm,
            extracted,
            properties,
            observations,
          }),
        );
      }
      snapshots.push(
        inputs.config.sources
          ? composeCallers(parts, inputs.config.sources)
          : parts[0],
      );
      manifests[env.id] = helm.manifest;
    }
  } finally {
    await captured.close();
  }
  return {
    schemaVersion: VERSION,
    name: inputs.config.name,
    simulation: true,
    run: {
      assessedAt: asOf,
      inputMode: inputs.source.mode,
      releaseCorrespondence: "unverified",
    },
    snapshots,
    manifests,
    assessments: snapshots.map((s) => ({
      environment: s.environment,
      observationFreshness: assessFreshness(s.observation.collectedAt, asOf),
      candidates: s.candidates.map((c) => ({
        id: c.id,
        freshness: assessFreshness(c.observedAt, asOf),
      })),
    })),
  };
}

// All parts share captured repository bytes and one rendered environment.
// Keep caller-scoped observations/comparisons separate; never promote partial
// collection into a complete system-level observation.
export function composeCallers(parts, sources) {
  const first = parts[0];
  if (
    parts.some(
      (p) =>
        p.environment !== first.environment ||
        hash(p.inputLock) !== hash(first.inputLock),
    )
  )
    throw new Error("Cannot compose different environment or input locks");
  const unique = (key) => [
    ...new Map(parts.flatMap((p) => p[key]).map((r) => [r.id, r])).values(),
  ];
  const observations = parts.map((p, i) => ({
    caller: sources[i].service,
    ...p.observation,
  }));
  const snapshot = {
    ...first,
    callers: sources.map((s) => s.service),
    candidates: parts.flatMap((p) => p.candidates),
    dependencies: parts.flatMap((p) => p.dependencies),
    evidence: unique("evidence"),
    facts: unique("facts"),
    resolutions: unique("resolutions"),
    resourceComparisons: parts.flatMap((p, i) =>
      p.resourceComparisons.map((r) => ({ ...r, caller: sources[i].service })),
    ),
    observation: {
      coverage: observations.every((o) => o.coverage === "unavailable")
        ? "unavailable"
        : "partial",
      collectedAt: null,
      releaseCorrespondence: "unverified",
      release: null,
    },
    observations,
    coverage: parts.flatMap((p, i) =>
      p.coverage.map((c) => ({ ...c, caller: sources[i].service })),
    ),
    diagnostics: parts.flatMap((p, i) =>
      p.diagnostics.map((d) => ({ ...d, caller: sources[i].service })),
    ),
  };
  delete snapshot.contentHash;
  assertSnapshot(snapshot);
  return { ...snapshot, contentHash: hash(snapshot) };
}

export async function writeAnalysis(result, out) {
  await mkdir(out, { recursive: true });
  await writeFile(
    path.join(out, "input-lock.json"),
    JSON.stringify(
      result.snapshots.map((s) => ({
        environment: s.environment,
        ...s.inputLock,
      })),
      null,
      2,
    ) + "\n",
  );
  for (const [env, manifest] of Object.entries(result.manifests))
    await writeFile(
      path.join(out, `${encodeURIComponent(env)}.rendered.yaml`),
      manifest,
    );
  const temporary = path.join(out, `.analysis-${process.pid}.json`);
  try {
    await writeFile(temporary, JSON.stringify(result, null, 2) + "\n");
    await rename(temporary, path.join(out, "analysis.json"));
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function checkOracle(result, file) {
  const oracle = JSON.parse(await readFile(file, "utf8"));
  const actual = Object.fromEntries(
    result.snapshots.map((s) => [
      s.environment,
      Object.fromEntries(
        s.candidates.map((c) => [
          s.callers ? `${c.source}/${c.name}` : c.name,
          {
            eligibility: c.eligibility,
            target: c.target,
            targetResolution: c.targetResolution,
          },
        ]),
      ),
    ]),
  );
  if (hash(actual) !== hash(oracle))
    throw new Error(
      `Analysis differs from independently authored oracle:\n${JSON.stringify(actual, null, 2)}`,
    );
  return true;
}
