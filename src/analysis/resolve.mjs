import { hash, identify, VERSION, assertSnapshot } from "./contract.mjs";
import { resourceKey } from "./helm.mjs";
import { endpointKeys, resolveEndpointBinding, resolveGrpcEndpoint } from './endpoint-binding.mjs';

function endpoint(value) {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:", "tcp:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function readObservations(text, env, ledger) {
  const absent = {
    resources: [],
    runtime: [],
    coverage: "unavailable",
    collectedAt: null,
    release: null,
    diagnostics: [],
  };
  if (!text) return absent;
  try {
    const data = JSON.parse(text);
    if (
      data.schemaVersion !== VERSION ||
      data.environment !== env.id ||
      !["complete", "partial", "failed"].includes(data.coverage) ||
      !Array.isArray(data.resources) ||
      !Array.isArray(data.runtime) ||
      !Number.isFinite(Date.parse(data.collectedAt))
    )
      throw new Error("Invalid observation scope or collection metadata");
    const evidenceId = ledger.recordEvidence({
      type: "deployment_metadata",
      locator: env.observations,
      contentHash: hash(text),
      collectedAt: data.collectedAt,
      coverage: data.coverage,
    });
    if (data.coverage === "failed")
      return {
        ...absent,
        coverage: "failed",
        collectedAt: data.collectedAt,
        evidenceId,
        diagnostics: [
          {
            code: "COLLECTION_FAILED",
            message:
              "Failed collection cannot establish resource presence, absence or runtime support",
          },
        ],
      };
    const resources = [];
    for (const object of data.resources) {
      if (object.metadata?.namespace !== env.namespace)
        throw new Error("Observation resource outside declared namespace");
      const key = resourceKey(object, env);
      if (!key) throw new Error("Unsupported observation resource");
      if (resources.some((r) => r.key === key))
        throw new Error("Duplicate observation resource");
      resources.push({ key, object, evidenceId });
    }
    for (const event of data.runtime)
      if (
        typeof event.candidate !== "string" ||
        typeof event.target !== "string" ||
        !Number.isFinite(Date.parse(event.observedAt)) ||
        Date.parse(event.observedAt) > Date.parse(data.collectedAt)
      )
        throw new Error("Invalid runtime event");
    return { ...data, resources, evidenceId, diagnostics: [] };
  } catch (error) {
    return {
      ...absent,
      coverage: "failed",
      diagnostics: [{ code: "OBSERVATION_INVALID", message: error.message }],
    };
  }
}

export function resolveCandidates(
  extracted,
  properties,
  env,
  resources,
  observations,
  ledger,
  targetResolver = null,
) {
  const candidates = [],
    dependencies = [];
  const targetEvidence = targetResolver
    ? null
    : ledger.recordEvidence({
        type: "declared_target_catalog",
        locator: `archi.config/environments/${env.id}/targets`,
        contentHash: hash(env.targets),
      });
  const targetFact = targetResolver
    ? null
    : ledger.fact("targets.catalog", env.id, env.targets, [targetEvidence]);
  for (const candidate of extracted.candidates) {
    const facts = [
      candidate.factId,
      ...(candidate.registrationFact?[candidate.registrationFact]:[]),
      properties.scopeFact,
      ...(properties.referenceFactIds??[]),
      ...(targetFact ? [targetFact] : []),
      ...(candidate.endpointBinding ? endpointKeys(candidate.endpointBinding).flatMap(k=>properties.chains[k]??[]) : properties.chains[candidate.key] ?? []),
    ];
    const reasons = [...candidate.unsupported];
    if (candidate.endpointMeaning === 'configured-base-url')
      reasons.push('Configured HTTP client base URL only; request URI overrides, later mutation, redirects, proxies and actual calls are not analyzed');
    if(candidate.sourceAdapter==='spring-feign/1')
      reasons.push('Explicit Feign registration is conditional on reviewed configuration activation and default client behavior; client names are not resolved as service discovery');
    let eligibility = "enabled";
    if (candidate.unsupported.length || !properties.complete)
      eligibility = "unknown";
    if(candidate.sourceAdapter==='spring-record-client/1'){
      reasons.push('Record binding and configuration activation are reviewed assumptions; only exact canonical String properties are supported');
      const normalized=k=>k.toLowerCase().replace(/[^a-z0-9]/g,'');
      const aliases=Object.keys(properties.values).filter(k=>(candidate.bindingKeys??[]).some(expected=>k!==expected&&normalized(k)===normalized(expected)));
      if(aliases.length){
        eligibility='unknown';
        facts.push(...aliases.flatMap(k=>properties.chains[k]??[]));
        reasons.push('Noncanonical or competing relaxed property aliases require a separate binding adapter');
      }
    }
    if(candidate.sourceAdapter==='spring-feign/1'&&Object.keys(properties.values).some(k=>/^(spring\.cloud\.openfeign\.|feign\.)/.test(k))){
      eligibility='unknown';
      facts.push(...Object.keys(properties.values).filter(k=>/^(spring\.cloud\.openfeign\.|feign\.)/.test(k)).flatMap(k=>properties.chains[k]??[]));
      reasons.push('Feign framework property overrides require a separate supported configuration contract');
    }
    const sameName = extracted.candidates.filter(
      (c) => c.name === candidate.name,
    );
    if (sameName.length > 1) {
      eligibility = "unknown";
      reasons.push("Multiple candidate registrations share a bean name");
      facts.push(...sameName.map((c) => c.factId));
    }
    if (!properties.complete)
      reasons.push("Effective properties or active profiles are incomplete");
    if (eligibility === "enabled")
      for (const condition of candidate.conditions) {
        if (
          condition.kind === "profile" &&
          !env.profiles.includes(condition.value)
        ) {
          eligibility = "disabled";
          reasons.push(`Profile ${condition.value} is inactive`);
        }
        if (condition.kind === "property") {
          facts.push(...(properties.chains[condition.key] ?? []));
          if (
            properties.values[condition.key]?.toLowerCase() !==
            condition.value.toLowerCase()
          ) {
            eligibility = "disabled";
            reasons.push(
              `${condition.key}=${properties.values[condition.key] ?? "<absent>"}; requires ${condition.value}`,
            );
          }
        }
      }
    if (eligibility === "enabled")
      reasons.push(
        candidate.extraction ? 'Operator accepted the AI extraction; supported conditions are satisfied. This is a declared review, not parser verification or execution proof.' : candidate.sourceAdapter==='spring-feign/1' ? 'Explicit Feign interface registration matches the selected source scope; configuration activation is reviewed, not runtime-proven' : "Explicit bean registration and supported conditions are satisfied; execution is not proven",
      );
    const value = candidate.endpointBinding ? Object.fromEntries(endpointKeys(candidate.endpointBinding).map(k=>[k,properties.values[k]??null])) : properties.values[candidate.key] ?? null;
    let url = properties.complete ? (candidate.endpointAdapter==='grpc-endpoint/1' ? resolveGrpcEndpoint(candidate.endpointBinding,properties.values) : candidate.endpointBinding ? resolveEndpointBinding(candidate.endpointBinding,candidate.extraction.protocol,properties.values) : endpoint(value)) : null;
    if (candidate.endpointMeaning === 'configured-base-url' && (!url || !['http:', 'https:'].includes(new URL(url).protocol))) {
      url = null;
      if (eligibility !== 'disabled') eligibility = 'unknown';
      reasons.push('HTTP factory requires a supported absolute HTTP/HTTPS base URL');
    }
    if(candidate.endpointBinding) {
      const bindingEvidence=[...new Set(ledger.facts.filter(f=>facts.includes(f.id)).flatMap(f=>f.evidenceIds))];
      facts.push(ledger.fact('endpoint.binding',candidate.id,{binding:candidate.endpointBinding,protocol:candidate.extraction.protocol,url,...(candidate.endpointAdapter?{adapter:candidate.endpointAdapter,transportSecurity:'unknown'}:{})},bindingEvidence));
      reasons.push(url?'Endpoint constructed from explicitly bound configuration keys':'Endpoint binding has missing, invalid or unsupported values');
    }
    if(candidate.endpointAdapter==='grpc-endpoint/1')reasons.push('gRPC host/port identity only; DNS answers, TLS/mTLS, authority overrides, load balancing and live reachability are unverified');
    if(candidate.extraction && (!url || new URL(url).protocol !== candidate.extraction.protocol.toLowerCase()+':')) {
      url=null; if(eligibility !== 'disabled') eligibility='unknown'; reasons.push('AI-declared protocol and supported configured endpoint do not agree');
    }
    const resolvedTarget = targetResolver ? targetResolver(url, ledger) : null;
    if (resolvedTarget) {
      facts.push(...resolvedTarget.factIds);
      reasons.push(...resolvedTarget.reasons);
    }
    const matches = resolvedTarget
      ? resolvedTarget.matches
      : url
        ? env.targets.filter((t) => endpoint(t.url) === url)
        : [];
    let targetResolution =
      matches.length === 1
        ? "unique"
        : matches.length > 1
          ? "ambiguous"
          : "unresolved";
    const target = matches.length === 1 ? matches[0] : null;
    if (!targetResolver && target && target.kind !== "external") {
      const parsed = new URL(target.url);
      const port =
        Number(parsed.port) ||
        (parsed.protocol === "https:"
          ? 443
          : parsed.protocol === "http:"
            ? 80
            : 0);
      const service = resources.find(
        (r) =>
          r.kind === "Service" &&
          r.name === target.id &&
          (r.spec?.ports ?? []).some((p) => p.port === port) &&
          [
            r.name,
            `${r.name}.${r.namespace}`,
            `${r.name}.${r.namespace}.svc`,
            `${r.name}.${r.namespace}.svc.cluster.local`,
          ].includes(parsed.hostname),
      );
      if (!service) {
        targetResolution = "unresolved";
        reasons.push(
          "Internal target catalog entry has no matching rendered Service/DNS",
        );
      } else facts.push(service.factId);
    }
    reasons.push(
      targetResolution === "unique"
        ? `Endpoint maps to ${target.id} using the reviewed ${targetResolver ? "deployment binding and rendered resources" : "target catalog"}`
        : targetResolution === "ambiguous"
          ? "Multiple target catalog entries match the endpoint"
          : "Endpoint or supported target mapping is unavailable",
    );
    const runtime =
      observations.coverage === "failed"
        ? []
        : observations.runtime.filter((e) => e.candidate === candidate.name);
    for (const event of runtime) {
      const e = ledger.recordEvidence({
        type: "runtime_observation",
        locator: env.observations,
        contentHash: hash(event),
        observedAt: event.observedAt,
      });
      facts.push(ledger.fact("runtime.target", candidate.id, event, [e]));
    }
    const consistency = runtime.length
      ? targetResolution === "unique" &&
        runtime.every((e) => e.target === target.id) &&
        eligibility === "enabled"
        ? "compatible"
        : "conflicting"
      : "unevaluated";
    const runtimeSupport = runtime.length ? "observed" : "unavailable";
    const outcome = {
      eligibility,
      targetResolution,
      target: targetResolution === "unique" ? target.id : null,
      alternatives: matches.map((t) => t.id),
      runtimeSupport,
      consistency,
    };
    const resolutionId = ledger.resolve(
      candidate.sourceAdapter==='spring-feign/1' ? (targetResolver?'explicit-feign-to-deployment':'explicit-feign-to-endpoint') : targetResolver
        ? (candidate.extraction ? 'reviewed-ai-candidate-to-deployment' : "explicit-bean-to-deployment")
        : "explicit-bean-to-endpoint",
      [...new Set(facts)],
      outcome,
      reasons,
      ['spring-http-factory/1','spring-feign/1','spring-record-client/1'].includes(candidate.sourceAdapter)
        ? candidate.sourceAdapter + (targetResolver ? ' + deployment-endpoint/1' : '')
        : targetResolver ? (candidate.endpointAdapter==='grpc-endpoint/1'?'grpc-endpoint/1 + deployment-endpoint/1':candidate.endpointBinding ? 'endpoint-binding/1 + deployment-endpoint/1' : "deployment-endpoint/1") : undefined,
    );
    const resolved = {
      ...candidate,
      ...outcome,
      value,
      observedAt:
        runtime
          .map((e) => e.observedAt)
          .sort()
          .at(-1) ?? null,
      resolutionId,
      reasons,
    };
    candidates.push(resolved);
    if (eligibility === "enabled" && targetResolution === "unique")
      dependencies.push({
        id: identify("dependency", {
          environment: env.id,
          candidate: candidate.id,
          target: target.id,
        }),
        environment: env.id,
        source: candidate.source,
        target: target.id,
        targetKind: target.kind,
        protocol: new URL(target.url).protocol==='grpc:'?'gRPC':new URL(target.url).protocol.replace(":", "").toUpperCase(),
        ...(candidate.endpointAdapter?{endpointAdapter:candidate.endpointAdapter,transportSecurity:'unknown'}:{}),
        candidateId: candidate.id,
        ...(candidate.endpointMeaning ? {endpointMeaning:candidate.endpointMeaning,sourceAdapter:candidate.sourceAdapter} : {}),
        resolutionId,
        ...(candidate.extraction?{extraction:candidate.extraction}:{}),
      });
  }
  return { candidates, dependencies };
}

function selectedSpec(object) {
  const spec = object.spec ?? {};
  return {
    replicas: spec.replicas ?? null,
    images: (spec.template?.spec?.containers ?? [])
      .map((c) => ({ name: c.name, image: c.image }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
export function compareResources(resources, observations) {
  const keys = [
    ...new Set([
      ...resources.map((r) => r.key),
      ...observations.resources.map((r) => r.key),
    ]),
  ].sort();
  return keys.map((key) => {
    const source = resources.find((r) => r.key === key),
      observed = observations.resources.find((r) => r.key === key);
    const differences = [];
    if (source && observed && source.kind === "Deployment") {
      const a = selectedSpec(source),
        b = selectedSpec(observed.object);
      if (hash(a.images) !== hash(b.images)) differences.push("images");
      // Scaling policy is unknown in this slice: replica differences are informational.
    }
    const live = observed?.object;
    const health =
      live?.kind === "Deployment" &&
      Number.isInteger(live.status?.readyReplicas) &&
      Number.isInteger(live.spec?.replicas)
        ? live.status.readyReplicas >= live.spec.replicas
          ? "ready"
          : "progressing"
        : "unknown";
    return {
      key,
      name: source?.name ?? live?.metadata.name,
      kind: source?.kind ?? live?.kind,
      presence:
        source && observed
          ? "both"
          : source
            ? observations.coverage === "complete"
              ? "source-only"
              : "source-present; deployment-unknown"
            : "observed-only",
      comparison:
        source && observed && source.kind === "Deployment"
          ? differences.length
            ? "different"
            : "matching-supported-fields"
          : "unavailable",
      differences,
      health,
      replicas: live
        ? {
            desired: source?.spec?.replicas ?? null,
            live: live.spec?.replicas ?? null,
            ready: live.status?.readyReplicas ?? null,
            ownership: "unknown; excluded from drift",
          }
        : null,
      evidenceIds: [source?.evidenceId, observed?.evidenceId].filter(Boolean),
      uid: live?.metadata.uid ?? null,
    };
  });
}

export function buildSnapshot({
  env,
  inputLock,
  ledger,
  helm,
  extracted,
  properties,
  observations,
  targetResolver = null,
}) {
  const { candidates, dependencies } = resolveCandidates(
    extracted,
    properties,
    env,
    helm.resources,
    observations,
    ledger,
    targetResolver,
  );
  const snapshot = {
    schemaVersion: VERSION,
    environment: env.id,
    inputLock,
    candidates,
    dependencies,
    resources: helm.resources,
    resourceComparisons: compareResources(helm.resources, observations),
    observation: {
      coverage: observations.coverage,
      collectedAt: observations.collectedAt,
      releaseCorrespondence: "unverified",
      release: observations.release ?? null,
    },
    evidence: ledger.evidence,
    facts: ledger.facts,
    resolutions: ledger.resolutions,
    coverage: [
      {
        ...helm.coverage,
        status: helm.diagnostics.length ? "partial" : "complete",
      },
      extracted.coverage,
      {
        collector: "properties",
        status: properties.complete ? "complete" : "partial",
        scope: env.id,
        meaning: "Reviewed property-source boundary, not live configuration",
      },
    ],
    diagnostics: [
      ...helm.diagnostics,
      ...extracted.diagnostics,
      ...properties.diagnostics,
      ...observations.diagnostics,
    ],
  };
  assertSnapshot(snapshot);
  return { ...snapshot, contentHash: hash(snapshot) };
}

export function assessFreshness(observedAt, asOf, maxAgeSeconds = 3600) {
  if (!observedAt) return "unknown";
  const age = (Date.parse(asOf) - Date.parse(observedAt)) / 1000;
  return !Number.isFinite(age) || age < 0
    ? "unknown"
    : age > maxAgeSeconds
      ? "stale"
      : "fresh";
}
