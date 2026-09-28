// Shared presentation state only. Help never fetches or acquires evidence.
export const helpContext = Vue.reactive({ analysis: null, refresh: null });
export function contextualHelp(view, state) {
  if (view === 'acceptance') return { title: 'Review an offline deployment scenario', text: 'Choose a phase and environment, then compare captures. Browser hash checks do not replace CLI replay or live deployment validation.' };
  if (view !== 'analysis') return { title: 'Explore the fictional architecture', text: 'Select a service to inspect its dependencies. Use Project analysis for your own inputs; this demo does not describe your cluster.' };
  const a = state.analysis, r = state.refresh;
  if (!a?.loaded) return { title: 'Prepare analysis inputs first', text: 'Follow the setup guide to bind repositories and Helm inputs, generate artifacts/analysis, then reload. Cluster credentials are not required for static analysis.' };
  if (a.tab === 'runtime') {
    if (r?.pending) return { title: 'A one-shot capture is running', text: `Collecting ${r.scope}. Displayed results remain the previous capture until completion. Do not retry while it is running.` };
    if (r?.failed) return { title: 'Recover before retrying', text: r.recovery === 'setup' ? 'Use Reload setup in Recovery options to renew the configuration and request token. This does not contact Kubernetes.' : 'Use Reload stored analysis in Recovery options to confirm the last committed result. A timeout does not prove that nothing was saved.' };
    if (a.simulation) return { title: 'This baseline is synthetic', text: 'Real-cluster refresh is disabled. Practice in Deployment scenarios, or prepare reviewed real-input analysis. Do not relabel fixtures as real data.' };
    if (!r?.ready) return { title: 'Complete the refresh setup checklist', text: `Check the target and bound namespace coverage for ${a.environment}. These checks do not validate credentials or RBAC. No cluster request starts until you explicitly refresh.` };
    return { title: a.runtime ? 'Inspect the stored workload evidence' : 'Capture runtime when needed', text: 'Confirm the environment, cluster and namespaces before Refresh runtime. Select a workload for image and consistency details; version differences alone are not errors.' };
  }
  if (a.tab === 'traffic') return { title: a.traffic ? 'Read the traffic observation window' : 'No traffic capture in this environment', text: 'Traffic comes from a separate Istio/OTel import, not Pod inventory. Inspect the window and coverage; absent observations do not prove there is no dependency.' };
  return { title: `Inspect ${a.environment} source evidence`, text: 'Select a connection to inspect its source/config evidence. Resource inventory and environment comparisons are scoped to selected inputs, not proof of a deployed source revision.' };
}
