const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createBookPageCache } = loadTypeScript(path.resolve(__dirname, '../src/lib/bookPageCache.ts'));
test('text loading is lazy, concurrent opens share a read, and only two books remain cached', async () => {
 let calls = [], release; const gate = new Promise(done => { release = done; });
 const cache = createBookPageCache(async id => { calls.push(id); if (id === 'a') await gate; return [{ pageNumber: 1, paragraph1: id }]; });
 assert.deepEqual(calls, []); assert.deepEqual(cache.snapshot(), {});
 const first = cache.load('a'), again = cache.load('a'); assert.equal(first, again); release(); await first;
 await cache.load('b'); await cache.load('a'); await cache.load('c');
 assert.deepEqual(calls, ['a','b','c']); assert.deepEqual(Object.keys(cache.snapshot()), ['a','c']);
 await cache.load('b'); assert.deepEqual(calls, ['a','b','c','b']); assert.equal(Object.keys(cache.snapshot()).length, 2);
});
test('failed/missing text reads can retry and imported text enters the same bounded cache', async () => {
 let ok = false; const cache = createBookPageCache(async () => ok ? [{ pageNumber: 1 }] : null);
 await assert.rejects(cache.load('a'), /missing or damaged/); assert.deepEqual(cache.snapshot(), {});
 ok = true; await cache.load('a'); cache.put('b', [{ pageNumber: 2 }]); cache.put('c', [{ pageNumber: 3 }]);
 assert.deepEqual(Object.keys(cache.snapshot()), ['b','c']); cache.remove('b'); assert.deepEqual(Object.keys(cache.snapshot()), ['c']);
});
