import fs from 'fs';
import { fromWire } from './lib/wire.mjs';
const d='.cache/new1';
const m=JSON.parse(fs.readFileSync(d+'/manifest.json','utf8'));const ser=new Map(JSON.parse(fs.readFileSync(d+'/series.json','utf8')).map(s=>[s.id,s]));const specs=Object.fromEntries(m.sources.map(s=>[s.id,{urlBase:s.urlBase,urlTemplates:s.urlTemplates}]));
const iss=[];for(const s of m.shards)for(const w of JSON.parse(fs.readFileSync(d+'/'+s.path,'utf8')))iss.push(fromWire(w,ser.get(w.series),specs));
const sus=iss.filter(i=>(i.event==='shavuot'||i.event==='pesach'||i.event==='sukkot')&&i.assets.some(a=>/דף|מסכת|גמרא|יומי|פסחים|סוכה|הלכות/.test(a.rawTitle)&&a.src==='tashma'));
console.log(sus.length); for (const i of sus.slice(0,25)) console.log(i.event, i.date, i.assets[0].rawTitle.slice(0,90));
const t=iss.filter(i=>i.event==='shavuot'&&i.assets.some(a=>/מסכת שבועות|שבועות דף|דף .*שבועות|שבועות\s+(ב|ג|ד|ה|ו|ז|ח|ט|י)\b/.test(a.rawTitle)));
console.log('tractate-like', t.length); for (const i of t.slice(0,10)) console.log(i.date, i.assets[0].rawTitle.slice(0,90));
