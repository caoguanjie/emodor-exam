import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { main, parsePreflightArgs, readPreflightConfig, inspectCos, buildProposal, writeProposal } from '../scripts/media/cos-preflight.mjs';

const require=createRequire(new URL('../server/package.json',import.meta.url));
const COS=require('cos-nodejs-sdk-v5');
const env={COS_BUCKET:'fixture-1234567890',COS_REGION:'ap-guangzhou',COS_KEY_PREFIX:'ruleexam/test/',COS_SECRET_ID:'unusable-long-id',COS_SECRET_KEY:'unusable-long-secret'};
function fixtureSdk(overrides={}) {
  const calls=[];
  const data={headBucket:{statusCode:200},getBucketLocation:{statusCode:200,LocationConstraint:env.COS_REGION},
    getBucketAcl:{statusCode:200,ACL:'private',Grants:[{Grantee:{ID:'private-owner-fixture'},Permission:'FULL_CONTROL'}]},
    getBucketVersioning:{statusCode:200,VersioningConfiguration:{Status:'Enabled'}},
    getBucketCors:{statusCode:200,CORSRules:[{ID:'gooodwork-existing',AllowedOrigins:['https://existing.invalid'],AllowedMethods:['GET'],AllowedHeaders:['x-existing'],ExposeHeaders:['ETag']}],ResponseVary:'true'},
    getBucketPolicy:{statusCode:200,Policy:{version:'2.0',statement:[{effect:'allow',principal:{qcs:['private-principal-fixture']},action:['name/cos:GetObject'],resource:['private-resource-fixture']}]}}
  };
  const sdk=new Proxy({}, {get(_target,method){return async params=>{calls.push({method,params});if(overrides[method]) return overrides[method](params);if(!(method in data))throw new Error(`unexpected write ${String(method)}`);return structuredClone(data[method]);};}});
  return {sdk,calls,data};
}

test('CLI defaults to read-only inspect, help needs no environment, and unsupported/unsafe arguments fail closed',async()=>{
  assert.equal(parsePreflightArgs([]).mode,'inspect');
  assert.equal(parsePreflightArgs(['--inspect']).mode,'inspect');
  const help=spawnSync(process.execPath,['scripts/media/cos-preflight.mjs','--help'],{encoding:'utf8',env:{}});
  assert.equal(help.status,0);assert.match(help.stdout,/--inspect/);assert.match(help.stdout,/--probe/);
  const value='unusable-private-cli-fixture';
  const bad=spawnSync(process.execPath,['scripts/media/cos-preflight.mjs','--apply',value],{encoding:'utf8',env:{}});
  assert.equal(bad.status,1);assert.equal(`${bad.stdout}${bad.stderr}`.includes(value),false);
  for(const args of [['--inspect','--probe'],['--render-proposal'],['--probe'],['--origin','*'],['--origin','http://example.com'],['--origin','https://example.com/path'],['--origin','https://user:pass@example.com'],['--origin','https://example.com?secret=x']])assert.throws(()=>parsePreflightArgs(args));
  assert.deepEqual(parsePreflightArgs(['--render-proposal','--out','/tmp/fixture-proposal.json','--origin','https://example.com','--origin','http://localhost:5173']).origins,['https://example.com','http://localhost:5173']);
});

test('configuration validates only COS runtime keys and exact bounded targets before creating a client',async()=>{
  const config=readPreflightConfig({...env,DB_PASSWORD:'unused-private-fixture',JWT_SECRET:'unused-jwt-fixture'});
  assert.equal(config.bucket,env.COS_BUCKET);assert.equal(config.keyPrefix,env.COS_KEY_PREFIX);
  for(const change of [{COS_KEY_PREFIX:'../gooodwork/'},{COS_KEY_PREFIX:'ruleexam/test*'},{COS_BUCKET:'https://foreign.invalid'},{COS_REGION:'ap-guangzhou/other'}])assert.throws(()=>readPreflightConfig({...env,...change}));
  let creations=0;
  await assert.rejects(main(['--inspect','--key','gooodwork/private.png'],env,{sdkFactory:()=>{creations++;return fixtureSdk().sdk;},output:()=>{}}),/TARGET_OUT_OF_SCOPE/);
  assert.equal(creations,0);
  await assert.rejects(main([],{}, {sdkFactory:()=>{creations++;},output:()=>{}}),/CONFIG_REQUIRED_COS_/);
  assert.equal(creations,0);
  for(const prefix of ['gooodwork/staging/probe/','ruleexam/test/media/probe/','ruleexam/test/staging/probe/not-a-uuid/'])await assert.rejects(main(['--probe','--approved-prefix',prefix,'--out','/tmp/unused-probe-fixture'],env,{sdkFactory:()=>{creations++;},output:()=>{}}),/PROBE_PREFIX_NOT_APPROVED/);
  assert.equal(creations,0);
});

test('default inspect reads bucket metadata without writes and reports no credentials, principals, or raw SDK diagnostics',async()=>{
  const {sdk,calls}=fixtureSdk();let output='';
  const result=await main([],env,{sdkFactory:()=>sdk,output:text=>{output+=text;}});
  assert.deepEqual(calls.map(item=>item.method).sort(),['headBucket','getBucketLocation','getBucketAcl','getBucketVersioning','getBucketCors','getBucketPolicy'].sort());
  assert.equal(result.report.mode,'inspect');assert.equal(result.report.g0,'not-verified');
  assert.equal(result.report.checks.cors.rule_count,1);assert.equal(result.report.checks.policyRead.statement_count,1);
  assert.equal(result.report.checks.sts.status,'not-run');
  for(const secret of [env.COS_SECRET_ID,env.COS_SECRET_KEY,'private-owner-fixture','private-principal-fixture','private-resource-fixture',env.COS_KEY_PREFIX])assert.equal(output.includes(secret),false);
});

test('denied/failed metadata inspection is unknown, never pass, and malformed or mismatched metadata is not accepted',async()=>{
  const raw=Object.assign(new Error(`request https://private.invalid/?q-signature=${env.COS_SECRET_KEY}`),{statusCode:403,code:'AccessDenied',url:'private-signed-fixture'});
  const {sdk}=fixtureSdk({getBucketCors:async()=>{throw raw;},getBucketPolicy:async()=>{throw raw;},getBucketLocation:async()=>({statusCode:200,LocationConstraint:'ap-beijing'})});
  const inspection=await inspectCos(readPreflightConfig(env),sdk);
  assert.equal(inspection.report.checks.cors.status,'unknown');assert.equal(inspection.report.checks.policyRead.status,'unknown');
  assert.equal(inspection.report.checks.location.status,'fail');assert.equal(inspection.report.ready,false);
  const text=JSON.stringify(inspection);assert.equal(text.includes(env.COS_SECRET_KEY),false);assert.equal(text.includes('private-signed-fixture'),false);
  assert.throws(()=>buildProposal(readPreflightConfig(env),inspection,['https://example.com']),/CORS_SNAPSHOT_UNAVAILABLE/);
});

test('proposal preserves every existing CORS rule, adds only explicit origins and SDK headers, and omits sensitive policy principals',async()=>{
  const {sdk,data}=fixtureSdk();const config=readPreflightConfig(env);const inspected=await inspectCos(config,sdk);
  const proposal=buildProposal(config,inspected,['https://exam.example.com','http://localhost:5173']);
  assert.deepEqual(proposal.cors.CORSRules[0],data.getBucketCors.CORSRules[0]);assert.equal(proposal.cors.ResponseVary,'true');
  const added=proposal.cors.CORSRules.at(-1);
  assert.deepEqual(added.AllowedOrigins,['https://exam.example.com','http://localhost:5173']);assert.deepEqual(added.AllowedMethods,['GET','HEAD','PUT']);
  for(const header of ['Authorization','Content-Type','Content-MD5','Range','x-cos-security-token','x-cos-sdk-retry','x-cos-acl'])assert.ok(added.AllowedHeaders.includes(header),`missing CORS header ${header}`);
  const template=JSON.parse(await readFile(new URL('../deploy/cos/cors.template.json',import.meta.url),'utf8'));
  assert.ok(template.additional_rule.AllowedHeaders.includes('x-cos-acl'));
  for(const header of ['ETag','Content-Range','Content-Length','Accept-Ranges'])assert.ok(added.ExposeHeaders.includes(header));
  assert.ok(!added.AllowedOrigins.includes('*'));assert.equal(proposal.apply_automatically,false);
  assert.equal(proposal.public_frontend.VITE_COS_MEDIA_ORIGIN,'https://fixture-1234567890.cos.ap-guangzhou.myqcloud.com');
  assert.equal(proposal.public_frontend.VITE_COS_MEDIA_PREFIX,'ruleexam/test/media/');
  assert.ok(proposal.csp.append_only['img-src'].includes(proposal.public_frontend.VITE_COS_MEDIA_ORIGIN));
  assert.ok(proposal.csp.append_only['media-src'].includes(proposal.public_frontend.VITE_COS_MEDIA_ORIGIN));
  assert.ok(proposal.csp.append_only['connect-src'].includes(proposal.public_frontend.VITE_COS_MEDIA_ORIGIN));
  assert.equal(JSON.stringify(proposal).includes('private-principal-fixture'),false);
  assert.equal(JSON.stringify(proposal).includes(env.COS_SECRET_ID),false);assert.equal(JSON.stringify(proposal).includes(env.COS_SECRET_KEY),false);
  const pending=buildProposal(config,inspected,[]);assert.equal(pending.cors.status,'needs-origins');
  assert.deepEqual(pending.cors.CORSRules,data.getBucketCors.CORSRules);assert.deepEqual(pending.cors.added_rules,[]);
});

test('proposal is written mode 0600 and refuses to overwrite an existing review artifact',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'ruleexam-preflight-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'private','proposal.json');const value={review_only:true};
  await writeProposal(path,value);assert.equal((await stat(path)).mode&0o777,0o600);assert.deepEqual(JSON.parse(await readFile(path,'utf8')),value);
  await assert.rejects(writeProposal(path,{replaced:true}),/PROPOSAL_EXISTS/);assert.deepEqual(JSON.parse(await readFile(path,'utf8')),value);
});

test('inspection follows actual SDK 3 XML/JSON result shapes against a local HTTP server',async t=>{
  const requests=[];const key=`${env.COS_KEY_PREFIX}media/fixture.png`;
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');requests.push({method:req.method,url});
    if(req.method==='HEAD') {res.writeHead(200,{'Content-Length':url.pathname==='/'?'0':'64','Content-Type':'image/png','x-cos-version-id':'fixture-version'}).end();return;}
    if(url.searchParams.has('policy')) {res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({version:'2.0',statement:[{principal:{qcs:'private-principal-fixture'},effect:'allow'}]}));return;}
    res.setHeader('Content-Type','application/xml');
    if(url.searchParams.has('location'))res.end('<LocationConstraint>ap-guangzhou</LocationConstraint>');
    else if(url.searchParams.has('versioning'))res.end('<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>');
    else if(url.searchParams.has('acl'))res.end('<AccessControlPolicy><Owner><ID>private-owner-fixture</ID></Owner><AccessControlList><Grant><Grantee><ID>private-owner-fixture</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>');
    else if(url.searchParams.has('cors'))res.end('<CORSConfiguration><ResponseVary>true</ResponseVary><CORSRule><ID>keep-existing</ID><AllowedOrigin>https://existing.invalid</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedHeader>x-existing</AllowedHeader><ExposeHeader>ETag</ExposeHeader></CORSRule></CORSConfiguration>');
    else {res.writeHead(400).end('<Error><Code>InvalidArgument</Code></Error>');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const sdk=new COS({SecretId:env.COS_SECRET_ID,SecretKey:env.COS_SECRET_KEY,Domain:`http://127.0.0.1:${server.address().port}`,Protocol:'http:',Timeout:1000,AutoSwitchHost:false});
  const inspected=await inspectCos(readPreflightConfig(env),sdk,{key});
  assert.equal(inspected.report.checks.location.status,'pass');assert.equal(inspected.report.checks.acl.status,'pass');
  assert.equal(inspected.report.checks.versioning.status,'pass');assert.equal(inspected.report.checks.objectMetadata.status,'pass');
  assert.equal(inspected.report.checks.objectMetadata.version_pinned,true);
  assert.deepEqual(inspected.snapshot.corsRules,[{ID:'keep-existing',AllowedOrigins:['https://existing.invalid'],AllowedMethods:['GET'],AllowedHeaders:['x-existing'],ExposeHeaders:['ETag']}]);
  assert.equal(requests.length,7);assert.ok(requests.every(item=>['GET','HEAD'].includes(item.method)));
  assert.equal(requests.filter(item=>item.method==='HEAD'&&item.url.pathname!== '/').at(0).url.pathname,`/${key}`);
});

async function probeServer(t,{versionMode='enabled',failSecondGrant=false,collision=false,tamperUnversioned=false,allowOutside=false,losePutReply=false,retryInitialization=false}={}){
  const requests=[];const objects=new Map();const tasks=new Map();const grants=new Map();const deleted=[];const aborted=[];const headErrors=[];const signaturePaths=new Map();let serial=0;let grantCalls=0;let firstHead=true;let lost=false;let initializationRetried=false;
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const xmlError=(res,status,code)=>res.writeHead(status,{'Content-Type':'application/xml'}).end(`<Error><Code>${code}</Code></Error>`);
  function store(key,body,headers){
    const version=versionMode==='enabled'?`version-${++serial}`:versionMode==='suspended'?'null':null;
    const object={version,body:Buffer.from(body),owner:headers['x-cos-meta-ruleexam-probe'],acl:headers['x-cos-acl']};
    objects.set(key,versionMode==='enabled'?[...(objects.get(key)||[]),object]:[object]);return object;
  }
  function headers(object){return {'Content-Length':String(object.body.length),'Content-Type':'application/octet-stream','x-cos-meta-ruleexam-probe':object.owner,'ETag':`"${hash(object.body)}"`,...(object.version!==null?{'x-cos-version-id':object.version}:{})};}
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');const key=decodeURIComponent(url.pathname.slice(1));
    const identity=url.searchParams.get('q-ak')||new URLSearchParams(req.headers.authorization).get('q-ak');const grant=grants.get(identity);
    requests.push({method:req.method,key,query:new URLSearchParams(url.search),headers:{...req.headers}});
    const versions=objects.get(key)||[];const object=url.searchParams.has('versionId')?versions.find(item=>item.version===url.searchParams.get('versionId')):versions.at(-1);
    const scopeAllowed=grant&&(grant.key===key||allowOutside);
    if(!key){
      if(req.method==='HEAD'){res.writeHead(200).end();return;}
      if(url.searchParams.has('location'))res.end('<LocationConstraint>ap-guangzhou</LocationConstraint>');
      else if(url.searchParams.has('versioning'))res.end(`<VersioningConfiguration>${versionMode==='unconfigured'?'':`<Status>${versionMode==='enabled'?'Enabled':'Suspended'}</Status>`}</VersioningConfiguration>`);
      else if(url.searchParams.has('acl'))res.end('<AccessControlPolicy><Owner><ID>private-owner-fixture</ID></Owner><AccessControlList><Grant><Grantee><ID>private-owner-fixture</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>');
      else if(url.searchParams.has('cors'))res.end('<CORSConfiguration/>');
      else if(url.searchParams.has('policy'))res.end(JSON.stringify({version:'2.0',statement:[]}));
      else if(url.searchParams.has('versions')){
        const prefix=url.searchParams.get('prefix');res.end(`<ListVersionsResult><IsTruncated>false</IsTruncated>${(objects.get(prefix)||[]).filter(item=>item.version!==null).map(item=>`<Version><Key>${prefix}</Key><VersionId>${item.version}</VersionId></Version>`).join('')}</ListVersionsResult>`);
      }else xmlError(res,400,'InvalidArgument');return;
    }
    if(req.method==='HEAD'){
      if(collision&&firstHead){firstHead=false;res.writeHead(200,{'Content-Length':'64'}).end();return;}
      if(!object){xmlError(res,404,'NoSuchKey');return;}res.writeHead(200,headers(object)).end();return;
    }
    if(req.method==='POST'&&url.searchParams.has('uploads')){
      if(grant){xmlError(res,403,'AccessDenied');return;}
      const id=`upload-${++serial}`;tasks.set(id,{key,headers:{...req.headers},parts:[]});
      if(retryInitialization&&!initializationRetried){initializationRetried=true;xmlError(res,500,'InternalError');return;}
      res.end(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);return;
    }
    if(url.searchParams.has('uploadId')){
      const id=url.searchParams.get('uploadId');const task=tasks.get(id);
      if(grant&&(!scopeAllowed||!grant.actions.includes(req.method==='PUT'?'name/cos:UploadPart':'name/cos:ListParts'))){xmlError(res,403,'AccessDenied');return;}
      if(!task||task.key!==key){xmlError(res,404,'NoSuchUpload');return;}
      if(req.method==='PUT'){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);task.parts[Number(url.searchParams.get('partNumber'))-1]=bytes;
        res.writeHead(200,{'ETag':`"${hash(bytes)}"`}).end();return;
      }
      if(req.method==='GET'){res.end(`<ListPartsResult><IsTruncated>false</IsTruncated>${task.parts.map((bytes,index)=>`<Part><PartNumber>${index+1}</PartNumber><ETag>"${hash(bytes)}"</ETag><Size>${bytes.length}</Size></Part>`).join('')}</ListPartsResult>`);return;}
      if(req.method==='DELETE'){aborted.push({key,id});tasks.delete(id);res.writeHead(204).end();return;}
      if(req.method==='POST'){
        for await(const _chunk of req){}const stored=store(key,Buffer.concat(task.parts),task.headers);tasks.delete(id);
        const responseHeaders=headers(stored);delete responseHeaders['Content-Length'];responseHeaders['Content-Type']='application/xml';
        res.writeHead(200,responseHeaders).end(`<CompleteMultipartUploadResult><ETag>"${hash(stored.body)}"</ETag></CompleteMultipartUploadResult>`);return;
      }
    }
    if(req.method==='PUT'){
      if(grant&&(!scopeAllowed||!grant.actions.includes('name/cos:PutObject'))){xmlError(res,403,'AccessDenied');return;}
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const stored=store(key,Buffer.concat(chunks),req.headers);
      if(losePutReply&&!lost){lost=true;res.destroy();return;}
      res.writeHead(200,{...headers(stored),'Content-Length':'0'}).end();return;
    }
    if(req.method==='GET'&&url.searchParams.has('acl')){
      if(!object){xmlError(res,404,'NoSuchKey');return;}
      res.end(`<AccessControlPolicy><Owner><ID>private-owner-fixture</ID></Owner><AccessControlList><Grant><Grantee><ID>${object.acl==='private'?'private-owner-fixture':'qcs::cam::anyone:anyone'}</ID></Grantee><Permission>${object.acl==='private'?'FULL_CONTROL':'READ'}</Permission></Grant></AccessControlList></AccessControlPolicy>`);return;
    }
    if(req.method==='GET'){
      if(!identity){if(tamperUnversioned&&object&&key.endsWith('-simple.bin'))object.body=Buffer.alloc(64,99);xmlError(res,403,'AccessDenied');return;}
      if(grant){xmlError(res,403,'AccessDenied');return;}if(!object){xmlError(res,404,'NoSuchKey');return;}
      const signedUntil=Number(url.searchParams.get('q-key-time')?.split(';')[1]);
      if(signedUntil&&signedUntil<=Date.now()/1000){xmlError(res,403,'AccessDenied');return;}
      const signature=url.searchParams.get('q-signature');
      if(signature){if(signaturePaths.has(signature)&&signaturePaths.get(signature)!==key){xmlError(res,403,'SignatureDoesNotMatch');return;}signaturePaths.set(signature,key);}
      const range=req.headers.range;if(range){const [start,end]=range.replace('bytes=','').split('-').map(Number);if(start>=object.body.length){res.writeHead(416,{'Content-Range':`bytes */${object.body.length}`}).end();return;}res.writeHead(206,{'Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${object.body.length}`,'Accept-Ranges':'bytes'}).end(object.body.subarray(start,end+1));return;}
      res.writeHead(200,headers(object)).end(object.body);return;
    }
    if(req.method==='DELETE'){
      deleted.push({key,version:url.searchParams.get('versionId')});
      if(url.searchParams.has('versionId'))objects.set(key,versions.filter(item=>item.version!==url.searchParams.get('versionId')));else objects.delete(key);
      res.writeHead(204).end();return;
    }
    xmlError(res,400,'InvalidArgument');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const localOrigin=`http://127.0.0.1:${server.address().port}`;
  const options={Domain:localOrigin,Protocol:'http:',Timeout:1000,AutoSwitchHost:false};
  const sdkFactory=()=>{const client=new COS({...options,SecretId:env.COS_SECRET_ID,SecretKey:env.COS_SECRET_KEY});const head=client.headObject.bind(client);client.headObject=async params=>{try{return await head(params);}catch(error){headErrors.push({statusCode:error.statusCode,code:error.code,errorCode:error.error?.Code,fields:Object.keys(error)});throw error;}};return client;};
  const temporarySdkFactory=data=>new COS({...options,getAuthorization:(_options,callback)=>callback({TmpSecretId:data.credentials.tmpSecretId,TmpSecretKey:data.credentials.tmpSecretKey,SecurityToken:data.credentials.sessionToken,StartTime:data.startTime,ExpiredTime:data.expiredTime})});
  const credentialProvider=async options=>{
    if(failSecondGrant&&++grantCalls===2)throw new Error('private-provider-fixture');
    const id=`unusable-temporary-${randomUUID()}`;const resource=options.policy.statement[0].resource[0];grants.set(id,{key:resource.slice(resource.indexOf(`${env.COS_BUCKET}/`)+env.COS_BUCKET.length+1),actions:options.policy.statement[0].action});
    return {startTime:Math.floor(Date.now()/1000),expiredTime:Math.floor(Date.now()/1000)+options.durationSeconds,requestId:'fixture',credentials:{tmpSecretId:id,tmpSecretKey:'unusable-temporary-secret',sessionToken:'unusable-temporary-token'}};
  };
  const fetchImpl=(url,options)=>{const rewritten=new URL(url);rewritten.protocol='http:';rewritten.host=new URL(localOrigin).host;return fetch(rewritten,options);};
  return {requests,objects,tasks,deleted,aborted,grants,headErrors,sdkFactory,temporarySdkFactory,credentialProvider,fetchImpl};
}

test('explicit probe uses real SDK protocols, exact-key STS scopes and precise cleanup for enabled, suspended/null-string, and unconfigured versions',async t=>{
  for(const versionMode of ['enabled','suspended','unconfigured']){
    const fixture=await probeServer(t,{versionMode});const dir=await mkdtemp(join(tmpdir(),'ruleexam-cos-probe-'));t.after(()=>rm(dir,{recursive:true,force:true}));
    const prefix=`${env.COS_KEY_PREFIX}staging/probe/${randomUUID()}/`;let output='';
    const result=await main(['--probe','--approved-prefix',prefix,'--out',join(dir,'journal.json')],env,{...fixture,output:text=>{output+=text;}});
    assert.equal(result.report.probe.status,'pass',JSON.stringify({probe:result.report.probe,headErrors:fixture.headErrors}));assert.equal(result.report.probe.cleanup.status,'pass');assert.equal(result.report.g0,'not-verified');
    assert.equal(result.report.probe.checks.signed_get_range.expired_url_denied,true);assert.equal(result.report.probe.checks.signed_get_range.key_change_denied,true);
    assert.equal(result.report.probe.cleanup.deleted_object_count,2);assert.equal(result.report.checks.sts.status,'pass');assert.equal(result.report.checks.signedGet.status,'pass');
    assert.equal([...fixture.objects.values()].flat().length,0);assert.equal(fixture.tasks.size,0);
    const objectRequests=fixture.requests.filter(item=>item.key);assert.ok(objectRequests.every(item=>item.key.startsWith(prefix)));
    const firstWrite=objectRequests.findIndex(item=>['PUT','POST','DELETE'].includes(item.method));assert.equal(objectRequests.slice(0,firstWrite).filter(item=>item.method==='HEAD').length,3);
    assert.equal(new Set(objectRequests.slice(0,3).map(item=>item.key)).size,3);
    assert.ok(fixture.deleted.every(item=>versionMode==='unconfigured'?item.version===null:versionMode==='suspended'?item.version==='null':/^version-/.test(item.version)));
    const put=objectRequests.find(item=>item.method==='PUT'&&item.key.endsWith('-simple.bin'));
    assert.equal(put.headers['x-cos-acl'],'private');assert.ok(put.query.get('q-header-list').includes('x-cos-meta-ruleexam-probe'));
    assert.ok([...fixture.grants.values()].some(item=>JSON.stringify(item.actions)===JSON.stringify(['name/cos:UploadPart','name/cos:ListParts'])));
    const journal=JSON.parse(await readFile(join(dir,'journal.json'),'utf8'));assert.equal((await stat(join(dir,'journal.json'))).mode&0o777,0o600);
    assert.equal(journal.scope,prefix);assert.equal(journal.objects.length,3);
    assert.ok(fixture.deleted.every(item=>journal.objects.some(entry=>entry.key===item.key)));
    for(const secret of [env.COS_SECRET_ID,env.COS_SECRET_KEY,'unusable-temporary-secret','unusable-temporary-token',prefix])assert.equal(output.includes(secret),false);
  }
});

test('probe collision prevents every cloud mutation, and STS failure aborts only its registered upload IDs',async t=>{
  for(const options of [{collision:true},{failSecondGrant:true}]){
    const fixture=await probeServer(t,options);const dir=await mkdtemp(join(tmpdir(),'ruleexam-cos-probe-'));t.after(()=>rm(dir,{recursive:true,force:true}));
    const prefix=`${env.COS_KEY_PREFIX}staging/probe/${randomUUID()}/`;
    const result=await main(['--probe','--approved-prefix',prefix,'--out',join(dir,'journal.json')],env,{...fixture,output:()=>{}});
    assert.equal(result.report.probe.status,'fail');
    if(options.collision)assert.equal(fixture.requests.filter(item=>['PUT','POST','DELETE'].includes(item.method)).length,0);
    else {assert.ok(fixture.aborted.length>=1,JSON.stringify(result.report.probe));assert.equal(fixture.tasks.size,0);assert.equal([...fixture.objects.values()].flat().length,0);}
  }
});

test('probe withholds success for overbroad temporary authorization and recovers only owned versions after an unknown PUT reply',async t=>{
  for(const options of [{allowOutside:true},{losePutReply:true}]){
    const fixture=await probeServer(t,options);const dir=await mkdtemp(join(tmpdir(),'ruleexam-cos-probe-'));t.after(()=>rm(dir,{recursive:true,force:true}));
    const prefix=`${env.COS_KEY_PREFIX}staging/probe/${randomUUID()}/`;
    const result=await main(['--probe','--approved-prefix',prefix,'--out',join(dir,'journal.json')],env,{...fixture,output:()=>{}});
    assert.equal(result.report.probe.status,'fail');assert.equal(result.report.probe.cleanup.status,'pass');assert.equal([...fixture.objects.values()].flat().length,0);
    if(options.allowOutside)assert.equal(result.report.probe.reason,'PROBE_SIMPLE_SCOPE_NOT_DENIED');
    else assert.ok(fixture.deleted.length>=1,'a committed PUT with a lost reply must be discovered and cleaned');
    assert.ok(fixture.deleted.every(item=>item.key.startsWith(prefix)&&item.version));
  }
});

test('unversioned cleanup retains ambiguous bytes even when a matching ownership marker remains',async t=>{
  const fixture=await probeServer(t,{versionMode:'unconfigured',tamperUnversioned:true});const dir=await mkdtemp(join(tmpdir(),'ruleexam-cos-probe-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const prefix=`${env.COS_KEY_PREFIX}staging/probe/${randomUUID()}/`;
  const result=await main(['--probe','--approved-prefix',prefix,'--out',join(dir,'journal.json')],env,{...fixture,output:()=>{}});
  assert.equal(result.report.probe.cleanup.status,'unknown',JSON.stringify(result.report.probe));assert.equal(result.report.probe.status,'fail');
  assert.equal([...fixture.objects.values()].flat().length,1);assert.ok(!fixture.deleted.some(item=>item.key.endsWith('-simple.bin')));
});

test('SDK initialization retries remain unknown and cleanup aborts only upload IDs actually returned to this probe',async t=>{
  const fixture=await probeServer(t,{retryInitialization:true});const dir=await mkdtemp(join(tmpdir(),'ruleexam-cos-probe-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const prefix=`${env.COS_KEY_PREFIX}staging/probe/${randomUUID()}/`;
  const result=await main(['--probe','--approved-prefix',prefix,'--out',join(dir,'journal.json')],env,{...fixture,output:()=>{}});
  assert.equal(result.report.probe.status,'fail');assert.equal(result.report.probe.reason,'PROBE_INIT_RETRY_UNKNOWN');assert.equal(result.report.probe.cleanup.status,'unknown');
  const journal=JSON.parse(await readFile(join(dir,'journal.json'),'utf8'));const known=new Set(journal.objects.flatMap(entry=>entry.uploadIds));
  assert.ok(fixture.aborted.every(item=>known.has(item.id)));assert.equal(fixture.tasks.size,1,'unknown first task remains for explicit review, never blind-aborted');
});
