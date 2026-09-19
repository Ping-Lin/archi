import { open, mkdir, realpath, lstat, rename, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { hash } from "../analysis/contract.mjs";
import { analyzeTraffic } from "./model.mjs";
import { insist, LIMITS, validateAnalysis } from "./validation.mjs";

export async function readJson(file) {
  const handle = await open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    insist(
      stat.isFile() && stat.nlink === 1,
      "input must be a regular, non-hardlinked file",
    );
    insist(stat.size <= LIMITS.bytes, "input exceeds byte limit");
    const buffer = Buffer.alloc(Math.min(stat.size + 1, LIMITS.bytes + 1));
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    insist(length === stat.size, "input changed while reading");
    const bytes = buffer.subarray(0, length);
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw Error("Traffic: invalid JSON input");
    }
    return { value, digest: hash(raw) };
  } finally {
    await handle.close();
  }
}

export async function importTraffic({ analysis: input, bundle, out }) {
  const parent = path.dirname(path.resolve(out));
  await mkdir(parent, { recursive: true });
  const output = path.join(await realpath(parent), path.basename(out));
  const canonicalInput = path.join(
    await realpath(path.dirname(path.resolve(input))),
    path.basename(input),
  );
  const lockPath = `${output}.lock`;
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw Error(
        "Traffic: output locked; inspect the owning process before manual stale-lock recovery",
      );
    throw error;
  }
  let temporary = null;
  try {
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
    );
    try {
      const stat = await lstat(output);
      insist(
        stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
        "output must be a regular, non-hardlinked file",
      );
      insist(
        output === canonicalInput,
        "existing output must be the analysis input; choose a new output path",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const captured = await readJson(canonicalInput),
      analysis = captured.value;
    validateAnalysis(analysis);
    const capture = (await readJson(bundle)).value;
    insist(
      analysis.simulation === capture?.simulation,
      "Do not mix synthetic and real captures",
    );
    const snapshot = analysis.snapshots.find(
      (s) => s.environment === capture.environment,
    );
    insist(snapshot, "Traffic environment is absent from analysis");
    const report = analyzeTraffic(capture, snapshot);
    analysis.traffic = { ...analysis.traffic, [capture.environment]: report };
    const serialized = JSON.stringify(analysis, null, 2) + "\n";
    insist(
      Buffer.byteLength(serialized) <= LIMITS.bytes,
      "output exceeds byte limit",
    );
    insist(
      (await readJson(canonicalInput)).digest === captured.digest,
      "analysis changed during import",
    );
    const candidate = path.join(
      path.dirname(output),
      `.traffic-${randomUUID()}.tmp`,
    );
    const handle = await open(candidate, "wx", 0o600);
    temporary = candidate;
    try {
      await handle.writeFile(serialized);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, output);
    temporary = null;
    // Cooperating traffic writers hold the same canonical-path lock through commit.
    let directory;
    try {
      directory = await open(path.dirname(output), "r");
      await directory.sync();
    } catch {
      throw Error(
        "Traffic: output installed, but directory durability could not be confirmed",
      );
    } finally {
      await directory?.close();
    }
    return report;
  } finally {
    try {
      if (temporary)
        await unlink(temporary).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
}
