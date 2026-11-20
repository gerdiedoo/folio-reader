const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/bookRemoval.ts');
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { removeBookLocally } = loaded.exports;
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const events = [], files = new Set(['target', 'other']);
  let failed, gate, cloud = async () => true, cloudErrors = 0;
  const stage = async name => {
    events.push(name);
    if (failed === name) throw new Error('Storage unavailable');
    if (name === 'library' && gate) await gate;
    return true;
  };
  const steps = {
    bookmarks: () => stage('bookmarks'), highlights: () => stage('notes'), vocabulary: () => stage('vocabulary'),
    saveLibrary: () => stage('library'), publishRemoval: () => { events.push('publish'); },
    removeFiles: () => { events.push('files'); files.delete('target'); return true; },
    removeCloud: () => { events.push('cloud'); return cloud(); }, reportCloudFailure: () => { cloudErrors++; },
  };
  return { events, files, steps, cloudErrors: () => cloudErrors,
    fail: name => { failed = name; }, cloud: fn => { cloud = fn; },
    block: () => { let release; gate = new Promise(resolve => { release = resolve; }); return release; },
  };
}

test('book files and visible removal wait for the library storage acknowledgement', async () => {
  const f = fixture(), release = f.block(); let complete = false;
  const pending = removeBookLocally('Book', f.steps).then(result => { complete = true; return result; });
  await flush();
  assert.equal(complete, false); assert.ok(f.files.has('target')); assert.ok(f.files.has('other'));
  assert.deepEqual(f.events, ['bookmarks', 'notes', 'vocabulary', 'library']);
  release(); const result = await pending; await flush();
  assert.equal(result.removed, true); assert.match(result.message, /on this device/);
  assert.deepEqual(f.events, ['bookmarks', 'notes', 'vocabulary', 'library', 'publish', 'files', 'cloud']);
  assert.equal(f.files.has('target'), false); assert.equal(f.files.has('other'), true);
});

for (const stage of ['bookmarks', 'notes', 'vocabulary', 'library']) {
  test(`failure in ${stage} keeps book files and explains earlier confirmed cleanup`, async () => {
    const f = fixture(); f.fail(stage);
    const result = await removeBookLocally('Book', f.steps); await flush();
    assert.equal(result.removed, false); assert.match(result.message, /Book kept/);
    assert.ok(f.files.has('target')); assert.ok(!f.events.includes('publish')); assert.ok(!f.events.includes('cloud'));
    if (stage === 'notes') assert.match(result.message, /bookmarks were already removed/);
    if (stage === 'vocabulary') assert.match(result.message, /bookmarks and notes were already removed/);
    if (stage === 'library') assert.match(result.message, /bookmarks, notes and vocabulary were already removed/);
    f.fail(undefined); assert.equal((await removeBookLocally('Book', f.steps)).removed, true);
  });
}

test('unconfirmed archive results are failures, not deletion success', async () => {
  for (const stage of ['highlights', 'vocabulary']) {
    const f = fixture(); f.steps[stage] = async () => false;
    const result = await removeBookLocally('Book', f.steps);
    assert.equal(result.removed, false); assert.ok(f.files.has('target')); assert.ok(!f.events.includes('publish'));
  }
});

test('an offline cloud request does not hold local completion open and its failure is reported separately', async () => {
  const f = fixture(); let resolve;
  f.cloud(() => new Promise(done => { resolve = done; }));
  const result = await removeBookLocally('Book', f.steps);
  assert.equal(result.removed, true); assert.equal(f.files.has('target'), false); assert.equal(f.cloudErrors(), 0);
  resolve(false); await flush(); assert.equal(f.cloudErrors(), 1);
});

test('file cleanup failures keep the confirmed library removal and still attempt cloud cleanup', async () => {
  for (const throws of [true, false]) {
    const f = fixture(); f.steps.removeFiles = () => { if (throws) throw new Error('File locked'); return false; };
    const result = await removeBookLocally('Book', f.steps); await flush();
    assert.equal(result.removed, true); assert.match(result.message, /some local files could not be deleted/);
    assert.ok(f.events.includes('cloud'));
  }
});

test('a rejected cloud cleanup cannot turn an acknowledged local removal into a failed dialog result', async () => {
  const f = fixture(); f.cloud(async () => { throw new Error('Offline'); });
  const result = await removeBookLocally('Book', f.steps); await flush();
  assert.equal(result.removed, true); assert.equal(f.cloudErrors(), 1);
});

test('a later cloud warning retains the information that local file cleanup was incomplete', async () => {
  const f = fixture(); let reported;
  f.steps.removeFiles = () => false;
  f.steps.reportCloudFailure = filesRemoved => { reported = filesRemoved; };
  f.cloud(async () => false);
  assert.equal((await removeBookLocally('Book', f.steps)).removed, true); await flush();
  assert.equal(reported, false);
});
