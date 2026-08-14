import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..','src');const violations=[];
for(const file of walk(root))for(const [pattern,message] of [[/@dayloom\/archive-protocol\/(?:src|dist)\//,'deep Protocol import'],[/archive-protocol[\\/]src/,'Protocol source import']])if(pattern.test(fs.readFileSync(file,'utf8')))violations.push(`${path.relative(root,file)}: ${message}`);
for(const relative of ['operations/runtime-operations-v2.ts']){const source=fs.readFileSync(path.join(root,relative),'utf8');for(const symbol of ['activeSession','stageCanon(','stageDay(','readCanonRevision(','readDayRevision('])if(source.includes(symbol))violations.push(`${relative}: modern Runtime uses legacy ${symbol}`);}
const tuiDriver=path.resolve(root,'..','..','tui','src','runtime-driver','create-runtime-driver.ts');if(fs.existsSync(tuiDriver)){const source=fs.readFileSync(tuiDriver,'utf8');for(const symbol of ['createArchiveRepository','createArchiveSessionWorldReadModel','archiveRepository:'])if(source.includes(symbol))violations.push(`tui runtime driver uses legacy ${symbol}`);}
if(violations.length){console.error(violations.join('\n'));process.exitCode=1;}
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.name.endsWith('.ts')?[path.join(dir,e.name)]:[]);}
