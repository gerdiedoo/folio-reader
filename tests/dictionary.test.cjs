const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');

function dictionary() {
  const timers = new Map();
  let nextTimer = 1;
  const clock = {
    setTimeout(fn, ms) { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  function load(relative) {
    const filename = path.resolve(__dirname, relative);
    const loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = module.paths;
    loaded.require = name => {
      if (name === '__timers') return clock;
      return load(path.relative(__dirname, path.resolve(path.dirname(filename), name)) + '.ts');
    };
    loaded._compile("const { setTimeout, clearTimeout } = require('__timers');\n" + ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText, filename);
    return loaded.exports;
  }
  return { ...load('../src/lib/dictionary.ts'), timers };
}
const payload = (definition = 'A usable definition.') => [{ phonetic: '/word/', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition }] }] }];
const response = data => ({ ok: true, status: 200, json: async () => data });

test('bundled dictionary only recognizes its own entries, including prototype-named input', () => {
  const d = dictionary();
  assert.equal(d.dictionaryWord('  QUIETUDE '), 'quietude');
  assert.ok(d.bundledDefinition('quietude').definition);
  for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.equal(d.bundledDefinition(key), null);
  assert.equal(d.dictionaryWord('cafe\u0301'), 'café');
});

test('parsing validates optional fields and keeps examples attached to the selected sense', () => {
  const d = dictionary();
  const data = payload();
  data[0].phonetic = {};
  data[0].phonetics = [null, { text: 44 }, { text: '/valid/' }];
  data[0].meanings[0].synonyms = ['garden', null, 4, ' garden ', 'place'];
  data[0].meanings[0].definitions[0].synonyms = 'not an array';
  data[0].meanings.push({ definitions: [{ definition: 'Different sense', example: 'Unrelated example' }] });
  const parsed = d.parseDictionaryResponse(data);
  assert.deepEqual(parsed, { phonetic: '/valid/', partOfSpeech: 'noun', definition: 'A usable definition.', synonyms: ['garden', 'place'], example: '' });
  const example = payload();
  example[0].meanings[0].definitions[0].example = ' Its own example. ';
  assert.equal(d.parseDictionaryResponse(example).example, 'Its own example.');
});

test('malformed definitions cannot become displayable or saveable entries', () => {
  const d = dictionary();
  for (const data of [null, {}, [null], [{ meanings: {} }], payload({ nested: 'not text' }), payload(''), payload('x'.repeat(10001))]) {
    assert.throws(() => d.parseDictionaryResponse(data), error => error.kind === 'invalid');
  }
  assert.equal(d.parseDictionaryResponse([]), null);
  assert.equal(d.parseDictionaryResponse([{ meanings: [{ definitions: [null, { definition: ' valid ' }] }] }]).definition, 'valid');
});

test('online lookup encodes the word in the fixed English endpoint and cleans up its timeout', async () => {
  const d = dictionary();
  let url, innerSignal;
  const entry = await d.fetchDictionaryDefinition('  A/B?X= ', { fetcher: async (value, options) => {
    url = value; innerSignal = options.signal;
    return response(payload());
  } });
  assert.equal(url, 'https://api.dictionaryapi.dev/api/v2/entries/en/a%2Fb%3Fx%3D');
  assert.equal(entry.definition, 'A usable definition.');
  assert.equal(innerSignal.aborted, true);
  assert.equal(d.timers.size, 0);
});

test('404, network, server and unreadable responses remain distinct', async () => {
  const d = dictionary();
  assert.equal(await d.fetchDictionaryDefinition('word', { fetcher: async () => ({ ok: false, status: 404, json: () => assert.fail('404 body should not be read') }) }), null);
  for (const [fetcher, kind] of [
    [async () => { throw new Error('Offline'); }, 'network'],
    [async () => ({ ok: false, status: 503 }), 'service'],
    [async () => response({ unexpected: true }), 'invalid'],
    [async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Bad JSON'); } }), 'invalid'],
  ]) {
    await assert.rejects(d.fetchDictionaryDefinition('word', { fetcher }), error => error.kind === kind);
    assert.equal(d.timers.size, 0);
  }
});

test('the eight-second timeout finishes even if transport or body reading ignores abort', async () => {
  for (const waitingForBody of [false, true]) {
    const d = dictionary();
    let innerSignal;
    const pending = new Promise(() => {});
    const lookup = d.fetchDictionaryDefinition('word', { fetcher: async (_url, { signal }) => {
      innerSignal = signal;
      return waitingForBody ? { ok: true, status: 200, json: () => pending } : pending;
    } });
    await Promise.resolve(); await Promise.resolve();
    const timer = [...d.timers.values()][0];
    assert.equal(timer.ms, 8000);
    timer.fn();
    await assert.rejects(lookup, error => error.kind === 'timeout');
    assert.equal(innerSignal.aborted, true);
    assert.equal(d.timers.size, 0);
  }
});

test('cancellation finishes ignored requests and invalid input never starts a request', async () => {
  const d = dictionary();
  const controller = new AbortController();
  let called = 0;
  const fetcher = async () => { called++; return new Promise(() => {}); };
  const lookup = d.fetchDictionaryDefinition('word', { signal: controller.signal, fetcher });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(lookup, { name: 'AbortError' });
  assert.equal(called, 1);
  assert.equal(d.timers.size, 0);
  await assert.rejects(d.fetchDictionaryDefinition('word', { signal: controller.signal, fetcher }), { name: 'AbortError' });
  await assert.rejects(d.fetchDictionaryDefinition('x'.repeat(81), { fetcher }), error => error.kind === 'input');
  assert.equal(await d.fetchDictionaryDefinition(' ', { fetcher }), null);
  assert.equal(called, 1);
});
