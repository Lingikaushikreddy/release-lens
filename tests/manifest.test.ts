import {expect,test} from 'vitest';
import {checkLiteralTargets} from '../packages/core/src/manifest';
import type {Inventory} from '../packages/core/src/types';
const inv=(manifest:Record<string,unknown>):Inventory=>({schemaVersion:1,archiveBytes:0,unpackedBytes:1,entries:[{path:'dist/index.js',bytes:1,sha256:'a'}],manifest});
test('checks nested literal targets and preserves pointers and exclusions',()=>{
 const f=checkLiteralTargets(inv({main:'dist/index.js',bin:{tool:'dist/missing.js'},exports:{'.':{import:'./dist/index.js',require:'./missing.cjs'},'./*':'./dist/*.js','./excluded':null}}));
 expect(f).toContainEqual(expect.objectContaining({code:'MISSING_LITERAL_TARGET',pointer:'/bin/tool',paths:['dist/missing.js']}));
 expect(f).toContainEqual(expect.objectContaining({pointer:'/exports/./require',code:'MISSING_LITERAL_TARGET'}));
 expect(f).toContainEqual(expect.objectContaining({code:'UNCHECKED_PATTERN',pointer:'/exports/.~1*'}));
 expect(f.some(x=>x.pointer==='/exports/.~1excluded')).toBe(false);
 expect(f.some(x=>x.pointer==='/main')).toBe(false);
});
test('never claims Node resolution and refuses traversal/external/unsupported values',()=>{
 const f=checkLiteralTargets(inv({main:'../x',module:'https://example.com/x.js',types:4,bin:['./x'],exports:{a:{b:42},c:['./dist/index.js','./missing.js']}}));
 expect(f.filter(x=>x.code.startsWith('UNCHECKED')).length).toBe(5);
 expect(f).toContainEqual(expect.objectContaining({code:'MISSING_LITERAL_TARGET',pointer:'/exports/c/1'}));
});
test('escapes pointers for unusual keys and handles __proto__ safely',()=>{
 const f=checkLiteralTargets(inv(JSON.parse('{"bin":{"a~/b":"missing.js","__proto__":"other.js"}}')));
 expect(f.map(x=>x.pointer)).toContain('/bin/a~0~1b');expect(f.map(x=>x.pointer)).toContain('/bin/__proto__');
});
