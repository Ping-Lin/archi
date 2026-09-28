// Closed endpoint constructors, not an expression evaluator or target-service list.
const text={type:'string',minLength:1,maxLength:2048};
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
export const endpointBindingSchema={oneOf:[
  object({kind:{const:'url-key'},key:text}),
  object({kind:{const:'host-port'},hostKey:text,portKey:text}),
]};
export const endpointKeys=binding=>binding.kind==='host-port'?[binding.hostKey,binding.portKey]:[binding.key];
export function resolveEndpointBinding(binding,protocol,values) {
  if(!['HTTP','HTTPS','TCP'].includes(protocol))return null;
  const scheme=protocol.toLowerCase();
  try {
    let value;
    if(binding.kind==='url-key') value=values[binding.key];
    else {
      const host=values[binding.hostKey],port=values[binding.portKey];
      // DNS/IPv4 names only in this version. Reject URL fragments and implicit ports.
      if(typeof host!=='string'||host.length>253||!host.split('.').every(l=>/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(l))||
        !/^[0-9]{1,5}$/.test(port??'')||Number(port)<1||Number(port)>65535)return null;
      value=`${scheme}://${host}:${Number(port)}`;
    }
    if(typeof value!=='string'||value!==value.trim()||/[\s\\]/.test(value))return null;
    const url=new URL(value);
    if(url.protocol!==scheme+':'||!url.hostname||url.username||url.password||url.search||url.hash)return null;
    if(scheme==='tcp'&&(!url.port||!['','/'].includes(url.pathname)))return null;
    return url.href.replace(/\/$/,'');
  }catch{return null;}
}
