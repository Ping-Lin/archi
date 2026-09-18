import { cp, mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { SYSTEM_VERSION } from "../src/analysis/system-contract.mjs";

// Authored specimens are copied into independent disposable repositories.
// Existing destinations are never overwritten, including on a repeated CLI run.
export async function createCrossRepoFixture(destination) {
  try {
    await access(destination);
    throw Error(`Fixture destination already exists: ${destination}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(destination, { recursive: true });
  const specimens = fileURLToPath(
    new URL("../examples/cross-repo/repos/", import.meta.url),
  );
  const repositories = [];
  for (const id of ["portal", "orders", "inventory", "deploy"]) {
    const folder = path.join(destination, id);
    await cp(path.join(specimens, id), folder, { recursive: true });
    const git = (args) =>
      execFileSync("git", ["-C", folder, ...args], {
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Archi fixture",
          GIT_AUTHOR_EMAIL: "fixture@example.invalid",
          GIT_COMMITTER_NAME: "Archi fixture",
          GIT_COMMITTER_EMAIL: "fixture@example.invalid",
          GIT_AUTHOR_DATE: "2026-09-17T00:00:00Z",
          GIT_COMMITTER_DATE: "2026-09-17T00:00:00Z",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
    git(["init", "--initial-branch=main"]);
    git(["add", "."]);
    git([
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-m",
      `Synthetic ${id} inputs`,
    ]);
    repositories.push({
      id,
      path: id,
      revision: git(["rev-parse", "HEAD"]).trim(),
    });
  }
  const manifest = {
    schemaVersion: SYSTEM_VERSION,
    simulation: true,
    name: "Cross-project commerce · pinned repositories",
    repositories,
    projects: [
      { id: "experience", name: "Customer experience" },
      { id: "sales", name: "Sales platform" },
      { id: "operations", name: "Operations" },
    ],
    services: [
      ["portal", "experience"],
      ["orders", "sales"],
      ["inventory", "operations"],
    ].map(([id, project]) => ({
      id,
      project,
      source: {
        adapter: "spring-explicit-bean/1",
        files: [{ repository: id, path: "Clients.java" }],
        clientTypes: ["RemoteClient"],
      },
    })),
    environments: ["qa", "production"].map((id) => ({
      id,
      releases: [
        ["portal", "experience"],
        ["orders", "sales"],
        ["inventory", "stock"],
        ["shadow", "sandbox"],
      ].map(([name, namespace]) => ({
        id: name,
        cluster: "commerce",
        namespace: `${namespace}-${id}`,
        name: `${name}-${id}`,
        adapter: "helm-template/1",
        chart: { repository: "deploy", path: "chart" },
        values: [{ repository: "deploy", path: `values/${id}/${name}.yaml` }],
        helmVersion: "v3.17.3",
        kubeVersion: "1.31.0",
        apiVersions: [],
      })),
      instances: ["portal", "orders", "inventory", "shadow"].map((name) => ({
        id: name === "shadow" ? "orders-shadow" : name,
        service: name === "shadow" ? "orders" : name,
        release: name,
        workload: "api",
        endpoint: {
          name: "api",
          port: 8080,
          protocol: "HTTP",
          kind: "service",
        },
        profiles: [id === "qa" ? "qa" : "prod"],
        propertyFiles: [],
        propertiesComplete: true,
      })),
      externalTargets: [
        { id: "warehouse", url: "https://warehouse.example.invalid" },
        { id: "audit", url: "https://audit.example.invalid" },
      ],
    })),
  };
  await writeFile(
    path.join(destination, "system.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return {
    root: destination,
    manifest,
    path: path.join(destination, "system.json"),
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const destination = path.resolve(
      process.argv[2] ?? `artifacts/cross-repo-${Date.now()}`,
    );
    const fixture = await createCrossRepoFixture(destination);
    console.log(
      `Fixture created: ${fixture.path}\nAnalyze with: npm run analyze -- --root ${destination} --system system.json --out ${path.resolve("artifacts/analysis")}`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
