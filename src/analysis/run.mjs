import { mkdir, writeFile, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { captureInputs } from "./inputs.mjs";
import { createLedger, VERSION, hash } from "./contract.mjs";
import { renderHelm } from "./helm.mjs";
import { extractSpring, resolveProperties } from "./spring.mjs";
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
      // Context-sensitive and explicitly nondeterministic Helm functions are outside this contract.
      for (const file of inputs.chartFiles)
        if (
          /\b(lookup|now|randAlphaNum|randAlpha|randNumeric|randAscii|uuidv4|genCA|genSelfSignedCert|genSignedCert)\b/.test(
            inputs.files.get(file),
          )
        )
          throw new Error(
            `Unsupported Helm context/random function in ${file}`,
          );
      const helm = renderHelm(captured.root, inputs.config, env, ledger, {
        binary,
      });
      const extracted = extractSpring(
        inputs.files,
        inputs.config.source,
        env,
        ledger,
      );
      const properties = resolveProperties(
        inputs.files,
        env,
        helm.resources,
        inputs.config.source,
        ledger,
      );
      const observations = readObservations(
        env.observations ? inputs.files.get(env.observations) : null,
        env,
        ledger,
      );
      const inputLock = inputs.lockFor(env, {
        helm: helm.version,
        javaParser: "3.0.1",
        yaml: "2.9.1",
        rule: "spring-explicit-bean/1",
      });
      inputLock.renderHash = helm.outputHash;
      snapshots.push(
        buildSnapshot({
          env,
          inputLock,
          ledger,
          helm,
          extracted,
          properties,
          observations,
        }),
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
          c.name,
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
