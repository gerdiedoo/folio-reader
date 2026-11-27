const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createDiscoveryCatalog } = loadTypeScript('./src/lib/discoveryCatalog.ts');
const { createOpenLibraryRequest } = loadTypeScript('./src/lib/openLibraryRequest.ts');
const { CatalogError } = loadTypeScript('./src/lib/catalogRequest.ts');
const { parseDiscoveryPage, discoverySearchUrl, matchingDiscoveryWork, mergeDiscoveryBooks, discoveryWorkDetails, openLibraryCover } = loadTypeScript('./src/lib/openLibraryMetadata.ts');
const flush = () => new Promise(resolve => setImmediate(resolve));
const doc = (id = 1, patch = {}) => ({ key: `/works/OL${id}W`, title: 'Frankenstein', author_name: ['Mary Shelley'], cover_i: 42, first_publish_year: 1818, edition_count: 120, ...patch });
const metadata = docs => ({ numFound: docs.length, docs });
const work = patch => ({ ...parseDiscoveryPage(metadata([doc()])).books[0], ...patch });
const edition = (source = 'gutenberg', patch = {}) => ({ id: `${source}-1`, source, title: 'Frankenstein', author: 'Mary Shelley', coverUrl: 'https://provider.example/cover.jpg', epubUrl: '', downloads: 0, subjects: [], ...patch });
function fixture(overrides = {}) {
 const events = [];
 const deps = {
  metadata: async (url, signal) => { events.push(['metadata',url,signal]); return metadata([doc()]); },
  search: async (opts, signal) => { events.push(['search',opts,signal]); return { books: [edition(opts.source)], hasMore: false, total: 1 }; },
  details: async (book, signal) => { events.push(['details',book,signal]); return book; },
  links: async (book, signal) => { events.push(['links',book,signal]); return ['https://provider.example/book.epub']; }, ...overrides,
 };
 return { events, deps, ...createDiscoveryCatalog(deps) };
}
test('the default catalog contains contemporary metadata-only works without requiring public scans or an EPUB', async () => {
 const f = fixture({ metadata: async () => ({ docs: [doc(1,{title:'A contemporary book',first_publish_year:2024,ebook_access:'no_ebook',ia:[]})], numFound:1000000 }) });
 const page = await f.search({}); assert.equal(page.books.length,1); assert.equal(page.total,1000000); assert.equal(page.hasMore,true);
 assert.equal(page.books[0].publicationYear,2024); assert.equal(page.books[0].epubUrl,''); assert.deepEqual(page.books[0].epubEditions,[]);
 const url = new URL(discoverySearchUrl('', '', 1)); assert.equal(url.searchParams.get('q'),'*:*'); assert.doesNotMatch(url.search,/public_scan|ebook_access/);
 assert.equal(new URL(discoverySearchUrl('作者 OR *:*', '', 2,'descending')).searchParams.get('sort'),'new');
 assert.ok(new URL(discoverySearchUrl('作者 OR *:*', '', 2)).searchParams.get('q').includes('作者'));
 assert.equal(f.events.length,0);
});
test('Open Library covers use checked numeric IDs and 404 for missing images; metadata parsing validates works', () => {
 assert.equal(openLibraryCover(42),'https://covers.openlibrary.org/b/id/42-L.jpg?default=false');
 for (const id of [0,-1,'42',Infinity,1.5]) assert.equal(openLibraryCover(id),'');
 const p = parseDiscoveryPage(metadata([doc(1,{cover_i:0}),doc(2,{cover_i:99})])); assert.equal(p.books[0].coverUrl,''); assert.match(p.books[1].coverUrl,/99-L/);
 assert.throws(()=>parseDiscoveryPage({docs:[{key:'/books/OL1M',title:'Edition'}],numFound:1}));
 assert.throws(()=>parseDiscoveryPage({docs:[],numFound:'1'}));
 const detailed=discoveryWorkDetails({key:'/works/OL1W',description:{value:'<p>Book description.</p>'},covers:[-1,88],subjects:['Fiction']},work({coverUrl:''}));
 assert.match(detailed.coverUrl,/88-L/); assert.equal(detailed.description,'<p>Book description.</p>');
 assert.throws(()=>discoveryWorkDetails({key:'/works/OL2W'},work()));
});
test('matching rejects shared titles with different authors and incompatible subtitles or volumes', () => {
 assert.equal(matchingDiscoveryWork(work(),edition('standard',{title:'Frankenstein; or, The Modern Prometheus',author:'Shelley, Mary, 1797–1851'})),true);
 assert.equal(matchingDiscoveryWork(work(),edition('gutenberg',{author:'John Smith'})),false);
 assert.equal(matchingDiscoveryWork(work(),edition('gutenberg',{author:'Unknown Author'})),false);
 assert.equal(matchingDiscoveryWork(work({title:'The City: New York'}),edition('gutenberg',{title:'The City: Paris'})),false);
 assert.equal(matchingDiscoveryWork(work({title:'The City: Volume 1'}),edition('gutenberg',{title:'The City: Volume 2'})),false);
 assert.equal(matchingDiscoveryWork(work({title:'Pride & Prejudice',author:'Jane Austen',authors:['Jane Austen']}),edition('standard',{title:'Pride and Prejudice',author:'Austen, Jane'})),true);
});
test('source filters query the actual provider, batch Open Library metadata, merge editions and retain its pagination', async () => {
 const seed=edition(), other=edition('gutenberg',{id:'gutenberg-2',author:'Mary Wollstonecraft Shelley'});
 const f=fixture({search:async opts=>{assert.equal(opts.source,'gutenberg');return {books:[seed,other],hasMore:true,total:900};}});
 const page=await f.search({source:'gutenberg',query:'Frankenstein',page:2});
 assert.equal(page.books.length,1); assert.equal(page.books[0].id,'openlibrary-OL1W'); assert.equal(page.books[0].epubEditions.length,2);
 assert.match(page.books[0].coverUrl,/covers.openlibrary.org/); assert.equal(page.hasMore,true); assert.equal(page.total,null);
 assert.match(page.notice,/Availability is checked/); assert.equal(f.events.filter(e=>e[0]==='metadata').length,1);
 const merged=mergeDiscoveryBooks([page.books[0]],[{...page.books[0],epubEditions:[edition('standard')]}]); assert.equal(merged[0].epubEditions.length,3);
});
test('unmatched and failed Open Library enrichment keeps usable source titles with typography covers', async () => {
 for(const failure of [false,true]) {
  const f=fixture({metadata:async()=>{if(failure)throw new CatalogError('network');return metadata([doc(1,{author_name:['A different author']})]);}});
  const page=await f.search({source:'standard'}); assert.equal(page.books[0].id,'standard-1'); assert.equal(page.books[0].coverUrl,''); assert.equal(page.books[0].catalogKind,'work');
  assert.equal(page.books[0].epubEditions.length,1); if(failure)assert.match(page.notice,/metadata could not be loaded/);
 }
});
test('a metadata-only book opens its description without searching or requiring an EPUB', async () => {
 const f=fixture({metadata:async url=>{assert.equal(url,'https://openlibrary.org/works/OL1W.json');return {key:'/works/OL1W',description:'A description.'};}});
 assert.equal((await f.details(work())).description,'A description.'); assert.equal(f.events.length,0);
});
test('availability matches work and author, verifies source links, and distinguishes source outages from no match', async () => {
 const f=fixture(); const available=await f.checkSource(work(),'standard'); assert.equal(available.state,'available'); assert.equal(available.editions[0].source,'standard');
 assert.ok(f.events.some(e=>e[0]==='links'));
 const mismatch=fixture({search:async()=>({books:[edition('standard',{author:'Someone else'})],hasMore:false,total:1})});
 assert.equal((await mismatch.checkSource(work(),'standard')).state,'not-found'); assert.equal(mismatch.events.length,0);
 const offline=fixture({search:async()=>{throw new CatalogError('network');}}); assert.equal((await offline.checkSource(work(),'archive')).state,'error');
 const unavailable=fixture({links:async()=>{throw new CatalogError('unavailable');}}); assert.equal((await unavailable.checkSource(work(),'archive')).state,'not-found');
 const broken=fixture({links:async()=>{throw new CatalogError('service',503);}}); assert.equal((await broken.checkSource(work(),'archive')).state,'error');
});
test('known source editions can match anonymous works, and Archive candidates must belong to the linked work', async () => {
 const seed=edition('gutenberg',{author:'Unknown Author'}), w=work({author:'Unknown Author',authors:[],epubEditions:[seed]});
 assert.equal((await fixture().checkSource(w,'gutenberg')).state,'available');
 const f=fixture(); assert.equal((await f.checkSource(work({archiveIds:['linked-id']}),'archive')).state,'available');
 assert.equal(f.events.some(e=>e[0]==='search'),false); assert.equal(f.events.find(e=>e[0]==='details')[1].id,'archive-linked-id');
});
test('Google access is reader-specific, missing keys need setup, and changing a key never reuses an availability result', async () => {
 const keys=[]; const f=fixture({search:async opts=>{keys.push(opts.googleBooksKey);return {books:[edition('google')],hasMore:false,total:1};}});
 assert.equal((await f.checkSource(work(),'google')).state,'key-required'); assert.equal(keys.length,0);
 await f.checkSource(work(),'google',undefined,{googleBooksKey:'reader-one-synthetic'});
 await f.checkSource(work(),'google',undefined,{googleBooksKey:'reader-two-synthetic'});
 assert.deepEqual(keys,['reader-one-synthetic','reader-two-synthetic']);
});
test('unavailable candidates do not hide a later compatible edition, and source checks are bounded', async () => {
 let links=0;
 const f=fixture({search:async()=>({books:Array.from({length:20},(_,i)=>edition('standard',{id:`standard-${i}`})),hasMore:false,total:20}),links:async()=>{links++;if(links===1)throw new CatalogError('unavailable');return ['https://standardebooks.org/book.epub'];}});
 const result=await f.checkSource(work(),'standard');assert.equal(result.editions.length,2);assert.equal(links,3);
});
test('cancelled metadata or provider checks cannot return late catalog or availability results', async () => {
 let finish; const controller=new AbortController();
 const f=fixture({search:async()=>new Promise(resolve=>{finish=resolve;})});
 const pending=f.checkSource(work(),'standard',controller.signal);await flush();controller.abort();finish({books:[edition('standard')],hasMore:false,total:1});
 await assert.rejects(pending,{name:'AbortError'});
 const pre=new AbortController();pre.abort();await assert.rejects(f.search({},pre.signal),{name:'AbortError'});
});
test('Open Library request slots are paced and cached without caching cancelled responses', async () => {
 let now=0;const timers=[],calls=[];
 const request=createOpenLibraryRequest(async (...args)=>{calls.push(args);return {key:args[0]};},()=>now,(fn,ms)=>{timers.push({fn,ms});return 1;});
 assert.deepEqual(await request('first'),{key:'first'});await request('first');assert.equal(calls.length,1);assert.equal(calls[0][3],1);
 const controller=new AbortController();const second=request('second',controller.signal);await flush();assert.equal(timers[0].ms,1100);
 controller.abort();await assert.rejects(second,{name:'AbortError'});now+=1100;timers.shift().fn();await flush();assert.equal(calls.length,1);
 assert.deepEqual(await request('third'),{key:'third'});assert.equal(calls.length,2);
 now+=120001;await request('first');assert.equal(calls.length,3);
});
