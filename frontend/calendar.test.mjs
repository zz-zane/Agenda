import assert from 'node:assert/strict';
import {monthCells,navigate,weekStart,canRecord,canEdit,eventLayout,completionByDay,allTimeProgress,checkinSummary,plusDays} from './calendar.js';
const september=monthCells('2026-09-12');
assert.equal(september.length,35);
assert.equal(september[0].date,'2026-08-30');
assert.equal(september[2].date,'2026-09-01');
assert.equal(monthCells('2028-02-01').filter(x=>!x.outside).length,29);
assert.equal(navigate('2026-01-31','month',1),'2026-02-01');
assert.equal(weekStart('2026-09-12'),'2026-09-06');
assert(canRecord('2026-09-12','2026-09-12'));
assert(!canRecord('2026-09-11','2026-09-12'));
assert(!canRecord('2026-09-13','2026-09-12'));
assert(!canEdit('2026-09-11','2026-09-12'));
const layout=eventLayout([{id:1,start:'08:30',end:'10:00'},{id:2,start:'09:00',end:'10:30'},{id:3,start:'10:30',end:'11:00'}]);
assert.deepEqual(layout.map(t=>[t.lane,t.lanes]),[[0,2],[1,2],[0,1]]);
console.log('Calendar dates, permissions and overlapping event placement passed.');
const counts=completionByDay([
  {date:'2026-09-19'}, {date:'2026-09-19',done:1,origin:'course'},
  {date:'2026-09-19',done:1,goal_id:'learning'},
  {date:'2026-09-19',done:1,superseded:1},
  {date:'2026-08-19',done:1},
]);
assert.deepEqual(counts.get('2026-09-19'),{done:2,total:3});
assert.deepEqual(counts.get('2026-08-19'),{done:1,total:1});
assert.equal(completionByDay([]).size,0);
console.log('Completion totals include courses and learning tasks, exclude replaced tasks, and keep dates separate.');
const course=Array.from({length:100},(_,i)=>({date:plusDays('2026-08-30',i),title:'离散数学',origin:'course-'+i,done:i<20?1:0}));
assert.deepEqual(allTimeProgress(course),[{key:'course:离散数学',title:'离散数学',done:20,total:100,percent:20}]);
course[20].done=1;
assert.equal(allTimeProgress(course)[0].percent,21);
assert.equal(allTimeProgress([...course,{...course[0],superseded:1}])[0].total,100);
assert.equal(allTimeProgress([{title:'章节一',goal_id:'g',done:1},{title:'章节二',goal_id:'g'}],[{id:'g',title:'完整目标'}])[0].percent,50);
const checkins=['2026-08-30','2026-08-31','2026-09-01','2026-09-02'].map(date=>({date}));
const dates=monthCells('2026-09-03').filter(c=>!c.outside).map(c=>c.date);
assert.deepEqual(checkinSummary(dates,'2026-09-03',checkins),{active:2,elapsed:3,rate:67,streak:4});
assert.equal(checkinSummary(dates,'2026-09-04',checkins).streak,0);
assert.deepEqual(checkinSummary(dates,'2026-08-31',checkins),{active:0,elapsed:0,rate:null,streak:0});
assert.equal(checkinSummary(dates,'2026-10-01',checkins).elapsed,30);
assert.deepEqual(allTimeProgress([]),[]);
console.log('All-time 20/100 progress and check-in rate/streak boundaries passed.');
