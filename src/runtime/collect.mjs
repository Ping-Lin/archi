import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  CAPTURE_VERSION,
  KINDS,
  projectResource,
  seal,
  validateCapture,
} from "./contract.mjs";
import { boundedJson, insist, LIMITS } from "../traffic/validation.mjs";

const exec = promisify(execFile);
const paths = {
  Deployment: "/apis/apps/v1",
  ReplicaSet: "/apis/apps/v1",
  Pod: "/api/v1",
};
const plurals = {
  Deployment: "deployments",
  ReplicaSet: "replicasets",
  Pod: "pods",
};
export const COLLECTION_LIMITS = Object.freeze({
  pages: 100,
  durationMs: 120000,
  pageBytes: 8 * 1024 * 1024,
});
export function kubectlReader({ context, kubeconfig, binary = "kubectl", signal }) {
  insist(
    typeof context === "string" &&
      context.length > 0 &&
      typeof kubeconfig === "string" &&
      kubeconfig.length > 0,
    "explicit context and kubeconfig required",
  );
  return async (url, timeoutMs) => {
    try {
      const { stdout } = await exec(
        binary,
        [
          "--kubeconfig",
          kubeconfig,
          "--context",
          context,
          "--request-timeout",
          `${Math.max(1, Math.floor(timeoutMs / 1000))}s`,
          "get",
          "--raw",
          url,
        ],
        {
          encoding: "utf8",
          timeout: timeoutMs,
          maxBuffer: COLLECTION_LIMITS.pageBytes,
          killSignal: "SIGKILL",
          windowsHide: true,
          signal,
        },
      );
      return stdout;
    } catch {
      throw Error("query-failed");
    } // Never export stderr, URLs, credentials or credential-plugin output.
  };
}

export async function collectRuntime(
  { environment, cluster, context, namespaces },
  { read, clock = () => Date.now(), signal } = {},
) {
  insist(
    [environment, cluster, context].every(
      (v) => typeof v === "string" && v.length > 0 && v.length <= 1024,
    ),
    "explicit capture context required",
  );
  insist(
    Array.isArray(namespaces) &&
      namespaces.length > 0 &&
      namespaces.length <= 16 &&
      new Set(namespaces).size === namespaces.length &&
      namespaces.every(
        (n) => /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(n) && n.length <= 63,
      ),
    "invalid namespace scope",
  );
  insist(typeof read === "function", "runtime reader required");
  const start = clock(),
    iso = () => new Date(clock()).toISOString();
  const capture = {
    schemaVersion: CAPTURE_VERSION,
    simulation: false,
    environment,
    cluster,
    context,
    clusterIdentity: "operator-asserted",
    adapter: "kubernetes-inventory/1",
    startedAt: new Date(start).toISOString(),
    finishedAt: null,
    collections: [],
  };
  let bytes = 0,
    records = 0;
  for (const namespace of namespaces)
    for (const kind of KINDS) {
      signal?.throwIfAborted();
      const c = {
        namespace,
        kind,
        selector: null,
        status: "failed",
        reason: null,
        startedAt: iso(),
        finishedAt: null,
        resourceVersion: null,
        resources: [],
      };
      const continuations = new Set(),
        names = new Set(),
        uids = new Set();
      let continuation = "",
        pages = 0;
      try {
        do {
          signal?.throwIfAborted();
          if (clock() - start >= COLLECTION_LIMITS.durationMs)
            throw Error("deadline-exceeded");
          if (
            ++pages > COLLECTION_LIMITS.pages ||
            records >= LIMITS.records ||
            bytes >= LIMITS.bytes
          )
            throw Error("collection-limit");
          const query = new URLSearchParams({ limit: "500" });
          if (continuation) query.set("continue", continuation);
          const url = `${paths[kind]}/namespaces/${namespace}/${plurals[kind]}?${query}`;
          const raw = await read(
            url,
            Math.min(15000, COLLECTION_LIMITS.durationMs - (clock() - start)),
          );
          if (typeof raw !== "string") throw Error("invalid-response");
          bytes += Buffer.byteLength(raw);
          if (
            Buffer.byteLength(raw) > COLLECTION_LIMITS.pageBytes ||
            bytes > LIMITS.bytes
          )
            throw Error("collection-limit");
          let page;
          try {
            page = JSON.parse(raw);
            boundedJson(page);
          } catch {
            throw Error("invalid-response");
          }
          if (
            page.kind !== `${kind}List` ||
            !Array.isArray(page.items) ||
            typeof page.metadata?.resourceVersion !== "string" ||
            !page.metadata.resourceVersion ||
            (page.metadata.continue !== undefined &&
              typeof page.metadata.continue !== "string")
          )
            throw Error("invalid-response");
          if (
            c.resourceVersion !== null &&
            c.resourceVersion !== page.metadata.resourceVersion
          )
            throw Error("invalid-response");
          c.resourceVersion = page.metadata.resourceVersion;
          if (records + page.items.length > LIMITS.records)
            throw Error("collection-limit");
          for (const rawObject of page.items) {
            let resource;
            try {
              resource = projectResource(rawObject, kind, namespace);
            } catch {
              throw Error("invalid-response");
            }
            if (names.has(resource.name) || uids.has(resource.uid))
              throw Error("invalid-response");
            names.add(resource.name);
            uids.add(resource.uid);
            c.resources.push(resource);
            records++;
          }
          continuation = page.metadata.continue ?? "";
          if (continuation && continuations.has(continuation))
            throw Error("invalid-response");
          continuations.add(continuation);
        } while (continuation);
        c.status = "complete";
      } catch (error) {
        c.status = c.resources.length ? "partial" : "failed";
        c.reason = [
          "query-failed",
          "invalid-response",
          "collection-limit",
          "deadline-exceeded",
        ].includes(error.message)
          ? error.message
          : "query-failed";
      }
      c.finishedAt = iso();
      capture.collections.push(c);
    }
  capture.finishedAt = iso();
  return validateCapture(seal(capture));
}
