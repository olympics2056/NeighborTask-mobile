function rad(d){ return d*Math.PI/180; }
export function distanceMiles(a,b){
  if (![a?.lat,a?.lng,b?.lat,b?.lng].every(Number.isFinite)) return null;
  const R=3958.7613, dLat=rad(b.lat-a.lat), dLng=rad(b.lng-a.lng);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function overlap(a,b){ if(!a?.start||!b?.start) return 0.6; const as=Date.parse(a.start), ae=Date.parse(a.end||a.start), bs=Date.parse(b.start), be=Date.parse(b.end||b.start); if([as,ae,bs,be].some(Number.isNaN)) return 0.6; return Math.max(as,bs)<=Math.min(ae,be)?1:0; }
export function scoreMatch(need, helper){
  if (!helper.active || !helper.verified || need.status !== 'open') return { score:0, eligible:false, reasons:['Need/helper not matchable'] };
  const d=distanceMiles(need.location, helper.home);
  if (d!==null && d>helper.radiusMiles) return { score:0, eligible:false, distanceMiles:d, reasons:['Outside helper radius'] };
  const skill = helper.categories.includes(need.category) || helper.categories.includes('other') ? 1 : 0.2;
  const dist = d===null ? 0.45 : Math.max(0,1-d/helper.radiusMiles);
  const helpType = helper.helpTypes.includes('either') || helper.helpTypes.includes(need.helpType) || need.helpType==='either' ? 1 : 0.15;
  if (need.helpType === 'volunteer' && !helper.helpTypes.includes('volunteer') && !helper.helpTypes.includes('either')) return { score:0, eligible:false, distanceMiles:d, reasons:['Helper does not accept volunteer tasks'] };
  const hourly = need.compensation?.unit === 'hour' ? Number(need.compensation?.amount || 0) : null;
  if (need.helpType === 'paid' && hourly !== null && hourly < helper.minimumHourly) return { score:0, eligible:false, distanceMiles:d, reasons:['Below helper minimum hourly rate'] };
  const avail = helper.availability.length ? Math.max(...helper.availability.map(x=>overlap(need.time,x))) : 0.7;
  const reliability = helper.reliability;
  const urgency = need.urgency==='urgent'?1:need.urgency==='high'?0.85:0.65;
  const score = 100*(0.32*dist+0.28*skill+0.15*avail+0.10*helpType+0.10*reliability+0.05*urgency);
  return { score:Math.round(score), eligible:score>=50, distanceMiles:d===null?null:Number(d.toFixed(2)), reasons:[`distance ${Math.round(dist*100)}%`,`skill ${Math.round(skill*100)}%`,`availability ${Math.round(avail*100)}%`,`help type ${Math.round(helpType*100)}%`] };
}
export function rankHelpers(need, helpers, limit=5){ return helpers.map(h=>({helper:h, ...scoreMatch(need,h)})).filter(x=>x.eligible).sort((a,b)=>b.score-a.score).slice(0,limit); }
