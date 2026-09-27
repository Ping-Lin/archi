const { ref, computed, watch, onMounted, onUnmounted } = Vue;
export default {
  props: ["analysis", "environment"], emits: ["updated"],
  setup(props, { emit }) {
    const catalog = ref(null), targetId = ref(""), pending = ref(false),
      loading = ref(false), loadingMessage = ref(""), message = ref(""), failed = ref(false), activeScope = ref(""), recovery = ref("");
    let request;
    const targets = computed(() => catalog.value?.targets.filter((t) => t.environment === props.environment) ?? []);
    const target = computed(() => targets.value.find((t) => t.id === targetId.value));
    const snapshot = computed(() => props.analysis.snapshots.find((s) => s.environment === props.environment));
    const checklist = computed(() => [
      { label: 'Real-input baseline', ready: !props.analysis.simulation, detail: props.analysis.simulation ? 'Synthetic inputs cannot query a real cluster. Prepare reviewed source analysis or use Deployment scenarios.' : 'Real-input analysis loaded; this does not verify the deployed revision.' },
      { label: 'Server target configuration', ready: !!catalog.value?.configured, detail: catalog.value?.configured ? 'Configuration loaded. Restart the server after editing its configuration file.' : 'Start the server with --runtime-config and an approved local configuration.' },
      { label: `Target for ${props.environment}`, ready: !!target.value, detail: target.value ? `Selected cluster: ${target.value.cluster}` : 'Configure a target for this environment, or continue using stored evidence.' },
      { label: 'Bound namespace coverage', ready: !!target.value?.enabled, detail: target.value?.reason ?? (target.value?.enabled ? 'Configured namespaces cover the bound scope. Credentials and RBAC have not been tested by this checklist.' : 'Select a configured target to check the bound scope.') },
    ]);
    watch(() => [props.environment, catalog.value], () => {
      if (!targets.value.some((t) => t.id === targetId.value)) targetId.value = targets.value[0]?.id ?? "";
    }, { immediate: true });
    async function settings() {
      if (pending.value || loading.value) return;
      loading.value = true;
      loadingMessage.value = "Checking refresh setup…";
      try {
        const r = await fetch("./api/runtime/targets", { signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw Error("Runtime setup could not be loaded. Check the local server and retry setup.");
        catalog.value = await r.json(); failed.value = false; message.value = ""; recovery.value = "";
      } catch (e) { catalog.value = null; failed.value = true; message.value = e.message; recovery.value = "setup"; }
      finally { loading.value = false; }
    }
    async function reloadStored() {
      if (pending.value || loading.value) return;
      loading.value = true;
      loadingMessage.value = "Loading stored analysis…";
      try {
        const r = await fetch("./analysis.json", { signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw Error("Stored analysis could not be loaded.");
        emit("updated", await r.json()); failed.value = false; recovery.value = "";
        message.value = "Reloaded stored analysis only. No Kubernetes request was made.";
      } catch (e) { failed.value = true; message.value = e.message; recovery.value = "stored"; }
      finally { loading.value = false; }
    }
    async function refresh() {
      if (pending.value || loading.value || !target.value?.enabled || props.analysis.simulation) return;
      const scope = target.value, hash = snapshot.value.contentHash;
      pending.value = true; failed.value = false; recovery.value = "";
      activeScope.value = `${scope.environment} / ${scope.cluster}`;
      message.value = `Collecting ${scope.environment} / ${scope.cluster}. Displayed results remain the previous stored capture until complete.`;
      request = new AbortController();
      const deadline = setTimeout(() => request?.abort(), 135000);
      try {
        const r = await fetch("./api/runtime/refresh", { method: "POST", signal: request.signal,
          headers: { "Content-Type": "application/json", "X-Archi-Runtime-Token": catalog.value.token },
          body: JSON.stringify({ targetId: scope.id, staticContentHash: hash }) });
        const result = await r.json();
        if (!r.ok) {
          const error = Error(result.message ?? "Refresh failed.");
          error.status = r.status; throw error;
        }
        emit("updated", result.analysis);
        message.value = `Updated ${result.environment} / ${result.cluster}. Capture completed at ${result.capturedAt}. No background refresh.`;
      } catch (e) {
        failed.value = true;
        recovery.value = [403, 404].includes(e.status) ? 'setup' : 'stored';
        message.value = `${scope.environment} / ${scope.cluster}: ${e.name === "AbortError"
          ? "Request timed out or was cancelled. Reload stored analysis to confirm the last saved capture."
          : e.message} Displayed results are unchanged. No automatic retry.`;
      } finally { clearTimeout(deadline); request = null; pending.value = false; activeScope.value = ""; }
    }
    onMounted(settings); onUnmounted(() => request?.abort());
    return { catalog, targetId, target, targets, checklist, pending, loading, loadingMessage, message, failed, recovery, activeScope, settings, reloadStored, refresh };
  },
  template: `<section class="runtime-refresh" aria-label="On-demand runtime refresh" :aria-busy="pending">
    <div><h3>Refresh runtime</h3><p>One read-only inventory request. Does not rerender Helm, reanalyze source or fetch traffic. No background polling.</p></div>
    <p v-if="loading" role="status">{{loadingMessage}}</p>
    <template v-else-if="catalog"><p v-if="!catalog.configured">Refresh is not configured on this server. Start with <code>npm run dev -- --runtime-config /approved/runtime-refresh.json</code>. Keep credentials server-side; offline capture import remains available.</p>
      <p v-else-if="!targets.length">No refresh target configured for {{environment}}. Existing captures remain available.</p>
      <template v-else><label>Runtime target <select aria-label="Runtime refresh target" v-model="targetId" :disabled="pending"><option v-for="t in targets" :value="t.id">{{t.environment}} / {{t.cluster}}</option></select></label><p v-if="target"><strong>Scope:</strong> {{target.environment}} / {{target.cluster}} · Namespaces: {{target.namespaces.join(', ')}}</p><p v-if="target&&!target.enabled">{{target.reason}}</p></template>
    </template>
    <details class="refresh-checklist" :open="!catalog?.configured||!target?.enabled||analysis.simulation"><summary>Setup checklist</summary><ol><li v-for="item in checklist" :key="item.label"><strong>{{item.ready?'Ready':'Action needed'}} · {{item.label}}</strong><p>{{item.detail}}</p></li></ol><p>No cluster request is made by these checks. A disabled refresh does not mean your application has failed.</p><a href="https://github.com/Ping-Lin/archi/blob/feat/architecture-poc/docs/adoption-guide.zh-TW.md" target="_blank" rel="noopener noreferrer">繁體中文設定指南 ↗</a> · <a href="https://github.com/Ping-Lin/archi/blob/feat/architecture-poc/docs/adoption-guide.md" target="_blank" rel="noopener noreferrer">English setup guide ↗</a><small>Opens GitHub; repository access is required.</small></details>
    <button class="secondary-button refresh-primary" @click="refresh" :disabled="loading||pending||!target?.enabled||analysis.simulation">{{pending?'Refreshing…':'Refresh runtime'}}</button>
    <details class="refresh-recovery" :open="failed"><summary>Recovery options · no cluster request</summary>
      <p v-if="failed">{{recovery==='setup'?'Next: reload setup to renew the server configuration and request token.':'Next: reload stored analysis to confirm the last saved capture before retrying.'}}</p>
      <button class="secondary-button" :class="{'recovery-recommended':recovery==='setup'}" :disabled="pending||loading" @click="settings">Reload setup</button>
      <button class="secondary-button" :class="{'recovery-recommended':recovery==='stored'}" :disabled="pending||loading" @click="reloadStored">Reload stored analysis</button>
    </details>
    <p v-if="pending" role="status">Refresh in progress for {{activeScope}}.</p>
    <p v-if="analysis.simulation">Synthetic baseline: real-cluster refresh is disabled. Practice with Deployment scenarios instead.</p>
    <p v-if="message" :role="failed?'alert':'status'" class="runtime-refresh-message">{{message}}</p>
  </section>`,
};
