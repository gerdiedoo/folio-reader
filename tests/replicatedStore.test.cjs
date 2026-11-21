const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { loadTypeScript } = require('./loadTypeScript.cjs');
const load = name => loadTypeScript(path.resolve(__dirname, '../src/lib/' + name + '.ts'));
const { createReplicatedStore } = load('replicatedStore');
const { createHighlightArchive } = load('highlightArchive');
const { createLibraryStore } = load('libraryStore');
const { createReaderSettingsStore } = load('readerSettingsStore');
let serial = 0;
const note = (id = 'n', text = 'Original') => ({ id, bookId: 'b', bookTitle: 'Book', chapter: 'One', page: 1, text, colorName: 'Amber Crayon', colorHex: '#F8E8A2', dateAdded: '2026-11-21' });
const book = () => ({ id: 'b', title: 'Book', author: 'Author', coverUrl: 'file:///private/cover.png', fileLocation: 'file:///private/book.epub', coverAlt: '', currentPage: 1, totalPages: 5, minutesLeft: 10, currentChapter: 'One', lastOpened: '', progressPercent: 0 });
function device(data = new Map(), scope = `device-${++serial}:`) {
 let fail = false, uncertain = false;
 const base = { storageKey: key => scope + key, async loadJSONEntryStrict(key) { const raw = data.get(scope + key); return raw === undefined ? { present: false, value: null } : { present: true, value: JSON.parse(raw) }; },
  async saveJSONStrict(key, value) { if (fail) throw Error('Storage full'); data.set(scope + key, JSON.stringify(value)); if (uncertain) throw Error('Lost storage acknowledgement'); } };
 const make = () => createReplicatedStore(base, randomUUID, true), store = make();
 return { base, store, data, make, scope, highlights: createHighlightArchive(store), library: createLibraryStore(store), fail: v => { fail = v; }, uncertain: v => { uncertain = v; } };
}
function server() {
 const rows = new Map(); let change = 0;
 const save = (kind, id, payload, revision, mutationId) => { const row = { kind, id, payload, revision, mutationId, changeId: ++change }; rows.set(kind + ':' + id, row); return row; };
 const send = operation => {
  const { kind, id, pending } = operation, old = rows.get(kind + ':' + id);
  if (old?.mutationId === pending.token) return { accepted: true, record: old };
  if ((old?.revision ?? 0) !== pending.baseRevision) return { accepted: false, record: old };
  const parent = pending.payload?.bookId && rows.get('book:' + pending.payload.bookId);
  if (parent?.payload === null && kind !== 'book') return { accepted: false, record: save(kind,id,null,(old?.revision ?? 0)+1,randomUUID()) };
  const record = save(kind,id,pending.payload,(old?.revision ?? 0)+1,pending.token);
  if (kind === 'book' && pending.payload === null) for (const row of [...rows.values()]) if (row.payload?.bookId === id) save(row.kind,row.id,null,row.revision+1,randomUUID());
  return { accepted: true, record };
 };
 return { rows, send, feed: kind => [...rows.values()].filter(r => r.kind === kind).sort((a,b) => a.changeId-b.changeId), async flush(d) { for (const pending of await d.store.replication.pending()) { const result = send(pending); await d.store.replication.acknowledge(pending.kind,pending.id,pending.pending,result.record,result.accepted); } } };
}

test('saved records and upload intentions persist together across restart; device paths and pixels never enter cloud payloads', async () => {
 const d = device(); await d.library.add({ ...book(), readingPosition: { pageNumber: 1, scroll: { offset: 20, layout: 'screen' } } }); await d.highlights.add(note());
 const restarted = d.make(), pending = await restarted.replication.pending(); assert.equal(pending.length, 2);
 const payload = pending.find(p => p.kind === 'book').pending.payload;
 assert.equal(payload.fileLocation, undefined); assert.equal(payload.coverUrl, ''); assert.equal(payload.readingPosition.scroll, undefined);
 assert.equal((await createLibraryStore(restarted).load()).books[0].fileLocation, 'file:///private/book.epub');
 assert.equal((await createHighlightArchive(restarted).load()).items[0].text, 'Original');
});

test('failed atomic writes leave both the confirmed record and its pending upload unchanged', async () => {
 const d = device(); await d.highlights.add(note()); const previous = JSON.stringify([...d.data]); d.fail(true);
 await assert.rejects(d.highlights.note('n','Unsaved edit')); assert.equal(JSON.stringify([...d.data]), previous);
 assert.equal((await d.highlights.load()).items[0].note, undefined); d.fail(false); await d.highlights.note('n','Saved edit');
 assert.equal((await d.store.replication.pending())[0].pending.payload.note, 'Saved edit');
});

test('a lost network acknowledgement retries the same mutation once without duplicate records or revisions', async () => {
 const d = device(), s = server(); await d.highlights.add(note()); const [pending] = await d.store.replication.pending(); s.send(pending);
 const restarted = d.make(), [again] = await restarted.replication.pending(); assert.equal(again.pending.token, pending.pending.token);
 const result = s.send(again); await restarted.replication.acknowledge(again.kind,again.id,again.pending,result.record,true);
 assert.equal(s.rows.get('highlight:n').revision, 1); assert.equal((await restarted.replication.status()).pending, 0);
});

test('an older in-flight save cannot clear a newer local edit; its acknowledgement rebases only that subsequent edit', async () => {
 const d = device(), s = server(); await d.highlights.add(note()); const [old] = await d.store.replication.pending();
 await d.highlights.note('n','New reflection'); const result = s.send(old);
 await d.store.replication.acknowledge(old.kind,old.id,old.pending,result.record,true);
 const [newer] = await d.store.replication.pending(); assert.notEqual(newer.pending.token, old.pending.token); assert.equal(newer.pending.baseRevision, 1); assert.equal(newer.pending.payload.note, 'New reflection');
 await s.flush(d); assert.equal(s.rows.get('highlight:n').payload.note, 'New reflection'); assert.equal((await d.store.replication.status()).pending, 0);
});

for (const choice of ['device','account']) test(`competing saved edits preserve both versions until an explicit ${choice} choice`, async () => {
 const a = device(), b = device(), s = server(); await a.highlights.add(note()); await s.flush(a); await b.store.replication.pull('highlight',s.feed('highlight'));
 await a.highlights.note('n','Reflection A'); await b.highlights.note('n','Reflection B'); await s.flush(a); await s.flush(b);
 const [conflict] = (await b.store.replication.status()).conflicts; assert.equal(conflict.device.note, 'Reflection B'); assert.equal(conflict.account.payload.note, 'Reflection A');
 assert.equal((await b.highlights.load()).items[0].note, 'Reflection B');
 await b.store.replication.resolve(conflict.kind,conflict.id,conflict.token,conflict.account.revision,choice);
 await s.flush(b); assert.equal((await b.highlights.load()).items[0].note, choice === 'device' ? 'Reflection B' : 'Reflection A');
 assert.equal(s.rows.get('highlight:n').payload.note, choice === 'device' ? 'Reflection B' : 'Reflection A');
});

test('a review choice based on an obsolete version cannot overwrite a newly saved edit', async () => {
 const d = device(); await d.highlights.add(note());
 await d.store.replication.pull('highlight',[{ kind:'highlight',id:'n',revision:2,mutationId:randomUUID(),changeId:3,payload:note('n','Account') }]);
 const [old] = (await d.store.replication.status()).conflicts; await d.highlights.note('n','Later local edit');
 await assert.rejects(d.store.replication.resolve('highlight','n',old.token,2,'account'),/changed while/);
 assert.equal((await d.highlights.load()).items[0].note,'Later local edit');
});

test('parent removal becomes a persistent server tombstone; an unknown stale child cannot recreate itself', async () => {
 const a = device(), b = device(), s = server(); await a.library.add(book()); await a.highlights.add(note()); await s.flush(a);
 await b.store.replication.pull('book',s.feed('book')); await b.store.replication.pull('highlight',s.feed('highlight'));
 await b.highlights.add(note('offline','Offline work'));
 await a.highlights.removeBook('b'); await a.library.remove('b'); await s.flush(a); await s.flush(b);
 const conflict = (await b.store.replication.status()).conflicts.find(c => c.id === 'offline');
 assert.equal(conflict.account.payload,null); assert.equal(conflict.device.text,'Offline work');
 assert.equal(s.rows.get('book:b').payload,null); assert.equal(s.rows.get('highlight:n').payload,null); assert.equal((await b.highlights.load()).items.some(n => n.id === 'offline'),true);
});

test('remote removal of a downloaded original stays available for review before local deletion', async () => {
 const d = device(), s = server(); await d.library.add(book()); await s.flush(d);
 await d.store.replication.pull('book',[{kind:'book',id:'b',payload:null,revision:2,changeId:2,mutationId:randomUUID()}]);
 assert.equal((await d.library.load()).books.length,1); const [conflict] = (await d.store.replication.status()).conflicts;
 await d.store.replication.resolve('book','b',conflict.token,2,'account'); assert.equal((await d.library.load()).books.length,0); assert.equal((await d.library.load()).pendingFileRemovals[0].id,'b');
});

test('remote change cursors advance with their data and never advance merely because a local upload was acknowledged', async () => {
 const d = device(), s = server(); await d.highlights.add(note()); await s.flush(d); assert.equal(await d.store.replication.cursor('highlight'),0);
 await d.store.replication.pull('highlight',s.feed('highlight')); assert.equal(await d.store.replication.cursor('highlight'),1);
 const last = JSON.stringify([...d.data]); d.fail(true);
 await assert.rejects(d.store.replication.pull('highlight',[{kind:'highlight',id:'other',payload:note('other'),revision:1,changeId:4,mutationId:randomUUID()}]));
 assert.equal(JSON.stringify([...d.data]),last); assert.equal(await d.store.replication.cursor('highlight'),1);
});

test('legacy account records remain intact while the first replicated write migrates safely; unknown remote versions create a conflict', async () => {
 const d = device(); await d.base.saveJSONStrict('highlights',[note()]); await d.highlights.note('n','Local reflection');
 assert.equal((await d.base.loadJSONEntryStrict('highlights')).value[0].note,undefined);
 await d.store.replication.pull('highlight',[{kind:'highlight',id:'n',revision:1,payload:note(),changeId:1,mutationId:randomUUID()}]);
 assert.equal((await d.store.replication.status()).conflicts.length,1); assert.equal((await d.highlights.load()).items[0].note,'Local reflection');
});

test('Guest/account/backend scopes keep independent records and pending mutations', async () => {
 const data = new Map(), a = device(data,'A:'), b = device(data,'B:');
 await a.highlights.add(note('same','A')); await b.highlights.add(note('same','B'));
 assert.equal((await a.store.replication.pending())[0].pending.payload.text,'A'); assert.equal((await b.store.replication.pending())[0].pending.payload.text,'B');
 const guest = createReplicatedStore(a.base,randomUUID,false); await guest.saveJSONStrict('goal',{minutesReadToday:10}); assert.equal((await guest.replication.status()).pending,0);
});

test('preferences use the same durable conflict protocol and keep locally saved settings while review is pending', async () => {
 const a = device(), b = device(), s = server(), prefsA = createReaderSettingsStore(a.store), prefsB = createReaderSettingsStore(b.store);
 await prefsA.patch({theme:'charcoal'}); await s.flush(a); await b.store.replication.pull('settings',s.feed('settings'));
 assert.equal((await prefsB.load()).settings.theme,'charcoal');
 await prefsA.patch({fontSizeStep:6}); await prefsB.patch({theme:'sepia'}); await s.flush(a); await s.flush(b);
 assert.equal((await b.store.replication.status()).conflicts.length,1); assert.equal((await prefsB.load()).settings.theme,'sepia');
});

test('an uncertain local create acknowledgement can be retried with the same identity without duplicates', async () => {
 const {createRetryableWriter}=load('retryableCreate'); const d=device(); let generated=0;
 const writer=createRetryableWriter(draft=>({...draft,id:'retry-'+(++generated)}),async entry=>{try{await d.highlights.add(entry);return true;}catch{return false;}});
 const draft=note(); delete draft.id; d.uncertain(true); assert.equal(await writer(draft),false); d.uncertain(false);
 assert.equal(await writer(draft),true); assert.equal(generated,1); assert.equal((await d.highlights.load()).items.length,1);
 assert.equal((await d.store.replication.pending()).length,1);
});
test('a damaged pending payload blocks synchronization without altering existing saved work',async()=>{
 const d=device();await d.highlights.add(note()); const key=d.scope+'replica:highlightArchive', corrupted=JSON.parse(d.data.get(key));
 corrupted.states[0].pending.payload={id:'n',text:'Lost metadata'};d.data.set(key,JSON.stringify(corrupted));const before=d.data.get(key);
 await assert.rejects(d.make().replication.pending());assert.equal(d.data.get(key),before);
});
test('matching account progress keeps this device’s measured pixels; other positions drop them',async()=>{
 const d=device(), s=server();const saved={...book(),readingPosition:{pageNumber:1,wordOffset:2,scroll:{offset:33,layout:'phone'}}};await d.library.add(saved);await s.flush(d);
 const original=s.feed('book')[0]; await d.store.replication.pull('book',[{...original,revision:2,changeId:2,payload:{...original.payload,title:'Renamed'}}]);
 assert.equal((await d.library.load()).books[0].readingPosition.scroll.offset,33);
 await d.store.replication.pull('book',[{...original,revision:3,changeId:3,payload:{...original.payload,readingPosition:{pageNumber:2,wordOffset:5}}}]);
 assert.equal((await d.library.load()).books[0].readingPosition.scroll,undefined);
});
