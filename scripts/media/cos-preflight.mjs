#!/usr/bin/env node
// Node --env-file=.env supplies configuration. This tool never opens env files,
// starts Nest, connects to a database, or applies bucket/IAM configuration.
import { createRequire } from 'node:module';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';

const require=createRequire(new URL('../../server/package.json',import.meta.url));
const CONFIG_NAMES=['COS_BUCKET','COS_REGION','COS_KEY_PREFIX','COS_SECRET_ID','COS_SECRET_KEY'];
const ALLOWED_HEADERS=['Authorization','Content-Type','Content-MD5','Range','x-cos-acl','x-cos-security-token','x-cos-sdk-retry'];
const EXPOSE_HEADERS=['ETag','Content-Range','Content-Length','Accept-Ranges'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
class PreflightError extends Error {constructor(code){super(code);this.code=code;}}
function fail(code){throw new PreflightError(code);}
function array(value){return value===undefined?[]:Array.isArray(value)?value:[value];}
function successful(value){return value&&Number.isInteger(value.statusCode)&&value.statusCode>=200&&value.statusCode<300;}
function errorCode(error){return error?.code||error?.error?.Code;}
// HEAD has no XML body. SDK 3 reports its verified HTTP 404 as code "404".
function missing(error){return error?.statusCode===404&&['NoSuchKey','NoSuchVersion','NotFound','404'].includes(errorCode(error));}
function safeFailure(error){return {status:'unknown',reason:error?.statusCode===403?'ACCESS_DENIED':'SDK_CALL_FAILED',...(Number.isInteger(error?.statusCode)?{http_status:error.statusCode}:{})};}
function safeKey(config,key){
  if(typeof key!=='string'||!key.startsWith(config.keyPrefix)||key===config.keyPrefix||!/^[A-Za-z0-9_./-]+$/.test(key)||key.split('/').some(part=>!part||part==='.'||part==='..'))fail('TARGET_OUT_OF_SCOPE');
  return key;
}
function origin(value){
  let parsed;try{parsed=new URL(value);}catch{fail('ORIGIN_INVALID');}
  if(parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/'||value.includes('*')
    || !['https:','http:'].includes(parsed.protocol)
    || (parsed.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)))fail('ORIGIN_INVALID');
  return parsed.origin;
}
function bucketOrigin(config){return `https://${config.bucket}.cos.${config.region}.myqcloud.com`;}
function scope(){return '<COS_KEY_PREFIX>{media,staging}/';}
function approvedPrefix(config,prefix){
  const base=`${config.keyPrefix}staging/probe/`;
  if(typeof prefix!=='string'||!prefix.startsWith(base)||!prefix.endsWith('/')||!UUID.test(prefix.slice(base.length,-1)))fail('PROBE_PREFIX_NOT_APPROVED');
  return prefix;
}

export function parsePreflightArgs(argv){
  const args={mode:'inspect',origins:[]};let selected=false;
  if(argv.length===1&&argv[0]==='--help')return {...args,help:true};
  for(let i=0;i<argv.length;i++){
    const flag=argv[i];
    if(['--inspect','--render-proposal','--probe'].includes(flag)){
      if(selected)fail('INVALID_ARGUMENTS');selected=true;args.mode=flag.slice(2);
    }else if(['--origin','--out','--key','--version-id','--approved-prefix'].includes(flag)){
      const value=argv[++i];if(!value||value.startsWith('--'))fail('INVALID_ARGUMENTS');
      if(flag==='--origin')args.origins.push(origin(value));
      else {const name={'--out':'out','--key':'key','--version-id':'versionId','--approved-prefix':'approvedPrefix'}[flag];if(args[name]!==undefined)fail('INVALID_ARGUMENTS');args[name]=flag==='--out'?resolve(value):value;}
    }else fail('INVALID_ARGUMENTS');
  }
  args.origins=[...new Set(args.origins)];
  if(args.mode==='render-proposal'&&!args.out)fail('PROPOSAL_PATH_REQUIRED');
  if(args.mode==='probe'&&(!args.approvedPrefix||!args.out))fail('PROBE_APPROVAL_AND_JOURNAL_REQUIRED');
  if(args.mode!=='probe'&&args.approvedPrefix)fail('INVALID_ARGUMENTS');
  if(args.mode==='inspect'&&args.out)fail('INVALID_ARGUMENTS');
  if(args.mode==='probe'&&(args.key||args.versionId))fail('INVALID_ARGUMENTS');
  if(args.versionId&&(!args.key||args.versionId.length>1024||/[\s\0]/.test(args.versionId)))fail('INVALID_ARGUMENTS');
  return args;
}

export function readPreflightConfig(env){
  for(const name of CONFIG_NAMES)if(typeof env[name]!=='string'||!env[name].trim())fail(`CONFIG_REQUIRED_${name}`);
  if(!/^[a-z0-9][a-z0-9-]*-\d+$/.test(env.COS_BUCKET))fail('CONFIG_INVALID_COS_BUCKET');
  if(!/^[a-z][a-z0-9-]+$/.test(env.COS_REGION))fail('CONFIG_INVALID_COS_REGION');
  if(!/^(?:[A-Za-z0-9_-]+\/)+$/.test(env.COS_KEY_PREFIX))fail('CONFIG_INVALID_COS_KEY_PREFIX');
  return {bucket:env.COS_BUCKET,region:env.COS_REGION,keyPrefix:env.COS_KEY_PREFIX,secretId:env.COS_SECRET_ID,secretKey:env.COS_SECRET_KEY,sessionToken:env.COS_SESSION_TOKEN||null};
}

export async function inspectCos(config,sdk,{key,versionId}={}){
  if(key)safeKey(config,key);
  const target={Bucket:config.bucket,Region:config.region};const checks={};const snapshot={};
  async function check(name,method,read,params=target){
    try {const data=await sdk[method](params);if(!successful(data)&&!(name==='cors'&&data?.statusCode===404&&Array.isArray(data.CORSRules)&&data.CORSRules.length===0))fail('SDK_RESPONSE_INVALID');checks[name]=read(data);}
    catch(error){
      if(name==='policyRead'&&error?.statusCode===404&&(['NoSuchPolicy','NoSuchPolicyVersion','404'].includes(errorCode(error))||error.ErrorStatus==='Policy Not Found'))checks[name]={status:'pass',present:false,statement_count:0};
      else checks[name]=safeFailure(error);
    }
  }
  await Promise.all([
    check('bucket','headBucket',()=>({status:'pass'})),
    check('location','getBucketLocation',data=>({status:data.LocationConstraint===config.region?'pass':typeof data.LocationConstraint==='string'?'fail':'unknown',matches_configured_region:data.LocationConstraint===config.region})),
    check('acl','getBucketAcl',data=>({status:data.ACL==='private'?'pass':['public-read','public-read-write'].includes(data.ACL)?'fail':'unknown',classification:['private','public-read','public-read-write'].includes(data.ACL)?data.ACL:'unknown',grant_count:array(data.Grants).length})),
    check('versioning','getBucketVersioning',data=>({status:['Enabled','Suspended',undefined].includes(data.VersioningConfiguration?.Status)?'pass':'unknown',mode:{Enabled:'enabled',Suspended:'suspended'}[data.VersioningConfiguration?.Status]||(data.VersioningConfiguration?.Status===undefined?'unconfigured':'unknown')})),
    check('cors','getBucketCors',data=>{
      if(!Array.isArray(data.CORSRules))fail('SDK_RESPONSE_INVALID');snapshot.corsRules=structuredClone(data.CORSRules);
      if(data.ResponseVary!==undefined)snapshot.responseVary=data.ResponseVary;
      return {status:'pass',rule_count:data.CORSRules.length};
    }),
    check('policyRead','getBucketPolicy',data=>{
      if(!data.Policy||typeof data.Policy!=='object')fail('SDK_RESPONSE_INVALID');return {status:'pass',present:true,statement_count:array(data.Policy.statement??data.Policy.Statement).length};
    }),
    ...(key?[check('objectMetadata','headObject',data=>{
      const size=Number(data.headers?.['content-length']);if(!Number.isSafeInteger(size)||size<0)fail('SDK_RESPONSE_INVALID');
      return {status:'pass',size_bytes:size,version_pinned:Boolean(versionId||data.VersionId||data.headers?.['x-cos-version-id']),etag_present:Boolean(data.ETag||data.headers?.etag),crc64_present:Boolean(data.headers?.['x-cos-hash-crc64ecma'])};
    },{...target,Key:key,...(versionId?{VersionId:versionId}:{})})]:[]),
  ]);
  checks.objectMetadata||={status:'not-run',reason:'EXPLICIT_KEY_NOT_PROVIDED'};
  checks.sts={status:'not-run',reason:'REAL_TEMPORARY_CREDENTIAL_NOT_TESTED'};
  checks.browserCors={status:'not-run',reason:'REAL_BROWSER_NOT_TESTED'};
  checks.signedGet={status:'not-run',reason:'REAL_SIGNED_TRANSFER_NOT_TESTED'};
  return {report:{mode:'inspect',configuration:[...CONFIG_NAMES.map(name=>({name,status:'configured'})),{name:'COS_SESSION_TOKEN',status:config.sessionToken?'configured':'not-set-optional'}],scope:scope(),ready:false,g0:'not-verified',metadata_complete:['bucket','location','acl','versioning','cors','policyRead'].every(name=>checks[name]?.status==='pass'),checks},snapshot};
}

function actionReference(config){
  const appid=config.bucket.slice(config.bucket.lastIndexOf('-')+1);
  const resource=key=>`qcs::cos:${config.region}:uid/${appid}:${config.bucket}/${config.keyPrefix}${key}`;
  return {disposition:'append-reviewed-actions-only-preserve-shared-policy',replace_existing_policy:false,
    inspection:['name/cos:HeadBucket','name/cos:GetBucketLocation','name/cos:GetBucketACL','name/cos:GetBucketVersioning','name/cos:GetBucketCORS','name/cos:GetBucketPolicy'],
    backend:[{actions:['name/cos:HeadObject','name/cos:GetObject','name/cos:PutObject','name/cos:DeleteObject'],exact_key_example:resource('media/<session-id>/<claim-id>.png')},
      {actions:['name/cos:InitiateMultipartUpload','name/cos:ListMultipartUploads','name/cos:ListParts','name/cos:CompleteMultipartUpload','name/cos:AbortMultipartUpload','name/cos:GetBucketObjectVersions'],exact_key_example:resource('staging/<session-id>.upload')}],
    temporary:[{mode:'simple',actions:['name/cos:PutObject'],exact_key_example:resource('staging/<session-id>.upload')},
      {mode:'multipart',actions:['name/cos:UploadPart','name/cos:ListParts'],exact_key_example:resource('staging/<session-id>.upload')}],
    probe_only:['name/cos:GetObjectACL'],
    notes:['This is an action reference, not a bucket/CAM policy. Bucket list actions need their own reviewed resource/prefix conditions.','Keep every existing shared identity permission and principal; add only missing approved actions.'],
    no_new_long_term_identity:true};
}

export function buildProposal(config,inspection,origins=[]){
  if(!Array.isArray(inspection.snapshot?.corsRules))fail('CORS_SNAPSHOT_UNAVAILABLE');
  const allowedOrigins=[...new Set(origins.map(origin))];const existing=structuredClone(inspection.snapshot.corsRules);
  const added=allowedOrigins.length?[{ID:`RuleExamMedia-${createHash('sha256').update(allowedOrigins.join('\n')).digest('hex').slice(0,12)}`,AllowedOrigins:allowedOrigins,AllowedMethods:['GET','HEAD','PUT'],AllowedHeaders:ALLOWED_HEADERS,ExposeHeaders:EXPOSE_HEADERS,MaxAgeSeconds:600}]:[];
  const additions=added.filter(rule=>!existing.some(old=>JSON.stringify(old)===JSON.stringify(rule)));
  const mediaOrigin=bucketOrigin(config);const host=new URL(mediaOrigin).hostname;
  return {schema_version:1,review_only:true,apply_automatically:false,
    cors:{status:allowedOrigins.length?'review-required':'needs-origins',preserve_existing:true,existing_rule_count:existing.length,added_rules:additions,CORSRules:[...existing,...additions],...(inspection.snapshot.responseVary!==undefined?{ResponseVary:inspection.snapshot.responseVary}:{}),recommended_response_vary:'true'},
    policy:actionReference(config),
    public_frontend:{VITE_COS_MEDIA_ORIGIN:mediaOrigin,VITE_COS_MEDIA_PREFIX:`${config.keyPrefix}media/`},
    csp:{append_only:{'img-src':[mediaOrigin],'media-src':[mediaOrigin],'connect-src':[mediaOrigin]},replace_existing_directives:false},
    mp_weixin:{request_legal_domain:mediaOrigin,upload_file_legal_domain:mediaOrigin,download_file_legal_domain:mediaOrigin,host,console_registration_required:true,mp_proxy_compatibility_unchanged:true},
    pending:[...(allowedOrigins.length?[]:['EXACT_PAGE_ORIGINS_REQUIRED']),'REAL_BROWSER_CORS','REAL_STS_SCOPE_DENIAL','REAL_SIGNED_GET_EXPIRY_RANGE','READY_MEDIA_BUSINESS_FLOW','MP_DOMAIN_DEVICE_ACCEPTANCE'],
  };
}

export async function writeProposal(path,value){
  await mkdir(dirname(path),{recursive:true,mode:0o700});let handle;
  try {handle=await open(path,'wx',0o600);await handle.writeFile(`${JSON.stringify(value,null,2)}\n`);await handle.sync();}
  catch(error){if(error?.code==='EEXIST')fail('PROPOSAL_EXISTS');fail('PROPOSAL_WRITE_FAILED');}
  finally {await handle?.close();}
}

async function replaceJournal(path,value){
  const temporary=`${path}.${randomUUID()}.tmp`;let handle;
  try {handle=await open(temporary,'wx',0o600);await handle.writeFile(`${JSON.stringify(value,null,2)}\n`);await handle.sync();await handle.close();handle=null;await rename(temporary,path);}
  catch {fail('PROBE_JOURNAL_WRITE_FAILED');}
  finally {await handle?.close();await rm(temporary,{force:true});}
}

function objectTarget(config,entry,versionId){
  return {Bucket:config.bucket,Region:config.region,Key:safeKey(config,entry.key),...(versionId!==undefined&&versionId!==null?{VersionId:versionId}:{})};
}
function versionOf(result){
  const value=result?.VersionId??result?.headers?.['x-cos-version-id'];
  if(value===undefined||value===null||value==='')return null;
  if(typeof value!=='string'||/[\s\0]/.test(value))fail('PROBE_VERSION_INVALID');
  return value; // The literal string "null" is a real, exact version selector.
}
function sha(bytes){return createHash('sha256').update(bytes).digest('hex');}
async function bounded(promise,milliseconds=10_000){
  let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new PreflightError('PROBE_RESPONSE_TIMEOUT')),milliseconds);})]);}
  finally {clearTimeout(timer);}
}
async function httpBytes(response,limit){
  const chunks=[];let length=0;
  if(response.body)for await(const chunk of response.body){length+=chunk.length;if(length>limit)fail('PROBE_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(chunk));}
  return Buffer.concat(chunks);
}
async function sdkBytes(sdk,target,limit){
  const output=new PassThrough();output.on('error',()=>{});
  try {
    sdk.getObject({...target,Output:output},error=>{if(error)output.destroy(new PreflightError('PROBE_READ_FAILED'));});
    const chunks=[];let length=0;
    for await(const chunk of output){length+=chunk.length;if(length>limit)fail('PROBE_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(chunk));}
    return Buffer.concat(chunks);
  }finally {output.destroy();}
}
async function signedUrl(signer,config,entry,{method='GET',versionId,headers,expires=30}={}){
  const Query=versionId!==undefined&&versionId!==null?{versionId}:undefined;
  const url=await new Promise((resolve,reject)=>signer.getObjectUrl({...objectTarget(config,entry),Method:method,Sign:true,...(Query?{Query}:{}),...(headers?{Headers:headers}:{}),...(expires!==null?{Expires:expires}:{})},(error,result)=>error?reject(new PreflightError('PROBE_SIGNING_FAILED')):resolve(result.Url)));
  const parsed=new URL(url);
  if(parsed.origin!==bucketOrigin(config)||parsed.pathname!==`/${entry.key}`||parsed.username||parsed.password)fail('PROBE_URL_OUT_OF_SCOPE');
  return url;
}

function expiredUrl(config,entry,versionId){
  const COS=require('cos-nodejs-sdk-v5');const now=Math.floor(Date.now()/1000);
  const Query=versionId===null?{}:{versionId};
  const authorization=COS.getAuthorization({SecretId:config.secretId,SecretKey:config.secretKey,Bucket:config.bucket,Region:config.region,Key:safeKey(config,entry.key),Method:'GET',Query,KeyTime:`${now-120};${now-60}`});
  const url=new URL(`${bucketOrigin(config)}/${entry.key}`);url.search=new URLSearchParams(authorization).toString();
  for(const [name,value]of Object.entries(Query))url.searchParams.set(name,value);
  if(config.sessionToken)url.searchParams.set('x-cos-security-token',config.sessionToken);
  return url;
}

async function listExactVersions(sdk,config,entry){
  const versions=[];const seen=new Set();let marker='';let versionMarker='';
  for(let pageNumber=0;pageNumber<20;pageNumber++){
    const page=await sdk.listObjectVersions({Bucket:config.bucket,Region:config.region,Prefix:safeKey(config,entry.key),KeyMarker:marker,VersionIdMarker:versionMarker,MaxKeys:'1000'});
    for(const item of page.Versions||[])if(item.Key===entry.key&&typeof item.VersionId==='string'&&item.VersionId)versions.push(item.VersionId);
    // This tool never creates delete markers. An unexpected marker is ambiguous.
    if((page.DeleteMarkers||[]).some(item=>item.Key===entry.key))fail('PROBE_UNOWNED_DELETE_MARKER');
    if(page.IsTruncated!==true&&page.IsTruncated!=='true')return [...new Set(versions)];
    const next=page.NextKeyMarker||'';const nextVersion=page.NextVersionIdMarker||'';const pair=JSON.stringify([next,nextVersion]);
    if(!next||seen.has(pair)||(next===marker&&nextVersion===versionMarker))fail('PROBE_PAGINATION_INVALID');
    seen.add(pair);marker=next;versionMarker=nextVersion;
  }
  fail('PROBE_VERSION_SCAN_LIMIT');
}

export async function probeCos(config,sdk,{approvedPrefix:prefix,out},inspection,dependencies={}){
  approvedPrefix(config,prefix);
  const ownership=randomUUID();
  const objects=['simple','multipart','denied'].map(kind=>{const bytes=randomBytes(64);return {kind,key:`${prefix}${randomUUID()}-${kind}.bin`,bytes,sha256:sha(bytes),writeIntent:false,writeConfirmed:false,versions:[],uploadIds:[],initAttempts:0,unknownUpload:false};});
  const report={status:'fail',checks:{},cleanup:{status:'unknown',deleted_object_count:0,aborted_upload_count:0,pending_object_count:0}};
  let journalCreated=false;
  async function journal(){
    const value={schema_version:1,kind:'ruleexam-cos-probe',scope:prefix,ownership,objects:objects.map(({bytes,...entry})=>({...entry,size_bytes:bytes.length})),report};
    if(!journalCreated){await writeProposal(out,value);journalCreated=true;}else await replaceJournal(out,value);
  }
  const fetchImpl=dependencies.fetchImpl||fetch;
  const http=(url,options={})=>fetchImpl(url,{...options,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10_000)});
  const signer=createClient(config);
  const temporaryFactory=dependencies.temporarySdkFactory||((data)=>createClient(config,data));
  const provider=dependencies.credentialProvider||require('qcloud-cos-sts').getCredential;
  async function grant(entry,mode){
    const actions=mode==='simple'?['name/cos:PutObject']:['name/cos:UploadPart','name/cos:ListParts'];
    const appid=config.bucket.slice(config.bucket.lastIndexOf('-')+1);const deadline=Date.now()+90_000;
    let data;
    try {data=await bounded(Promise.resolve().then(()=>provider({secretId:config.secretId,secretKey:config.secretKey,region:config.region,durationSeconds:60,policy:{version:'2.0',statement:[{effect:'allow',action:actions,resource:[`qcs::cos:${config.region}:uid/${appid}:${config.bucket}/${safeKey(config,entry.key)}`]}]}})));}
    catch {fail('PROBE_STS_UNAVAILABLE');}
    if(!data?.credentials?.tmpSecretId||!data.credentials.tmpSecretKey||!data.credentials.sessionToken||!Number.isSafeInteger(data.startTime)||!Number.isSafeInteger(data.expiredTime)||data.startTime>=data.expiredTime||data.expiredTime*1000<=Date.now()||data.expiredTime*1000>deadline)fail('PROBE_STS_VALIDITY_INVALID');
    return {data,sdk:temporaryFactory(data),signer:createClient(config,data)};
  }
  const writeHeaders={'Content-Type':'application/octet-stream','x-cos-acl':'private','x-cos-meta-ruleexam-probe':ownership};
  async function capture(entry,result){const version=versionOf(result);if(version!==null&&!entry.versions.includes(version))entry.versions.push(version);entry.writeConfirmed=true;await journal();}
  async function initialize(entry){
    entry.unknownUpload=true;await journal();
    const result=await sdk.multipartInit({...objectTarget(config,entry),ContentType:'application/octet-stream',ACL:'private',Headers:{'x-cos-meta-ruleexam-probe':ownership}});
    if(typeof result.UploadId!=='string'||!result.UploadId)fail('PROBE_UPLOAD_ID_INVALID');
    entry.uploadIds.push(result.UploadId);
    if(entry.initAttempts>1){await journal();fail('PROBE_INIT_RETRY_UNKNOWN');}
    entry.unknownUpload=false;await journal();return result.UploadId;
  }
  async function verifyPrivate(entry){
    const head=await sdk.headObject(objectTarget(config,entry));const version=versionOf(head);
    if(head.headers?.['x-cos-meta-ruleexam-probe']!==ownership||Number(head.headers?.['content-length'])!==entry.bytes.length)fail('PROBE_OWNERSHIP_MISMATCH');
    if(version!==null&&!entry.versions.includes(version))entry.versions.push(version);
    const acl=await sdk.getObjectAcl(objectTarget(config,entry,version));if(acl.ACL!=='private')fail('PROBE_OBJECT_ACL_NOT_PRIVATE');
    await journal();return version;
  }
  async function assertHttpDenied(response,code,allowed=['AccessDenied']){
    const body=await httpBytes(response,4096);
    const actual=/<Code>([A-Za-z]+)<\/Code>/.exec(body.toString())?.[1];
    if(response.status!==403||!allowed.includes(actual))fail(code);
  }
  async function transfers(entry,version){
    const url=await signedUrl(signer,config,entry,{versionId:version});
    const full=await http(url);if(full.status!==200||sha(await httpBytes(full,64))!==entry.sha256)fail('PROBE_SIGNED_GET_FAILED');
    const range=await http(url,{headers:{Range:'bytes=4-11'}});
    if(range.status!==206||range.headers.get('content-range')!=='bytes 4-11/64'||!(await httpBytes(range,8)).equals(entry.bytes.subarray(4,12)))fail('PROBE_RANGE_FAILED');
    const invalid=await http(url,{headers:{Range:'bytes=64-70'}});await httpBytes(invalid,4096);if(invalid.status!==416)fail('PROBE_RANGE_416_FAILED');
    const unsigned=new URL(url);unsigned.search='';if(version!==null)unsigned.searchParams.set('versionId',version);
    await assertHttpDenied(await http(unsigned),'PROBE_UNSIGNED_READ_NOT_DENIED');
    await assertHttpDenied(await http(expiredUrl(config,entry,version)),'PROBE_EXPIRED_READ_NOT_DENIED',['AccessDenied','RequestTimeTooSkewed']);
    return url;
  }
  await journal();
  // SDK 3 retries Init internally after an unknown reply. Observe actual sends:
  // a returned ID does not prove that an earlier attempt created no other task.
  const observe=options=>{
    try {const url=new URL(options.url);if(String(options.method).toUpperCase()==='POST'&&url.searchParams.has('uploads')){const entry=objects.find(item=>`/${item.key}`===url.pathname);if(entry)entry.initAttempts++;}}catch{}
  };
  if(typeof sdk.on!=='function'||typeof sdk.off!=='function')fail('PROBE_SDK_OBSERVABILITY_REQUIRED');
  sdk.on('before-send',observe);
  try {
    // Check all random targets before the first cloud mutation, not one by one
    // interleaved with writes. Unknown/denied existence never means absent.
    for(const entry of objects){try {await sdk.headObject(objectTarget(config,entry));fail('PROBE_TARGET_ALREADY_EXISTS');}catch(error){if(!missing(error))throw error;}}
    report.checks.targets_absent={status:'pass',count:objects.length};
    const [simple,multipart,denied]=objects;
    const simpleGrant=await grant(simple,'simple');
    simple.writeIntent=true;await journal();
    const simplePut=await http(await signedUrl(simpleGrant.signer,config,simple,{method:'PUT',headers:writeHeaders,expires:null}),{method:'PUT',headers:writeHeaders,body:simple.bytes});
    await httpBytes(simplePut,4096);if(simplePut.status<200||simplePut.status>=300)fail('PROBE_SIMPLE_PUT_FAILED');
    await capture(simple,{headers:{'x-cos-version-id':simplePut.headers.get('x-cos-version-id')}});
    const simpleVersion=await verifyPrivate(simple);report.checks.simple_upload={status:'pass'};
    // Even an unexpectedly successful forbidden write remains in the owned
    // journal and gets exact cleanup. It cannot touch an existing business key.
    denied.writeIntent=true;await journal();
    const forbiddenPut=await http(await signedUrl(simpleGrant.signer,config,denied,{method:'PUT',headers:writeHeaders,expires:null}),{method:'PUT',headers:writeHeaders,body:denied.bytes});
    await assertHttpDenied(forbiddenPut,'PROBE_SIMPLE_SCOPE_NOT_DENIED');denied.writeIntent=false;await journal();
    const uploadId=await initialize(multipart);const deniedUploadId=await initialize(denied);const multipartGrant=await grant(multipart,'multipart');
    try {await multipartGrant.sdk.multipartUpload({...objectTarget(config,denied),UploadId:deniedUploadId,PartNumber:1,Body:denied.bytes,ContentLength:64});fail('PROBE_MULTIPART_SCOPE_NOT_DENIED');}
    catch(error){if(error?.statusCode!==403||errorCode(error)!=='AccessDenied')throw error;}
    report.checks.temporary_scope={status:'pass',simple_outside_key_denied:true,multipart_outside_key_denied:true};
    await multipartGrant.sdk.multipartUpload({...objectTarget(config,multipart),UploadId:uploadId,PartNumber:1,Body:multipart.bytes,ContentLength:64});
    const parts=await multipartGrant.sdk.multipartListPart({...objectTarget(config,multipart),UploadId:uploadId});
    if(parts.Part?.length!==1||Number(parts.Part[0].PartNumber)!==1||Number(parts.Part[0].Size)!==64||!parts.Part[0].ETag)fail('PROBE_PARTS_MISMATCH');
    multipart.writeIntent=true;await journal();
    const complete=await sdk.multipartComplete({...objectTarget(config,multipart),UploadId:uploadId,Parts:[{PartNumber:1,ETag:parts.Part[0].ETag}]});await capture(multipart,complete);
    const multipartVersion=await verifyPrivate(multipart);report.checks.multipart_upload={status:'pass'};
    const simpleUrl=await transfers(simple,simpleVersion);await transfers(multipart,multipartVersion);
    const tampered=new URL(simpleUrl);tampered.pathname=`/${multipart.key}`;
    if(multipartVersion===null)tampered.searchParams.delete('versionId');else tampered.searchParams.set('versionId',multipartVersion);
    await assertHttpDenied(await http(tampered),'PROBE_CHANGED_KEY_NOT_DENIED',['AccessDenied','SignatureDoesNotMatch']);
    report.checks.signed_get_range={status:'pass',full_hash:true,range_206:true,range_416:true,unsigned_read_denied:true,expired_url_denied:true,key_change_denied:true};
    report.checks.application_auth={status:'not-run',reason:'APPLICATION_SIGNED_URL_AND_BUSINESS_AUTH_REQUIRE_SEPARATE_ACCEPTANCE'};
    report.status='pass';
  }catch(error){report.status='fail';report.reason=error instanceof PreflightError?error.code:error?.statusCode===403?'PROBE_ACCESS_DENIED':'PROBE_SDK_OR_HTTP_FAILED';}
  finally {
    sdk.off('before-send',observe);
    let pending=0;
    for(const entry of objects){
      if(entry.unknownUpload)pending++;
      for(const uploadId of entry.uploadIds){
        try {await sdk.multipartAbort({...objectTarget(config,entry),UploadId:uploadId});report.cleanup.aborted_upload_count++;}
        catch(error){if(error?.statusCode!==404||errorCode(error)!=='NoSuchUpload')pending++;}
      }
      if(!entry.writeIntent)continue;
      try {
        const versions=new Set(entry.versions);let latest;
        try {latest=await sdk.headObject(objectTarget(config,entry));const version=versionOf(latest);if(version!==null)versions.add(version);}
        catch(error){if(!missing(error))throw error;}
        if(!entry.writeConfirmed&&inspection.report.checks.versioning.mode!=='unconfigured')for(const version of await listExactVersions(sdk,config,entry))versions.add(version);
        if(versions.size){
          for(const version of versions){
            const target=objectTarget(config,entry,version);let head;
            try {head=await sdk.headObject(target);}catch(error){if(missing(error))continue;throw error;}
            if(head.headers?.['x-cos-meta-ruleexam-probe']!==ownership||Number(head.headers?.['content-length'])!==64||sha(await sdkBytes(sdk,target,64))!==entry.sha256)fail('PROBE_CLEANUP_OWNERSHIP_AMBIGUOUS');
            if(!entry.versions.includes(version)){entry.versions.push(version);await journal();}
            await sdk.deleteObject(target);report.cleanup.deleted_object_count++;
          }
        }else if(latest){
          if(inspection.report.checks.versioning.mode!=='unconfigured'||latest.headers?.['x-cos-meta-ruleexam-probe']!==ownership||Number(latest.headers?.['content-length'])!==64||sha(await sdkBytes(sdk,objectTarget(config,entry),64))!==entry.sha256)fail('PROBE_CLEANUP_OWNERSHIP_AMBIGUOUS');
          // The non-versioned fallback is limited to this random, pre-absent key
          // and only follows matching ownership AND a full actual-byte hash.
          await sdk.deleteObject(objectTarget(config,entry));report.cleanup.deleted_object_count++;
        }else if(!entry.writeConfirmed)pending++;
      }catch {pending++;}
    }
    report.cleanup.pending_object_count=pending;report.cleanup.status=pending?'unknown':'pass';
    if(pending)report.status='fail';await journal();
  }
  return report;
}

function createClient(config,temporary){
  const COS=require('cos-nodejs-sdk-v5');
  return new COS({Protocol:'https:',Timeout:10_000,AutoSwitchHost:false,...(temporary?{getAuthorization:(_params,callback)=>callback({TmpSecretId:temporary.credentials.tmpSecretId,TmpSecretKey:temporary.credentials.tmpSecretKey,SecurityToken:temporary.credentials.sessionToken,StartTime:temporary.startTime,ExpiredTime:temporary.expiredTime})}:{SecretId:config.secretId,SecretKey:config.secretKey,...(config.sessionToken?{SecurityToken:config.sessionToken}:{})})});
}

export async function main(argv=process.argv.slice(2),env=process.env,dependencies={}){
  const args=parsePreflightArgs(argv);const output=dependencies.output||((text)=>process.stdout.write(text));
  if(args.help){output('COS preflight: --inspect (default, read-only) | --render-proposal --out <private-file> [--origin <https-origin|http://localhost:port>]... | --probe --approved-prefix <COS_KEY_PREFIX>staging/probe/<UUID>/ --out <private-journal>\nOptional inspection: --key <exact-project-key> [--version-id <exact-version>]. No apply command.\n');return {help:true};}
  const config=readPreflightConfig(env);if(args.key)safeKey(config,args.key);if(args.mode==='probe')approvedPrefix(config,args.approvedPrefix);
  const sdk=(dependencies.sdkFactory||createClient)(config);const inspection=await inspectCos(config,sdk,args);const report={...inspection.report,mode:args.mode};
  if(args.mode==='render-proposal'){
    const proposal=buildProposal(config,inspection,args.origins);await writeProposal(args.out,proposal);
    report.proposal={status:proposal.cors.status,mode:'0600',existing_rule_count:proposal.cors.existing_rule_count,added_rule_count:proposal.cors.added_rules.length,policy:'review-only-no-apply'};
  }
  if(args.mode==='probe'){
    report.probe=await probeCos(config,sdk,args,inspection,dependencies);
    report.checks.sts=report.probe.checks.temporary_scope||{status:'unknown',reason:'TEMPORARY_SCOPE_PROBE_NOT_COMPLETED'};
    report.checks.signedGet=report.probe.checks.signed_get_range||{status:'unknown',reason:'SIGNED_TRANSFER_PROBE_NOT_COMPLETED'};
  }
  output(`${JSON.stringify(report,null,2)}\n`);return {report,snapshot:inspection.snapshot};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(result=>{if(result.report?.probe?.status==='fail')process.exitCode=1;else if(result.report&&!result.report.metadata_complete)process.exitCode=2;}).catch(error=>{
  process.stderr.write(`${error instanceof PreflightError?error.code:'COS_PREFLIGHT_FAILED'}\n`);process.exitCode=1;
});
