import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Explicit companion checkout: never resolves installed/live runtime state.
const integration = process.env.PICLAW_A2A_CORE_SOURCE ? test : test.skip;
integration(
  "real Piclaw host route + durable operation service interoperate over raw authenticated A2A HTTP",
  async () => {
    const core = process.env.PICLAW_A2A_CORE_SOURCE!;
    if (!core.startsWith("/") || process.env.PICLAW_E2E_DISPOSABLE !== "1")
      throw new Error("Explicit disposable companion source required.");
    const root = mkdtempSync(join(tmpdir(), "a2a-host-"));
    const script = join(root, "probe.ts");
    const addon = new URL(".", import.meta.url).pathname;
    writeFileSync(
      script,
      `
 import {initDatabase,closeDatabase} from ${JSON.stringify(join(core, "runtime/src/db.js"))};
 import {AddonOperationService} from ${JSON.stringify(join(core, "runtime/src/addons/operation-service.js"))};
 import {withExternalAddonRegistrationContext,handleExternalAddonRoutes,freezeExternalAddonRoutes,resetExternalAddonRoutesForTests} from ${JSON.stringify(join(core, "runtime/src/addons/external-routes.js"))};
 import {installAddonRuntimeApi,setAddonOperationHost,resetAddonRuntimeContributionsForTests} from ${JSON.stringify(join(core, "runtime/src/addons/runtime-contributions.js"))};
 import {A2aService} from ${JSON.stringify(join(addon, "service.ts"))};
 import {A2aTaskStore} from ${JSON.stringify(join(addon, "task-store.ts"))};
 initDatabase();
 let calls=0;let complete;
 const grant={revision:'r1',target:'echo',allowedTools:[],maxToolCalls:0,timeoutMs:5000,parentWorkId:null};
 setAddonOperationHost({authorize:(_p,t)=>t==='echo'?{decision:'allow',grant}:{decision:'rejected'},execute:async()=>{calls++;await new Promise(r=>{complete=r;});return {status:'completed',output:'real core public result'};}});
 const api=installAddonRuntimeApi();
 const service=await withExternalAddonRegistrationContext({packageName:'@rcarmo/piclaw-addon-a2a',entryPath:${JSON.stringify(join(addon, "runtime.ts"))}},()=>Promise.resolve(new A2aService(api,${JSON.stringify(root)},async()=> 'disposable-host-credential-123456789')));
 freezeExternalAddonRoutes();
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:async req=>await handleExternalAddonRoutes(req,new URL(req.url).pathname)||new Response('missing',{status:404})});
 try{
  await service.setConfig({enabled:true,inbound:true,outbound:false,publicBaseUrl:'https://fixture.invalid',principals:[{id:'alice',credentialKey:'test/alice',targets:['echo'],enabled:true}],agents:[{id:'echo',name:'Echo',description:'test',enabled:true}],endpoints:[]});
  const url=new URL('/api/addons/a2a/agents/echo/rpc',server.url);
  const send=(method,params,id='rpc')=>fetch(url,{method:'POST',headers:{'authorization':'Bearer disposable-host-credential-123456789','content-type':'application/json','a2a-version':'1.0'},body:JSON.stringify({jsonrpc:'2.0',id,method,params})}).then(r=>r.json());
  const req={message:{messageId:'stable-msg',role:'ROLE_USER',parts:[{text:'task request'}]},configuration:{returnImmediately:true}};
  const first=await send('SendMessage',req);const id=first.result.task.id;
  const duplicate=await send('SendMessage',req);if(duplicate.result.task.id!==id||calls!==1)throw new Error('duplicate admission');
  await new Promise(r=>setTimeout(r,5));complete();await new Promise(r=>setTimeout(r,10));
  const final=await send('GetTask',{id,historyLength:0});if(final.result.status.state!=='TASK_STATE_COMPLETED'||final.result.artifacts[0].parts[0].text!=='real core public result')throw new Error('core result not mapped');
  const denied=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'GetTask',params:{id}})});if(denied.status!==401)throw new Error('auth bypass');
  const listing=await send('ListTasks',{pageSize:10,includeArtifacts:false});if(listing.result.tasks[0].artifacts!==undefined||listing.result.nextPageToken!=='')throw new Error('list wire presence');
  console.log('A2A-HOST-PASS '+JSON.stringify({calls,state:final.result.status.state,auth:denied.status}));
 }finally{await service.close();server.stop(true);resetAddonRuntimeContributionsForTests();closeDatabase();}
 `,
    );
    try {
      const proc = Bun.spawn(
        [
          process.execPath,
          "--preload",
          join(core, "runtime/test/setup-filesystem-isolation.ts"),
          script,
        ],
        {
          env: {
            ...process.env,
            PICLAW_DB_IN_MEMORY: "1",
            PICLAW_WORKSPACE: root,
            PICLAW_STORE: join(root, "store"),
            PICLAW_DATA: join(root, "data"),
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(code, err + "\n" + out).toBe(0);
      expect(out).toContain("A2A-HOST-PASS");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  15000,
);
