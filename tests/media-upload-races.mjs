import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isSafeTestDatabase, renderSchemaForDatabase } from './support/test-target.mjs';
import { createEphemeralServices } from './support/ephemeral-services.mjs';

const require=createRequire(new URL('../server/package.json',import.meta.url));
require('reflect-metadata');
const {DataSource}=require('typeorm');
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const delay=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(check){for(let index=0;index<400;index++){const value=await check();if(value)return value;await delay();}throw new Error('upload race checkpoint timeout');}
function missing(){return Object.assign(new Error('external object not found'),{statusCode:404,code:'NoSuchKey'});}

/** Only the COS and media probe boundaries are replaced; DB/permissions/publisher are real. */
class FakeCos {
  objects=new Map(); tasks=new Map(); puts=0; begins=0; completes=0; removed=[]; hook={};
  place(locator,body,mimeType='image/png') {
    const bytes=Buffer.from(body);const object={locator:{...locator,versionId:randomUUID()},sizeBytes:bytes.length,mimeType,etag:sha(bytes),crc64:null};
    const versions=this.objects.get(locator.key)||[];versions.push({object,bytes});this.objects.set(locator.key,versions);return object;
  }
  find(locator){const versions=this.objects.get(locator.key)||[];const found=locator.versionId===null?versions.at(-1):versions.find(item=>item.object.locator.versionId===locator.versionId);if(!found)throw missing();return found;}
  async stat(locator){return structuredClone(this.find(locator).object);}
  async open(locator){const found=this.find(locator);const bytes=Buffer.from(found.bytes);await this.hook.open?.(locator);return Readable.from([bytes]);}
  async putFile(locator,path,mimeType){this.puts++;const object=this.place(locator,await readFile(path),mimeType);await this.hook.put?.(object);return object;}
  async remove(locator){this.removed.push({...locator});const versions=this.objects.get(locator.key)||[];this.objects.set(locator.key,versions.filter(item=>item.object.locator.versionId!==locator.versionId));}
  async begin(locator){this.begins++;const uploadId=randomUUID();this.tasks.set(uploadId,{key:locator.key,initiatedAt:new Date().toISOString(),parts:[]});await this.hook.begin?.(uploadId);return{uploadId};}
  async listMultipartUploads(locator){return [...this.tasks].filter(([,task])=>task.key===locator.key).map(([uploadId,task])=>({uploadId,initiatedAt:task.initiatedAt}));}
  async parts(locator,uploadId){const task=this.tasks.get(uploadId);if(!task||task.key!==locator.key)throw Object.assign(missing(),{code:'NoSuchUpload'});return task.parts.map((bytes,index)=>({partNumber:index+1,etag:sha(bytes),sizeBytes:bytes.length}));}
  async complete(locator,uploadId){this.completes++;const task=this.tasks.get(uploadId);if(!task)throw Object.assign(missing(),{code:'NoSuchUpload'});const object=this.place(locator,Buffer.concat(task.parts),'video/mp4');this.tasks.delete(uploadId);await this.hook.complete?.(object);return object;}
  async abort(locator,uploadId){const task=this.tasks.get(uploadId);if(task&&task.key===locator.key)this.tasks.delete(uploadId);}
  async removeStagingVersions(locator){for(const item of this.objects.get(locator.key)||[])this.removed.push(item.object.locator);this.objects.delete(locator.key);}
}

async function createChecks(mysqlConfig,redisConfig) {
  assert.ok(isSafeTestDatabase(mysqlConfig.database),'upload checks refuse a non-test database');
  const root=await mkdtemp(join(tmpdir(),'ruleexam-upload-races-'));
  const load=(name)=>require(`./dist/${name}.js`);
  const {MediaAsset}=load('entities/media-asset.entity');const {MediaReference}=load('entities/media-reference.entity');const {MediaUploadSession}=load('entities/media-upload-session.entity');
  const {SysUser}=load('entities/sys-user.entity');const {SysRole}=load('entities/sys-role.entity');const {SysPermission}=load('entities/sys-permission.entity');
  const {SysUserRole}=load('entities/sys-user-role.entity');const {SysRolePermission}=load('entities/sys-role-permission.entity');const {AuthSession}=load('entities/auth-session.entity');
  const {RedisService}=load('common/redis.service');const {AccessService}=load('modules/access/access.service');const {SessionService}=load('modules/auth/session.service');
  const {MediaService}=load('modules/media/media.service');const {MediaPublisher}=load('modules/media/media-publisher.service');
  const {LocalMediaStorage}=load('modules/media/storage/local-media-storage');const {MediaStorageRouter}=load('modules/media/storage/media-storage.router');
  const {CosUploadGrantAdapter}=load('modules/media/storage/cos-upload-grant.adapter');
  const {MediaUploadSessionService}=load('modules/media/uploads/media-upload-session.service');const {MediaUploadGrantService}=load('modules/media/uploads/media-upload-grant.service');
  const {MediaUploadFinalizerService}=load('modules/media/uploads/media-upload-finalizer.service');const {MediaUploadCleanupService}=load('modules/media/uploads/media-upload-cleanup.service');
  const {DEFAULT_MEDIA_LIMITS}=load('modules/media/media-policy');
  const config={upload:{dir:root},media:DEFAULT_MEDIA_LIMITS,cosMedia:{provider:'cos',bucket:'fixture-1234567890',region:'ap-guangzhou',keyPrefix:'ruleexam/races/',secretId:'unusable-fixture-id',secretKey:'unusable-fixture-key',sessionToken:null},
    mediaUpload:{sessionTtlSeconds:86400,receiptTtlSeconds:2592000,multipartThresholdBytes:32,partSizeBytes:8,parallelLimit:3,grantTtlSeconds:1800,finalizerConcurrency:2,leaseSeconds:120,renewSeconds:30,maxAttempts:5,orphanGraceSeconds:86400},
    jwt:{refreshExpiresDays:7},redis:{...redisConfig,enabled:true,keyPrefix:`upload-races:${randomUUID()}:`}};
  const dbOptions={type:'mysql',host:mysqlConfig.host,port:mysqlConfig.port,username:mysqlConfig.user,password:mysqlConfig.password,database:mysqlConfig.database,
    timezone:'Z',entities:[join(ROOT,'server/dist/entities/*.entity.js')],synchronize:false,logging:false,extra:{connectionLimit:2}};
  const source=await new DataSource(dbOptions).initialize();const second=await new DataSource(dbOptions).initialize();
  const redis=new RedisService(config);await redis.onModuleInit();assert.equal(redis.isAvailable(),true,'ephemeral Redis must really be connected');
  const cos=new FakeCos();const probe={hook:null,async probe(path,kind){await this.hook?.(path,kind);return kind==='video'?{mimeType:'video/mp4',durationMs:1500}:{mimeType:'image/png',width:1,height:1};}};
  const observedGrants=[];const grantAdapter={hook:null,async issue(input){observedGrants.push(input);await this.hook?.(input);return input.mode==='simple'?{mode:'simple',method:'PUT',url:'https://fixture.invalid/upload-instruction',headers:{},expires_at:input.expiresAt.toISOString()}:{mode:'multipart',bucket:input.locator.bucket,region:input.locator.region,key:input.locator.key,upload_id:input.uploadId,credentials:{tmp_secret_id:'unusable-temporary-id',tmp_secret_key:'unusable-temporary-key',token:'unusable-temporary-token'},start_time:Math.floor(Date.now()/1000),expired_time:Math.floor(input.expiresAt.getTime()/1000)};}};
  function instance(dataSource) {
    const repo=entity=>dataSource.getRepository(entity);const auth=new SessionService(repo(AuthSession),redis,undefined,config);
    const access=new AccessService(repo(SysUser),repo(SysRole),repo(SysPermission),repo(SysRolePermission),repo(SysUserRole),redis,dataSource,auth,undefined,config);
    const router=new MediaStorageRouter(config.cosMedia,new LocalMediaStorage(root),cos);const publisher=new MediaPublisher(router);
    const media=new MediaService(repo(MediaAsset),repo(MediaReference),dataSource,config,probe,router,publisher,access);
    const sessions=new MediaUploadSessionService(dataSource,media,config,cos);
    const grants=new MediaUploadGrantService(dataSource,media,sessions,config,grantAdapter);
    const finalizer=new MediaUploadFinalizerService(dataSource,media,config,cos,publisher,probe,sessions);
    const cleanup=new MediaUploadCleanupService(dataSource,config,cos);
    return{media,sessions,grants,finalizer,cleanup};
  }
  const one=instance(source);const two=instance(second);const repo=source.getRepository(MediaUploadSession);
  const users=source.getRepository(SysUser);
  for(const [id,role]of [['9001','super_admin'],['9002','employee']])await users.save(users.create({id,username:`upload-race-${id}`,passwordHash:'unusable-password-fixture',realName:'媒体并发测试',role,status:1,authVersion:0,rolesConfigured:0}));
  const actor={id:9001,username:'upload-race-9001',role:'super_admin',jti:'unusable-session',iat:Math.floor(Date.now()/1000)};
  const other={...actor,id:9002,username:'upload-race-9002',role:'employee'};
  const input=(body=Buffer.from('image fixture'),purpose='avatar')=>({client_request_id:randomUUID(),purpose,filename:purpose==='video'?'fixture.mp4':'fixture.png',mime_type:purpose==='video'?'video/mp4':'image/png',size_bytes:body.length,fingerprint_sha256:sha(body)});
  async function uploaded(body=Buffer.from('image fixture')){const request=input(body);const session=await one.sessions.begin(actor,request);const row=await repo.findOneByOrFail({id:session.session_id});cos.place(row.stagingLocator,body);return{request,session,row,body};}
  const assetCount=()=>source.getRepository(MediaAsset).count({where:{uploadedBy:'9001'}});
  return{one,two,source,second,cos,probe,repo,users,actor,other,input,uploaded,observedGrants,grantAdapter,assetCount,MediaAsset,MediaReference,config,
    grantsWithProvider(provider){return new MediaUploadGrantService(source,one.media,one.sessions,config,new CosUploadGrantAdapter(config.cosMedia,provider));},
    async close(){await Promise.all([source.destroy(),second.destroy()]);await redis.onModuleDestroy();await rm(root,{recursive:true,force:true});}};
}

export async function verifyMediaUploadRaces({mysqlConfig,redisConfig}) {
  const h=await createChecks(mysqlConfig,redisConfig);let scenarios=0;
  try {
    // Same request races through two connection pools; MySQL's unique key is the arbiter.
    const body=Buffer.from('persistent image');const request=h.input(body);
    const begins=await Promise.all(Array.from({length:8},(_,i)=>(i%2?h.one:h.two).sessions.begin(h.actor,request)));
    assert.equal(new Set(begins.map(value=>value.session_id)).size,1);
    await assert.rejects(h.one.sessions.begin(h.actor,{...request,filename:'other.png'}),error=>error.data?.reason_code==='UPLOAD_REQUEST_CONFLICT');
    for(const op of [()=>h.one.sessions.status(h.other,begins[0].session_id),()=>h.one.sessions.complete(h.other,begins[0].session_id),()=>h.one.sessions.cancel(h.other,begins[0].session_id),()=>h.one.grants.issue(h.other,begins[0].session_id)])await assert.rejects(op,error=>error.httpStatus===403);
    scenarios++;

    // H5 avatars stay on simple PUT even when an operator lowers the multipart threshold.
    const avatar=await h.one.sessions.begin(h.actor,h.input(Buffer.alloc(64,1)));
    assert.equal(avatar.mode,'simple');
    h.config.mediaUpload.grantTtlSeconds=600;
    await h.one.grants.issue(h.actor,avatar.session_id);
    const sixHundred=h.observedGrants.at(-1);
    assert.ok(sixHundred.expiresAt.getTime()<=Date.now()+600_000);
    const near=await h.one.sessions.begin(h.actor,h.input(Buffer.alloc(64,2)));
    const originalDeadline=new Date(Date.now()+12_000);await h.repo.update(near.session_id,{expiresAt:originalDeadline});
    const shortened=await h.two.grants.issue(h.actor,near.session_id);
    assert.equal(shortened.expires_at,originalDeadline.toISOString());
    assert.equal((await h.repo.findOneByOrFail({id:near.session_id})).lastCredentialExpiresAt.getTime(),originalDeadline.getTime());
    h.grantAdapter.hook=async()=>{throw new Error('provider rejected a short grant with private diagnostic');};
    await assert.rejects(h.one.grants.issue(h.actor,near.session_id),error=>error.httpStatus===503&&!error.message.includes('private diagnostic'));
    h.grantAdapter.hook=null;h.config.mediaUpload.grantTtlSeconds=1800;
    await h.one.sessions.cancel(h.actor,avatar.session_id);await h.one.sessions.cancel(h.actor,near.session_id);
    scenarios++;

    // An initialization that succeeded remotely but lost its reply is adopted, not repeated.
    const video=Buffer.from('0123456789abcdef0123456789abcdef01234567');const videoRequest=h.input(video,'video');
    h.cos.hook.begin=async()=>{throw new Error('simulated initialization reply loss');};const beforeBegins=h.cos.begins;
    const declared=await h.one.sessions.begin(h.actor,videoRequest);let row=await h.repo.findOneByOrFail({id:declared.session_id});
    assert.equal(row.uploadId,null);assert.equal(row.reasonCode,'UPLOAD_INITIALIZING');
    await h.one.sessions.begin(h.actor,videoRequest);assert.equal(h.cos.begins,beforeBegins+1);
    h.cos.hook.begin=null;await h.repo.update(row.id,{leaseUntil:new Date(Date.now()-1000)});
    const restored=await h.two.sessions.status(h.actor,row.id);row=await h.repo.findOneByOrFail({id:row.id});
    assert.ok(row.uploadId);assert.equal(h.cos.begins,beforeBegins+1);assert.equal(restored.session_id,declared.session_id);
    h.cos.tasks.get(row.uploadId).parts=[video.subarray(0,8)];
    assert.equal((await h.one.sessions.status(h.actor,row.id)).parts.length,1);
    await assert.rejects(h.one.sessions.complete(h.actor,row.id),error=>error.data?.reason_code==='UPLOAD_PARTS_INCOMPLETE');
    assert.equal((await h.repo.findOneByOrFail({id:row.id})).state,'uploading');
    const firstGrant=await h.one.grants.issue(h.actor,row.id);const secondGrant=await h.two.grants.issue(h.actor,row.id);
    assert.equal(firstGrant.upload_id,row.uploadId);assert.equal(secondGrant.upload_id,row.uploadId);
    assert.ok((await h.repo.findOneByOrFail({id:row.id})).lastCredentialExpiresAt);
    scenarios++;

    // Complete may also lose its reply. GET resolves the same staging version and one receipt.
    h.cos.tasks.get(row.uploadId).parts=Array.from({length:5},(_,index)=>video.subarray(index*8,(index+1)*8));
    h.cos.hook.complete=async()=>{throw new Error('simulated complete reply loss');};const beforeComplete=h.cos.completes;
    assert.equal((await h.one.sessions.complete(h.actor,row.id)).state,'finalizing');
    assert.equal((await h.one.sessions.cancel(h.actor,row.id)).state,'finalizing');
    await h.repo.update(row.id,{leaseUntil:new Date(Date.now()-1000)});h.cos.hook.complete=null;
    assert.equal((await h.two.sessions.status(h.actor,row.id)).state,'finalizing');
    assert.equal(h.cos.completes,beforeComplete+1);
    const beforeAssets=await h.assetCount();await Promise.all([h.one.finalizer.runOnce(),h.two.finalizer.runOnce()]);
    const receipt=await h.one.sessions.status(h.actor,row.id);assert.equal(receipt.state,'completed');assert.ok(receipt.result.asset_id);
    assert.deepEqual((await h.two.sessions.complete(h.actor,row.id)).result,receipt.result);assert.equal(await h.assetCount(),beforeAssets+1);
    scenarios++;

    // Bytes used for the real probe and publisher stay the same when staging is overwritten.
    const saved=await h.uploaded();const selected=await h.one.sessions.complete(h.actor,saved.row.id);
    assert.equal(selected.state,'finalizing');let rewrote=false;
    h.probe.hook=async()=>{if(!rewrote){rewrote=true;h.cos.place(saved.row.stagingLocator,Buffer.from('evil replacement'));}};
    await h.one.finalizer.runOnce();h.probe.hook=null;
    const completed=await h.one.sessions.status(h.actor,saved.row.id);assert.equal(completed.state,'completed');
    const asset=await h.source.getRepository(h.MediaAsset).findOneByOrFail({id:completed.result.asset_id});
    assert.equal(asset.sha256,sha(saved.body));assert.deepEqual(h.cos.find({key:asset.storageKey,versionId:asset.cosVersionId}).bytes,saved.body);
    scenarios++;

    // A stale process can finish its external write, but cannot create a second asset.
    const stale=await h.uploaded(Buffer.from('stale lease fixture'));await h.one.sessions.complete(h.actor,stale.row.id);
    let releaseProbe;let entered=false;h.probe.hook=async()=>{if(!entered){entered=true;await new Promise(resolve=>{releaseProbe=resolve;});}};
    const oldRun=h.one.finalizer.runOnce(1);await until(()=>entered);
    const oldClaim=(await h.repo.findOneByOrFail({id:stale.row.id})).claimId;await h.repo.update(stale.row.id,{leaseUntil:new Date(Date.now()-1000)});
    await h.two.finalizer.runOnce(1);releaseProbe();await oldRun;h.probe.hook=null;
    const staleDone=await h.repo.findOneByOrFail({id:stale.row.id});assert.equal(staleDone.state,'completed');assert.equal(staleDone.claimId,null);
    assert.ok(staleDone.candidateObjects.some(value=>value.claimId===oldClaim));
    const matching=await h.source.getRepository(h.MediaAsset).find({where:{uploadedBy:'9001',originalName:stale.request.filename,sha256:sha(stale.body)}});
    assert.equal(matching.length,1);
    scenarios++;

    // A cloud write committed before process death is recovered on its registered key.
    const crash=await h.uploaded(Buffer.from('candidate recovery fixture'));await h.one.sessions.complete(h.actor,crash.row.id);
    let releasePut;let wrote=false;const puts=h.cos.puts;
    h.cos.hook.put=async()=>{if(!wrote){wrote=true;await new Promise(resolve=>{releasePut=resolve;});}};
    const crashed=h.one.finalizer.runOnce(1);await until(()=>wrote);
    const originalCandidate=(await h.repo.findOneByOrFail({id:crash.row.id})).candidateObjects.find(value=>value.kind==='formal');
    let adopted=false;
    h.cos.hook.open=async locator=>{if(adopted&&locator.key===originalCandidate.locator.key)throw new Error('simulated stale publisher readback failure');};
    await h.repo.update(crash.row.id,{leaseUntil:new Date(Date.now()-1000)});
    await h.two.finalizer.runOnce(1);adopted=true;releasePut();await crashed;h.cos.hook.put=null;h.cos.hook.open=null;
    const recovered=await h.repo.findOneByOrFail({id:crash.row.id});
    assert.equal(recovered.state,'completed');assert.equal(h.cos.puts,puts+1,'recovery must not write a new candidate');
    const recoveredAsset=await h.source.getRepository(h.MediaAsset).findOneByOrFail({id:recovered.assetId});
    assert.ok(h.cos.find({key:recoveredAsset.storageKey,versionId:recoveredAsset.cosVersionId}),'a stale publisher failure cannot delete an adopted ready version');
    scenarios++;

    // Last credential expiry protects cancellation from a delayed PUT, then grace scans again.
    const late=await h.uploaded(Buffer.from('late request fixture'));const now=new Date();const last=new Date(now.getTime()+1000);
    await h.repo.update(late.row.id,{lastCredentialExpiresAt:last});await h.one.sessions.cancel(h.actor,late.row.id);
    h.cos.place(late.row.stagingLocator,late.body);await h.one.cleanup.runOnce(now);assert.ok(h.cos.objects.has(late.row.stagingLocator.key));
    await h.one.cleanup.runOnce(new Date(last.getTime()+1));assert.equal(h.cos.objects.has(late.row.stagingLocator.key),false);
    h.cos.place(late.row.stagingLocator,late.body);await h.two.cleanup.runOnce(new Date(last.getTime()+86400_000+1));
    assert.equal(h.cos.objects.has(late.row.stagingLocator.key),false);assert.ok((await h.repo.findOneByOrFail({id:late.row.id})).cleanedAt);
    scenarios++;

    // Cancellation during a real adapter's vendor wait cannot let cleanup race
    // a credential already being issued. Its reserved deadline owns both paths.
    const duringGrant=await h.uploaded(Buffer.from('cancel during STS fixture'));
    const sessionDeadline=new Date(Date.now()+12_000);await h.repo.update(duringGrant.row.id,{expiresAt:sessionDeadline});
    let releaseCredential;let actualExpiry;
    const realGrants=h.grantsWithProvider(options=>new Promise(resolve=>{
      releaseCredential=()=>{
        const startTime=Math.floor(Date.now()/1000);actualExpiry=new Date((startTime+options.durationSeconds)*1000);
        resolve({startTime,expiredTime:actualExpiry.getTime()/1000,requestId:'fixture',credentials:{tmpSecretId:'unusable-temporary-id',tmpSecretKey:'unusable-temporary-key',sessionToken:'unusable-temporary-token'}});
      };
    }));
    const inFlight=realGrants.issue(h.actor,duringGrant.row.id).then(grant=>({grant}),error=>({error}));
    await until(()=>releaseCredential);
    const reserved=await h.repo.findOneByOrFail({id:duringGrant.row.id});
    try {
      assert.equal(reserved.lastCredentialExpiresAt.getTime(),sessionDeadline.getTime());
      await h.two.sessions.cancel(h.actor,duringGrant.row.id);
      await h.two.cleanup.runOnce(new Date(reserved.lastCredentialExpiresAt.getTime()-1));
      assert.ok(h.cos.objects.has(duringGrant.row.stagingLocator.key),'reserved credential deadline must defer cleanup during STS');
    } finally {releaseCredential();}
    const withheld=await inFlight;
    assert.equal(withheld.error?.httpStatus,409);assert.equal(withheld.error?.data?.reason_code,'UPLOAD_ABORTED');
    assert.equal(withheld.grant,undefined);
    assert.ok(actualExpiry.getTime()<=reserved.lastCredentialExpiresAt.getTime());
    assert.ok(reserved.lastCredentialExpiresAt.getTime()<=reserved.expiresAt.getTime());
    await h.one.cleanup.runOnce(new Date(reserved.lastCredentialExpiresAt.getTime()+1));
    assert.equal(h.cos.objects.has(duringGrant.row.stagingLocator.key),false);
    scenarios++;

    // Revocation is rechecked even after the provider has generated a grant; the result is withheld.
    const revoked=await h.uploaded(Buffer.from('grant revocation fixture'));
    h.grantAdapter.hook=async()=>{await h.users.update('9001',{status:0});};await assert.rejects(h.one.grants.issue(h.actor,revoked.row.id),error=>error.httpStatus===403);
    h.grantAdapter.hook=null;await h.users.update('9001',{status:1,authVersion:1});await h.one.sessions.cancel(h.actor,revoked.row.id);
    scenarios++;

    // Content fingerprints are verified from bounded bytes, never copied from the client declaration.
    const invalid=await h.uploaded(Buffer.from('expected source'));h.cos.place(invalid.row.stagingLocator,Buffer.from('different bytes'));
    await h.one.sessions.complete(h.actor,invalid.row.id);const invalidBefore=await h.assetCount();await h.one.finalizer.runOnce();
    assert.equal((await h.repo.findOneByOrFail({id:invalid.row.id})).state,'failed');assert.equal(await h.assetCount(),invalidBefore);
    scenarios++;

    // Concurrent cancel/complete is serialized by MySQL; either winner leaves a coherent terminal state.
    const contested=await h.uploaded(Buffer.from('cancel race fixture'));const contestedCount=await h.assetCount();
    await Promise.all([h.one.sessions.complete(h.actor,contested.row.id),h.two.sessions.cancel(h.actor,contested.row.id)]);
    await h.one.finalizer.runOnce();const contest=await h.repo.findOneByOrFail({id:contested.row.id});
    assert.ok(['aborted','completed'].includes(contest.state));
    assert.equal(await h.assetCount(),contestedCount+(contest.state==='completed'?1:0));
    scenarios++;

    // An expired receipt becomes a request tombstone; exact published versions and references survive.
    await h.source.getRepository(h.MediaReference).insert({assetId:asset.id,ownerType:'sys_user_avatar',ownerId:'9001'});
    // Legacy unpinned rows also protect the key if bucket versioning was enabled later.
    await h.source.getRepository(h.MediaAsset).update(recoveredAsset.id,{cosVersionId:null});
    const receiptExpired=new Date(Date.now()-1);await h.repo.update(saved.row.id,{receiptExpiresAt:receiptExpired,cleanedAt:null});
    const removedBefore=h.cos.removed.filter(value=>value.key===asset.storageKey&&value.versionId===asset.cosVersionId).length;
    const countBefore=await h.assetCount();await h.one.cleanup.runOnce(new Date(Date.now()+31*86400_000));
    const tombstone=await h.one.sessions.begin(h.actor,saved.request);assert.equal(tombstone.state,'expired');assert.equal(tombstone.result,null);assert.equal(await h.assetCount(),countBefore);
    assert.equal(h.cos.removed.filter(value=>value.key===asset.storageKey&&value.versionId===asset.cosVersionId).length,removedBefore);assert.ok(h.cos.find({key:asset.storageKey,versionId:asset.cosVersionId}));
    assert.ok(h.cos.find({key:recoveredAsset.storageKey,versionId:recoveredAsset.cosVersionId}));
    scenarios++;
    return{scenarios};
  } finally {await h.close();}
}

export async function run(ctx) {
  const result=await verifyMediaUploadRaces({mysqlConfig:{host:ctx.env.DB_HOST,port:Number(ctx.env.DB_PORT),user:ctx.env.DB_USERNAME,password:ctx.env.DB_PASSWORD,database:ctx.env.DB_DATABASE},
    redisConfig:{host:ctx.env.REDIS_HOST,port:Number(ctx.env.REDIS_PORT)}});
  console.log(`上传会话真实事务/租约/回收竞争：${result.scenarios} 场景通过`);
}

async function standalone() {
  const services=await createEphemeralServices();const database=`ruleexam_test_upload_${randomBytes(5).toString('hex')}`;let admin;
  try {
    admin=await require('mysql2/promise').createConnection({...services.mysql,multipleStatements:true});
    await admin.query(renderSchemaForDatabase(await readFile(new URL('../database/init.sql',import.meta.url),'utf8'),database));
    const result=await verifyMediaUploadRaces({mysqlConfig:{...services.mysql,database},redisConfig:services.redis});
    console.log(`上传会话真实事务/租约/回收竞争：${result.scenarios} 场景通过`);
  } finally {if(admin){await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);await admin.end();}await services.cleanup();}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)standalone().catch(error=>{console.error(error);process.exitCode=1;});
