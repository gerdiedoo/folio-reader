const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const cache = new Map();
exports.loadTypeScript = function loadTypeScript(filename) {
  filename = path.resolve(filename);
  if (cache.has(filename)) return cache.get(filename).exports;
  const m = new Module(filename, module); cache.set(filename, m); m.filename = filename; m.paths = module.paths;
  const requireModule = m.require.bind(m);
  m.require = name => name.startsWith('.') ? loadTypeScript(path.resolve(path.dirname(filename), name + '.ts')) : requireModule(name);
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
  return m.exports;
};
