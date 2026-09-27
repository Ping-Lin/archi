const { ref, computed, watch, onMounted, onUnmounted } = Vue;
export default {
  props: ["analysis", "environment"], emits: ["updated"],
  setup(props, { emit }) {
    const catalog = ref(null), targetId = ref(""), pending = ref(false),
      loading = ref(false), loadingMessage = ref(""), message = ref(""), failed = ref(false), activeScope = ref("");
    let request;
    const targets = computed(() => catalog.value?.targets.filter((t) => t.environment === props.environment) ?? []);
    const target = computed(() => targets.value.find((t) => t.id === targetId.value));
    const snapshot = computed(() => props.analysis.snapshots.find((s) => s.environment === props.environment));
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
        catalog.value = await r.json(); failed.value = false; message.value = "";
      } catch (e) { failed.value = true; message.value = e.message; }
      finally { loading.value = false; }
    }
    async function reloadStored() {
      if (pending.value || loading.value) return;
      loading.value = true;
      loadingMessage.value = "Loading stored analysis…";
      try {
        const r = await fetch("./analysis.json", { signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw Error("Stored analysis could not be loaded.");
        emit("updated", await r.json()); failed.value = false;
        message.value = "Reloaded stored analysis only. No Kubernetes request was made.";
      } catch (e) { failed.value = true; message.value = e.message; }
      finally { loading.value = false; }
    }
    async function refresh() {
      if (pending.value || !target.value?.enabled || props.analysis.simulation) return;
      const scope = target.value, hash = snapshot.value.contentHash;
      pending.value = true; failed.value = false;
      activeScope.value = `${scope.environment} / ${scope.cluster}`;
      message.value = `Collecting ${scope.environment} / ${scope.cluster}. Displayed results remain the previous stored capture until complete.`;
      request = new AbortController();
      const deadline = setTimeout(() => request?.abort(), 135000);
      try {
        const r = await fetch("./api/runtime/refresh", { method: "POST", signal: request.signal,
          headers: { "Content-Type": "application/json", "X-Archi-Runtime-Token": catalog.value.token },
          body: JSON.stringify({ targetId: scope.id, staticContentHash: hash }) });
        const result = await r.json();
        if (!r.ok) throw Error(result.message ?? "Refresh failed.");
        emit("updated", result.analysis);
        message.value = `Updated ${result.environment} / ${result.cluster}. Capture completed at ${result.capturedAt}. No background refresh.`;
      } catch (e) {
        failed.value = true;
        message.value = `${scope.environment} / ${scope.cluster}: ${e.name === "AbortError"
          ? "Request timed out or was cancelled. Reload stored analysis to confirm the last saved capture."
          : e.message} Displayed results are unchanged. Reload stored analysis before retrying; no automatic retry.`;
      } finally { clearTimeout(deadline); request = null; pending.value = false; activeScope.value = ""; }
    }
    onMounted(settings); onUnmounted(() => request?.abort());
    return { catalog, targetId, target, targets, pending, loading, loadingMessage, message, failed, activeScope, settings, reloadStored, refresh };
  },
  template: `<section class="runtime-refresh" aria-label="On-demand runtime refresh" :aria-busy="pending">
    <div><h3>Refresh runtime</h3><p>One read-only inventory request. Does not rerender Helm, reanalyze source or fetch traffic. No background polling.</p></div>
    <p v-if="loading" role="status">{{loadingMessage}}</p>
    <template v-else-if="catalog"><p v-if="!catalog.configured">Refresh is not configured on this server. Start with <code>npm run dev -- --runtime-config /approved/runtime-refresh.json</code>. Keep credentials server-side; offline capture import remains available.</p>
      <p v-else-if="!targets.length">No refresh target configured for {{environment}}. Existing captures remain available.</p>
      <template v-else><label>Runtime target <select aria-label="Runtime refresh target" v-model="targetId" :disabled="pending"><option v-for="t in targets" :value="t.id">{{t.environment}} / {{t.cluster}}</option></select></label><p v-if="target"><strong>Scope:</strong> {{target.environment}} / {{target.cluster}} · Namespaces: {{target.namespaces.join(', ')}}</p><p v-if="target&&!target.enabled">{{target.reason}}</p></template>
    </template>
    <button class="secondary-button" @click="refresh" :disabled="loading||pending||!target?.enabled||analysis.simulation">{{pending?'Refreshing…':'Refresh runtime'}}</button>
    <button class="secondary-button" :disabled="pending||loading" @click="settings">Reload setup</button>
    <button class="secondary-button" :disabled="pending||loading" @click="reloadStored">Reload stored analysis</button>
    <p v-if="pending" role="status">Refresh in progress for {{activeScope}}.</p>
    <p v-if="analysis.simulation">Synthetic baseline: real-cluster refresh is disabled. Practice with Deployment scenarios instead.</p>
    <p v-if="message" :role="failed?'alert':'status'" class="runtime-refresh-message">{{message}}</p>
  </section>`,
};
