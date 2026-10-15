import fs from 'fs';
const m=JSON.parse(fs.readFileSync('out/manifest.json','utf8'));
let issues=[]; for (const s of m.shards) issues.push(...JSON.parse(fs.readFileSync('out/'+s.path,'utf8')));
const ser=JSON.parse(fs.readFileSync('out/series.json','utf8')); const sb=new Map(ser.map(s=>[s.id,s]));
const dist={}; for (const i of issues){const k=i.assets.map(a=>a.src).join('+'); dist[k]=(dist[k]||0)+1;} console.log(dist);
const merged=issues.filter(i=>i.assets.length>1);
console.log('merged',merged.length);
for (const i of merged.slice(0,25)) console.log(i.date, i.parasha?.join('+'), '|', sb.get(i.series).title, '|', i.title, i.no??'', '|', i.assets.map(a=>a.src+':'+a.rawTitle).join(' || '));
