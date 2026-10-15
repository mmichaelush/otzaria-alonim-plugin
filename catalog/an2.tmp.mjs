import fs from 'fs';
const m=JSON.parse(fs.readFileSync('out/manifest.json','utf8'));
let issues=[]; for (const s of m.shards) issues.push(...JSON.parse(fs.readFileSync('out/'+s.path,'utf8')));
const ser=JSON.parse(fs.readFileSync('out/series.json','utf8')); const sb=new Map(ser.map(s=>[s.id,s]));
const none=issues.filter(i=>!i.date);
console.log('undated',none.length);
for (const i of none.slice(0,45)) console.log(i.hy??'-', i.parasha?.join('+')??'-', '|', sb.get(i.series).title, '|', i.title, '|', i.assets.map(a=>a.src+':'+a.rawTitle).join(' || '));
const w=JSON.parse(fs.readFileSync('out/weeks.json','utf8')); console.log(w.length, w[0], w.at(-1));
