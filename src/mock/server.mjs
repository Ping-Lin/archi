import http from 'node:http';
import { pathToFileURL } from 'node:url';
/** All dependency transports are deliberately simulated over HTTP. */
export function createMock({id, dependencies={}, timeout=3000}) {
  return http.createServer(async (req,res)=>{
    const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    const url=new URL(req.url,'http://localhost');
    if(req.method!=='GET')return reply(405,{error:'GET only'});
    if(['/healthz','/info'].includes(url.pathname))return reply(200,{service:id,simulation:true,transport:'HTTP',dependencies:Object.keys(dependencies)});
    if(url.pathname!=='/simulate')return reply(404,{error:'not found'});
    const visited=(url.searchParams.get('visited')??'').split(',').filter(Boolean);
    if(visited.includes(id)||visited.length>=16)return reply(508,{service:id,error:'cycle or depth limit'});
    const requested=Number(url.searchParams.get('budget')??timeout);
    if(!Number.isFinite(requested)||requested<=0)return reply(400,{error:'invalid budget'});
    const budget=Math.min(requested,timeout),start=performance.now();
    const calls=await Promise.all(Object.entries(dependencies).map(async([service,endpoint])=>{
      const remaining=Math.floor(budget-(performance.now()-start));
      if(remaining<=0)return {service,error:'request budget exhausted'};
      const child=new URL('/simulate',endpoint);
      child.searchParams.set('visited',[...visited,id].join(','));child.searchParams.set('budget',String(remaining));
      try {
        const response=await fetch(child,{signal:AbortSignal.timeout(remaining)});
        const data=await response.json();
        return response.ok?data:{service,error:data.error??`HTTP ${response.status}`};
      } catch(error){return {service,error:error.name};}
    }));
    const failed=node=>Boolean(node.error)||node.calls?.some(failed);
    reply(200,{service:id,simulation:true,ok:!calls.some(failed),calls,elapsedMs:Math.round((performance.now()-start)*100)/100});
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const server=createMock({id:process.env.SERVICE_ID??'mock',dependencies:JSON.parse(process.env.DEPENDENCIES??'{}')});
  server.listen(Number(process.env.PORT??8080),process.env.BIND??'0.0.0.0');
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close();server.closeAllConnections();});
}
