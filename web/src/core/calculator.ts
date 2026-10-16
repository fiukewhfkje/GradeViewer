import {type Assignment,type SourceCourse,type Scenario,emptyScenario,graded,scorePercent} from './model';
export class CalculationError extends Error { constructor(public code:'unknownRules'|'incompleteData'|'invalidInput'|'noGradedAssignments'){super(code);} }
function aggregate(rows:Assignment[],method:'points'|'percent'):number {
 if(method==='percent'){if(rows.some(a=>scorePercent(a)===undefined))throw new CalculationError('incompleteData');return rows.reduce((s,a)=>s+scorePercent(a)!*a.multiplier,0)/rows.reduce((s,a)=>s+a.multiplier,0);}
 const possible=rows.reduce((s,a)=>s+a.score.possible!*a.multiplier,0);if(possible<=0)throw new CalculationError('noGradedAssignments');return rows.reduce((s,a)=>s+a.score.earned!*a.multiplier,0)/possible*100;
}
export function normalizeScenario(c:SourceCourse,h:Scenario):Scenario {const rows=new Map([...c.assignments,...h.added].map(a=>[a.id,a]));return {...h,scores:Object.fromEntries(Object.entries(h.scores).filter(([id,v])=>rows.has(id)&&Number.isFinite(v)&&(rows.get(id)!.score.earned===undefined||Math.abs(rows.get(id)!.score.earned!-v)>1e-9))),ignored:h.ignored.filter(id=>rows.has(id))};}
export function calculate(c:SourceCourse,h:Scenario=emptyScenario()):number {
 if(c.method==='unknown')throw new CalculationError('unknownRules');
 const included=[...c.assignments,...h.added].filter(a=>!h.ignored.includes(a.id)&&!a.excluded&&!a.score.excused&&!c.categories.some(k=>k.id===a.categoryID&&k.excluded)).map(a=>({...a,score:{...a.score,earned:h.scores[a.id]??a.score.earned}}));
 if(included.some(a=>graded(a)&&a.score.earned===undefined))throw new CalculationError('incompleteData');
 const rows=included.filter(a=>a.score.earned!==undefined);
 if(rows.some(a=>!Number.isFinite(a.score.earned)||!Number.isFinite(a.score.possible)||(a.score.possible??-1)<0||!Number.isFinite(a.multiplier)||a.multiplier<=0))throw new CalculationError('invalidInput');
 if(!rows.length)throw new CalculationError('noGradedAssignments');if(c.method==='points')return aggregate(rows,'points');
 let sum=0,weight=0;
 for(const category of c.categories.filter(k=>!k.excluded)) {
  let group=rows.filter(a=>a.categoryID===category.id);if(!group.length)continue;
  if(!Number.isSafeInteger(category.dropLowest)||category.dropLowest<0)throw new CalculationError('invalidInput');
  group=group.sort((a,b)=>(scorePercent(a)??Infinity)-(scorePercent(b)??Infinity)).slice(category.dropLowest);if(!group.length)continue;
  const w=c.method==='equalCategories'?1:category.weight;if(w===undefined||!Number.isFinite(w)||w<0)throw new CalculationError('unknownRules');if(w===0)continue;
  sum+=aggregate(group,category.method)*w;weight+=w;
 }
 if(rows.some(a=>!c.categories.some(k=>k.id===a.categoryID)))throw new CalculationError('incompleteData');if(weight<=0)throw new CalculationError('noGradedAssignments');return sum/weight;
}
export function safelyCalculate(c:SourceCourse,h?:Scenario){try{return calculate(c,h);}catch{return undefined;}}
export function reliable(c:SourceCourse){const n=safelyCalculate(c);return n!==undefined&&c.grade.percent!==undefined&&Math.abs(n-c.grade.percent)<=.15;}
export function hypothetical(c:SourceCourse,h:Scenario){if(!reliable(c))return undefined;return c.grade.percent!+calculate(c,normalizeScenario(c,h))-calculate(c);}
export function requiredFinal(current:number,target:number,weight:number){if(![current,target,weight].every(Number.isFinite)||current<0||target<0||weight<=0||weight>1)throw new CalculationError('invalidInput');return (target-current*(1-weight))/weight;}
