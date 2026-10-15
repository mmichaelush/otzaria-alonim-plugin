import fs from 'fs';
import { fromWire } from './lib/wire.mjs';
const load=(d)=>{const m=JSON.parse(fs.readFileSync(d+'/manifest.json','utf8'));const ser=new Map(JSON.parse(fs.readFileSync(d+'/series.json','utf8')).map(s=>[s.id,s]));const specs=Object.fromEntries(m.sources.map(s=>[s.id,{urlBase:s.urlBase,urlTemplates:s.urlTemplates}]));const iss=[];for(const s of m.shards)for(const w of JSON.parse(fs.readFileSync(d+'/'+s.path,'utf8')))iss.push(fromWire(w,ser.get(w.series),specs));return iss;};
const cov=(iss)=>{const c={total:iss.length,event:0,dated:0,parasha:0,undatedWithHy:0,byEvent:{}};for(const i of iss){if(i.event){c.event++;c.byEvent[i.event]=(c.byEvent[i.event]||0)+1;} if(i.date)c.dated++; if(i.parasha?.length)c.parasha++; if(!i.date&&i.hy)c.undatedWithHy++;}return c;};
for (const d of process.argv.slice(2)) { const iss=load(d); console.log(d, JSON.stringify(cov(iss))); }
