const {computed,ref}=Vue;
export default {
  props:['data','level','context','selected','search','project','focus'],emits:['select','drill'],
  setup(props){
    const zoom=ref(1);
    const positions={gateway:[35,224],catalog:[330,35],orders:[330,224],identity:[330,413],inventory:[635,35],shipping:[635,190],payments:[635,345],notifications:[635,500]};
    const nodes=computed(()=>{
      if(props.level==='L1')return props.data.projects.map((p,i)=>({...p,kind:'project',x:70+i*285,y:215,count:props.data.services.filter(s=>s.project===p.id).length}));
      const counters={edge:0,domain:0,integration:0};
      return props.data.services.map(s=>{
        const fallback=[{edge:35,domain:330,integration:635}[s.layer],35+(counters[s.layer]++)*155];
        const [x,y]=positions[s.id]??fallback;
        return {...s,kind:'service',x,y,instance:props.data.instances.find(i=>i.service===s.id&&i.context===props.context)};
      });
    });
    const edges=computed(()=>{
      if(props.level!=='L1')return props.data.edges;
      const result=new Map();
      for(const e of props.data.edges){
        const source=props.data.services.find(s=>s.id===e.source).project,target=props.data.services.find(s=>s.id===e.target).project;
        if(source===target)continue;
        const key=source+'/'+target;
        if(result.has(key))result.get(key).count++;else result.set(key,{id:key,source,target,protocol:'',count:1});
      }
      return [...result.values()];
    });
    const connected=computed(()=>new Set([props.selected,...props.data.edges.filter(e=>e.source===props.selected||e.target===props.selected).flatMap(e=>[e.source,e.target])]));
    const dim=n=>Boolean((props.search&&!`${n.name} ${n.id} ${n.project??''}`.toLowerCase().includes(props.search.toLowerCase()))||(props.project&&n.id!==props.project&&n.project!==props.project)||(props.focus&&props.level!=='L1'&&!connected.value.has(n.id)));
    const path=e=>{
      const s=nodes.value.find(n=>n.id===e.source),t=nodes.value.find(n=>n.id===e.target);
      if(!s||!t)return '';
      if(s.x===t.x){const x=s.x+220;return `M ${x} ${s.y+52} C ${x+65} ${s.y+52}, ${x+65} ${t.y+52}, ${x} ${t.y+52}`;}
      const forward=t.x>s.x,x1=s.x+(forward?220:0),x2=t.x+(forward?0:220),y1=s.y+52,y2=t.y+52,mid=(x1+x2)/2;
      return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
    };
    const label=e=>{const s=nodes.value.find(n=>n.id===e.source),t=nodes.value.find(n=>n.id===e.target);return s&&t?{x:(s.x+t.x+220)/2,y:(s.y+t.y)/2+43}:{x:0,y:0};};
    const height=computed(()=>Math.max(660,...nodes.value.map(n=>n.y+145)));
    return {nodes,edges,dim,path,label,zoom,height};
  },
  template:`<div class="graph-shell">
    <div class="canvas-heading"><span>{{level==='L1'?'PROJECT BOUNDARIES':'SERVICE RELATIONSHIPS'}}</span><span class="mini-pill">{{level==='deployment'?'Desired + observed':'Declared architecture'}}</span></div>
    <div class="graph-scroll"><svg class="graph" :viewBox="'0 0 920 '+height" :style="{width:(zoom*100)+'%',minWidth:zoom>1?'780px':null}" role="img" aria-label="Interactive architecture dependency graph">
      <defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#dfe3eb"/></pattern><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="none" stroke="#aeb6ca"/></marker><marker id="active-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="none" stroke="#8066dd"/></marker><filter id="shadow" x="-20%" y="-20%" width="150%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#17213f" flood-opacity=".05"/></filter></defs>
      <rect width="920" :height="height" fill="url(#dots)"/>
      <g v-if="level!=='L1'" class="column-labels"><text x="35" y="19">01 / ENTRY</text><text x="330" y="19">02 / CORE SERVICES</text><text x="635" y="19">03 / OPERATIONS</text></g>
      <g v-for="e in edges" :key="e.id" class="edge" :class="{active:e.source===selected||e.target===selected}">
        <path :d="path(e)" fill="none" :marker-end="(e.source===selected||e.target===selected)?'url(#active-arrow)':'url(#arrow)'" :stroke-dasharray="e.protocol==='AMQP'?'5 5':null"/>
        <title>{{e.source}} → {{e.target}} · {{e.protocol||e.count+' dependencies'}} · {{e.label||'Cross-project dependency'}}</title>
        <g v-if="e.source===selected||e.target===selected||level==='L1'"><rect :x="label(e).x-27" :y="label(e).y-11" width="54" height="18" rx="5" fill="#f8f9fd"/><text :x="label(e).x" :y="label(e).y+2" text-anchor="middle">{{e.protocol||e.count+' links'}}</text></g>
      </g>
      <g v-for="n in nodes" :key="n.id" class="graph-node" :class="[{selected:n.id===selected,dimmed:dim(n)},n.project||n.id]" :transform="'translate('+n.x+','+n.y+')'" tabindex="0" role="button" :aria-label="n.name" :aria-pressed="n.id===selected" @click="$emit('select',n.id)" @keydown.enter="$emit('select',n.id)" @keydown.space.prevent="$emit('select',n.id)" @dblclick="n.kind==='project'&&$emit('drill',n.id)">
        <rect class="node-box" width="220" height="108" rx="12" filter="url(#shadow)"/>
        <rect class="node-icon-bg" x="14" y="15" width="30" height="30" rx="8"/>
        <path d="M23 25h12v10H23z M26 22h12v10" fill="none" class="node-icon" stroke-width="1.5"/>
        <text x="54" y="29" class="node-name">{{n.name}}</text><text x="54" y="44" class="node-sub">{{n.kind==='project'?n.owner:n.project+' / '+n.layer}}</text>
        <line x1="14" y1="60" x2="206" y2="60" stroke="#edf0f5"/>
        <circle cx="20" cy="83" r="3.5" :fill="level==='deployment'&&n.instance?.status==='drift'?'#dd9948':level==='deployment'&&!n.instance?.observed?'#98a0b3':'#6ca68c'"/>
        <text x="30" y="87" class="node-meta">{{n.kind==='project'?n.count+' services':level==='deployment'?(n.instance?'v'+n.instance.image.tag:'Not deployed'):'Logical service'}}</text>
        <text x="206" y="87" text-anchor="end" class="node-meta">{{n.kind==='project'?'L1 ↗':level==='deployment'?(n.instance?.replicas??'—')+' replicas':'L2'}}</text>
      </g>
      <text v-if="level==='L1'" x="460" y="410" text-anchor="middle" class="overview-hint">Select a project to inspect it. Double-click to explore its services.</text>
    </svg></div>
    <div class="canvas-footer"><div class="legend"><span><i class="dot commerce-dot"></i>Commerce</span><span><i class="dot fulfillment-dot"></i>Fulfillment</span><span><i class="dot platform-dot"></i>Platform</span></div><div class="zoom"><button aria-label="Zoom out" @click="zoom=Math.max(.7,zoom-.15)">−</button><button aria-label="Reset zoom" @click="zoom=1">{{Math.round(zoom*100)}}%</button><button aria-label="Zoom in" @click="zoom=Math.min(2,zoom+.15)">+</button></div></div>
  </div>`
};
