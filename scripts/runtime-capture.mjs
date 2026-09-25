#!/usr/bin/env node
import { parseArgs } from "node:util";
import { collectRuntime, kubectlReader } from "../src/runtime/collect.mjs";
import { createJson } from "../src/observations/create.mjs";
try {
  const { values } = parseArgs({
    options: Object.fromEntries(
      [
        "environment",
        "cluster",
        "context",
        "kubeconfig",
        "namespaces",
        "out",
      ].map((k) => [k, { type: "string" }]),
    ),
  });
  if (
    !Object.values(values).length ||
    [
      "environment",
      "cluster",
      "context",
      "kubeconfig",
      "namespaces",
      "out",
    ].some((k) => !values[k])
  )
    throw Error(
      "Usage: npm run runtime:capture -- --environment ENV --cluster ID --context CONTEXT --kubeconfig FILE --namespaces ns1,ns2 --out NEW_FILE",
    );
  const capture = await collectRuntime(
    { ...values, namespaces: values.namespaces.split(",") },
    { read: kubectlReader(values) },
  );
  await createJson(values.out, capture);
  const incomplete = capture.collections.filter(
    (c) => c.status !== "complete",
  ).length;
  console.log(
    `Capture saved; ${incomplete} incomplete collections. ${capture.contentHash}`,
  );
  if (incomplete) process.exitCode = 2; // Partial capture is retained and explicitly non-successful.
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
