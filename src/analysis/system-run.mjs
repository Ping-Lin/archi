import { captureSystem, refPath } from "./repositories.mjs";
import { createLedger, VERSION, hash, assertSnapshot } from "./contract.mjs";
import { adapterContracts, runAdapter } from "./adapters.mjs";
import {
  deploymentResolver,
  workloadKey,
  resolutionContract,
} from "./bindings.mjs";
import { buildSnapshot, readObservations } from "./resolve.mjs";
import { composeCallers } from "./run.mjs";

export async function analyzeSystem(
  root,
  manifestPath,
  { asOf = new Date().toISOString(), binary } = {},
) {
  if (!Number.isFinite(Date.parse(asOf)))
    throw Error("Invalid assessment time");
  const inputs = await captureSystem(root, manifestPath),
    captured = await inputs.materialize();
  const { manifest } = inputs,
    snapshots = [],
    manifests = {};
  try {
    for (const env of manifest.environments) {
      const renderLedger = createLedger(env.id),
        renders = {},
        resources = [],
        renderCoverage = [],
        renderDiagnostics = [];
      for (const release of env.releases) {
        // Release metadata participates in evidence identity, even for identical chart bytes.
        const scopeLedger = {
          ...renderLedger,
          recordEvidence: (payload) =>
            renderLedger.recordEvidence({
              ...payload,
              locator: `helm:${env.id}/${release.id}`,
              releaseId: release.id,
              inputs: [release.chart, ...release.values].map((ref) => ({
                repository: ref.repository,
                revision: manifest.repositories.find(
                  (r) => r.id === ref.repository,
                ).revision,
                path: ref.path,
              })),
            }),
        };
        const helm = runAdapter(release.adapter, {
          root: captured.root,
          files: inputs.files,
          chartFiles: inputs.charts.get(`${env.id}/${release.id}`),
          binary,
          config: {
            helm: {
              chart: refPath(release.chart),
              version: release.helmVersion,
              kubeVersion: release.kubeVersion,
              apiVersions: release.apiVersions,
            },
          },
          env: {
            id: env.id,
            cluster: release.cluster,
            namespace: release.namespace,
            release: release.name,
            values: release.values.map(refPath),
          },
          ledger: scopeLedger,
        });
        for (const resource of helm.resources) {
          if (resources.some((r) => r.key === resource.key))
            throw Error(
              `Resource claimed by multiple releases: ${resource.key}`,
            );
          resources.push({
            ...resource,
            releaseId: release.id,
            cluster: release.cluster,
          });
        }
        renders[release.id] = { hash: helm.outputHash, helm: helm.version };
        manifests[`${env.id}/${release.id}`] = helm.manifest;
        renderCoverage.push({ ...helm.coverage, releaseId: release.id });
        renderDiagnostics.push(
          ...helm.diagnostics.map((d) => ({ ...d, releaseId: release.id })),
        );
      }
      const lock = inputs.lockFor(
          env,
          { adapters: adapterContracts, resolution: resolutionContract.id },
          renders,
        ),
        parts = [];
      for (const instance of env.instances) {
        const service = manifest.services.find(
            (s) => s.id === instance.service,
          ),
          release = env.releases.find((r) => r.id === instance.release);
        const ledger = createLedger(env.id, instance.id);
        ledger.evidence.push(...renderLedger.evidence);
        ledger.facts.push(...renderLedger.facts);
        const record = ledger.recordEvidence;
        ledger.recordEvidence = (payload) => {
          const provenance =
            inputs.provenance[payload.locator] ??
            ledger.evidence.find((e) => e.id === payload.parentEvidenceId)
              ?.provenance;
          return record({
            ...payload,
            ...(provenance ? { provenance } : {}),
            ...(payload.type === "declared_analysis_scope"
              ? {
                  locator: `system.manifest/environments/${env.id}/instances/${instance.id}`,
                  manifestHash: lock.manifestHash,
                }
              : {}),
          });
        };
        const source = {
          service: instance.id,
          files: service.source.files.map(refPath),
          clientTypes: service.source.clientTypes,
          candidateFile: service.source.candidateFile ? refPath(service.source.candidateFile) : null,
          workloadKey: workloadKey(instance, release),
        };
        const scope = {
          id: env.id,
          cluster: release.cluster,
          namespace: release.namespace,
          release: release.name,
          profiles: instance.profiles,
          propertyFiles: instance.propertyFiles.map(refPath),
          propertiesComplete: instance.propertiesComplete,
          observations: null,
          targets: [],
        };
        const context = {
          files: inputs.files,
          source,
          env: scope,
          ledger,
          resources,
          service, simulation:manifest.simulation, provenance:inputs.provenance,
        };
        const extracted = runAdapter(service.source.adapter, context),
          properties = runAdapter("spring-properties/1", context);
        const part = buildSnapshot({
          env: scope,
          inputLock: lock,
          ledger,
          helm: {
            resources,
            coverage: {
              collector: "helm",
              status: renderDiagnostics.length ? "partial" : "complete",
              meaning:
                "Shared rendered inventory across explicit release bindings",
            },
            diagnostics: [],
          },
          extracted,
          properties,
          observations: readObservations(null, scope, ledger),
          targetResolver: deploymentResolver({
            env,
            caller: instance,
            resources,
            manifestHash: lock.manifestHash,
          }),
        });
        const describe = (c) => {
          const target = env.instances.find((i) => i.id === c.target),
            targetService = manifest.services.find(
              (s) => s.id === target?.service,
            );
          return {
            ...c,
            sourceService: service.id,
            sourceProject: service.project,
            sourceRelease: release.id,
            targetService: targetService?.id ?? null,
            targetProject: targetService?.project ?? null,
          };
        };
        part.candidates = part.candidates.map(describe);
        part.dependencies = part.dependencies.map(describe);
        parts.push(part);
      }
      const snapshot = composeCallers(
        parts,
        env.instances.map((i) => ({ service: i.id })),
      );
      snapshot.projects = manifest.projects;
      snapshot.instances = env.instances.map((i) => ({
        ...i,
        scope: env.releases.find((r) => r.id === i.release),
      }));
      snapshot.services = manifest.services.map((s) => ({
        id: s.id,
        project: s.project,
        source: s.source,
      }));
      snapshot.coverage = [
        ...renderCoverage,
        ...snapshot.coverage.filter((c) => c.collector !== "helm"),
      ];
      snapshot.diagnostics.push(...renderDiagnostics);
      // Render inventory has one shared unavailable observation scope in this slice.
      snapshot.resourceComparisons = parts[0].resourceComparisons;
      delete snapshot.contentHash;
      assertSnapshot(snapshot);
      snapshot.contentHash = hash(snapshot);
      snapshots.push(snapshot);
    }
  } finally {
    await captured.close();
  }
  return {
    schemaVersion: VERSION,
    name: manifest.name,
    simulation: manifest.simulation,
    run: {
      assessedAt: asOf,
      inputMode: "git-revision-vector",
      releaseCorrespondence: "unverified",
    },
    snapshots,
    manifests,
    assessments: snapshots.map((s) => ({
      environment: s.environment,
      observationFreshness: "unknown",
      candidates: s.candidates.map((c) => ({ id: c.id, freshness: "unknown" })),
    })),
  };
}
