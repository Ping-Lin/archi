// Closed endpoint constructors, not an expression evaluator or target-service list.
const text={type:'string',minLength:1,maxLength:2048};
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
export const endpointBindingSchema={oneOf:[
  object({kind:{const:'url-key'},key:text}),
  object({kind:{const:'host-port'},hostKey:text,portKey:text}),
]};
export const endpointBindingSchemaV3={oneOf:[...endpointBindingSchema.oneOf,
  object({kind:{const:'grpc-dns'},key:text}),
]};

// grpc:// is an internal comparison identity, NOT a gRPC client target URI.
// Only reviewed DNS names and explicit ports are modeled; no DNS query occurs.
export function resolveGrpcEndpoint(binding,values) {
  let host,port;
  if(binding.kind==='host-port'){host=values[binding.hostKey];port=values[binding.portKey];}
  else if(binding.kind==='grpc-dns'){
    const value=values[binding.key];
    if(typeof value!=='string'||!value.startsWith('dns:///'))return null;
    const match=/^dns:\/\/\/([^:/?#@%\\\s]+):([0-9]{1,5})$/.exec(value);
    if(!match)return null;[,host,port]=match;
  }else return null;
  if(typeof host!=='string'||host.length>254||typeof port!=='string'||!/^[0-9]{1,5}$/.test(port)||Number(port)<1||Number(port)>65535)return null;
  host=host.toLowerCase().replace(/\.$/,'');
  if(host.length>253||!host.split('.').every(l=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)))return null;
  return `grpc://${host}:${Number(port)}`;
}
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
