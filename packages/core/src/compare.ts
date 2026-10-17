import type { Category, Inventory, Report, ManifestChange } from './types';
import {checkLiteralTargets,pointerToken} from './manifest';
import {canonicalize,order} from './serialize';
export function categoryFor(path:string):Category {
 if(/\.map$/i.test(path))return 'source maps';
 if(/(?:^|\/)(?:__tests__|tests?|fixtures?)(?:\/|\.)/i.test(path))return 'tests and fixtures';
 if(/\.d\.(?:ts|mts|cts)$/i.test(path))return 'types';
 if(/(?:^|\/)(?:readme|license|licence|changelog|notice)(?:\.|$)|\.(?:md|mdx|txt|rst)$/i.test(path))return 'documentation';
 if(/\.(?:[cm]?js|[cm]?ts|jsx|tsx|css|html|json|wasm)$/i.test(path))return 'code';
 return 'other';
}
const fields=['files','exports','main','module','types','bin','engines','dependencies','devDependencies','peerDependencies','optionalDependencies','bundledDependencies','bundleDependencies','scripts'];
function manifestChanges(before:Record<string,unknown>,after:Record<string,unknown>):ManifestChange[]{
 const result:ManifestChange[]=[];
 function walk(a:unknown,b:unknown,pointer:string,hasA:boolean,hasB:boolean){
  if(!hasA&&!hasB)return;
  if(hasA&&hasB&&JSON.stringify(canonicalize(a))===JSON.stringify(canonicalize(b)))return;
  if(hasA&&hasB&&a!==null&&b!==null&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
   const left=a as Record<string,unknown>,right=b as Record<string,unknown>;
   for(const key of [...new Set([...Object.keys(left),...Object.keys(right)])].sort(order))walk(left[key],right[key],`${pointer}/${pointerToken(key)}`,Object.hasOwn(left,key),Object.hasOwn(right,key));
  }else result.push({pointer,before:hasA?a:null,after:hasB?b:null,beforeExists:hasA,afterExists:hasB});
 }
 for(const key of fields)walk(before[key],after[key],`/${key}`,Object.hasOwn(before,key),Object.hasOwn(after,key));
 return result.sort((a,b)=>order(a.pointer,b.pointer));
}
export function compare(before:Inventory,after:Inventory):Report {
 const left=new Map(before.entries.map(e=>[e.path,e])),right=new Map(after.entries.map(e=>[e.path,e]));
 const fileDeltas=[...new Set([...left.keys(),...right.keys()])].sort(order).map(path=>{
  const a=left.get(path),b=right.get(path);
  return {path,beforeBytes:a?.bytes??0,afterBytes:b?.bytes??0,delta:(b?.bytes??0)-(a?.bytes??0),kind:!a?'added' as const:!b?'removed' as const:a.sha256!==b.sha256||a.bytes!==b.bytes?'modified' as const:'unchanged' as const,category:categoryFor(path),beforeHash:a?.sha256??null,afterHash:b?.sha256??null};
 });
 return {schemaVersion:1,before,after,fileDeltas,manifestChanges:manifestChanges(before.manifest,after.manifest),findings:[...checkLiteralTargets(before).map(f=>({...f,side:'before' as const})),...checkLiteralTargets(after).map(f=>({...f,side:'after' as const}))],unpackedDelta:after.unpackedBytes-before.unpackedBytes,archiveDelta:after.archiveBytes-before.archiveBytes,budget:'unset'};
}
