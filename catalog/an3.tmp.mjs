import fs from 'fs';
const m=JSON.parse(fs.readFileSync('out/manifest.json','utf8'));
const byYear={};
for (const s of m.shards) { const y=s.id.split('-')[0]; byYear[y]=(byYear[y]||0)+s.count; }
console.log(JSON.stringify(byYear));
for (const y of ['5750','5754','5757','5770','5772']) {
  const issues=JSON.parse(fs.readFileSync(`out/issues/${y}.json`,'utf8'));
  console.log('---',y,issues.length);
  for (const i of issues.slice(0,8)) console.log(i.date||'-', (i.parasha||[]).join('+'), '|', i.assets.map(a=>a.src+':'+a.rawTitle).join(' || ').slice(0,150));
}
