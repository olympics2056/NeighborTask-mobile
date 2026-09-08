import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { publicNeedView } from './domain/model.mjs';
const scrypt = promisify(crypto.scrypt);
export async function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}
export function createAdmin({store, json, readJson, username=process.env.ADMIN_USERNAME || 'admin', hash=process.env.ADMIN_PASSWORD_HASH || '', secure=process.env.NODE_ENV === 'production', now=()=>Date.now()}) {
  const sessions=new Map(), attempts=new Map();
  const cookieName='nt_admin';
  function cookie(res,value,maxAge) {res.setHeader('Set-Cookie',`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`);}
  function session(req) {
    const token=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    const s=sessions.get(token); if(!s||s.expires<=now()){sessions.delete(token);return null;} return {...s,token};
  }
  return async function admin(req,res,url) {
    if(!url.pathname.startsWith('/api/admin/')) return false;
    res.setHeader('Cache-Control','no-store');
    if(req.method==='POST' && req.headers.origin){
      let allowed=false;try{allowed=new URL(req.headers.origin).host===req.headers.host;}catch{}
      if(!allowed){json(res,403,{error:'跨站请求被拒绝'});return true;}
    }
    if(req.method==='POST' && url.pathname==='/api/admin/login') {
      if(!hash) {json(res,503,{error:'请在 Render 设置至少16位的 ADMIN_PASSWORD 或 ADMIN_PASSWORD_HASH。'});return true;}
      const ip=req.socket.remoteAddress; const time=now();
      for(const [k,v] of attempts)if(v.until<=time)attempts.delete(k);
      const a=attempts.get(ip)||{count:0,until:time+900000};
      if(a.count>=5){json(res,429,{error:'尝试次数过多，请15分钟后再试。'});return true;}
      a.count++;attempts.set(ip,a);
      const body=await readJson(req); const [salt,expected]=hash.split(':');
      if(!/^[a-f0-9]{32}$/i.test(salt||'')||!/^[a-f0-9]{128}$/i.test(expected||'')){json(res,503,{error:'管理员密码配置无效'});return true;}
      const actual=(await passwordHash(String(body.password||'').slice(0,1024),salt)).split(':')[1];
      if(body.username!==username||!crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex'))){json(res,401,{error:'用户名或密码错误'});return true;}
      attempts.delete(ip);
      for(const [k,v] of sessions)if(v.expires<=time)sessions.delete(k);
      if(sessions.size>=20)sessions.delete(sessions.keys().next().value);
      const token=crypto.randomBytes(32).toString('hex'), csrf=crypto.randomBytes(32).toString('hex');
      sessions.set(token,{username,csrf,expires:time+3600000});cookie(res,token,3600);
      json(res,200,{ok:true,username,csrf});return true;
    }
    const s=session(req);
    if(!s){json(res,401,{error:'请先登录管理员账号'});return true;}
    if(req.method!=='GET'&&req.headers['x-csrf-token']!==s.csrf){json(res,403,{error:'请求验证失败，请刷新后重试'});return true;}
    if(req.method==='GET'&&url.pathname==='/api/admin/session'){json(res,200,{ok:true,username:s.username,csrf:s.csrf});return true;}
    if(req.method==='POST'&&url.pathname==='/api/admin/logout'){sessions.delete(s.token);cookie(res,'',0);json(res,200,{ok:true});return true;}
    if(req.method==='GET'&&url.pathname==='/api/admin/dashboard'){
      await store.init();
      json(res,200,{ok:true,needs:store.state.needs.map(publicNeedView),helpers:store.state.helpers.map(h=>({id:h.id,displayName:h.displayName,categories:h.categories,active:h.active,approved:h.verified,demo:h.id.startsWith('helper_demo_')})),audit:(store.state.adminAudit||[]).slice(-100).reverse(),storage:process.env.NEIGHBORTASK_DATA_FILE?'已指定数据路径，请确认磁盘挂载':'临时存储：重新部署可能丢失数据',roles:{requester:'所有成员可求助',helper:'成员可同时申请 Helper',admin:'额外的管理权限'}});return true;
    }
    const match=url.pathname.match(/^\/api\/admin\/(needs|helpers)\/([^/]+)$/);
    if(req.method==='POST'&&match){
      const body=await readJson(req);
      try{await store.adminAction(match[1],decodeURIComponent(match[2]),body.action,String(body.reason||'').trim(),s.username);json(res,200,{ok:true});}
      catch(e){json(res,400,{error:e.message});}
      return true;
    }
    json(res,404,{error:'管理接口不存在'});return true;
  };
}
