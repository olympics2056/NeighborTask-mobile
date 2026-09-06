import { publicNeedView } from './model.mjs';
import { distanceMiles } from './matching.mjs';
export function publicNeedWithDistance(need, viewer){
  const view=publicNeedView(need);
  const d=distanceMiles(need.location,viewer);
  return {...view,distanceMiles:d===null?null:Number(d.toFixed(1)),matchable:need.status==='open'};
}
export function parseViewer(url){ const lat=Number(url.searchParams.get('lat')), lng=Number(url.searchParams.get('lng')); return {lat:Number.isFinite(lat)?lat:null,lng:Number.isFinite(lng)?lng:null}; }
