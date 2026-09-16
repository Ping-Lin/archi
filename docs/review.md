# First version review

## Ready to review

- [x] JavaScript-only application/tooling and offline Vue explorer.
- [x] Three fictional project boundaries and eight service descriptors.
- [x] Three deployment contexts and 24 instances with independent observations.
- [x] Deterministic values, Compose, service descriptors and graph generation.
- [x] HTTP simulation with cycle/depth limits, timeout and failure propagation.
- [x] Repo-local system-design skill with repeatable verification.
- [x] Node contract, runtime and Vue template compilation checks.
- [x] Isolated setup-skill extension: ninth service, three contexts, unknown observations preserved.
- [x] Helm and browser CI gates with screenshot artifacts.

Initial remote verification passed: all 24 Node tests, all nine Helm lint/render
combinations, and browser interactions at desktop/mobile sizes. The screenshot
artifact is available in GitHub Actions. Later changes must pass the same gates.
The authoring environment lacks Helm/Chromium; those gates run on GitHub runners.

## Suggested review sequence

1. Run `npm run dev`, start in Services, and select Order Service.
2. Verify the project boundary and ownership model matches your mental model.
3. Switch to Deployments → Production East → Payment Adapter and inspect drift.
4. Compare East/West in Environments. Orders and Inventory differ.
5. Check Notification Worker: missing commits remain explicitly unknown.
6. Review `config/system.json`: decide which fields should come from Helm, CD or humans.
7. Try the setup skill on one additional service and inspect the generated diff.

## Known limitations

- Browser appearance requires actual screenshot review; Node template compilation
  only proves syntax, not layout.
- Graph layout is curated for this fixture; a large system needs automatic layout.
- Model and Helm generation cover this documented contract, not arbitrary Helm charts.
- The mock only exercises HTTP dependency traversal, not business or broker semantics.
- No digest-based identity, multiple releases per context or observation history yet.
- Links are examples; snapshots are not refreshed by external collectors.

Keep this work on the development branch. Do not open a PR until Ping confirms the
first version and requested adjustments.
