# Archi project guidance

For the next architecture milestone, read docs/phase-four-direction.md. It records
the accepted contract/composition direction and supersedes the earlier onboarding-first plan.
For observation work, also read docs/traffic.md and docs/phase-five-report.md.

Use JavaScript ES modules and Node.js 22+. Keep the frontend in Vue components and
CSS; do not add a second frontend framework. Core modeling/generation must remain
usable without the browser or external services.

Read docs/model.md before changing identity or deployment semantics. Authored config
and observed snapshots are independent. Never infer source commits from image tags.
Use .agents/skills/archi-system-design for system onboarding/configuration changes.

Regenerate with npm run generate. Run npm run verify; run npm run check:helm when Helm
is available and report skipped gates explicitly. Optional browser checks are in
tests/browser.mjs. Do not edit generated files directly.

Current review workflow: save changes on feat/architecture-poc. Do not open a PR or
merge until Ping explicitly confirms that the first version is ready. No deployment
to a live cluster is part of this PoC.
