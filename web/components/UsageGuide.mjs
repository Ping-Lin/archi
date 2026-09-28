import { helpContext, contextualHelp } from '../help-context.mjs';
const { ref, watch, nextTick, onUnmounted } = Vue;
export const guideSteps = [
  { title: "Choose what you want to inspect", stage: 0, text: "Architecture demo is fictional. Project analysis analyzes selected source/config inputs. Deployment scenarios demonstrate rollout interpretation; none of these views deploy to a cluster.", action: "Start with Deployment scenarios if you want to learn without preparing repositories.", href: "./?view=acceptance", link: "Open deployment scenarios" },
  { title: "Keep your existing Helm chart", stage: 0, text: "Your values keys and templates do not need to match the demo chart. Archi renders the selected chart with ordered values files, then inspects supported Kubernetes resources.", action: "Record chart path, values files in CD order, release name, namespace, Helm/Kubernetes versions and API capabilities. Inline --set overrides and external CD transformations need explicit preparation." },
  { title: "Map identities in the system manifest", stage: 1, text: "Bind repository revisions, logical services, releases and exact Deployment/Service names. Add an environment with its own release scopes and property inputs. Names alone do not prove relationships.", action: "Use --system with archi/system-v1alpha1 for cross-repository inputs. Source support currently targets explicit Java Spring bean patterns; unsupported Kotlin/gRPC patterns need adapters." },
  { title: "Render and inspect the evidence", stage: 2, text: "Run analysis, then open Project analysis. Select an environment and a service connection to inspect source/config evidence. An extracted relationship does not establish live traffic.", action: "Inspect unresolved candidates and coverage. Do not change expectations merely to make a graph pass.", href: "./?view=analysis", link: "Open project analysis" },
  { title: "Refresh runtime when you need it", stage: 3, text: "Open Runtime inventory, select the configured scope and click Refresh runtime. Each click runs one read-only inventory capture. The server needs an approved target configuration and a real-input baseline; synthetic scenarios never query a cluster.", action: "Stored results remain visible while loading. Failed or incomplete collection retains the previous snapshot. No polling, WATCH, SSE or WebSocket. Refresh does not rerender Helm or fetch traffic." },
  { title: "Practice rollout, failure and rollback", stage: 3, text: "In Deployment scenarios, select T0–T6 and QA/production. Compare independent expectations with stored interpretations. Compare captures to inspect image/count changes and UID recreation.", action: "Open or export an acceptance bundle. CLI --verify replays runtime interpretation offline; browser hash checks alone do not certify replay or live correctness.", href: "./?view=acceptance", link: "Try T0–T6 scenarios" },
];
export default {
  setup() {
    const open = ref(false), index = ref(0), playing = ref(false), dialog = ref(null);
    const context = ref(null);
    function launch() {
      context.value = contextualHelp(new URLSearchParams(location.search).get('view'), helpContext);
      open.value = true;
    }
    let timer, previousFocus, previousOverflow;
    const stop = () => { clearInterval(timer); timer = null; playing.value = false; };
    function move(n) { stop(); index.value = Math.max(0, Math.min(guideSteps.length - 1, n)); }
    function play() {
      if (playing.value) { stop(); return; }
      if (index.value === guideSteps.length - 1) index.value = 0;
      playing.value = true;
      timer = setInterval(() => {
        if (index.value === guideSteps.length - 1) stop(); else index.value++;
      }, 10000);
    }
    function keys(e) {
      if (e.key === "Escape") { e.preventDefault(); open.value = false; }
      if (e.key !== "Tab") return;
      const items = [...dialog.value.querySelectorAll('button:not(:disabled), a[href]')];
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    watch(open, async (value) => {
      if (value) { previousFocus = document.activeElement; previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden"; await nextTick(); dialog.value?.querySelector('button').focus(); }
      else { stop(); document.body.style.overflow = previousOverflow ?? ""; previousFocus?.focus(); }
    });
    onUnmounted(() => { stop(); if (open.value) document.body.style.overflow = previousOverflow ?? ""; });
    return { open, index, playing, dialog, context, launch, steps: guideSteps, move, play, keys };
  },
  template: `<button class="usage-launch" @click="launch">? How to use</button>
    <div v-if="open" class="usage-backdrop" @click.self="open=false"><section ref="dialog" class="usage-dialog" role="dialog" aria-modal="true" aria-labelledby="usage-title" tabindex="-1" @keydown="keys">
      <button class="usage-close" aria-label="Close usage guide" @click="open=false">×</button><div class="eyebrow">ARCHI · GUIDED WALKTHROUGH</div><h2 id="usage-title">From configuration to evidence.</h2>
      <section v-if="context" class="usage-context" aria-label="Help for this view"><h3>{{context.title}}</h3><p>{{context.text}}</p><a href="https://github.com/Ping-Lin/archi/blob/feat/architecture-poc/docs/adoption-guide.zh-TW.md" target="_blank" rel="noopener noreferrer">繁體中文指南 ↗</a><small>Opens GitHub; repository access required. Help does not trigger collection.</small></section>
      <div class="usage-flow" aria-label="Configuration, bindings, analysis, observations"><div v-for="(label,n) in ['Your chart','Explicit bindings','Static analysis','Dated observations']" :class="{current:steps[index].stage===n}" :key="n"><span>{{n+1}}</span>{{label}}</div></div>
      <div class="usage-step" :key="index" aria-live="polite"><small>Step {{index+1}} of {{steps.length}}</small><h3>{{steps[index].title}}</h3><p>{{steps[index].text}}</p><div class="usage-action">{{steps[index].action}}</div><a v-if="steps[index].href" :href="steps[index].href">{{steps[index].link}} →</a></div>
      <div class="usage-controls"><button @click="move(index-1)" :disabled="index===0">Previous</button><button @click="play" :aria-pressed="playing">{{playing?'Pause':'Play walkthrough'}}</button><button @click="move(index+1)" :disabled="index===steps.length-1">Next</button></div><p class="usage-footnote">Optional playback: 10 seconds per step. Pause or advance at any time. Reduced-motion preferences are respected.</p>
    </section></div>`,
};
