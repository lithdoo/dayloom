import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChangePlanV2 } from './change-plan-v2';
import type { MarkdownDraftSnapshotV2 } from './markdown-draft-snapshot';
import type { TurnAuditV1 } from './turn-record';
import type { PublishedWorld } from '../world/read';
import { readTextDocument } from '../world/read';

export async function verifyChangePlanEvidenceV2(input:{plan:Readonly<ChangePlanV2>;snapshot:Readonly<MarkdownDraftSnapshotV2>;turns:readonly Readonly<TurnAuditV1>[];worldRoot:string;world:PublishedWorld|null}):Promise<void>{
 const brief=await readFile(path.join(input.snapshot.root,'brief.md')),evidenceFile=await readFile(path.join(input.snapshot.root,'evidence.md')),turns=new Map(input.turns.map((turn)=>[turn.turnId,turn]));
 for(const change of input.plan.changes){let confirms=false;for(const ref of change.evidence){
  if(ref.source==='brief'){if(hash(lineRange(brief,ref.startLine,ref.endLine))!==ref.sha256)fail('brief evidence hash mismatch.');continue;}
  if(ref.source==='evidence'){const turn=turns.get(ref.turnId);if(!turn)fail('Turn evidence does not exist.');let bytes:Buffer;if(ref.field==='user-input'){bytes=Buffer.from(turn.userInput);confirms=true;}else if(ref.field==='accepted-response'){const accepted=turn.generationAttempts.find((item)=>item.generationId===turn.acceptedGenerationId);if(!accepted)fail('Accepted response evidence does not exist.');bytes=Buffer.from(accepted.responseText);}else bytes=extractField(evidenceFile,ref.turnId,'curator-note');if(hash(bytes)!==ref.sha256)fail('Turn evidence hash mismatch.');continue;}
  if(ref.source==='published'){if(!input.world)fail('Published evidence is unavailable.');const text=await readTextDocument(input.worldRoot,input.world.tree,ref.path);if(hash(lineRange(Buffer.from(text),ref.startLine,ref.endLine))!==ref.sha256)fail('Published evidence hash mismatch.');continue;}
  if(input.snapshot.meta.sourceFormat!=='submission-v1-import')fail('Legacy evidence is not allowed for this Draft.');const slotRoot=path.dirname(path.dirname(input.snapshot.root)),bytes=await readFile(path.join(slotRoot,'legacy-v1',...ref.path.split('/')));if(hash(bytes)!==ref.sha256)fail('Legacy evidence hash mismatch.');confirms=true;
 }if(!confirms)fail(`Change ${change.localKey} lacks user-confirmed or Legacy evidence.`);}
}
function extractField(file:Buffer,turnId:string,field:string):Buffer{const marker=Buffer.from(`## Turn \`${turnId}\``),turn=file.indexOf(marker);if(turn<0)fail('Evidence Turn block is missing.');const header=Buffer.from(`### ${field}\n\nBytes: `),start=file.indexOf(header,turn);if(start<0)fail('Evidence field is missing.');const numberStart=start+header.length,numberEnd=file.indexOf(10,numberStart);if(numberEnd<0)fail('Evidence byte count is malformed.');const bytes=Number(file.subarray(numberStart,numberEnd).toString());if(!Number.isSafeInteger(bytes)||bytes<0)fail('Evidence byte count is malformed.');const fenceHeaderEnd=file.indexOf(10,file.indexOf(10,file.indexOf(10,numberEnd+1)+1)+1);if(fenceHeaderEnd<0)fail('Evidence fence is malformed.');const contentStart=fenceHeaderEnd+1;return file.subarray(contentStart,contentStart+bytes);}
function lineRange(bytes:Buffer,start:number,end:number):Buffer{let line=1,from=start===1?0:-1;for(let index=0;index<bytes.length;index++){if(bytes[index]===10){if(line===end&&from>=0)return bytes.subarray(from,index+1);line++;if(line===start)from=index+1;}}if(from<0||end!==line)fail('Evidence line range is outside the file.');return bytes.subarray(from);}
function hash(bytes:Uint8Array){return createHash('sha256').update(bytes).digest('hex');}function fail(message:string):never{throw new Error(message);}
