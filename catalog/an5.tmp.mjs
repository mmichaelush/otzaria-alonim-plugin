import fs from 'fs';
const r=JSON.parse(fs.readFileSync('out/recent.json','utf8'));
console.log(r.length);
const c={}; for (const i of r){ const k=(i.date?'dated':'undated')+':'+i.assets.map(a=>a.src).sort().join('+'); c[k]=(c[k]||0)+1;}
console.log(c);
const byDate={}; for (const i of r) byDate[i.date||'none']=(byDate[i.date||'none']||0)+1; console.log(byDate);
const und=r.filter(i=>!i.date); const adds={}; for (const i of und) adds[i.added.slice(0,10)]=(adds[i.added.slice(0,10)]||0)+1; console.log(adds);
