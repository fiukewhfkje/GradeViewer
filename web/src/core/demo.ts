import {parseSection,type Row} from './parser';
import {calculate} from './calculator';
import {reconcile} from './reconcile';
export const SYNTHETIC_ACCOUNT='sample-student';
export function syntheticPayload(sectionID='100',now=Date.now()) {
 const year=new Date(now).getUTCFullYear(),start=`${year}-08-15`,q1End=`${year}-10-15`,q2Start=`${year}-10-16`,end=`${year}-12-20`;
 const titles=['AP Biology','AP Physics 1','Computer Science A','English Literature','Calculus BC'],index=Math.max(0,Number(sectionID)-100),title=titles[index%titles.length];
 const periods=[{id:'1',title:'Quarter 1',start,end:q1End,weight:45},{id:'2',title:'Quarter 2',start:q2Start,end,weight:45},{id:'3',title:'Semester 1',start,end,weight:100},{id:'4',title:'Exam',start:`${year}-12-18`,end,weight:10}];
 const names=['Cell structure practice','Enzyme investigation','Unit 2 assessment','Reading response','Lab reflection','Weekly practice','Discussion: evidence','Practice review'];
 const items:Row[]=[],gradePeriods:Row[]=[],totals:Row[]=[];
 for(const pid of ['1','2']){const rows:Row[]=[];for(let i=0;i<8;i++){const id=String(Number(pid)*1000+i),category=i%3===2?'2':'1',possible=i%3===2?100:20,earned=possible-(i+index)%5;const periodStart=Date.parse(pid==='1'?start:q2Start),periodEnd=Math.min(now,Date.parse(pid==='1'?q1End:end)+86399000),updated=periodStart+(periodEnd-periodStart)*(i+1)/9;items.push({id,grade_item_id:id,type:'assignment',title:names[i],grading_category:category,grading_period:pid,max_points:possible,due:new Date(updated+86400000).toISOString(),factor:1});rows.push({assignment_id:id,type:'assignment',grade:earned,max_points:possible,category_id:category,exception:0,timestamp:Math.floor(updated/1000)});}items.push({id:`${pid}999`,title:'Upcoming assignment',type:'assignment',grading_period:pid,grading_category:'1',max_points:20});gradePeriods.push({period_id:'p'+pid,assignment:{grade:rows}});totals.push({period_id:'p'+pid,grade:93-index,scale_id:0,weight:45});}
 const section:Row={id:sectionID,course_title:title,teacher_display:'Sample Teacher',options:{weighted_grading_categories:1}},categories:Row[]=[{id:'1',title:'Practice',weight:30,calculation_type:2,drop_lowest:0},{id:'2',title:'Assessments',weight:70,calculation_type:2,drop_lowest:0}];
 const grades:Row={section:[{section_id:sectionID,period:gradePeriods,final_grade:totals}]};const parsed=parseSection({section,grades,items,categories,periods,owner:sectionID,fetched:now});for(const p of parsed.filter(p=>p.term.id==='p1'||p.term.id==='p2')){const total=totals.find(t=>t.period_id===p.term.id)!;total.grade=calculate(p);}totals.push({period_id:'p3',grade:totals.reduce((s,r)=>s+Number(r.grade),0)/2,scale_id:0,weight:100});
 return {section,grades,items,categories,periods};
}
export function demoCourses(now=Date.now()){return reconcile(Array.from({length:5},(_,i)=>{const sectionID=String(100+i),p=syntheticPayload(sectionID,now);return parseSection({...p,owner:sectionID,fetched:now});}).flat(),[],now);}
