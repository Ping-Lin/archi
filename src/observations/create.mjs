import { open, link, unlink, realpath } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { insist, LIMITS } from "../traffic/validation.mjs";

// New capture only: atomic installation without overwriting any existing file.
export async function createJson(file, value) {
  const raw = JSON.stringify(value, null, 2) + "\n";
  insist(Buffer.byteLength(raw) <= LIMITS.bytes, "capture exceeds byte limit");
  const parent = await realpath(path.dirname(path.resolve(file)));
  const out = path.join(parent, path.basename(file)),
    temp = path.join(parent, `.capture-${randomUUID()}.tmp`);
  const handle = await open(temp, "wx", 0o600);
  try {
    try {
      await handle.writeFile(raw);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temp, out); // EEXIST is never replaced, including symlinks.
    await unlink(temp);
    let directory;
    try {
      directory = await open(parent, "r");
      await directory.sync();
    } catch {
      throw Error(
        "Capture installed, but directory durability could not be confirmed",
      );
    } finally {
      await directory?.close();
    }
  } finally {
    await unlink(temp).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}
