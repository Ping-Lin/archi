// The effective map preserves same-spelling overrides, but not cross-alias source
// precedence. Accept a unique spelling only; never choose by map iteration order.
export function selectRelaxedProperty(candidate,values){
  const normalized=key=>key.toLowerCase().replace(/[^a-z0-9]/g,'');
  const consideredKeys=new Set(),unsupported=[];
  let selectedKey=null;
  for(const key of candidate.bindingKeys??[]){
    if((candidate.bindingKeys??[]).filter(k=>normalized(k)===normalized(key)).length>1)unsupported.push(`Ambiguous relaxed member names for ${key}`);
    const dot=key.lastIndexOf('.'),prefix=key.slice(0,dot+1),member=key.slice(dot+1);
    const allowed=new Set([key,prefix+member.replace(/-([a-z0-9])/g,(_,c)=>c.toUpperCase()),prefix+member.replaceAll('-','_')]);
    // Broad collision detection is deliberately conservative, including punctuation,
    // capitalization and collapsed segment boundaries that this adapter cannot bind.
    const matches=Object.keys(values).filter(k=>normalized(k)===normalized(key)).sort();
    for(const match of matches)consideredKeys.add(match);
    if(matches.some(k=>!allowed.has(k)))unsupported.push(`Unsupported relaxed spelling for ${key}`);
    if(matches.length>1)unsupported.push(`Competing relaxed spellings for ${key} require source-aware precedence`);
    if(key===candidate.key&&matches.length===1&&allowed.has(matches[0]))selectedKey=matches[0];
  }
  return {selectedKey,consideredKeys:[...consideredKeys].sort(),unsupported};
}
