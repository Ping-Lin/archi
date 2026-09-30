import {parsePropertyFile} from './property-files.mjs';
import {hash} from './contract.mjs';

// Bounded import trees over explicitly captured files, never a filesystem resolver.
export function resolveConfigImports(files,env,ledger) {
  const sources=[],diagnostics=[],factIds=[],seen=new Set(),active=new Set();
  const bindings=env.importBindings??[],used=new Set();
  const fail=(message)=>diagnostics.push({code:'CONFIG_IMPORT_INCOMPLETE',message});
  if(env.importProfilePolicy!=='no-variants-reviewed')fail('Import profile variants require an explicit no-variants-reviewed scope policy');
  const visit=(file,depth=0)=>{
    if(depth>16||seen.size>=128){fail('Config import traversal exceeds depth/file bounds');return;}
    if(active.has(file)){fail(`Circular config import: ${file}`);return;}
    if(seen.has(file)){fail(`Repeated config input requires unsupported import deduplication semantics: ${file}`);return;}
    seen.add(file);active.add(file);
    try {
      const text=files.get(file),mapping=parsePropertyFile(file,text);
      const evidence=ledger.recordEvidence({type:'config_import_source',locator:file,contentHash:hash(text)});
      // Contradictory known input cannot be overridden by a completeness declaration.
      for(const profile of env.profiles.length?env.profiles:['default']){
        const variant=file.replace(/(\.(?:properties|yaml|yml))$/,`-${profile}$1`);
        if(variant!==file&&files.has(variant))fail(`Known profile variant contradicts no-variants-reviewed policy: ${variant}`);
      }
      const imports=mapping['spring.config.import'];delete mapping['spring.config.import'];
      sources.push({file,mapping,evidenceIds:[evidence]});
      if(imports===undefined)return;
      const locations=imports.split(',').map(s=>s.trim());
      if(locations.length>64){fail(`Too many imports in ${file}`);return;}
      for(const location of locations){
        const matches=bindings.filter(b=>b.from===file&&b.location===location);
        const relative=location.replace(/^optional:/,'');
        const supported=/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(properties|yaml|yml)$/.test(relative)&&!relative.split('/').some(p=>p==='.'||p==='..');
        const binding=matches.length===1?matches[0]:null;
        const compatible=binding&&(/\.properties$/.test(relative)===/\.properties$/.test(binding.file));
        const status=!supported?'unsupported':!binding?'unbound':!compatible?'format-mismatch':!files.has(binding.file)?'unavailable':'bound';
        const ev=[evidence];
        if(binding&&files.has(binding.file))ev.push(ledger.recordEvidence({type:'config_import_source',locator:binding.file,contentHash:hash(files.get(binding.file))}));
        factIds.push(ledger.fact('configuration.import',`${file}#${location}`,{from:file,location,target:binding?.file??null,optional:location.startsWith('optional:'),status},ev));
        if(status!=='bound'){fail(`${file}: import ${location} is ${status}; optional does not authorize missing-input fallback`);continue;}
        used.add(binding);visit(binding.file,depth+1);
      }
    }catch(error){fail(`${file}: ${error.message}`);}
    finally{active.delete(file);}
  };
  for(const file of env.propertyFiles)visit(file);
  for(const binding of bindings)if(!used.has(binding))fail(`Unused import binding: ${binding.from} -> ${binding.location}`);
  return {sources,diagnostics,factIds,complete:diagnostics.length===0};
}
