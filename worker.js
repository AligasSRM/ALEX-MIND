const B2_ENDPOINT="https://s3.eu-central-003.backblazeb2.com";
const B2_BUCKET="alex-central-vault";
const B2_REGION="eu-central-003";
const B2_SERVICE="s3";

async function sha256Hex(data){
  const bytes=typeof data==="string"?new TextEncoder().encode(data):data;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function hmac(keyBytes,data){
  const key=await crypto.subtle.importKey("raw",keyBytes,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(data)));
}
async function hmacHex(keyBytes,data){return [...await hmac(keyBytes,data)].map(b=>b.toString(16).padStart(2,"0")).join("");}
function awsEncode(s){return encodeURIComponent(s).replace(/[!'()*]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase());}

async function b2Request(env,method,key,body="",contentType){
  if(!env.B2_KEY_ID||!env.B2_APP_KEY)throw new Error("B2 secrets not configured");
  const now=new Date();
  const amzDate=now.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
  const dateStamp=amzDate.slice(0,8);
  const payloadHash=await sha256Hex(body);
  const host=new URL(B2_ENDPOINT).host;
  const path="/"+B2_BUCKET+"/"+key.split("/").map(awsEncode).join("/");
  const headers={host,"x-amz-content-sha256":payloadHash,"x-amz-date":amzDate};
  if(contentType)headers["content-type"]=contentType;
  const signedHeaders=Object.keys(headers).sort().join(";");
  const canonicalHeaders=Object.keys(headers).sort().map(k=>k+":"+headers[k].trim()+"\n").join("");
  const canonicalRequest=[method,path,"",canonicalHeaders,signedHeaders,payloadHash].join("\n");
  const scope=dateStamp+"/"+B2_REGION+"/"+B2_SERVICE+"/aws4_request";
  const kDate=await hmac(new TextEncoder().encode("AWS4"+env.B2_APP_KEY),dateStamp);
  const kRegion=await hmac(kDate,B2_REGION);
  const kService=await hmac(kRegion,B2_SERVICE);
  const kSigning=await hmac(kService,"aws4_request");
  const stringToSign=["AWS4-HMAC-SHA256",amzDate,scope,await sha256Hex(canonicalRequest)].join("\n");
  headers.authorization="AWS4-HMAC-SHA256 Credential="+env.B2_KEY_ID+"/"+scope+", SignedHeaders="+signedHeaders+", Signature="+await hmacHex(kSigning,stringToSign);
  return fetch(B2_ENDPOINT+path,{method,headers,body:body||undefined});
}
function errorText(e){return String(e?.message||e);}
async function objectSchema(env){
  const q=await env.CENTRAL_DB.prepare("PRAGMA table_info(objects)").all();
  return q.results||[];
}
async function groomObjects(env,{dryRun=false}={}){
  if(!env.CENTRAL_DB)throw new Error("D1 binding missing");
  if(!env.CENTRAL_KV)throw new Error("KV binding missing");
  const cutoff=new Date(Date.now()-90*24*60*60*1000).toISOString();
  const q=await env.CENTRAL_DB.prepare("SELECT object_id,source_id,vault_id,storage_key,status,updated_at FROM objects WHERE status='stored' AND archived_at IS NULL AND updated_at < ? ORDER BY updated_at ASC LIMIT 100").bind(cutoff).all();
  const candidates=q.results||[];
  if(dryRun){
    return {ok:true,status:"GREEN",dry_run:true,retention_days:90,bounded_to:100,candidate_count:candidates.length,candidates};
  }
  if(candidates.length){
    const ids=candidates.map(x=>x.object_id);
    const placeholders=ids.map(()=>"?").join(",");
    await env.CENTRAL_DB.prepare("UPDATE objects SET status='archived', archived_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE object_id IN ("+placeholders+") AND status='stored' AND archived_at IS NULL").bind(...ids).run();
  }
  const result={ok:true,status:"GREEN",dry_run:false,retention_days:90,bounded_to:100,archived_count:candidates.length,storage_bytes_deleted:0,storage_delete_performed:false,ran_at:new Date().toISOString()};
  await env.CENTRAL_KV.put("groom/last",JSON.stringify(result));
  return result;
}

async function storeObject(env,p){
  const source=await env.CENTRAL_DB.prepare("SELECT id FROM sources WHERE source_name=? AND status='active' LIMIT 1").bind(p.sourceName).first();
  if(!source)throw new Error("source not registered");
  const policy=await env.CENTRAL_DB.prepare("SELECT vault_sync FROM sync_policies WHERE source_id=?").bind(source.id).first();
  if(!policy?.vault_sync)throw new Error("vault sync disabled");
  const body=p.body instanceof ArrayBuffer?new Uint8Array(p.body):typeof p.body==="string"?new TextEncoder().encode(p.body):p.body instanceof Uint8Array?p.body:new Uint8Array(p.body);
  const checksum=await sha256Hex(body);
  const key="objects/"+p.sourceName.replace(/[^a-zA-Z0-9_-]/g,"_")+"/"+p.objectId;
  const contentType=p.contentType||"application/octet-stream";
  const put=await b2Request(env,"PUT",key,body,contentType);
  if(!put.ok)throw new Error("B2_WRITE_FAILED:"+put.status);
  const get=await b2Request(env,"GET",key);
  if(!get.ok)throw new Error("B2_READ_FAILED:"+get.status);
  const verify=new Uint8Array(await get.arrayBuffer());
  if(await sha256Hex(verify)!==checksum)throw new Error("B2_VERIFY_FAILED");
  const now=new Date().toISOString();
  const values={object_id:p.objectId,source_id:source.id,vault_id:p.vaultId,storage_provider:"backblaze-b2",storage_bucket:B2_BUCKET,storage_key:key,status:"stored",name:p.name,kind:p.kind,mime_type:contentType,size_bytes:body.byteLength,checksum,checksum_algorithm:"SHA-256",external_id:p.externalId,project_slug:p.projectSlug,created_at:now,updated_at:now,stored_at:now};
  const schema=await objectSchema(env);
  const columns=schema.map(c=>c.name).filter(n=>Object.prototype.hasOwnProperty.call(values,n));
  if(!columns.length)throw new Error("objects table has no compatible columns");
  const sql="INSERT INTO objects ("+columns.join(",")+") VALUES ("+columns.map(()=>"?").join(",")+")";
  try{await env.CENTRAL_DB.prepare(sql).bind(...columns.map(c=>values[c]===undefined?null:values[c])).run();}
  catch(e){console.error("OBJECT_INSERT_FAILED",e);throw new Error("D1_OBJECT_INSERT_FAILED:"+errorText(e));}
  await env.CENTRAL_KV.put("object/last",JSON.stringify({object_id:p.objectId,source_name:p.sourceName,vault_id:p.vaultId,storage_key:key,stored_at:now}));
  return {ok:true,status:"GREEN",object_id:p.objectId,storage_key:key,size_bytes:body.byteLength,checksum,verified:true};
}

export default {
  async scheduled(_controller,env){
    try{
      const result=await groomObjects(env,{dryRun:false});
      console.log("SCHEDULED_GROOM",JSON.stringify(result));
    }catch(e){
      console.error("SCHEDULED_GROOM_ERROR",e);
    }
  },
  async fetch(request,env){
    const url=new URL(request.url);
    try{
      if(url.pathname==="/health"){
        const q=await env.CENTRAL_DB.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
        return Response.json({system:"ALEX CENTRAL VAULT",status:"GREEN",d1:{connected:true,tables:q.results?.map(r=>r.name)||[]},kv:{connected:true}});
      }
      if(url.pathname==="/status"){
        const q=await env.CENTRAL_DB.prepare("SELECT s.id,s.source_type,s.source_name,s.status,p.vault_sync,p.phone_sync,p.last_sync_at,p.last_sync_status FROM sources s JOIN sync_policies p ON p.source_id=s.id ORDER BY s.id").all();
        return Response.json({system:"ALEX CENTRAL VAULT",status:"GREEN",sources:q.results||[]});
      }
      if(url.pathname==="/storage/status")return Response.json({ok:true,backend:"backblaze-b2",bucket:B2_BUCKET,endpoint:B2_ENDPOINT,configured:!!(env.B2_KEY_ID&&env.B2_APP_KEY),credentials_exposed:false});
      if(url.pathname==="/sync-policy"&&request.method==="GET"){
        const name=url.searchParams.get("source_name");if(!name)return Response.json({ok:false,error:"source_name required"},{status:400});
        const q=await env.CENTRAL_DB.prepare("SELECT s.id,s.source_type,s.source_name,p.vault_sync,p.phone_sync,p.status,p.last_sync_at,p.last_sync_status FROM sources s JOIN sync_policies p ON p.source_id=s.id WHERE s.source_name=? LIMIT 1").bind(name).first();
        return q?Response.json({ok:true,policy:q}):Response.json({ok:false,error:"source not found"},{status:404});
      }
      if(url.pathname==="/sync-policy"&&request.method==="POST"){
        const p=await request.json(),name=String(p.source_name||"").trim();if(!name)return Response.json({ok:false,error:"source_name required"},{status:400});
        const r=await env.CENTRAL_DB.prepare("UPDATE sync_policies SET vault_sync=?,phone_sync=?,updated_at=CURRENT_TIMESTAMP WHERE source_id=(SELECT id FROM sources WHERE source_name=? LIMIT 1)").bind(p.vault_sync===false?0:1,p.phone_sync===true?1:0,name).run();
        return r.meta?.changes?Response.json({ok:true,source_name:name,vault_sync:p.vault_sync===false?0:1,phone_sync:p.phone_sync===true?1:0}):Response.json({ok:false,error:"source not found"},{status:404});
      }
      if(url.pathname==="/debug/objects-schema"&&request.method==="GET")return Response.json({ok:true,columns:await objectSchema(env)});
      if(url.pathname==="/objects/test"&&request.method==="GET"){
        return Response.json(await storeObject(env,{sourceName:"GitHub",vaultId:"alex-central-vault",objectId:"runtime-"+crypto.randomUUID(),name:"ALEX-MIND runtime object test",kind:"test",contentType:"text/plain",body:"ALEX MIND runtime object test"}));
      }
      if(url.pathname==="/objects/groom"&&request.method==="POST"){
        const dryRun=url.searchParams.get("dry_run")==="true";
        return Response.json(await groomObjects(env,{dryRun}));
      }
      if(url.pathname==="/objects"&&request.method==="POST"){
        const p={sourceName:String(request.headers.get("x-source-name")||"").trim(),vaultId:String(request.headers.get("x-vault-id")||"").trim(),objectId:String(request.headers.get("x-object-id")||crypto.randomUUID()).trim(),name:request.headers.get("x-object-name"),kind:request.headers.get("x-object-kind")||"file",externalId:request.headers.get("x-external-id"),projectSlug:request.headers.get("x-project-slug"),contentType:request.headers.get("content-type")||"application/octet-stream",body:await request.arrayBuffer()};
        if(!p.sourceName||!p.vaultId)return Response.json({ok:false,error:"x-source-name and x-vault-id required"},{status:400});
        return Response.json(await storeObject(env,p));
      }
      return new Response("ALEX CENTRAL VAULT",{status:200});
    }catch(e){
      console.error("ALEX_MIND_RUNTIME_ERROR",e);
      return Response.json({ok:false,status:"FAILED",error:errorText(e)},{status:500});
    }
  }
};