import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function catalogFromBrowser() {
  const minor=readFileSync(resolve(root,'minor.js'),'utf8').split('const MINOR_PREVIEW_ART')[0];
  const data=readFileSync(resolve(root,'data.js'),'utf8').split('const PREVIEW_ART')[0];
  const raw=runInNewContext(`${minor}\n${data}\nJSON.stringify({CARDS,REVERSED,SPREADS})`,Object.create(null),{timeout:1000});
  const parsed=JSON.parse(raw);
  return Object.fromEntries(parsed.CARDS.map(card=>[card.id,{cn:card.cn,meaning:card.meaning,
    reversed:parsed.REVERSED[card.id]?.meaning}]));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  writeFileSync(resolve(root,'server','card-catalog.json'),JSON.stringify(catalogFromBrowser(),null,2)+'\n');
