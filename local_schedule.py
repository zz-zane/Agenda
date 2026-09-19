"""Bounded rule expansion; existing proposal validation remains the write gate."""
from collections import defaultdict
from datetime import date, timedelta
from time import monotonic

# Mainland holiday dates; school calendars may differ. Never extrapolate other years.
HOLIDAYS = {'year': 2026, 'source': 'https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm',
            'ranges': [{'name': '元旦', 'from_date': '2026-01-01', 'to_date': '2026-01-03'},
                       {'name': '中秋', 'from_date': '2026-09-25', 'to_date': '2026-09-27'},
                       {'name': '国庆', 'from_date': '2026-10-01', 'to_date': '2026-10-07'}]}


def days(app, start, end):
    app.valid_date(start); app.valid_date(end)
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    if not 0 <= (b-a).days < 366: raise ValueError('日期范围须为1至366天')
    return [(a+timedelta(days=n)).isoformat() for n in range((b-a).days+1)]


def gaps(windows, occupied):
    result = []
    for lo, hi in windows:
        cursor = lo
        for a, b in sorted(occupied):
            if b <= cursor or a >= hi: continue
            if cursor < a: result.append((cursor, min(a, hi)))
            cursor = max(cursor, b)
        if cursor < hi: result.append((cursor, hi))
    return result


def clock(m):
    return f'{m//60:02d}:{m%60:02d}'


def query(ctx, app, from_date, to_date, goal_id):
    dates = days(app, from_date, to_date)
    goal = next((g for g in ctx['goals'] if g['id'] == goal_id), None)
    if goal_id and not goal: raise ValueError('目标不存在')
    result = []
    for day in dates:
        tasks = [t for t in ctx['tasks'] if t['date'] == day and not t.get('superseded')]
        busy = [(app.minutes(t['start']), app.minutes(t['end'])) for t in tasks
                if not (goal and t.get('goal_id') == goal_id and not t.get('done'))]
        begin = max(510, app.minutes(ctx['now'])+1) if day == ctx['today'] else 510
        result.append({'date': day, 'weekday': date.fromisoformat(day).isoweekday(),
                       'courses': [t for t in tasks if t.get('origin')],
                       'other_tasks': [t for t in tasks if not t.get('origin')],
                       'free_windows': [{'start': clock(a), 'end': clock(b), 'minutes': b-a}
                                        for a, b in gaps([(begin, 1440)], busy)] if day >= ctx['today'] else []})
    return {'today': ctx['today'], 'now': ctx['now'], 'goal': goal, 'days': result,
            'holiday_reference': HOLIDAYS, 'note': '按实际日期读取；空档仅排除所选目标的未完成任务，其他目标仍占用。'}


def expand(ctx, app, request):
    start, end = request['from_date'], request['to_date']
    dates = days(app, start, end); app.valid_date(request['deadline'])
    if start < ctx['today'] or end > request['deadline']: raise ValueError('排期只能从今天起，不能超出截止日')
    old = next((g for g in ctx['goals'] if g['id'] == request['goal_id']), None)
    if request['goal_id'] and not old: raise ValueError('原目标不存在')
    rules = request['rules']
    if not isinstance(rules, list) or not 1 <= len(rules) <= 12: raise ValueError('需要1至12条排期规则')
    required = {'topic_id','title','until','minutes','per_week','skip_courses','preferred_start','preferred_end'}
    seen = set()
    for r in rules:
        if not isinstance(r, dict) or set(r) != required: raise ValueError('排期规则字段不完整')
        if not isinstance(r['topic_id'], str) or not 1 <= len(r['topic_id']) <= 100 or r['topic_id'] in seen: raise ValueError('规则 topic_id 必须唯一')
        seen.add(r['topic_id'])
        if not isinstance(r['title'], str) or not 1 <= len(r['title']) <= 100: raise ValueError('规则名称无效')
        if type(r['minutes']) is not int or not 5 <= r['minutes'] <= 600 or r['minutes'] % 5: raise ValueError('连续时长须为5至600分钟且为5的倍数')
        if type(r['per_week']) is not int or not 0 <= r['per_week'] <= 7: raise ValueError('每周次数须为0至7，0表示每天')
        if not isinstance(r['skip_courses'], list) or len(r['skip_courses']) > 20 or any(not isinstance(c, str) or not 1 <= len(c.strip()) <= 100 for c in r['skip_courses']): raise ValueError('跳过条件须为明确课程名称列表')
        app.valid_date(r['until'])
        if r['until'] > request['deadline']: raise ValueError('科目停止日期不能晚于目标截止日')
        if not isinstance(r['preferred_start'], str) or not isinstance(r['preferred_end'], str): raise ValueError('偏好时间须为时间文本或空字符串')
        if r['preferred_start'] or r['preferred_end']:
            if app.minutes(r['preferred_start']) >= app.minutes(r['preferred_end']): raise ValueError('偏好时间范围无效')
    if old and seen != {t['id'] for t in old['topics']}: raise ValueError('请对原目标的每个 topic_id 提供规则，不能丢弃原大纲；使用 get_schedule 查看原目标')
    windows = request['windows']
    if not isinstance(windows, list) or not 1 <= len(windows) <= 12: raise ValueError('需要明确可用时间窗口')
    available = []
    for w in windows:
        if not isinstance(w, dict) or set(w) != {'start','end'}: raise ValueError('可用窗口字段无效')
        a, b = app.minutes(w['start']), app.minutes(w['end'])
        if not 510 <= a < b <= 1440: raise ValueError('可用时段须在08:30至24:00内')
        available.append((a,b))
    available.sort()
    if any(b > c for (a,b),(c,d) in zip(available,available[1:])): raise ValueError('可用窗口不能重叠')
    blocked = request['blocked']
    if not isinstance(blocked, list) or len(blocked) > 32: raise ValueError('不可用区间过多')
    busy = defaultdict(list)
    for block in blocked:
        if not isinstance(block, dict) or set(block) != {'from_date','to_date','start','end'}: raise ValueError('不可用区间字段无效')
        a,b = app.minutes(block['start']),app.minutes(block['end'])
        if a >= b: raise ValueError('不可用时间范围无效')
        for day in days(app, block['from_date'], block['to_date']): busy[day].append((a,b))
    active = [t for t in ctx['tasks'] if not t.get('superseded')]
    own = [t for t in active if old and t.get('goal_id') == old['id']]
    kept = [t for t in own if not t.get('done') and t['date'] >= ctx['today'] and not start <= t['date'] <= end]
    for task in active:
        if task in own and not task.get('done') and start <= task['date'] <= end: continue
        busy[task['date']].append((app.minutes(task['start']),app.minutes(task['end'])))
    if ctx['today'] in dates: busy[ctx['today']].append((0, (app.minutes(ctx['now'])//5+1)*5))
    weeks = defaultdict(list)
    for day in dates:
        d=date.fromisoformat(day);weeks[(d-timedelta(days=d.weekday())).isoformat()].append(day)
    sessions = [{k:t.get(k,'') for k in ('topic_id','date','title','start','end','note')} for t in kept]
    # ponytail: bounded weekly backtracking, not an optimal solver; report search exhaustion honestly.
    budget = [20000]
    search_deadline = monotonic()+5
    for monday, week in weeks.items():
        sunday=(date.fromisoformat(monday)+timedelta(days=6)).isoformat()
        jobs=[];used=defaultdict(set)
        for r in rules:
            completed=[t for t in own if t.get('done') and t.get('topic_id')==r['topic_id']
                       and monday <= t['date'] <= sunday and app.minutes(t['end'])-app.minutes(t['start']) >= r['minutes']]
            used[r['topic_id']].update(t['date'] for t in completed)
            used[r['topic_id']].update(t['date'] for t in kept if t.get('topic_id')==r['topic_id'] and monday<=t['date']<=sunday and app.minutes(t['end'])-app.minutes(t['start'])>=r['minutes'])
            eligible=[day for day in week if day <= r['until'] and day not in used[r['topic_id']]
                      and not any(t['date']==day and t.get('origin') and any(c.casefold() in t['title'].casefold() for c in r['skip_courses']) for t in active)]
            if r['per_week']:
                if not any(day <= r['until'] for day in week): continue
                count=max(0,r['per_week']-len(used[r['topic_id']]))
                jobs.extend((r,eligible) for _ in range(count))
            else: jobs.extend((r,[day]) for day in eligible)
        if len(jobs)>84 or len(sessions)+len(jobs)>1000: raise ValueError('排期超过1000项或每周84项，请分批安排')
        added=[]
        def candidates(job):
            r, eligible=job; choices=[]
            pref=(app.minutes(r['preferred_start']),app.minutes(r['preferred_end'])) if r['preferred_start'] else None
            for day in eligible:
                if day in used[r['topic_id']]: continue
                for a,b in gaps(available,busy[day]):
                    a=(a+4)//5*5
                    if b-a < r['minutes']: continue
                    starts={a, (b-r['minutes'])//5*5}
                    if pref: starts.add(max(a,(pref[0]+4)//5*5))
                    for time in sorted(starts):
                        if time+r['minutes']>b: continue
                        miss=bool(pref and not (pref[0]<=time and time+r['minutes']<=pref[1]))
                        choices.append((miss,day,time))
            return sorted(choices)
        def place(remaining):
            if not remaining: return True
            budget[0]-=1
            if budget[0]<=0 or monotonic()>search_deadline: return False
            options=[(candidates(job),i,job) for i,job in enumerate(remaining)]
            choices,i,(r,eligible)=min(options,key=lambda v:(len(v[0]),-v[2][0]['minutes'],v[1]))
            for _,day,time in choices:
                interval=(time,time+r['minutes']);busy[day].append(interval);used[r['topic_id']].add(day)
                added.append({'topic_id':r['topic_id'],'date':day,'title':r['title'],'start':clock(time),'end':clock(interval[1]),'note':'按已确认的频次、连续时长和课程跳过条件安排'})
                if place(remaining[:i]+remaining[i+1:]): return True
                added.pop();used[r['topic_id']].remove(day);busy[day].remove(interval)
            return False
        if not place(jobs):
            needs='；'.join(f"{r['title']} {r['minutes']}分钟×{sum(j[0] is r for j in jobs)}次" for r in rules if any(j[0] is r for j in jobs))
            raise ValueError(f'{monday}这一周未找到满足全部要求的安排（{needs}）。未减少任何次数或时长；请核对窗口/现有日程，或明确调整规则。这不是无解证明。')
        sessions.extend(added)
    if not sessions: raise ValueError('该范围没有需要新增的安排')
    sessions.sort(key=lambda s:(s['date'],s['start']))
    totals=defaultdict(int)
    for s in sessions: totals[s['topic_id']]+=app.minutes(s['end'])-app.minutes(s['start'])
    topics=old['topics'] if old else [{'id':r['topic_id'],'title':r['title'],'minutes':totals[r['topic_id']]} for r in rules if totals[r['topic_id']]]
    return {'goal_id':request['goal_id'],'title':old['title'] if old else request['title'],
            'mode':old['mode'] if old else request['mode'],'deadline':request['deadline'],
            'topics':topics,'sessions':sessions,'reason':request['reason'], 'schedule_request':request}
