import fs from 'node:fs/promises';
import path from 'node:path';
import { createNeed, createHelperProfile, transitionNeed } from './model.mjs';
import { rankHelpers } from './matching.mjs';
import { contentSimilarity } from '../discovery/dedupe.mjs';

export class JsonStore {
  constructor(file){ this.file=file; this.state={needs:[],helpers:[],rawCandidates:[]}; this.ready=false; this.writeChain=Promise.resolve(); }
  async init(){ if(this.ready)return; try{this.state=JSON.parse(await fs.readFile(this.file,'utf8'));}catch{await fs.mkdir(path.dirname(this.file),{recursive:true}); await this.save();} this.state.needs ||= []; this.state.helpers ||= []; this.state.rawCandidates ||= []; this.ready=true; }
  async save(){ const data=JSON.stringify(this.state,null,2); this.writeChain=this.writeChain.then(async()=>{ const tmp=`${this.file}.tmp`; await fs.writeFile(tmp,data); await fs.rename(tmp,this.file); }); return this.writeChain; }
  async addNeed(input){ await this.init(); const n=createNeed(input); if(n.dedupeKey && this.state.needs.some(x=>x.dedupeKey===n.dedupeKey && !['expired','rejected','completed'].includes(x.status))) return {duplicate:true, need:this.state.needs.find(x=>x.dedupeKey===n.dedupeKey)}; this.state.needs.unshift(n); await this.save(); return {duplicate:false,need:n}; }
  async listNeeds({status,origin,category,limit=50}={}){ await this.init(); return this.state.needs.filter(n=>(!status||n.status===status)&&(!origin||n.origin===origin)&&(!category||n.category===category)).slice(0,Math.min(100,limit)); }
  async getNeed(id){ await this.init(); return this.state.needs.find(n=>n.id===id)||null; }
  async transitionNeed(id,to){ await this.init(); const i=this.state.needs.findIndex(n=>n.id===id); if(i<0) return null; this.state.needs[i]=transitionNeed(this.state.needs[i],to); await this.save(); return this.state.needs[i]; }
  async addHelper(input){ await this.init(); const h=createHelperProfile(input); this.state.helpers.unshift(h); await this.save(); return h; }
  async addRawCandidate(input){ await this.init(); const record={...input,needId:null}; this.state.rawCandidates.unshift(record); this.state.rawCandidates=this.state.rawCandidates.slice(0,5000); await this.save(); return record; }
  async linkCandidateToNeed(candidateId,needId){ await this.init(); const item=this.state.rawCandidates.find(x=>x.id===candidateId); if(item)item.needId=needId; await this.save(); return item||null; }
  async findCandidateDuplicate({dedupeKey,fingerprint,candidate,similarityThreshold=.88}){ await this.init(); return this.state.rawCandidates.find(x=>x.dedupeKey===dedupeKey||x.fingerprint===fingerprint||contentSimilarity(x,candidate)>=similarityThreshold)||null; }
  async listRawCandidates({limit=50}={}){ await this.init(); return this.state.rawCandidates.slice(0,Math.min(100,limit)); }
  async seed({needs=[],helpers=[]}={}){ await this.init(); if(this.state.needs.length||this.state.helpers.length) return false; for(const input of needs){ const n=createNeed(input); if(n.origin==='native') n.status='open'; this.state.needs.push(n); } for(const input of helpers) this.state.helpers.push(createHelperProfile(input)); await this.save(); return true; }
  async listHelpers(){ await this.init(); return this.state.helpers; }
  async matches(needId,limit=5){ const n=await this.getNeed(needId); if(!n)return null; return rankHelpers(n,this.state.helpers,limit); }
}
