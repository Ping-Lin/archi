import test from "node:test";
import assert from "node:assert/strict";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyze, checkOracle } from "../../src/analysis/run.mjs";
import {
  hash,
  createLedger,
  validateConfig,
  assertSnapshot,
} from "../../src/analysis/contract.mjs";
import { captureInputs } from "../../src/analysis/inputs.mjs";
import { parseManifest, resourceKey } from "../../src/analysis/helm.mjs";
import { assessFreshness } from "../../src/analysis/resolve.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url)),
  configPath = "examples/analysis/archi.config.json";
const binary = process.env.HELM_BIN ?? "helm";
let helmAvailable = true;
try {
  execFileSync(binary, ["version", "--short"], { stdio: "ignore" });
} catch {
  helmAvailable = false;
}
if (process.env.CI && !helmAvailable)
  throw new Error("CI requires real Helm for analysis acceptance");
const helmTest = (name, fn) =>
  test(
    name,
    {
      skip: !helmAvailable
        ? "Helm unavailable; integration gate incomplete"
        : false,
    },
    fn,
  );
const options = { binary, asOf: "2026-09-17T00:05:00Z" };
const read = async (root, file) =>
  JSON.parse(await readFile(path.join(root, file), "utf8"));
const json = async (root, file, value) =>
  writeFile(path.join(root, file), JSON.stringify(value, null, 2) + "\n");
const edit = async (root, file, fn) =>
  writeFile(
    path.join(root, file),
    fn(await readFile(path.join(root, file), "utf8")),
  );
const get = (result, env = "dev", name = "clientA") =>
  result.snapshots
    .find((s) => s.environment === env)
    .candidates.find((c) => c.name === name);
async function fixture(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "archi-analysis-test-"));
  try {
    await mkdir(path.join(dir, "examples"), { recursive: true });
    await cp(
      path.join(root, "examples/analysis"),
      path.join(dir, "examples/analysis"),
      { recursive: true },
    );
    const git = (args) =>
      execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" })
        .toString()
        .trim();
    git(["init", "--quiet"]);
    git(["add", "."]);
    git([
      "-c",
      "user.name=Archi fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "Independent synthetic inputs",
    ]);
    return await fn(dir, git);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
let baseline;
async function base() {
  return (baseline ??= await analyze(root, configPath, options));
}

helmTest(
  "real Helm and Java CST match the independently authored A/B/C oracle",
  async () => {
    const result = await base();
    await checkOracle(
      result,
      path.join(root, "tests/fixtures/analysis-oracle.json"),
    );
    assert.equal(result.snapshots[0].dependencies.length, 2);
    assert.equal(result.snapshots[1].dependencies.length, 1);
    for (const s of result.snapshots) assertSnapshot(s);
    const candidate = get(result);
    assert.match(candidate.value, /archi-dev/);
    const resolution = result.snapshots[0].resolutions.find(
      (r) => r.id === candidate.resolutionId,
    );
    const predicates = resolution.inputFactIds.map(
      (id) => result.snapshots[0].facts.find((f) => f.id === id).predicate,
    );
    for (const predicate of [
      "client.candidate",
      "property.value",
      "resource.present",
      "runtime.target",
    ])
      assert.ok(predicates.includes(predicate));
  },
);
helmTest(
  "captured bytes are deterministic; assessment timestamps do not alter snapshot hashes",
  async () => {
    const a = await base(),
      b = await analyze(root, configPath, {
        ...options,
        asOf: "2026-10-17T00:00:00Z",
      });
    assert.deepEqual(
      a.snapshots.map((s) => s.contentHash),
      b.snapshots.map((s) => s.contentHash),
    );
    assert.equal(b.assessments[0].observationFreshness, "stale");
  },
);
helmTest(
  "dev-only input changes leave production snapshot unchanged",
  async () =>
    fixture(async (dir) => {
      const a = await analyze(dir, configPath, options);
      await edit(dir, "examples/analysis/environments/dev.yaml", (s) =>
        s.replace(
          "http://gateway.archi-dev.svc.cluster.local:8080",
          "https://missing.example.invalid",
        ),
      );
      const b = await analyze(dir, configPath, options);
      assert.equal(a.snapshots[1].contentHash, b.snapshots[1].contentHash);
      assert.notEqual(a.snapshots[0].contentHash, b.snapshots[0].contentHash);
      assert.equal(get(b).targetResolution, "unresolved");
    }),
);
helmTest(
  "immutable Git revision ignores dirty workspace modifications",
  async () =>
    fixture(async (dir) => {
      const a = await analyze(dir, configPath, {
        ...options,
        revision: "HEAD",
      });
      await edit(dir, "examples/analysis/application/Clients.java", (s) =>
        s.replace("clients.a.url", "missing.url"),
      );
      const b = await analyze(dir, configPath, {
        ...options,
        revision: "HEAD",
      });
      assert.deepEqual(
        a.snapshots.map((s) => s.contentHash),
        b.snapshots.map((s) => s.contentHash),
      );
      assert.equal(b.run.inputMode, "git-revision");
    }),
);
helmTest("missing configuration does not invent an endpoint", async () =>
  fixture(async (dir) => {
    await edit(dir, "examples/analysis/application/Clients.java", (s) =>
      s.replace("clients.a.url", "missing.url"),
    );
    const result = await analyze(dir, configPath, options);
    assert.equal(get(result).targetResolution, "unresolved");
    assert.equal(get(result).target, null);
  }),
);
helmTest(
  "ambiguous target aliases preserve alternatives instead of choosing one",
  async () =>
    fixture(async (dir) => {
      const c = await read(dir, configPath);
      c.environments[0].targets.push({
        ...c.environments[0].targets[0],
        id: "other-gateway",
      });
      await json(dir, configPath, c);
      const result = await analyze(dir, configPath, options);
      assert.equal(get(result).targetResolution, "ambiguous");
      assert.equal(get(result).alternatives.length, 2);
      assert.ok(
        !result.snapshots[0].dependencies.some(
          (d) => d.candidateId === get(result).id,
        ),
      );
    }),
);
helmTest(
  "unsupported Java body and unknown class condition stay unknown",
  async () =>
    fixture(async (dir) => {
      await edit(dir, "examples/analysis/application/Clients.java", (s) =>
        s
          .replace(
            "return new EndpointClient(endpoint);",
            "return ClientFactory.create(endpoint);",
          )
          .replace("@Configuration", "@Configuration\n@UnknownCondition"),
      );
      const result = await analyze(dir, configPath, options);
      assert.equal(get(result).eligibility, "unknown");
      assert.ok(
        result.snapshots[0].diagnostics.some(
          (d) => d.code === "UNSUPPORTED_CLIENT_PATTERN",
        ),
      );
    }),
);
helmTest(
  "unavailable higher-priority property sources prevent false resolution",
  async () =>
    fixture(async (dir) => {
      const c = await read(dir, configPath);
      c.environments[0].propertiesComplete = false;
      await json(dir, configPath, c);
      const result = await analyze(dir, configPath, options);
      assert.equal(get(result).eligibility, "unknown");
      assert.equal(get(result).targetResolution, "unresolved");
      assert.equal(get(result, "dev", "clientC").eligibility, "unknown");
    }),
);
helmTest(
  "production works without runtime and never borrows dev confirmation",
  async () => {
    const result = await base();
    assert.equal(get(result).runtimeSupport, "observed");
    assert.equal(get(result, "prod").runtimeSupport, "unavailable");
    assert.ok(
      result.snapshots[1].evidence.every(
        (e) => e.environment === "prod" && e.type !== "runtime_observation",
      ),
    );
  },
);
helmTest("contradictory runtime evidence remains explicit", async () =>
  fixture(async (dir) => {
    const file = "examples/analysis/environments/dev-observations.json",
      o = await read(dir, file);
    o.runtime[0].target = "unexpected";
    await json(dir, file, o);
    const result = await analyze(dir, configPath, options);
    assert.equal(get(result).consistency, "conflicting");
    assert.equal(get(result).target, "gateway");
  }),
);
helmTest(
  "observed-only resources, external targets and rollout health stay separate",
  async () => {
    const result = await base(),
      s = result.snapshots[0];
    assert.ok(s.dependencies.some((d) => d.targetKind === "external"));
    assert.ok(
      s.resourceComparisons.some(
        (r) => r.name === "unmanaged-worker" && r.presence === "observed-only",
      ),
    );
    const checkout = s.resourceComparisons.find(
      (r) => r.name === "checkout-dev-checkout",
    );
    assert.equal(checkout.health, "progressing");
    assert.deepEqual(checkout.differences, []);
    assert.equal(s.observation.releaseCorrespondence, "unverified");
    assert.ok(
      result.snapshots[1].resourceComparisons.every(
        (r) => r.presence === "source-present; deployment-unknown",
      ),
    );
  },
);
helmTest("collector failure never means absence", async () =>
  fixture(async (dir) => {
    const file = "examples/analysis/environments/dev-observations.json";
    await writeFile(path.join(dir, file), "invalid");
    const result = await analyze(dir, configPath, options);
    assert.ok(
      result.snapshots[0].resourceComparisons.every(
        (r) => r.presence === "source-present; deployment-unknown",
      ),
    );
    assert.equal(result.snapshots[0].observation.coverage, "failed");
  }),
);
helmTest("unknown release revision is not inferred from image tags", async () =>
  fixture(async (dir) => {
    const file = "examples/analysis/environments/dev-observations.json",
      o = await read(dir, file);
    o.release.sourceCommit = "c".repeat(40);
    await json(dir, file, o);
    const result = await analyze(dir, configPath, options);
    assert.equal(
      result.snapshots[0].observation.releaseCorrespondence,
      "unverified",
    );
    assert.ok(
      result.snapshots[0].resourceComparisons.every(
        (r) => !r.differences.includes("commit"),
      ),
    );
  }),
);
helmTest(
  "required cluster lookup fails explicitly instead of producing invented facts",
  async () =>
    fixture(async (dir) => {
      await edit(
        dir,
        "examples/analysis/chart/templates/service.yaml",
        (s) => '{{ lookup "v1" "Service" "default" "x" }}\n' + s,
      );
      await assert.rejects(
        analyze(dir, configPath, options),
        /Unsupported Helm context/,
      );
    }),
);
helmTest("internal target must expose the endpoint port", async () =>
  fixture(async (dir) => {
    await edit(dir, "examples/analysis/chart/templates/service.yaml", (s) =>
      s.replace("port: 8080", "port: 9090"),
    );
    const result = await analyze(dir, configPath, options);
    assert.equal(get(result).targetResolution, "unresolved");
  }),
);
helmTest(
  "failed collector cannot reuse supplied resources or runtime events",
  async () =>
    fixture(async (dir) => {
      const file = "examples/analysis/environments/dev-observations.json",
        o = await read(dir, file);
      o.coverage = "failed";
      await json(dir, file, o);
      const result = await analyze(dir, configPath, options);
      assert.equal(get(result).runtimeSupport, "unavailable");
      assert.ok(
        result.snapshots[0].resourceComparisons.every(
          (r) => r.presence === "source-present; deployment-unknown",
        ),
      );
    }),
);
helmTest(
  "duplicate factory names do not create certain dependencies",
  async () =>
    fixture(async (dir) => {
      await edit(dir, "examples/analysis/application/Clients.java", (s) =>
        s.replace("clientB(", "clientA("),
      );
      const result = await analyze(dir, configPath, options);
      assert.equal(get(result).eligibility, "unknown");
      assert.ok(
        get(result).reasons.includes(
          "Multiple candidate registrations share a bean name",
        ),
      );
    }),
);
test("resource identity survives API-version changes and separates instances", () => {
  const env = { id: "dev", cluster: "c", namespace: "n" },
    a = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "checkout-stable" },
    };
  assert.equal(
    resourceKey(a, env),
    resourceKey({ ...a, apiVersion: "apps/v1beta1" }, env),
  );
  const ledger = createLedger("dev"),
    b = { ...a, metadata: { name: "checkout-canary" } };
  const result = parseManifest(
    JSON.stringify(a) + "\n---\n" + JSON.stringify(b),
    env,
    ledger,
  );
  assert.equal(result.resources.length, 2);
  assert.notEqual(result.resources[0].key, result.resources[1].key);
});
test("duplicate YAML keys and duplicate resource identities are rejected", () => {
  const env = { id: "dev", cluster: "c", namespace: "n" };
  assert.throws(
    () =>
      parseManifest(
        "kind: Service\nkind: Deployment",
        env,
        createLedger("dev"),
      ),
    /Invalid rendered YAML/,
  );
  const resource = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: "gateway" },
  };
  assert.throws(
    () =>
      parseManifest(
        JSON.stringify(resource) + "\n---\n" + JSON.stringify(resource),
        env,
        createLedger("dev"),
      ),
    /Duplicate rendered resource/,
  );
});
test("freshness rejects future time and distinguishes old observations", () => {
  assert.equal(assessFreshness("2020-01-01T00:00:00Z", options.asOf), "stale");
  assert.equal(
    assessFreshness("2030-01-01T00:00:00Z", options.asOf),
    "unknown",
  );
  assert.equal(assessFreshness(null, options.asOf), "unknown");
});
test("strict config rejects unknown fields, duplicate environments and live inputs", async () => {
  const c = await read(root, configPath);
  assert.throws(
    () => validateConfig({ ...c, guessedDependencies: [] }),
    /Invalid analysis/,
  );
  assert.throws(
    () =>
      validateConfig({
        ...c,
        environments: [c.environments[0], c.environments[0]],
      }),
    /Duplicate environment/,
  );
  assert.throws(
    () => validateConfig({ ...c, simulation: false }),
    /Invalid analysis/,
  );
});
test("input path and symlink escapes are rejected before Helm execution", async () =>
  fixture(async (dir) => {
    const c = await read(dir, configPath);
    c.source.files = ["../outside.java"];
    await json(dir, configPath, c);
    await assert.rejects(captureInputs(dir, configPath), /within repository/);
    c.source.files = ["escape.java"];
    await json(dir, configPath, c);
    await symlink("/etc/passwd", path.join(dir, "escape.java"));
    await assert.rejects(captureInputs(dir, configPath), /escapes repository/);
  }));
test("canonical hashing is independent of object key order", () =>
  assert.equal(hash({ b: 1, a: 2 }), hash({ a: 2, b: 1 })));
