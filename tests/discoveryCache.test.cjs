const assert = require('node:assert/strict');
const {test} = require('node:test');
const {loadTypeScript} = require('./loadTypeScript.cjs');
const {createDiscoveryPageCache} = loadTypeScript('./src/lib/discoveryPageCache.ts');
const {discoverySearchUrl,parseDiscoveryPage} = loadTypeScript('./src/lib/openLibraryMetadata.ts');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const page=()=>parseDiscoveryPage({numFound:90,docs:[{key:'/works/OL1W',title:'A Book',author_name:['An Author'],cover_i:42,ia:['valid-id']}]});
let serial=0;
function fixture(shared=new Map(),scope=`cache-${serial++}`){
 let failRead=false,failWrite=false,gate;
 const io={storageKey:key=>`${scope}:${key}`,loadJSON:async key=>{if(failRead)throw Error('Unreadable cache');return JSON.parse(shared.get(`${scope}:${key}`)??'null');},saveJSONStrict:async(key,value)=>{if(gate)await gate;if(failWrite)throw Error('Disk full');shared.set(`${scope}:${key}`,JSON.stringify(value));}};
 let now=1000000;
 return {io,shared,cache:createDiscoveryPageCache(io,()=>now),advance:ms=>{now+=ms;},readFail:()=>{failRead=true;},writeFail:()=>{failWrite=true;},block:()=>{let release;gate=new Promise(done=>{release=done;});return release;}};
}
test('public catalog pages survive cache recreation and remain isolated by account',async()=>{
 const shared=new Map(),a=fixture(shared,'guest'),b=fixture(shared,'reader');const url=discoverySearchUrl('A Book','',1);
 await a.cache.write(url,page());const reopened=createDiscoveryPageCache(a.io,()=>1000000);const saved=await reopened.read(url);
 assert.equal(saved.page.books[0].title,'A Book');assert.equal(saved.page.books[0].id,'openlibrary-OL1W');assert.equal(saved.savedAt,1000000);assert.equal(await b.cache.read(url),undefined);
 assert.equal(await a.cache.read(discoverySearchUrl('Another book','',1)),undefined);
 assert.equal(await a.cache.read(discoverySearchUrl('A Book','',2)),undefined);
 assert.equal(await a.cache.read(discoverySearchUrl('A Book','',1,'descending')),undefined);
});
test('cache persists only safe metadata, never provider links, credentials or transient availability',async()=>{
 const f=fixture(),p=page();p.notice='unsafe-token';p.books[0]={...p.books[0],googleBooksKey:'private-key',epubUrl:'https://example.org/book.epub?key=private-key',description:'not needed',epubEditions:[{id:'google-1',epubUrl:'private-key'}],coverUrl:'https://covers.openlibrary.org/b/id/42-L.jpg?key=private-key'};
 await f.cache.write(discoverySearchUrl('A Book','',1),p);
 const raw=[...f.shared.values()].join('');assert.doesNotMatch(raw,/private-key|unsafe-token|epubEditions[^\]]*google/);
 const saved=await f.cache.read(discoverySearchUrl('A Book','',1));assert.equal(saved.page.books[0].coverUrl,'');assert.equal(saved.page.books[0].epubUrl,'');assert.deepEqual(saved.page.books[0].epubEditions,[]);
 await f.cache.write('https://openlibrary.org/search.json?q=books&key=private-key',page());assert.equal(f.shared.size,1);
});
test('cache bounds history, expires old entries and rejects malformed or non-Open-Library books',async()=>{
 const f=fixture();for(let n=0;n<14;n++)await f.cache.write(discoverySearchUrl(`book ${n}`,'',1),page());
 assert.equal(JSON.parse([...f.shared.values()][0]).pages.length,12);assert.equal(await f.cache.read(discoverySearchUrl('book 0','',1)),undefined);
 const wrong=page();wrong.books[0].id='openlibrary-OL2W';await f.cache.write(discoverySearchUrl('invalid','',1),wrong);assert.equal(await f.cache.read(discoverySearchUrl('invalid','',1)),undefined);
 const provider=page();provider.books[0].source='google';await f.cache.write(discoverySearchUrl('provider','',1),provider);assert.equal(await f.cache.read(discoverySearchUrl('provider','',1)),undefined);
 f.advance(8*24*60*60*1000);assert.equal(await f.cache.read(discoverySearchUrl('book 13','',1)),undefined);
});
test('concurrent writes retain both pages and reads wait for storage acknowledgement',async()=>{
 const f=fixture(),release=f.block();const a=discoverySearchUrl('first','',1),b=discoverySearchUrl('second','',1);
 const first=f.cache.write(a,page()),second=f.cache.write(b,page());let read=false;const load=f.cache.read(b).then(value=>{read=true;return value;});await flush();assert.equal(read,false);assert.equal(f.shared.size,0);
 release();await Promise.all([first,second]);assert.ok(await load);assert.ok(await f.cache.read(a));
});
test('unreadable optional cache does not claim saved results and writes surface their failure to callers',async()=>{
 const f=fixture();f.readFail();assert.equal(await f.cache.read(discoverySearchUrl('first','',1)),undefined);
 const full=fixture();full.writeFail();await assert.rejects(full.cache.write(discoverySearchUrl('first','',1),page()));assert.equal(full.shared.size,0);
 assert.equal(createDiscoveryPageCache({}),undefined);
});
