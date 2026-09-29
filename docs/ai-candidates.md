# AI-assisted source candidates

`ai-evidence/1` is an opt-in source adapter for the system manifest. It accepts
structured proposals extracted by an AI or operator from selected source files.
It does not call an LLM, send source to a provider, execute source, or contact a
cluster. Use your approved coding agent to fill the template. No polling is added.

For differently named configuration keys, `.properties` inputs, environment
bindings and split host/port, use the additive `ai-evidence/2` and
`spring-properties/2` contracts in [configuration bindings](configuration-bindings.md).
The v1 workflow and limits documented below remain unchanged.
For bounded gRPC DNS and host/port bindings, opt in separately to
[`ai-evidence/3`](grpc-endpoints.md). This does not expand the older adapters.

## Try the complete synthetic example

```bash
node scripts/ai-candidates-fixture.mjs artifacts/ai-demo
npm run analyze -- --root artifacts/ai-demo --system system.json --out ../analysis
npm run dev
# Project analysis: portal/downstream is visible as an unreviewed candidate, not an edge.
npm run analyze -- --root artifacts/ai-demo --system accepted.json --out ../analysis
# Reload the page: QA has a declared-review edge; production remains unreviewed.
```

Requires Node 22+, dependencies, Git and Helm v3.17.3. Destination must be new.
These Kotlin and AI documents are authored specimens, not a real LLM run, compiled
application or actual human approval. The fixture never contacts Kubernetes.

## Prepare an AI input

In a reviewed system manifest, use this source shape instead of the Spring source
adapter for one logical service (the excerpt is not a complete manifest):

```json
{
  "adapter": "ai-evidence/1",
  "files": [{"repository": "orders-source", "path": "src/Clients.kt"}],
  "candidateFile": {"repository": "architecture-inputs", "path": "orders-candidates.json"},
  "reviews": []
}
```

Declare and pin both repository bindings with exact commit SHAs in the normal
system manifest. Keep source and candidate inputs independently pinned. They may
use separate repositories, or two IDs pointing to the same local repository path:

```json
[
  {"id": "orders-source", "path": "orders", "revision": "<source commit A>"},
  {"id": "architecture-inputs", "path": "orders", "revision": "<candidate commit B>"}
]
```

For the same physical repository, generate citations at commit A, commit the
candidate document in commit B, then update only architecture-inputs to B. Keep
orders-source at A. Updating the source pin invalidates the citations even when
file bytes are unchanged; regenerate candidates and review after source changes.
Using one binding for both creates a self-reference loop and is unsupported.
Template/check commands capture source inputs without requiring the
candidateFile to exist yet. Full analysis requires it in its pinned Git commit.

```bash
node scripts/ai-candidates.mjs template --root APPROVED_ROOT --system system.json \
  --service orders --out NEW_TEMPLATE.json
# Give the template, approved source files and extraction instructions to your agent.
node scripts/ai-candidates.mjs check --root APPROVED_ROOT --system system.json \
  --service orders --bundle FILLED_TEMPLATE.json
```

Run from Archi; template/bundle paths are relative to the current directory.
The output parent must exist and existing template files are never overwritten.
`check` prints candidate hashes after evidence validation. This verifies bytes and
scope, not semantic correctness. Commit the filled document into candidateFile's
repository and update that repository's pinned revision before full analysis.

## Extraction instructions for the agent

For each client supply a stable ID, symbol/name, literal endpoint configuration
key, protocol, explicit conditions, unknowns, and at least one source citation.
Each citation must name a selected repository/file, exact revision, SHA-256 file
content hash, inclusive 1-based line range and matching quote. Quote text uses LF
line separators. Preserve the source file hash (including original line endings).

Do not invent targets or edges. Do not infer a target from a class/service name.
Do not fill reviewer decisions. Record dynamic construction, unresolved activation,
framework defaults and missing evidence in unknowns. Cite configuration access as
well as client construction when these span files; declare all needed source files.
Missing candidates are not evidence of absence, and coverage remains partial.

Protocol values are HTTP, HTTPS, TCP, gRPC and unknown. This initial resolution
path supports configuration keys whose effective values are HTTP/HTTPS/TCP URLs.
gRPC targets, split host/port, literal targets and custom configuration precedence
remain unsupported and cannot produce confirmed edges. The existing bounded
Spring property adapter still supplies effective properties from ordered YAML and
rendered SPRING_APPLICATION_JSON. AI extraction does not expand property semantics.

## Explicit review

Unreviewed and rejected candidates may show a target mapping but never create a
dependency edge. An operator may record a review in the manifest's source.reviews:

```json
{
  "candidateHash": "<hash printed by check>",
  "environment": "qa",
  "instance": "orders-qa",
  "decision": "accepted",
  "reviewer": "<operator identity>",
  "reason": "<why the extraction and activation conditions are valid>"
}
```

Decisions are accepted or rejected, scoped to that service's environment/instance.
Review binds the complete candidate, including source revision/hash, quote, key,
protocol, conditions and unknowns. Changing it invalidates the review; stale review
hashes fail analysis. Accepted candidates with unknowns, incomplete properties,
inactive supported conditions or unresolved endpoints still cannot create edges.

These are declared operator assertions in trusted local configuration, not signed
identities, authenticated approval or an authorization service. Do not let an AI
self-approve proposals. Use your repository's review policy for manifest changes.
UI and export preserve AI origin, reviewer and decision; they do not call an
accepted candidate language-parser-verified or runtime-observed.
Exported analysis includes cited source excerpts and review metadata. Keep it inside
the approved data boundary and inspect/redact sensitive content before sharing.

## Review queue and safe manifest output

After committing the candidate bundle and pinning its input revision, inspect all
candidate/environment/instance combinations without Helm or cluster access:

```bash
node scripts/ai-candidates.mjs queue --root APPROVED_ROOT --system system.json --service orders
```

The JSON queue includes exact source quotations, conditions, unknowns, review status,
candidate hashes and stale review declarations. It does not resolve deployment
endpoints. Inspect semantics and completeness before accepting a candidate.

Use its candidate ID and hash to record one explicitly authorized decision:

```bash
node scripts/ai-candidates.mjs review --root APPROVED_ROOT --system system.json \
  --service orders --candidate CLIENT_ID --hash EXACT_HASH_FROM_QUEUE \
  --environment qa --instance orders-qa --decision accepted \
  --reviewer 'YOUR_IDENTITY' --reason 'YOUR_REVIEW_FINDINGS' --out NEW_REVIEWED_MANIFEST.json
```

`rejected` records rejection; `unreviewed` removes this exact scoped review. Every
operation requires an explicit identity and reason. The command prints the previous
and requested decisions; removal is not a persisted audit event. Commit the output
using your normal review policy if history is needed. No bulk approval is provided.
Other scopes, candidates and stale declarations remain untouched. Stale declarations
still block analysis until explicitly removed or corrected in the manifest.

The command reads the pinned bundle, checks its evidence and expected candidate hash,
and writes a **new** manifest, never overwriting an existing file or changing Git.
Output paths are relative to your shell directory; repository paths continue to be
relative to `--root`. Reanalyze the new manifest with the same root and reload the UI.
Acceptance cannot bypass unknowns, inactive conditions or unsupported endpoints.

In **Connections & evidence**, search by client, instance, service, configuration key
or reviewer, and filter by AI review status or investigation need. The inspector
shows cited source lines and revisions. These filters are view-only; browser review
remains read only and does not submit decisions or mutate analysis.

## Validation and limits

Strict schemas reject extra fields (including direct targetService answers),
duplicate candidate IDs, mismatched service/input mode, unselected source paths,
stale revisions/hashes, invalid line ranges and fabricated quotes. Reviews reject
unknown service scopes and duplicate decisions. Input bundles are limited to
500 candidates and 2 MiB in the adapter; JSON file reads additionally use existing
file safety limits. CLI/template operations and pinned capture perform no network
acquisition. Full analysis still needs Helm, just like the existing system path.

This supports language-independent evidence proposals, not arbitrary language
semantics. Built-in deterministic Spring extraction remains the default and can
coexist with AI-assisted services in the same manifest. One source adapter per
logical service is selected in this version; it does not merge competing extractors.
