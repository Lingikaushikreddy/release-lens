import {expect,test} from 'vitest';
import fc from 'fast-check';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {readInventory} from '../packages/core/src/archive';
import {DEFAULT_LIMITS} from '../packages/core/src/types';
import {tar,stream} from './helpers/archive';
test('bounded generated payloads match Node SHA-256 across chunking, order and compression (seed 20261016)',async()=>{
 await fc.assert(fc.asyncProperty(fc.array(fc.uint8Array({maxLength:4096}),{maxLength:12}),fc.integer({min:1,max:1024}),fc.constantFrom(0,1,6,9),async(payloads,chunk,level)=>{
  const records=[{name:'package/package.json',body:'{"name":"generated"}'},...payloads.map((body,i)=>({name:`package/f${i}.bin`,body}))];
  const input=new Uint8Array(gzipSync(tar(...records),{level}));
  const reversed=new Uint8Array(gzipSync(tar(...[...records].reverse()),{level:9}));
  const a=await readInventory(stream(input,chunk),input.length,DEFAULT_LIMITS);
  const b=await readInventory(stream(reversed,509),reversed.length,DEFAULT_LIMITS);
  expect(a.entries).toEqual(b.entries);expect(a.unpackedBytes).toBe(b.unpackedBytes);
  for(let i=0;i<payloads.length;i++)expect(a.entries.find(e=>e.path===`f${i}.bin`)).toMatchObject({bytes:payloads[i].length,sha256:createHash('sha256').update(payloads[i]).digest('hex')});
 }),{seed:20261016,numRuns:60});
});
