import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Dumbbell, HeartPulse, BookOpen, Camera, Save } from "lucide-react";
import { apiErrorMessage } from "../api/errors";
import { type IdealHumanDay, useIdealHumanDays, useSaveIdealHumanDay } from "../api/ideal-human";

const START = Date.UTC(2026, 10, 3);
const dates = Array.from({ length: 30 }, (_, i) => new Date(START + i * 86_400_000).toISOString().slice(0, 10));
const dayNumber = (date:string) => dates.indexOf(date) + 1;
function todayInAstana(): string {
  return new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Almaty", year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}
function blank(date:string):IdealHumanDay {
  return {date, weightKg:null,sleepMinutes:null,caloriesKcal:null,proteinG:null,training:null,
    scienceMinutes:null,scienceTopic:"",scienceTakeaway:"",englishMinutes:null,codingMinutes:null,
    filmingMinutes:null,footageBackedUp:null,energy:null,highlights:"",notes:""};
}
const inputClass = "mt-1 w-full min-h-11 rounded-lg border border-white/15 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-cyan-400";
const panelClass = "rounded-xl border border-white/10 bg-white/[0.03] p-4";
const labelClass = "block text-xs font-medium text-zinc-300";
function NumberField({title, value, onChange, step = 1, max}:{
  title:string;value:number|null;onChange:(value:number|null)=>void;step?:number;max?:number;
}) {
  return <label className={labelClass}>{title}
    <input className={inputClass} type="number" inputMode="decimal" min="0" max={max} step={step}
      value={value ?? ""} onChange={event => onChange(event.target.value === "" ? null : Number(event.target.value))} />
  </label>;
}

export function IdealHumanScreen({onOpenWorkout,onOpenHealth,onOpenStudy}:{
  onOpenWorkout:()=>void;onOpenHealth:()=>void;onOpenStudy:()=>void;
}) {
  const now = todayInAstana();
  const initial = now < dates[0] ? dates[0] : now > dates[29] ? dates[29] : now;
  const [date,setDate] = useState(initial);
  const [draft,setDraft] = useState<IdealHumanDay>(() => blank(initial));
  const [dirty,setDirty] = useState(false);
  const [saved,setSaved] = useState(false);
  const query = useIdealHumanDays();
  const mutation = useSaveIdealHumanDay();
  const record = query.data?.find(day=>day.date===date);
  useEffect(() => {
    if (!dirty) setDraft(record ?? blank(date));
  }, [date,record,dirty]);
  const stats = useMemo(() => {
    const days = query.data ?? [];
    const measured = days.filter(day=>day.weightKg !== null).map(day=>day.weightKg!);
    const sleep = days.filter(day=>day.sleepMinutes !== null).map(day=>day.sleepMinutes!);
    return {
      saved:days.length,
      gyms:days.filter(day=>day.training==="gym").length,
      science:days.reduce((s,d)=>s+(d.scienceMinutes??0),0),
      film:days.filter(day=>(day.filmingMinutes??0)>0).length,
      avgWeight:measured.length ? measured.reduce((a,b)=>a+b,0)/measured.length:null,
      avgSleep:sleep.length ? sleep.reduce((a,b)=>a+b,0)/sleep.length:null,
    };
  }, [query.data]);
  function change<K extends keyof IdealHumanDay>(key:K,value:IdealHumanDay[K]) {
    setDraft(previous=>({...previous,[key]:value}));
    setDirty(true);
    setSaved(false);
  }
  function navigateDate(next:string) {
    if (dirty && !window.confirm("Есть несохранённые изменения. Перейти к другому дню?")) return;
    setDirty(false); setSaved(false); setDate(next);
    setDraft(query.data?.find(d=>d.date===next) ?? blank(next));
  }
  async function save() {
    try {
      await mutation.mutateAsync(draft);
      setDirty(false);setSaved(true);
    } catch { setSaved(false); }
  }
  function exportCsv() {
    const fields = ["date","weightKg","sleepMinutes","caloriesKcal","proteinG","training","scienceMinutes","englishMinutes","codingMinutes","filmingMinutes","footageBackedUp","energy"] as const;
    const quote=(v:unknown)=>'"'+String(v??"").replaceAll('"','""')+'"';
    const csv=[fields.join(","),...(query.data??[]).map(day=>fields.map(f=>quote(day[f])).join(","))].join("\r\n");
    const url=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}));
    const link=document.createElement("a");link.href=url;link.download="ideal-human-2026.csv";link.click();
    URL.revokeObjectURL(url);
  }
  return <div className="space-y-4 pb-5">
    <header className={panelClass}>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">IDEAL HUMAN • 2026</p>
      <h1 className="mt-2 text-2xl font-bold text-white">DAY {String(dayNumber(date)).padStart(2,"0")} / 30</h1>
      <p className="mt-1 text-sm text-zinc-400">3 ноября — 2 декабря · Не идеальное расписание, а честный эксперимент.</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-cyan-400" style={{width: `${stats.saved/30*100}%`}} />
      </div>
      <p className="mt-2 text-xs text-zinc-400">Дней с сохранёнными записями: {stats.saved}/30. Пропуски не засчитываются.</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-white/5 p-2"><div className="text-lg text-white">{stats.gyms}</div><div className="text-[10px] text-zinc-400">Зал, дней</div></div>
        <div className="rounded-lg bg-white/5 p-2"><div className="text-lg text-white">{stats.science}</div><div className="text-[10px] text-zinc-400">Наука, мин</div></div>
        <div className="rounded-lg bg-white/5 p-2"><div className="text-lg text-white">{stats.film}</div><div className="text-[10px] text-zinc-400">Снято, дней</div></div>
      </div>
      <p className="mt-3 text-xs text-zinc-500">Средний вес: {stats.avgWeight===null?"нет данных":stats.avgWeight.toFixed(1)+" кг"} · средний сон: {stats.avgSleep===null?"нет данных":(stats.avgSleep/60).toFixed(1)+" ч"} (только измеренные дни).</p>
    </header>
    <section className={panelClass}>
      <label className="flex items-center gap-2 text-sm font-semibold text-white" htmlFor="ideal-human-day"><CalendarDays className="h-4 w-4 text-cyan-300"/> Выбери день</label>
      <select id="ideal-human-day" className={inputClass} value={date} onChange={event=>navigateDate(event.target.value)}>
        {dates.map((d,i)=><option value={d} key={d}>День {i+1} · {d}{query.data?.some(item=>item.date===d)?" ✓":""}</option>)}
      </select>
      {date>now ? <p className="mt-2 text-xs text-amber-300">Будущие дни лучше заполнять после фактического выполнения.</p> : null}
    </section>
    {query.isLoading ? <p className="text-sm text-zinc-400">Загружаем дневник…</p> : query.isError ? <p className="text-sm text-rose-300">Не удалось загрузить дневник. <button className="underline" onClick={()=>void query.refetch()}>Повторить</button></p> : <>
      <section className={panelClass}>
        <h2 className="flex items-center gap-2 font-semibold text-white"><HeartPulse className="h-4 w-4 text-emerald-300"/> Тело и восстановление</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <NumberField title="Утренний вес, кг" step={0.1} max={300} value={draft.weightKg} onChange={v=>change("weightKg",v)}/>
          <NumberField title="Сон, минут" max={1440} value={draft.sleepMinutes} onChange={v=>change("sleepMinutes",v)}/>
          <NumberField title="Калории, ккал (оценка)" max={10000} value={draft.caloriesKcal} onChange={v=>change("caloriesKcal",v)}/>
          <NumberField title="Белок, г (оценка)" step={0.1} max={400} value={draft.proteinG} onChange={v=>change("proteinG",v)}/>
        </div>
        <label className={labelClass + " mt-3"}>Активность / восстановление
          <select className={inputClass} value={draft.training ?? ""} onChange={e=>change("training",(e.target.value||null) as IdealHumanDay["training"])}>
            <option value="">Нет записи</option><option value="gym">Тренировка в зале</option><option value="recovery">День восстановления</option><option value="other">Другая активность</option><option value="none">Не тренировался</option>
          </select>
        </label>
        <label className={labelClass + " mt-3"}>Энергия (1–5)
          <select className={inputClass} value={draft.energy??""} onChange={e=>change("energy",e.target.value?Number(e.target.value):null)}>
            <option value="">Нет оценки</option>{[1,2,3,4,5].map(n=><option value={n} key={n}>{n}</option>)}
          </select>
        </label>
        <button className="mt-3 min-h-11 rounded-lg border border-emerald-400/30 px-3 text-sm text-emerald-200" onClick={onOpenWorkout}><Dumbbell className="mr-1 inline h-4 w-4"/> Подходы и история тренировок</button>
        <button className="ml-2 mt-3 min-h-11 rounded-lg border border-white/20 px-3 text-sm text-zinc-300" onClick={onOpenHealth}>Health Connect</button>
      </section>
      <section className={panelClass}>
        <h2 className="flex items-center gap-2 font-semibold text-white"><BookOpen className="h-4 w-4 text-violet-300"/> Интеллект</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <NumberField title="Науки, минут" max={900} value={draft.scienceMinutes} onChange={v=>change("scienceMinutes",v)}/>
          <NumberField title="Английский, минут" max={900} value={draft.englishMinutes} onChange={v=>change("englishMinutes",v)}/>
          <NumberField title="Программирование, мин" max={900} value={draft.codingMinutes} onChange={v=>change("codingMinutes",v)}/>
        </div>
        <label className={labelClass + " mt-3"}>Тема (нейробиология / кибернетика)
          <input className={inputClass} maxLength={160} value={draft.scienceTopic} onChange={e=>change("scienceTopic",e.target.value)}/>
        </label>
        <label className={labelClass + " mt-3"}>Что понял (3–5 предложений + пример применения)
          <textarea className={inputClass} rows={4} maxLength={1500} value={draft.scienceTakeaway} onChange={e=>change("scienceTakeaway",e.target.value)}/>
        </label>
        <button className="mt-3 min-h-11 rounded-lg border border-violet-400/30 px-3 text-sm text-violet-200" onClick={onOpenStudy}>Перейти к учёбе и дедлайнам</button>
      </section>
      <section className={panelClass}>
        <h2 className="flex items-center gap-2 font-semibold text-white"><Camera className="h-4 w-4 text-amber-300"/> Документальный фильм</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <NumberField title="Съёмка, минут" max={900} value={draft.filmingMinutes} onChange={v=>change("filmingMinutes",v)}/>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={draft.footageBackedUp===true} onChange={e=>change("footageBackedUp",e.target.checked)} />
          Исходники скопированы и проверены
        </label>
        <label className={labelClass + " mt-3"}>Что сегодня стоит показать в фильме?
          <textarea className={inputClass} rows={2} maxLength={500} value={draft.highlights} onChange={e=>change("highlights",e.target.value)}/>
        </label>
        <label className={labelClass + " mt-3"}>Честная заметка о дне (включая сложности)
          <textarea className={inputClass} rows={3} maxLength={2000} value={draft.notes} onChange={e=>change("notes",e.target.value)}/>
        </label>
        <p className="mt-2 text-xs text-zinc-500">Не включай в видео приватные экраны, закрытые проекты и чужие данные.</p>
      </section>
      {mutation.isError ? <p role="alert" className="text-sm text-rose-300">{apiErrorMessage(mutation.error)}</p> : null}
      <button type="button" disabled={mutation.isPending||query.isError||date>now} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 font-semibold text-zinc-950 disabled:opacity-50" onClick={()=>void save()}>
        {saved&&!dirty?<Check className="h-5 w-5"/>:<Save className="h-5 w-5"/>}
        {mutation.isPending?"Сохраняем…":saved&&!dirty?"Сохранено":"Сохранить день"}
      </button>
      <button className="min-h-11 w-full text-xs text-zinc-500 underline" type="button" onClick={exportCsv}>Экспорт метрик для монтажа (CSV, без личных заметок)</button>
    </>}
    <p className="text-xs text-zinc-600">В дни 7, 14, 21 и 30 подведи итоги. Пустое поле означает «нет данных», а не ноль. Отдых — часть эксперимента.</p>
  </div>;
}
