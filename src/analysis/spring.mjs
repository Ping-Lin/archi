import { parse } from "java-parser";
import { parseDocument } from "yaml";
import { hash, identify } from "./contract.mjs";

function descendants(node, name) {
  const out = [];
  if (node?.name === name) out.push(node);
  for (const values of Object.values(node?.children ?? {}))
    for (const child of values)
      if (child.children) out.push(...descendants(child, name));
  return out;
}
function tokens(node) {
  if (!node) return [];
  if (node.image !== undefined) return [node];
  return Object.values(node.children ?? {})
    .flatMap((values) => values.flatMap(tokens))
    .sort((a, b) => a.startOffset - b.startOffset);
}
const text = (node) =>
  tokens(node)
    .map((t) => t.image)
    .join(" ");
const annotations = (modifiers) =>
  (modifiers ?? []).flatMap((m) => descendants(m, "annotation")).map(text);
const knownImports = {
  Configuration: "org.springframework.context.annotation.Configuration",
  Bean: "org.springframework.context.annotation.Bean",
  Profile: "org.springframework.context.annotation.Profile",
  Value: "org.springframework.beans.factory.annotation.Value",
  ConditionalOnProperty:
    "org.springframework.boot.autoconfigure.condition.ConditionalOnProperty",
};

// Grammar-backed extraction, followed by an intentionally narrow semantic whitelist.
// Unknown method bodies remain candidates; parsing Java never proves bean reachability.
export function extractSpring(files, source, env, ledger, { httpFactories = false } = {}) {
  const candidates = [],
    diagnostics = [];
  for (const file of source.files) {
    const content = files.get(file),
      evidenceId = ledger.recordEvidence({
        type: "code_static_analysis",
        locator: file,
        contentHash: hash(content),
        analyzer: "java-parser@3.0.1",
      });
    let tree;
    try {
      tree = parse(content);
    } catch (error) {
      diagnostics.push({
        code: "JAVA_PARSE_FAILED",
        file,
        message: error.message.slice(0, 500),
      });
      continue;
    }
    const imports = descendants(tree, "importDeclaration").map(text);
    const imported = (name) =>
      imports.includes(`import ${knownImports[name].split(".").join(" . ")} ;`);
    const classes = descendants(tree, "classDeclaration");
    const singleClass =
      classes.length === 1 &&
      descendants(tree, "normalClassDeclaration").length === 1;
    const classNode = classes[0],
      classAnnotations = annotations(classNode?.children.classModifier);
    const classSupported =
      singleClass &&
      classAnnotations.length === 1 &&
      classAnnotations[0] === "@ Configuration" &&
      imported("Configuration") &&
      !descendants(tree, "classExtends").length &&
      !descendants(tree, "classImplements").length;
    const methods = descendants(tree, "methodDeclaration");
    for (const method of methods) {
      const methodText = text(method);
      if (
        !source.clientTypes.some((type) =>
          tokens(method).some((t) => t.image === type),
        )
      )
        continue;
      const header = method.children.methodHeader?.[0],
        decl = descendants(header, "methodDeclarator")[0];
      const name =
        decl?.children.Identifier?.[0]?.image ??
        `unknown-${method.location.startLine}`;
      const id = identify("candidate", {
        environment: env.id,
        source: source.service,
        file,
        name,
        line: method.location.startLine,
      });
      const methodAnnotations = annotations(method.children.methodModifier),
        conditions = [],
        unsupported = [];
      if (!classSupported)
        unsupported.push(
          "Enclosing configuration class or annotation imports are outside supported scope",
        );
      let bean = false;
      for (const a of methodAnnotations) {
        if (a === "@ Bean" && imported("Bean")) {
          bean = true;
          continue;
        }
        let match;
        if (
          imported("Profile") &&
          (match = a.match(/^@ Profile \( "([a-zA-Z0-9_-]+)" \)$/))
        ) {
          conditions.push({ kind: "profile", value: match[1] });
          continue;
        }
        if (
          imported("ConditionalOnProperty") &&
          (match = a.match(
            /^@ ConditionalOnProperty \( name = "([a-zA-Z0-9_.-]+)" , havingValue = "([a-zA-Z0-9_.-]+)" \)$/,
          ))
        ) {
          conditions.push({ kind: "property", key: match[1], value: match[2] });
          continue;
        }
        unsupported.push(`Unsupported method annotation: ${a}`);
      }
      if (!bean)
        unsupported.push(
          "No supported explicit @Bean registration; candidate is not proven disabled",
        );
      const result = text(header?.children.result?.[0]);
      const headerMatch = text(decl).match(
        /^([A-Za-z_$][\w$]*) \( @ Value \( "\$\{([a-zA-Z0-9_.-]+)\}" \) String ([A-Za-z_$][\w$]*) \)$/,
      );
      const key = headerMatch?.[2] ?? null,
        param = headerMatch?.[3];
      if (
        !headerMatch ||
        !imported("Value") ||
        !source.clientTypes.includes(result)
      )
        unsupported.push(
          "Only one literal @Value parameter and an approved client return type are supported",
        );
      const body = text(method.children.methodBody?.[0]);
      const httpImports = {
        RestClient: 'org.springframework.web.client.RestClient',
        WebClient: 'org.springframework.web.reactive.function.client.WebClient',
      };
      const supportedFactory = httpFactories
        ? Object.hasOwn(httpImports, result) &&
          imports.includes(`import ${httpImports[result].split('.').join(' . ')} ;`) &&
          param !== result &&
          !imports.some(i => i.startsWith('import static ')) &&
          !descendants(tree, 'fieldDeclaration').length &&
          !descendants(tree, 'typeParameters').length &&
          !descendants(tree, 'classExtends').length &&
          !descendants(tree, 'classImplements').length &&
          !descendants(tree, 'interfaceDeclaration').length &&
          !descendants(tree, 'enumDeclaration').length &&
          !descendants(tree, 'recordDeclaration').length &&
          [
            `{ return ${result} . create ( ${param} ) ; }`,
            `{ return ${result} . builder ( ) . baseUrl ( ${param} ) . build ( ) ; }`,
          ].includes(body)
        : body === `{ return new ${result} ( ${param} ) ; }`;
      if (!supportedFactory)
        unsupported.push(
          "Client construction is dynamic or outside the approved constructor pattern",
        );
      const methodEvidence = ledger.recordEvidence({
        type: "code_static_analysis",
        locator: `${file}:${method.location.startLine}`,
        contentHash: hash(methodText),
        parentEvidenceId: evidenceId,
        line: method.location.startLine,
      });
      const factId = ledger.fact(
        "client.candidate",
        id,
        { name, key, conditions, unsupported, ...(httpFactories ? {endpointMeaning:'configured-base-url', sourceAdapter:'spring-http-factory/1'} : {}) },
        [methodEvidence],
      );
      candidates.push({
        id,
        name,
        source: source.service,
        file,
        line: method.location.startLine,
        key,
        conditions,
        unsupported,
        factId,
        ...(httpFactories ? {endpointMeaning:'configured-base-url', sourceAdapter:'spring-http-factory/1'} : {}),
      });
      if (unsupported.length)
        diagnostics.push({
          code: "UNSUPPORTED_CLIENT_PATTERN",
          file,
          line: method.location.startLine,
          message: unsupported.join("; "),
        });
    }
    if (
      source.clientTypes.some((type) =>
        tokens(tree).some((t) => t.image === type),
      ) &&
      !methods.some((m) =>
        source.clientTypes.some((type) =>
          tokens(m).some((t) => t.image === type),
        ),
      )
    )
      diagnostics.push({
        code: "UNSUPPORTED_CLIENT_LOCATION",
        file,
        message:
          "Client type outside a supported factory method; no completeness claim",
      });
  }
  return {
    candidates,
    diagnostics,
    coverage: {
      collector: "spring",
      status: diagnostics.length ? "partial" : "complete",
      scope: source.files,
      meaning:
        "Candidate registration in listed files only; no execution reachability",
    },
  };
}

function flatten(value, prefix = "", out = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Property sources must contain mappings");
  for (const [key, item] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === "object" && !Array.isArray(item))
      flatten(item, full, out);
    else if (["string", "boolean", "number"].includes(typeof item))
      out[full] = String(item);
    else throw new Error(`Unsupported property value: ${full}`);
  }
  return out;
}
export function resolveProperties(files, env, resources, source, ledger, options = {}) {
  const values = Object.create(null),
    chains = Object.create(null),
    diagnostics = [];
  let complete = env.propertiesComplete;
  const add = (mapping, locator, type, supportingEvidence = [], supportingFactIds = []) => {
    const evidenceId = ledger.recordEvidence({
      type,
      locator,
      contentHash: hash(mapping),
    });
    for (const [key, value] of Object.entries(mapping)) {
      const factId = ledger.fact(
        "property.value",
        key,
        { value, precedence: chains[key]?.length ?? 0, locator, ...(supportingFactIds.length?{supportingFactIds}:{}) },
        [...new Set([evidenceId,...supportingEvidence])],
      );
      (chains[key] ??= []).push(factId);
      values[key] = value;
      if (
        key.startsWith("spring.config.") ||
        key.startsWith("spring.profiles.") ||
        (!options.placeholders && value.includes("${")) ||
        (options.placeholders && value.includes('$(')) ||
        value.includes("#{")
      ) {
        complete = false;
        diagnostics.push({
          code: "UNSUPPORTED_PROPERTY_SOURCE",
          message: `${key} requires unsupported config import, profile, or expression resolution`,
        });
      }
    }
  };
  const imported=options.fileResolver?.(files,env,ledger);
  if(imported){
    diagnostics.push(...imported.diagnostics);if(!imported.complete)complete=false;
    for(const source of imported.sources)add(source.mapping,source.locator??source.file,'config_resolution',source.evidenceIds,imported.factIds);
  }
  for (const file of imported?[]:env.propertyFiles) {
    try {
      if (options.parseFile) add(options.parseFile(file,files.get(file)),file,'config_resolution');
      else {
        const doc = parseDocument(files.get(file), { uniqueKeys: true });
        if (doc.errors.length) throw new Error(doc.errors[0].message);
        add(flatten(doc.toJS({ maxAliasCount: 100 })), file, "config_resolution");
      }
    } catch (error) {
      complete = false;
      diagnostics.push({
        code: "PROPERTY_PARSE_FAILED",
        message: `${file}: ${error.message}`,
      });
    }
  }
  const deployments = resources.filter(
    (r) => r.kind === "Deployment" && (source.workloadKey ? r.key === source.workloadKey : r.service === source.service),
  );
  if (deployments.length !== 1) {
    complete = false;
    diagnostics.push({
      code: "WORKLOAD_MAPPING_UNRESOLVED",
      message: `Expected one source workload for property resolution; found ${deployments.length}`,
    });
  }
  const deployment = deployments.length === 1 ? deployments[0] : null;
  const containers = deployment?.spec?.template?.spec?.containers ?? [];
  if (containers.length !== 1) {
    complete = false;
    diagnostics.push({
      code: "CONTAINER_MAPPING_UNRESOLVED",
      message: "Single application container required for this adapter",
    });
  }
  const container = containers.length === 1 ? containers[0] : null;
  if (
    (!options.environmentResolver && container?.envFrom?.length) ||
    container?.args?.length ||
    container?.command?.length ||
    (!options.mountResolver&&container?.volumeMounts?.length)
  ) {
    complete = false;
    diagnostics.push({
      code: "UNSUPPORTED_DEPLOYMENT_OVERRIDE",
      message:
        "envFrom, command/args, or mounted configuration requires another property adapter",
    });
  }
  const resolvedEnvironment=options.environmentResolver?.(container,deployment,resources,env,ledger);
  if(resolvedEnvironment){diagnostics.push(...resolvedEnvironment.diagnostics);if(!resolvedEnvironment.complete)complete=false;}
  let variables = resolvedEnvironment?.variables ?? [...(container?.env ?? [])];
  const mounted=options.mountResolver?.(container,deployment,resources,env,variables,ledger);
  if(mounted){
    diagnostics.push(...mounted.diagnostics);if(!mounted.complete)complete=false;
    for(const source of mounted.sources)add(source.mapping,source.locator??source.file,'mounted_config',source.evidenceIds,mounted.factIds);
    variables=variables.filter(v=>v.name!=='SPRING_CONFIG_ADDITIONAL_LOCATION');
  }
  // Explicit env bindings override files; application JSON overrides both.
  if (options.environmentBindings) variables.sort((a,b) => Number(a.name==='SPRING_APPLICATION_JSON')-Number(b.name==='SPRING_APPLICATION_JSON'));
  for (const binding of options.environmentBindings ?? []) {
    if (!variables.some(v=>v.name===binding.name)) {
      complete=false;
      diagnostics.push({code:'ENV_BINDING_MISSING',message:`Declared environment variable unavailable: ${binding.name}`});
    }
  }
  if (new Set(variables.map((v) => v.name)).size !== variables.length)
    complete = false;
  for (const variable of variables) {
    if (
      variable.name === "SPRING_APPLICATION_JSON" &&
      typeof variable.value === "string" && !variable.valueFrom
    ) {
      try {
        add(
          (options.flatten ?? flatten)(JSON.parse(variable.value)),
          `${deployment.key}/env/SPRING_APPLICATION_JSON`,
          "helm_render",
          variable._evidenceIds,variable._referenceFactIds,
        );
      } catch (error) {
        complete = false;
        diagnostics.push({
          code: "INVALID_APPLICATION_JSON",
          message: error.message,
        });
      }
    } else if (
      variable.name === "SPRING_PROFILES_ACTIVE" &&
      typeof variable.value === "string" && !variable.valueFrom
    ) {
      if (
        JSON.stringify(options.orderedProfiles?variable.value.split(',').map(p=>p.trim()).filter(Boolean):variable.value.split(",").sort()) !==
        JSON.stringify(options.orderedProfiles?env.profiles:[...env.profiles].sort())
      ) {
        complete = false;
        diagnostics.push({
          code: "PROFILE_MISMATCH",
          message: "Rendered profiles differ from reviewed environment scope",
        });
      }
    } else if (options.environmentBindings?.some(b=>b.name===variable.name) && typeof variable.value==='string' && !variable.valueFrom) {
      const binding=options.environmentBindings.find(b=>b.name===variable.name);
      add({[binding.key]:variable.value},variable._locator??`${deployment.key}/env/${variable.name}`,'helm_render',variable._evidenceIds,variable._referenceFactIds);
    } else {
      complete = false;
      diagnostics.push({
        code: "UNSUPPORTED_DEPLOYMENT_OVERRIDE",
        message: `Unsupported environment property source: ${variable.name}`,
      });
    }
  }
  if (!variables.some((v) => v.name === "SPRING_PROFILES_ACTIVE")) {
    complete = false;
    diagnostics.push({
      code: "PROFILE_SOURCE_UNKNOWN",
      message: "Rendered active profiles unavailable",
    });
  }
  const policyEvidence = ledger.recordEvidence({
    type: "declared_analysis_scope",
    locator: `archi.config/environments/${env.id}`,
    contentHash: hash({
      profiles: env.profiles,
      propertiesComplete: env.propertiesComplete,
      ...(imported?{importProfilePolicy:env.importProfilePolicy,importBindings:env.importBindings}:{}),
      ...(options.orderedProfiles?{profileBindings:env.profileBindings}:{}),
      ...(mounted&&options.orderedProfiles?{mountedProfileBindings:env.mountedProfileBindings}:{}),
      ...(mounted?{mountedFiles:env.mountedFiles,...(env.mountedImportBindings?{mountedImportBindings:env.mountedImportBindings}:{})}:{}),
      ...(options.environmentBindings ? {adapter:options.adapter??(options.placeholders?'spring-properties/3':'spring-properties/2'),environmentBindings:options.environmentBindings,propertyFiles:env.propertyFiles} : {}),
    }),
  });
  if(options.placeholders) {
    if(complete) {
      const failures=options.placeholders(values,chains,ledger,policyEvidence,
        (options.environmentBindings??[]).filter(b=>b.name!==b.key).map(b=>b.name));
      diagnostics.push(...failures);if(failures.length)complete=false;
    }else diagnostics.push({code:'PLACEHOLDER_SCOPE_INCOMPLETE',message:'Placeholder evaluation skipped: reviewed configuration scope is incomplete; defaults do not prove absence'});
  }
  const scopeFact = ledger.fact(
    "property.scope",
    env.id,
    {
      complete,
      ...(resolvedEnvironment?{referenceFactIds:[...resolvedEnvironment.factIds,...(imported?.factIds??[]),...(mounted?.factIds??[])]}:{}),
      profiles: env.profiles,
      assumption:
        "Reviewed closed property-source scope; not live configuration",
    },
    [policyEvidence],
  );
  return { values, chains, complete, scopeFact, diagnostics, ...(resolvedEnvironment?{referenceFactIds:[...resolvedEnvironment.factIds,...(imported?.factIds??[]),...(mounted?.factIds??[])]}:{}) };
}
