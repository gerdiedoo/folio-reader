const assert=require('node:assert/strict');
const {test}=require('node:test');
const {randomUUID}=require('node:crypto');
const {loadTypeScript}=require('./loadTypeScript.cjs');
const {createChunkedJsonStorage}=loadTypeScript(require('node:path').resolve(__dirname,'../src/lib/jsonChunks.ts'));
function driver(){const values=new Map();let failure,after=false;const native={async getItem(k){return values.get(k)??null;},async setItem(k,v){assert.ok(Buffer.byteLength(v)<=512*1024,'Native entries stay below Android cursor limits');if(k===failure&&!after)throw Error('No space');values.set(k,v);if(k===failure&&after)throw Error('Lost acknowledgement');},async removeItem(k){values.delete(k);}};return{values,native,store:createChunkedJsonStorage(native,randomUUID),fail:(key,uncertain=false)=>{failure=key;after=uncertain;}};}
const large=JSON.stringify({notes:'A 📖 thought. '.repeat(200000)});
test('multi-megabyte Unicode JSON survives segmented native storage and restart without splitting surrogate pairs',async()=>{
 const d=driver();await d.store.setItem('A',large);const pointer=JSON.parse(d.values.get('A'));assert.equal(pointer.format,'folio-json-chunks');assert.ok(pointer.parts>10);
 const restarted=createChunkedJsonStorage(d.native,randomUUID);assert.equal(await restarted.getItem('A'),large);
 await restarted.setItem('A',JSON.stringify({notes:'Small again'}));assert.equal(d.values.size,1);assert.deepEqual(JSON.parse(await restarted.getItem('A')),{notes:'Small again'});
});
for(const uncertain of [false,true])test(`failed pointer acknowledgement preserves ${uncertain?'possibly committed new':'confirmed old'} data and restart remains readable`,async()=>{
 const d=driver();await d.store.setItem('A',JSON.stringify({notes:'Confirmed'}));d.fail('A',uncertain);await assert.rejects(d.store.setItem('A',large));
 const restarted=createChunkedJsonStorage(d.native,randomUUID);assert.equal(await restarted.getItem('A'),uncertain?large:JSON.stringify({notes:'Confirmed'}));
});
test('a segment failure never publishes a partially written archive',async()=>{
 const d=driver();await d.store.setItem('A','[]');const write=d.native.setItem;let count=0;d.native.setItem=async(k,v)=>{if(k.includes('.chunk.')&&++count===2)throw Error('Full');return write(k,v);};
 await assert.rejects(d.store.setItem('A',large));assert.equal(await d.store.getItem('A'),'[]');assert.equal(d.values.size,1);
});
test('a read holds its immutable segments until complete before a queued replacement cleans them up',async()=>{
 const d=driver();await d.store.setItem('A',large);const read=d.native.getItem;let release,blocked=true;const started=new Promise(done=>{d.native.getItem=async k=>{if(blocked&&k.includes('.chunk.')){blocked=false;done();await new Promise(resolve=>release=resolve);}return read(k);};});
 const reading=d.store.getItem('A');await started;const saving=d.store.setItem('A','[]');await new Promise(done=>setImmediate(done));release();assert.equal(await reading,large);await saving;assert.equal(await d.store.getItem('A'),'[]');assert.equal(d.values.size,1);
});
test('scope keys never share segments and malformed or missing segment data blocks safely',async()=>{
 const d=driver();await d.store.setItem('A',large);await d.store.setItem('B','[]');assert.equal(await d.store.getItem('B'),'[]');
 const key=[...d.values.keys()].find(k=>k.startsWith('A.chunk.'));d.values.delete(key);await assert.rejects(d.store.getItem('A'),/missing or damaged/);assert.equal(await d.store.getItem('B'),'[]');
});
