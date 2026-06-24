import fs from 'fs'; import path from 'path';
export type PlayPromptName='play-event-generator'|'play-event-dialogue'|'play-event-resolver'|'play-replanner';
export function loadPlayPrompt(name:PlayPromptName):string{return fs.readFileSync(path.resolve(__dirname,'..','..','prompts',name+'.system.md'),'utf8');}
