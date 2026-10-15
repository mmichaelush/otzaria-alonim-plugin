import fs from 'fs';
const d='.cache/out2/';
const m=JSON.parse(fs.readFileSync(d+'manifest.json','utf8'));
const issues=[]; for (const s of m.shards) issues.push(...JSON.parse(fs.readFileSync(d+s.path,'utf8')));
const ser=JSON.parse(fs.readFileSync(d+'series.json','utf8'));
console.log('series',ser.length,'by lang',Object.entries(ser.reduce((a,s)=>(a[s.lang]=(a[s.lang]||0)+1,a),{})).map(x=>x.join(':')).join(' '),'by kind',ser.filter(s=>s.kind==='timeless').length,'timeless');
console.log('series with multiple sources', ser.filter(s=>new Set(s.sources.map(x=>x.src)).size>1).length);
let copies=0; const per={}; 
for (const i of issues) for (const a of i.assets){copies++; per[a.src]=(per[a.src]||0)+1;}
console.log('issues',issues.length,'copies',copies,per);
const win=issues.filter(i=>i.date&&i.date>='2026-02-01'&&i.date<='2026-10-17');
const stat={}; for (const i of win){ const srcs=new Set(i.assets.map(a=>a.src)); for (const a of i.assets){ const s=stat[a.src]??={n:0,shared:0}; s.n++; if(srcs.size>1) s.shared++; } }
for (const [k,v] of Object.entries(stat)) console.log(k,'copies in 2026-02..10 window',v.n,'shared with another source',v.shared,(100*v.shared/v.n).toFixed(1)+'%');
const noParasha=issues.filter(i=>!i.parasha&&!i.event); console.log('issues without parasha/event',noParasha.length,(100*noParasha.length/issues.length).toFixed(1)+'%');
const noDate=issues.filter(i=>!i.date); console.log('without date',noDate.length,(100*noDate.length/issues.length).toFixed(1)+'%');
console.log('shards',m.shards.length,'bytes total',m.shards.reduce((a,s)=>a+s.bytes,0),'max',Math.max(...m.shards.map(s=>s.bytes)), 'split',m.shards.filter(s=>/-/.test(s.id)).map(s=>s.id).join(','));
const big=m.shards.filter(s=>s.bytes>2.5e6).map(s=>s.id+':'+(s.bytes/1e6).toFixed(2)); console.log(big.join(' '));
console.log('recent', m.files.recent.count, (m.files.recent.bytes/1e6).toFixed(2)+'MB','series',(m.files.series.bytes/1e3).toFixed(0)+'KB');
