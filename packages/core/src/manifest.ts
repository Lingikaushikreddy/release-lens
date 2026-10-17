import type { Inventory, Finding } from './types';
import {order} from './serialize';
export const pointerToken=(s:string):string=>s.replace(/~/g,'~0').replace(/\//g,'~1');
export function checkLiteralTargets(inventory:Inventory):Finding[] {
  const paths=new Set(inventory.entries.map(e=>e.path));
  const findings:Finding[]=[];
  function unchecked(code:string,pointer:string,message:string){findings.push({code,severity:'info',message,paths:[],pointer});}
  function literal(value:unknown,pointer:string,isExports=false){
    if(typeof value!=='string'){unchecked('UNCHECKED_TARGET',pointer,'Unsupported target value; literal file existence was not checked.');return;}
    if(/[\*?\[\]{}]/.test(value)){unchecked('UNCHECKED_PATTERN',pointer,'Pattern target; literal file existence was not checked.');return;}
    const parts=value.split('/');
    if(!value||value.endsWith('/')||value.includes('\\')||value.includes('\0')||value.startsWith('/')||value.includes(':')||parts.includes('..')||(isExports&&!value.startsWith('./'))){unchecked('UNCHECKED_TARGET',pointer,'Target is outside the supported local relative file grammar.');return;}
    const path=parts.filter(s=>s!=='.'&&s!=='').join('/');
    if(!path){unchecked('UNCHECKED_TARGET',pointer,'Target does not name a regular file.');return;}
    if(!paths.has(path)) findings.push({code:'MISSING_LITERAL_TARGET',severity:'warning',message:`Literal target ${value} is absent from the archive.`,paths:[path],pointer});
  }
  function exportsTarget(value:unknown,pointer:string){
    if(value===null)return;
    if(Array.isArray(value)){value.forEach((v,i)=>exportsTarget(v,`${pointer}/${i}`));return;}
    if(typeof value==='object'&&value!==null){for(const key of Object.keys(value).sort(order))exportsTarget((value as Record<string,unknown>)[key],`${pointer}/${pointerToken(key)}`);return;}
    literal(value,pointer,true);
  }
  const m=inventory.manifest;
  for(const key of ['main','module','types'])if(Object.hasOwn(m,key))literal(m[key],`/${key}`);
  if(Object.hasOwn(m,'bin')){
    const bin=m.bin;
    if(bin!==null&&typeof bin==='object'&&!Array.isArray(bin))for(const key of Object.keys(bin).sort(order))literal((bin as Record<string,unknown>)[key],`/bin/${pointerToken(key)}`);
    else literal(bin,'/bin');
  }
  if(Object.hasOwn(m,'exports'))exportsTarget(m.exports,'/exports');
  return findings.sort((a,b)=>order(a.pointer??'',b.pointer??'')||order(a.code,b.code));
}
