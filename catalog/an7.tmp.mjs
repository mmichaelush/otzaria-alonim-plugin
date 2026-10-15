import fs from 'fs';
const d='.cache/out2/';
const m=JSON.parse(fs.readFileSync(d+'manifest.json','utf8'));
const issues=[]; for (const s of m.shards) issues.push(...JSON.parse(fs.readFileSync(d+s.path,'utf8')));
const r={};
for (const i of issues) for (const a of i.assets) { const x=r[a.src]??={min:'9',max:'0',pages:0,bytes:0,thumb:0,n:0,addedMin:'9'}; x.n++; if(i.date){ if(i.date<x.min)x.min=i.date; if(i.date>x.max)x.max=i.date;} if(a.pages)x.pages++; if(a.bytes)x.bytes++; if(a.thumb)x.thumb++; }
console.log(r);
