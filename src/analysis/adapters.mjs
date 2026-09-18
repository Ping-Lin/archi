import { extractSpring, resolveProperties } from "./spring.mjs";
import { renderHelm } from "./helm.mjs";
import Ajv from "ajv";

const records = { type: "array", items: { type: "object" } };
const coverage = {
  type: "object",
  required: ["collector", "status", "meaning"],
  properties: {
    collector: { type: "string" },
    status: { enum: ["complete", "partial"] },
    meaning: { type: "string" },
  },
};
const result = (required, properties) => ({
  type: "object",
  required: [...required, "diagnostics"],
  properties: { ...properties, diagnostics: records },
});
export const adapterResultSchemas = Object.freeze({
  "spring-explicit-bean/1": result(["candidates", "coverage"], {
    candidates: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "source", "file", "name", "factId"],
        properties: Object.fromEntries(
          ["id", "source", "file", "name", "factId"].map((k) => [
            k,
            { type: "string" },
          ]),
        ),
      },
    },
    coverage,
  }),
  "spring-properties/1": result(["values", "chains", "scopeFact", "complete"], {
    values: { type: "object" },
    chains: { type: "object" },
    scopeFact: { type: "string" },
    complete: { type: "boolean" },
  }),
  "helm-template/1": result(
    ["resources", "manifest", "outputHash", "version", "coverage"],
    {
      resources: records,
      manifest: { type: "string" },
      outputHash: { type: "string" },
      version: { type: "string" },
      coverage,
    },
  ),
});
const ajv = new Ajv(),
  validators = Object.fromEntries(
    Object.entries(adapterResultSchemas).map(([id, schema]) => [
      id,
      ajv.compile(schema),
    ]),
  );
export function validateAdapterResult(id, result) {
  if (!validators[id]?.(result)) throw Error(`Invalid adapter result: ${id}`);
  return result;
}

// Closed, versioned built-ins. A manifest selects an adapter, never executable code.
export const adapterContracts = Object.freeze({
  "spring-explicit-bean/1": Object.freeze({
    input: "captured-java-files + caller-scope",
    output: "candidates + coverage + diagnostics",
    engine: "java-parser@3.0.1",
  }),
  "spring-properties/1": Object.freeze({
    input: "ordered-yaml + bound-workload + caller-policy",
    output: "values + chains + scopeFact + diagnostics",
    engine: "yaml@2.9.1",
  }),
  "helm-template/1": Object.freeze({
    input: "captured-chart + release-scope",
    output: "resources + manifest + outputHash + coverage + diagnostics",
    engine: "helm@v3.17.3",
  }),
});
export function runAdapter(id, context) {
  let result;
  if (id === "spring-explicit-bean/1")
    result = extractSpring(
      context.files,
      context.source,
      context.env,
      context.ledger,
    );
  else if (id === "spring-properties/1")
    result = resolveProperties(
      context.files,
      context.env,
      context.resources,
      context.source,
      context.ledger,
    );
  else if (id === "helm-template/1") {
    for (const file of context.chartFiles ?? []) {
      if (file.endsWith(".tgz"))
        throw Error("Binary chart archives are unsupported");
      if (
        /\b(lookup|now|randAlphaNum|randAlpha|randNumeric|randAscii|uuidv4|genCA|genSelfSignedCert|genSignedCert)\b/.test(
          context.files.get(file),
        )
      )
        throw Error(`Unsupported Helm context/random function in ${file}`);
    }
    result = renderHelm(
      context.root,
      context.config,
      context.env,
      context.ledger,
      { binary: context.binary },
    );
  } else throw Error(`Unsupported adapter: ${id}`);
  return validateAdapterResult(id, result);
}
