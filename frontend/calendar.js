export const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fromKey = (s) => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d,12); };
export const plusDays = (s,n) => { const d = fromKey(s); d.setDate(d.getDate()+n); return keyOf(d); };
export const weekStart = (s) => plusDays(s,-fromKey(s).getDay());
export const minutes = (s) => { const [h,m] = s.split(':').map(Number); return h*60+m; };
export const timeOf = (m) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
export const canRecord = (day,today) => day === today;
export const canEdit = (day,today) => day >= today;
export function monthCells(anchor) {
  const d = fromKey(anchor), first = keyOf(new Date(d.getFullYear(),d.getMonth(),1,12));
  const count = new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
  const leading = fromKey(first).getDay(), total = Math.ceil((leading+count)/7)*7;
  return Array.from({length:total},(_,i) => ({date:plusDays(first,i-leading),outside:i<leading || i>=leading+count}));
}
export function navigate(anchor, view, step) {
  if (view !== 'month') return plusDays(anchor,step*(view==='week'?7:1));
  const d = fromKey(anchor); return keyOf(new Date(d.getFullYear(),d.getMonth()+step,1,12));
}
export function eventLayout(tasks) {
  // Overlapping events share the day column; a new cluster reuses its full width.
  const sorted = [...tasks].sort((a,b)=>minutes(a.start)-minutes(b.start)||minutes(b.end)-minutes(a.end));
  const output=[]; let cluster=[],ends=[],finish=-1;
  const flush=()=> { for(const t of cluster) output.push({...t,lanes:ends.length}); cluster=[]; ends=[]; };
  for(const t of sorted) {
    const start=minutes(t.start),end=minutes(t.end);
    if(start>=finish) flush();
    let lane=ends.findIndex(e=>e<=start); if(lane<0) lane=ends.length;
    ends[lane]=end; finish=cluster.length?Math.max(finish,end):end; cluster.push({...t,lane});
  }
  flush(); return output;
}
