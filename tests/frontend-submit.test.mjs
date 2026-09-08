import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
const source=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
function setup({rejectPost=false,rejectFeed=false}={}){
  const elements=new Map();let handler,posts=0,feeds=0,release;
  const gate=new Promise(resolve=>release=resolve);
  const button={disabled:false};
  function element(s){if(!elements.has(s))elements.set(s,{dataset:{},innerHTML:'',textContent:'',classList:{add(){},remove(){}},addEventListener(type,fn){if(s==='#needForm')handler=fn;},querySelector(){return button;},reset(){this.resets=(this.resets||0)+1;},close(){this.closed=true;}});return elements.get(s);}
  const context={document:{querySelector:element,querySelectorAll:()=>[]},navigator:{},setTimeout:()=>0,FormData:class{get(key){return ({title:'Test request',category:'yard',description:'Test only',helpType:'either',locationLabel:'Naperville'})[key];}},
    fetch:async(url,options)=>{if(options?.method==='POST'){posts++;await gate;if(rejectPost)return {ok:false,json:async()=>({error:'Save failed'})};return {ok:true,json:async()=>({ok:true})};}feeds++;return {ok:!rejectFeed,json:async()=>rejectFeed?({error:'Feed unavailable'}):({needs:[{id:'test',category:'yard',title:'Test request',origin:'native',location:{label:'Naperville'},matchable:true}]})};}};
  vm.runInNewContext(source,context);
  return {element,button,release,submit(){const e={preventDefault(){},currentTarget:element('#needForm')};const promise=handler(e);e.currentTarget=null;return promise;},counts:()=>({posts,feeds})};
}
test('browser event currentTarget clears after dispatch: successful POST resets and refreshes without false error',async()=>{
  const f=setup();const pending=f.submit();assert.equal(f.button.disabled,true);
  await f.submit();assert.equal(f.counts().posts,1);
  f.release();await pending;
  assert.equal(f.element('#needForm').resets,1);assert.equal(f.element('#needDialog').closed,true);
  assert.equal(f.element('#toast').textContent,'Request posted');assert.equal(f.counts().feeds,2);
  assert.match(f.element('#feed').innerHTML,/Test request/);assert.equal(f.button.disabled,false);
});
test('failed POST keeps form and permits retry without resetting it',async()=>{
  const f=setup({rejectPost:true});const pending=f.submit();f.release();await pending;
  assert.equal(f.element('#needForm').resets,undefined);assert.equal(f.element('#needDialog').closed,undefined);
  assert.equal(f.element('#toast').textContent,'Save failed');assert.equal(f.button.disabled,false);
  assert.equal(f.element('#needForm').dataset.submitting,undefined);
});
test('feed failure after saved POST does not misreport publication failure',async()=>{
  const f=setup({rejectFeed:true});const pending=f.submit();f.release();await pending;
  assert.equal(f.element('#toast').textContent,'Request posted');assert.match(f.element('#feed').innerHTML,/Feed unavailable/);
  assert.equal(f.counts().posts,1);assert.equal(f.button.disabled,false);
});
