const {computed}=Vue;
export default {
 props:['data','selected','context'],emits:['select'],
 setup(props){
  const service=computed(()=>props.data.services.find(s=>s.id===props.selected));
  const project=computed(()=>props.data.projects.find(p=>p.id===(service.value?.project??props.selected)));
  const instance=computed(()=>props.data.instances.find(d=>d.service===props.selected&&d.context===props.context));
  const dependencies=computed(()=>props.data.edges.filter(e=>e.source===props.selected||e.target===props.selected));
  return {service,project,instance,dependencies};
 },
 template:`<aside class="inspector" aria-label="Selection details">
 <div class="inspector-label">INSPECTOR <span>↗</span></div>
 <div v-if="service||project"><div class="detail-icon" :class="service?.project||project.id">▧</div><h2>{{service?.name||project.name}}</h2><p class="muted detail-description">{{service?.description||project.description}}</p>
 <div class="tags"><span class="tag">{{service?'Logical service':'Project'}}</span><span class="tag">{{project.id}}</span></div>
 <section><h3>Ownership</h3><dl><dt>Team</dt><dd>{{project.owner}}</dd><dt>Repository</dt><dd><a :href="project.repo" target="_blank" rel="noopener noreferrer">{{project.id}} ↗</a></dd><template v-if="service"><dt>Source path</dt><dd class="mono">{{service.repoPath}}</dd></template></dl></section>
 <section v-if="service"><h3>Deployment <span class="status" :class="instance?.status||'unknown'">{{instance?.status||'not deployed'}}</span></h3>
 <template v-if="instance"><dl><dt>Desired image</dt><dd class="mono">{{instance.image.tag}}</dd><dt>Observed image</dt><dd class="mono">{{instance.observed?.image.tag??'Unknown'}}</dd><dt>Ready / desired</dt><dd>{{instance.observed?.readyReplicas??'?'}} / {{instance.replicas}}</dd><dt>Desired commit</dt><dd class="mono">{{instance.sourceCommit?.slice(0,10)??'Unknown'}}</dd><dt>Observed commit</dt><dd class="mono">{{instance.observed?.sourceCommit?.slice(0,10)??'Unknown'}}</dd></dl>
 <div v-if="instance.drift.length" class="notice warning">Snapshot differs in {{instance.drift.join(' and ')}}.</div><div v-if="!instance.sourceCommit" class="notice">No commit evidence. Image tags are not treated as Git revisions.</div>
 <div class="links"><a v-for="(url,label) in instance.links" :key="label" :href="url" target="_blank" rel="noopener noreferrer">{{label}} ↗</a></div>
 </template><p v-else class="muted">No deployment declared in this context.</p></section>
 <section v-if="service"><h3>Relationships <span class="count">{{dependencies.length}}</span></h3><button v-for="e in dependencies" :key="e.id" class="relationship" @click="$emit('select',e.source===selected?e.target:e.source)"><span>{{e.source===selected?'↗':'↙'}} {{e.source===selected?e.target:e.source}}</span><span class="protocol">{{e.protocol}}</span></button></section>
 <section v-else><h3>Services</h3><button v-for="s in data.services.filter(s=>s.project===project.id)" :key="s.id" class="relationship" @click="$emit('select',s.id)">{{s.name}} <span>↗</span></button></section>
 <section class="evidence"><h3>Evidence & freshness</h3><p>{{instance?.observed?.observedAt??'Declared design only'}}</p><p class="mono">{{instance?.observed?'config/observations.json':'config/system.json'}}</p><p>Simulated snapshot. External links are examples.</p></section>
 </div><div v-else class="empty-state">Select a node to inspect its ownership, deployment and evidence.</div>
 </aside>`
};
