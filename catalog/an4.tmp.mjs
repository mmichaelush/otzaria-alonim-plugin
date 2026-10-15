import fs from 'fs';
const m=JSON.parse(fs.readFileSync('out/manifest.json','utf8'));
let x=11; const rnd=()=>(x=(x*1103515245+12345)&0x7fffffff)/0x7fffffff;
const all=[]; for (const s of m.shards) { if (!/^578[3-6]/.test(s.id)) continue; all.push(...JSON.parse(fs.readFileSync('out/'+s.path,'utf8'))); }
const t=all.filter(i=>i.assets.length===1&&i.assets[0].src==='tashma'&&i.date);
console.log(t.length);
for (let k=0;k<40;k++){ const i=t[Math.floor(rnd()*t.length)]; console.log(i.date,(i.parasha||[]).join('+'),i.event||'','|',i.assets[0].rawTitle.slice(0,90),'| hy',i.hy); }
