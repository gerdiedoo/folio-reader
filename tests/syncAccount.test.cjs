const assert=require('node:assert/strict');
const {test}=require('node:test');
const {randomUUID}=require('node:crypto');
const path=require('node:path');
const {loadTypeScript}=require('./loadTypeScript.cjs');
const load=name=>loadTypeScript(path.resolve(__dirname,'../src/lib/'+name+'.ts'));
const {createReplicatedStore}=load('replicatedStore');
const {createSyncAccountRepository}=load('syncAccount');
const {createHighlightArchive}=load('highlightArchive');
let serial=0;
function setup(){
 const map=new Map(), key='transport-'+(++serial)+':';
 const store=createReplicatedStore({storageKey:k=>key+k,async loadJSONEntryStrict(k){return map.has(k)?{present:true,value:JSON.parse(map.get(k))}:{present:false,value:null};},async saveJSONStrict(k,v){map.set(k,JSON.stringify(v));}},randomUUID,true);
 const state={user:'A',rows:[],rpc:[],reads:[],error:null,switchDuringRequest:false};
 const client={auth:{async getSession(){return{data:{session:state.user?{user:{id:state.user}}:null},error:null};}},rpc(name,args){
  state.rpc.push({name,args});if(state.switchDuringRequest)state.user='B';
  const denied=state.user!==args.p_owner;
  return{abortSignal(){return Promise.resolve({data:denied?null:{accepted:true,record:{kind:args.p_kind,id:args.p_id,payload:args.p_payload,revision:args.p_expected_revision+1,mutation_id:args.p_mutation_id,change_id:state.rpc.length}},error:denied?{message:'Wrong owner'}:state.error});}};
 },from(table){const query={table,filters:[]};state.reads.push(query);const b={select(){return b;},eq(k,v){query.filters.push([k,v]);return b;},gt(k,v){query.cursor=v;return b;},order(){return b;},limit(){return b;},abortSignal(){return Promise.resolve({data:state.rows.filter(r=>r.kind===query.filters.find(([k])=>k==='kind')[1]&&r.change_id>query.cursor).slice(0,500),error:state.error});}};return b;}};
 const cloud=createSyncAccountRepository(client,'A',store);return{state,store,cloud,archive:createHighlightArchive(store)};
}
const note={id:'n',bookId:'b',bookTitle:'Book',chapter:'One',page:1,text:'Original',colorName:'Amber',colorHex:'#F8E8A2',dateAdded:''};
test('transport flush reads the latest durable intention rather than a stale callback argument',async()=>{
 const d=setup();await d.archive.add(note);await d.archive.note('n','Latest reflection');
 await d.cloud.upsertHighlightToSupabase({...note,note:'Obsolete'});
 assert.equal(d.state.rpc[0].args.p_payload.note,'Latest reflection');assert.equal(d.state.rpc[0].args.p_owner,'A');assert.equal((await d.store.replication.status()).pending,0);
});
test('migration/network failure keeps durable mutations retryable across repository restart',async()=>{
 const d=setup();await d.archive.add(note);d.state.error={message:'RPC missing'};assert.equal(await d.cloud.sync.flush(),false);
 const token=(await d.store.replication.pending())[0].pending.token;assert.match(d.cloud.sync.error(),/kept/);
 d.state.error=null;await d.cloud.sync.flush();assert.equal(d.state.rpc[1].args.p_mutation_id,token);assert.equal((await d.store.replication.status()).pending,0);
});
test('account change between session check and request cannot acknowledge or transfer old-scope work',async()=>{
 const d=setup();await d.archive.add(note);d.state.switchDuringRequest=true;assert.equal(await d.cloud.sync.flush(),false);
 assert.equal(d.state.rpc[0].args.p_owner,'A');assert.equal((await d.store.replication.status()).pending,1);assert.equal((await d.archive.load()).items[0].text,'Original');
 await assert.rejects(d.cloud.sync.cycle(),/Sign in again/);assert.equal(d.state.rpc.length,1);
});
test('incremental pulls scope owner and kind and commit the change cursor with validated data',async()=>{
 const d=setup();d.state.rows=[{kind:'highlight',id:'n',payload:note,revision:1,mutation_id:randomUUID(),change_id:12}];
 await d.cloud.sync.pull('highlight');assert.equal(await d.store.replication.cursor('highlight'),12);assert.equal((await d.archive.load()).items.length,1);
 assert.deepEqual(d.state.reads[0].filters,[['user_id','A'],['kind','highlight']]);await d.cloud.sync.pull('highlight');assert.equal(d.state.reads[1].cursor,12);
 d.cloud.sync.stop();await d.archive.note('n','After leaving');assert.equal(await d.cloud.sync.flush(),false);assert.equal(d.state.rpc.length,0);
});
