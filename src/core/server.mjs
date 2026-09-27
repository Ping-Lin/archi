import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createMock } from '../mock/server.mjs';
import { runtimeHttp, RefreshError } from '../runtime/http.mjs';
export async function listen(server,port,host='127.0.0.1') {
  return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve(server);});});
}
export function createExplorer(root, { runtimeConfig, runtimeController } = {}) {
  const web=path.resolve(root,'web');
  // Keep the authored simulator dependency-free unless refresh is explicitly configured.
  let runtimePromise;
  const getRuntime=()=>runtimePromise??=runtimeController?Promise.resolve(runtimeController):runtimeConfig
    ?import('../runtime/refresh.mjs').then(m=>m.createRuntimeRefresh(root,runtimeConfig))
    :Promise.resolve({describe:async()=>({configured:false,targets:[]}),refresh:async()=>{throw new RefreshError(404,'Runtime refresh is not configured.');}});
  const runtime=runtimeHttp({describe:async()=>(await getRuntime()).describe(),refresh:async(...args)=>(await getRuntime()).refresh(...args)});
  return http.createServer(async(req,res)=>{
    if(await runtime(req,res))return;
    if(req.method!=='GET'){res.writeHead(405);res.end();return;}
    try {
      const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const artifacts={'/analysis.json':'artifacts/analysis/analysis.json','/acceptance.json':'artifacts/acceptance/bundle.json'};
      const artifact=Object.hasOwn(artifacts,name)?artifacts[name]:null;
      const target=artifact?path.resolve(root,artifact):path.resolve(web,'.'+(name==='/'?'/index.html':name));
      if(!artifact&&!target.startsWith(web+path.sep))throw new Error('invalid path');
      const content=await readFile(target);
      const mime={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml'}[path.extname(target)]??'application/octet-stream';
      res.writeHead(200,{'Content-Type':mime+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(content);
    } catch {res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
  });
}
export async function startDemo(root,config,{port=4173,mocks=true,runtimeConfig}={}) {
  const servers=[];
  try {
    if(mocks)for(const service of config.services) {
      const dependencies=Object.fromEntries(config.dependencies.filter(e=>e.source===service.id).map(e=>[e.target,`http://127.0.0.1:${config.services.find(s=>s.id===e.target).port}`]));
      const server=createMock({id:service.id,dependencies});servers.push(server);await listen(server,service.port);
    }
    const explorer=createExplorer(root,{runtimeConfig});servers.push(explorer);await listen(explorer,port);
    return {url:`http://127.0.0.1:${explorer.address().port}`,close:()=>Promise.all(servers.map(s=>new Promise(resolve=>{s.close(resolve);s.closeAllConnections();})))};
  }catch(error){for(const s of servers){s.close();s.closeAllConnections();}throw error;}
}
