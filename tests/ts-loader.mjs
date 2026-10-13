import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('typescript');
export function loadTs(file,overrides={}) {
  const cache=new Map();
  function load(filename) {
    const absolute=path.resolve(filename);
    if(cache.has(absolute))return cache.get(absolute);
    const result={exports:{}};cache.set(absolute,result.exports);
    const compiled=ts.transpileModule(fs.readFileSync(absolute,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    const localRequire=id=>Object.hasOwn(overrides,id)?overrides[id]:id.startsWith('@/')?load(path.resolve(''+id.slice(2)+'.ts')):id.startsWith('.')?load(path.resolve(path.dirname(absolute),id+'.ts')):require(id);
    new Function('require','module','exports',compiled)(localRequire,result,result.exports);
    cache.set(absolute,result.exports);return result.exports;
  }
  return load(file);
}
