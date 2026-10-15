import fs from 'fs';
import { fromWire } from './lib/wire.mjs';
const d=process.argv[2]; const seed=Number(process.argv[3]||5);
const m=JSON.parse(fs.readFileSync(d+'/manifest.json','utf8'));const ser=new Map(JSON.parse(fs.readFileSync(d+'/series.json','utf8')).map(s=>[s.id,s]));const specs=Object.fromEntries(m.sources.map(s=>[s.id,{urlBase:s.urlBase,urlTemplates:s.urlTemplates}]));
const iss=[];for(const s of m.shards)for(const w of JSON.parse(fs.readFileSync(d+'/'+s.path,'utf8')))iss.push(fromWire(w,ser.get(w.series),specs));
const sel=iss.filter(i=>i.event&&!(i.parasha?.length)&&i.assets.length===1&&i.assets[0].src==='tashma'&&!/^shabbat-/.test(i.event));
let x=seed; const rnd=()=>(x=(x*1103515245+12345)&0x7fffffff)/0x7fffffff;
console.log(sel.length);
for (let k=0;k<40;k++){const i=sel[Math.floor(rnd()*sel.length)]; console.log(i.date||'-',i.hy,i.event,'|',i.assets[0].rawTitle.slice(0,80),'| series:',ser.get(i.series).title.slice(0,30));}
