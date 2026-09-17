import {
  readFile,
  readdir,
  realpath,
  mkdtemp,
  mkdir,
  writeFile,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { hash, validateConfig, sourcesFor, callersFor } from "./contract.mjs";

function relative(file) {
  if (
    path.isAbsolute(file) ||
    file.split(/[\\/]/).some((p) => p === "..") ||
    file.includes("\\")
  )
    throw new Error(`Input must stay within repository: ${file}`);
  return file.replace(/^\.\//, "");
}
export async function captureInputs(
  root,
  configPath,
  { revision = null } = {},
) {
  root = await realpath(root);
  const git = (args) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  const commit = git([
    "rev-parse",
    "--verify",
    `${revision ?? "HEAD"}^{commit}`,
  ]).trim();
  const files = new Map();
  const tracked = revision
    ? git(["ls-tree", "-r", "--name-only", commit]).trim().split("\n")
    : null;
  async function read(file) {
    file = relative(file);
    if (files.has(file)) return files.get(file);
    let content;
    if (revision) {
      if (!tracked.includes(file))
        throw new Error(`Input absent at revision: ${file}`);
      const mode = git(["ls-tree", commit, "--", file]).split(" ")[0];
      if (!["100644", "100755"].includes(mode))
        throw new Error(`Unsupported Git input mode: ${file}`);
      content = git(["show", `${commit}:${file}`]);
    } else {
      const target = await realpath(path.join(root, file));
      if (!target.startsWith(root + path.sep))
        throw new Error(`Input escapes repository: ${file}`);
      content = await readFile(target, "utf8");
    }
    files.set(file, content);
    return content;
  }
  async function directory(dir) {
    dir = relative(dir);
    if (revision)
      return tracked.filter((file) => file.startsWith(dir + "/")).sort();
    const resolved = await realpath(path.join(root, dir));
    if (!resolved.startsWith(root + path.sep))
      throw new Error(`Chart escapes repository: ${dir}`);
    const out = [];
    for (const entry of await readdir(resolved, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new Error(`Chart symlink is unsupported: ${entry.name}`);
      const name = `${dir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...(await directory(name)));
      else out.push(name);
    }
    return out.sort();
  }
  const config = validateConfig(JSON.parse(await read(configPath)));
  const chartFiles = await directory(config.helm.chart);
  if (chartFiles.some((p) => p.endsWith(".tgz")))
    throw new Error(
      "Vendored binary chart archives unsupported; use expanded locked dependencies",
    );
  const paths = [
    ...sourcesFor(config).flatMap((s) => s.files),
    ...chartFiles,
    ...config.environments.flatMap((e) => [
      ...e.values,
      ...callersFor(config, e).flatMap(({ env }) => [
        ...env.propertyFiles,
        ...(env.observations ? [env.observations] : []),
      ]),
    ]),
  ];
  for (const file of paths) await read(file);
  if (!revision && git(["rev-parse", "HEAD"]).trim() !== commit)
    throw new Error("HEAD moved during input capture; retry");
  return {
    config,
    files,
    chartFiles,
    source: {
      mode: revision ? "git-revision" : "captured-working-tree",
      commit,
      releaseBinding: "unverified",
    },
    lockFor(env, tools) {
      const selected = [
        ...sourcesFor(config).flatMap((s) => s.files),
        ...chartFiles,
        ...env.values,
        ...callersFor(config, env).flatMap(({ env: scope }) => [
          ...scope.propertyFiles,
          ...(scope.observations ? [scope.observations] : []),
        ]),
      ];
      return {
        source: this.source,
        configHash: hash({
          sources: sourcesFor(config),
          helm: config.helm,
          environment: env,
        }),
        files: Object.fromEntries(
          [...new Set(selected)]
            .sort()
            .map((file) => [file, hash(files.get(file))]),
        ),
        tools,
      };
    },
    async materialize() {
      const dir = await mkdtemp(path.join(os.tmpdir(), "archi-input-"));
      try {
        for (const [file, content] of files) {
          await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
          await writeFile(path.join(dir, file), content);
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
