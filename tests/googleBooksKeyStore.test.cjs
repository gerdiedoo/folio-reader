const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createGoogleBooksKeyStore } = loadTypeScript(path.resolve(__dirname, '../src/lib/googleBooksKeyStore.ts'));
const digest = async text => createHash('sha256').update(text).digest('hex');
const key = 'reader-key-01234567890123456789';
function fixture() {
 const values = new Map(); let fail = false;
 const secure = { getItemAsync: async id => values.get(id) ?? null, setItemAsync: async (id,value) => { if (!fail) values.set(id,value); }, deleteItemAsync: async id => { if (!fail) values.delete(id); } };
 return { values, store: scope => createGoogleBooksKeyStore(scope,secure,digest), fail: () => { fail = true; } };
}
test('Google keys remain separate across accounts, Guests and backends without exposing scope names', async () => {
 const f=fixture(), a=f.store('production:user-A'), b=f.store('production:user-B'), guest=f.store('production:guest'), dev=f.store('development:user-A');
 await a.save(key); assert.equal(await a.load(),key);
 for(const other of [b,guest,dev])assert.equal(await other.load(),null);
 assert.equal([...f.values.keys()].some(id=>id.includes('user-A')||id.includes('production')),false);
 await b.save('another-key-01234567890123456789');await a.remove();assert.equal(await a.load(),null);assert.notEqual(await b.load(),null);
});
test('key replacement and deletion require native storage acknowledgement', async () => {
 const f=fixture(),store=f.store('account');await store.save(key);f.fail();
 await assert.rejects(store.save('replacement-key-01234567890123456789'),/confirmed/);assert.equal(await store.load(),key);
 await assert.rejects(store.remove(),/confirmed/);assert.equal(await store.load(),key);
 await assert.rejects(store.save('not an API key'),/valid/);
});

test('a temporary native key-name failure can be retried without losing the reading space',async()=>{
 let calls=0;const secure={getItemAsync:async()=>null,setItemAsync:async()=>{},deleteItemAsync:async()=>{}};
 const store=createGoogleBooksKeyStore('account',secure,async value=>{if(++calls===1)throw Error('Native crypto not ready');return digest(value);});
 await assert.rejects(store.load(),/not ready/);assert.equal(await store.load(),null);assert.equal(calls,2);
});
