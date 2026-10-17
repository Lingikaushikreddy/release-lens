import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { compare } from '../packages/core/src/compare';
import { applyBudget } from '../packages/core/src/budget';
import { serializeReport } from '../packages/core/src/serialize';
import type { Inventory, Entry } from '../packages/core/src/types';
const inventory = (entries: Entry[], manifest: Record<string,unknown> = {}): Inventory => ({schemaVersion:1,archiveBytes:10,unpackedBytes:entries.reduce((n,e)=>n+e.bytes,0),entries,manifest});
const entry = (path:string,bytes:number,sha256='a'):Entry => ({path,bytes,sha256});
describe('exact comparison',()=>{
 test('accounts for every payload byte, including removals and equal-size edits',()=>{
  const r=compare(inventory([entry('old.js',20),entry('keep.js',80)]),inventory([entry('new.map',60),entry('keep.js',85)]));
  expect(r.unpackedDelta).toBe(45); expect(r.fileDeltas.reduce((n,f)=>n+f.delta,0)).toBe(45);
  expect(r.fileDeltas.find(f=>f.path==='old.js')).toMatchObject({kind:'removed',delta:-20});
  expect(compare(inventory([entry('x',1)]),inventory([entry('x',1,'b')])).fileDeltas[0].kind).toBe('modified');
 });
 test('has deterministic escaped manifest pointers and missing vs null values',()=>{
  const r=compare(inventory([], {exports:{'./a~b/c':'./a'}}),inventory([], {exports:{'./a~b/c':null}}));
  expect(r.manifestChanges).toContainEqual({pointer:'/exports/.~1a~0b~1c',before:'./a',after:null,beforeExists:true,afterExists:true});
  const missing=compare(inventory([]),inventory([],{main:null})).manifestChanges[0];
  expect(missing).toMatchObject({beforeExists:false,before:null,afterExists:true,after:null});
 });
 test('canonicalizes object order and does not interpret prototype-like keys',()=>{
  const a=inventory([],JSON.parse('{"exports":{"__proto__":"./x","z":"./z","a":"./a"}}'));
  const b=inventory([],JSON.parse('{"exports":{"a":"./a","z":"./z","__proto__":"./x"}}'));
  expect(serializeReport(compare(a,a))).toBe(serializeReport(compare(b,b)));
  expect({}).not.toHaveProperty('polluted');
 });
 test('inclusive integer growth budget',()=>{
  const r=compare(inventory([]),inventory([entry('x',100)]));
  expect(applyBudget(r,100).budget).toBe('pass');expect(applyBudget(r,99).budget).toBe('fail');expect(r.budget).toBe('unset');
  for(const n of [-1,NaN,Infinity,1.1,Number.MAX_SAFE_INTEGER+1]) expect(()=>applyBudget(r,n)).toThrow();
 });
 test('generated inventories reconcile and reverse signed deltas (seed 20261016)',()=>{
  fc.assert(fc.property(fc.array(fc.nat({max:100000}),{maxLength:80}),fc.array(fc.nat({max:100000}),{maxLength:80}),(a,b)=>{
   const make=(xs:number[])=>inventory(xs.map((n,i)=>entry(`f${i}.js`,n,String(n))));const x=make(a),y=make(b);const r=compare(x,y),reverse=compare(y,x);
   expect(r.fileDeltas.reduce((n,f)=>n+f.delta,0)).toBe(y.unpackedBytes-x.unpackedBytes);
   expect(reverse.unpackedDelta).toBe(-r.unpackedDelta || 0);
   expect(compare(x,x).fileDeltas.every(f=>f.kind==='unchanged')).toBe(true);
  }),{seed:20261016,numRuns:200});
 });
});
