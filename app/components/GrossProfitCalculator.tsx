'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';

// ── 定数 ─────────────────────────────────────────────────
const WARN = 90;

// ── 型 ───────────────────────────────────────────────────
type ColKey = 'revenue' | 'ext' | 'ot' | 'hol' | 'night' | 'labor' | 'ins';
type MD = Record<ColKey, string>;

const emptyMD = (): MD => ({ revenue: '', ext: '', ot: '', hol: '', night: '', labor: '', ins: '' });
const pf = (s?: string) => parseFloat(s ?? '') || 0;
const fmt = (n: number, d = 0) => n.toLocaleString('ja-JP', { maximumFractionDigits: d });

function blockInvalid(e: React.KeyboardEvent<HTMLInputElement>) {
  if (['e', 'E', '+'].includes(e.key)) { e.preventDefault(); return; }
  if (e.key === '-' && (e.target as HTMLInputElement).value.includes('-')) e.preventDefault();
}

// ── Canvas グラフ描画 ─────────────────────────────────────
function drawChart(
  canvas: HTMLCanvasElement,
  months: number[],
  rates: (number | null)[],
  targetRate: number | null,
) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  if (!W || !H) return;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const ml = 44, mr = 48, mt = 16, mb = 28;
  const iW = W - ml - mr, iH = H - mt - mb;
  const n = months.length;

  const valid = rates.filter((r): r is number => r !== null);
  const maxVal = Math.max(100, targetRate ?? 0, ...valid);
  const yMax = Math.ceil(maxVal / 10) * 10;
  const toY = (r: number) => mt + iH - (r / yMax * iH);
  const toX = (i: number) => ml + (n === 1 ? iW / 2 : (i / (n - 1)) * iW);

  // 背景グラデーション
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#f8faff');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // 90%以下のエリアを薄赤で塗る
  if (yMax >= WARN) {
    const y90 = toY(WARN);
    ctx.fillStyle = 'rgba(254,226,226,0.35)';
    ctx.fillRect(ml, y90, iW, mt + iH - y90);
  }

  // グリッド線
  [0, 25, 50, 75, 90, 100].forEach(g => {
    if (g > yMax) return;
    const y = toY(g);
    const is90 = g === WARN;
    ctx.beginPath();
    ctx.strokeStyle = is90 ? '#fca5a5' : '#e5e7eb';
    ctx.lineWidth = is90 ? 2 : 1;
    ctx.setLineDash(is90 ? [5, 4] : []);
    ctx.moveTo(ml, y); ctx.lineTo(ml + iW, y);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = is90 ? '#ef4444' : '#9ca3af';
    ctx.font = `${is90 ? 'bold ' : ''}11px system-ui`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(g + '%', ml - 6, y);
  });

  // 目標ライン（青破線）
  if (targetRate && targetRate > 0 && targetRate <= yMax) {
    const y = toY(targetRate);
    ctx.beginPath(); ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 2;
    ctx.setLineDash([7, 4]); ctx.moveTo(ml, y); ctx.lineTo(ml + iW, y);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#6366f1'; ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('目標', ml + iW + 5, y);
  }

  if (yMax >= WARN) {
    ctx.fillStyle = '#ef4444'; ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('90%', ml + iW + 5, toY(WARN));
  }

  // 折れ線（グロー効果）
  ctx.shadowColor = 'rgba(16,185,129,0.3)';
  ctx.shadowBlur = 6;
  ctx.beginPath(); ctx.strokeStyle = '#10b981'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  let started = false;
  rates.forEach((r, i) => {
    if (r === null) { started = false; return; }
    const x = toX(i), y = toY(r);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.shadowBlur = 0;

  // ドット＋ラベル
  months.forEach((m, i) => {
    const r = rates[i]; const x = toX(i);
    ctx.fillStyle = '#9ca3af'; ctx.font = '11px system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(m + '月', x, mt + iH + 6);
    if (r !== null) {
      const y = toY(r); const warn = r < WARN;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = warn ? '#ef4444' : '#10b981'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = warn ? '#ef4444' : '#059669';
      ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center';
      ctx.textBaseline = y < mt + 24 ? 'top' : 'bottom';
      ctx.fillText(r.toFixed(1) + '%', x, y + (y < mt + 24 ? 10 : -10));
    }
  });
}

// ── 数値入力 ──────────────────────────────────────────────
function NumInput({ value, step = '1', onChange }: {
  value: string; step?: string; onChange: (v: string) => void;
}) {
  return (
    <input
      type="number" step={step} value={value} placeholder="0"
      onKeyDown={blockInvalid} onChange={e => onChange(e.target.value)}
      className="w-full h-9 border border-gray-200 rounded-lg px-2 text-right text-sm
                 bg-white outline-none transition
                 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
    />
  );
}

// ── セクションタイトル ────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="w-1 h-5 rounded-full bg-blue-500" />
      <h2 className="text-base font-bold text-gray-700">{children}</h2>
    </div>
  );
}

// ── メインコンポーネント ──────────────────────────────────
export default function GrossProfitCalculator() {
  const [year,         setYear]         = useState('2026');
  const [half,         setHalf]         = useState<'1' | '2'>('1');
  const [overtimeRate, setOvertimeRate] = useState('');
  const [goalProfit,   setGoalProfit]   = useState('');
  const [goalRate,     setGoalRate]     = useState('');
  const [data,         setData]         = useState<Record<number, MD>>({});
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const months = useMemo(() =>
    half === '1' ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12], [half]);

  const calc = useMemo(() => {
    const rate = pf(overtimeRate);
    let sRev=0, sExt=0, sOt=0, sHol=0, sNight=0;
    let sOtT=0, sOtP=0, sLab=0, sIns=0, sCost=0, sPf=0;
    let any = false;
    const rows = months.map(m => {
      const d = data[m] ?? emptyMD();
      const rev=pf(d.revenue), ext=pf(d.ext), ot=pf(d.ot),
            hol=pf(d.hol), night=pf(d.night), labor=pf(d.labor), ins=pf(d.ins);
      const otT = ot + hol + night;
      const otP = Math.round(otT * rate);
      const cost = otP + labor + ins;
      const prof = rev - cost;
      const rPct = rev !== 0 ? prof / rev * 100 : null;
      sRev+=rev; sExt+=ext; sOt+=ot; sHol+=hol; sNight+=night;
      sOtT+=otT; sOtP+=otP; sLab+=labor; sIns+=ins; sCost+=cost; sPf+=prof;
      if (rev||ext||ot||hol||night||labor||ins) any = true;
      return { m, rev, ext, ot, hol, night, otT, otP, labor, ins, cost, prof, rPct };
    });
    const tRate = sRev !== 0 ? sPf / sRev * 100 : null;
    return { rows, sRev, sExt, sOt, sHol, sNight, sOtT, sOtP, sLab, sIns, sCost, sPf, tRate, any };
  }, [data, overtimeRate, months]);

  const warnMonths = useMemo(() =>
    calc.rows.filter(r => r.rPct !== null && r.rPct < WARN), [calc.rows]);

  const gp = pf(goalProfit), gr = pf(goalRate);
  const profitPct = gp > 0 && calc.any ? calc.sPf / gp * 100 : null;
  const ratePct   = gr > 0 && calc.any && calc.tRate !== null ? calc.tRate / gr * 100 : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rates = calc.rows.map(r => r.rPct);
    const target = pf(goalRate) || null;
    const draw = () => drawChart(canvas, months, rates, target);
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [calc, months, goalRate]);

  const update = useCallback((m: number, col: ColKey, val: string) => {
    setData(prev => ({ ...prev, [m]: { ...(prev[m] ?? emptyMD()), [col]: val } }));
  }, []);

  const downloadCSV = () => {
    const halfLabel = half === '1' ? '上期' : '下期';
    const { rows, sRev, sExt, sOt, sHol, sNight, sOtT, sOtP, sLab, sIns, sCost, sPf, tRate } = calc;
    const rate = pf(overtimeRate);
    const csvRows: (string | number)[][] = [
      [`半期粗利計算（${year}年${halfLabel}）`],
      ['時間外手当単価（円/h）', rate], [],
      ['月','売上高','社外合計(h)','定時外(h)','休日(h)','深夜(h)',
       '残業時間計(h)','残業額','人件費','社会保険等','コスト計','粗利額','粗利率(%)'],
    ];
    rows.forEach(r => csvRows.push([
      `${r.m}月`, r.rev, r.ext, r.ot, r.hol, r.night,
      r.otT, r.otP, r.labor, r.ins, r.cost, r.prof,
      r.rPct !== null ? r.rPct.toFixed(1) : '',
    ]));
    csvRows.push(['合計', sRev, sExt, sOt, sHol, sNight,
      sOtT, sOtP, sLab, sIns, sCost, sPf, tRate !== null ? tRate.toFixed(1) : '']);
    if (gp > 0) csvRows.push([], ['目標粗利額', gp],
      ['粗利額達成度(%)', (sPf/gp*100).toFixed(1)], ['差額', sPf-gp]);
    if (gr > 0 && tRate !== null) csvRows.push(
      ['目標粗利率(%)', gr], ['粗利率達成度(%)', (tRate/gr*100).toFixed(1)],
      ['差(pt)', (tRate-gr).toFixed(1)]);
    const csv = csvRows.map(r => r.map(c => `"${c ?? ''}"`).join(',')).join('\r\n');
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })),
      download: `粗利計算_${year}年${halfLabel}.csv`,
    });
    a.click(); URL.revokeObjectURL(a.href);
  };

  const { rows, sRev, sExt, sOt, sHol, sNight, sOtT, sOtP, sLab, sIns, sCost, sPf, tRate, any } = calc;

  // テーブルヘッダーの共通クラス
  const gTh = 'text-white text-xs font-bold tracking-wide uppercase py-2.5 text-center';
  const cTh = 'text-xs font-semibold text-right py-2.5 px-3 border-b-2 border-gray-200 whitespace-nowrap';
  const bTd = 'text-right text-sm px-2 py-2 border-b border-gray-100 align-middle';
  const fTd = 'text-right text-sm font-bold px-3 py-3 bg-emerald-50 border-t-2 border-emerald-400 whitespace-nowrap';

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6">

      {/* ── ヘッダー ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-6 py-4 mb-5
                      flex items-center gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-800">半期粗利計算ツール</h1>
          <p className="text-sm text-gray-400 mt-0.5">売上・コスト・残業を一括管理</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap ml-2">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-500">年度</label>
            <input type="number" value={year} onKeyDown={blockInvalid}
              onChange={e => setYear(e.target.value)}
              className="w-20 h-9 border border-gray-200 rounded-lg px-3 text-sm text-gray-700
                         bg-white outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-500">半期</label>
            <select value={half} onChange={e => setHalf(e.target.value as '1' | '2')}
              className="h-9 border border-gray-200 rounded-lg px-3 text-sm text-gray-700
                         bg-white outline-none focus:border-blue-400 cursor-pointer">
              <option value="1">上期（1〜6月）</option>
              <option value="2">下期（7〜12月）</option>
            </select>
          </div>
        </div>
        <div className="ml-auto flex gap-3">
          <button onClick={() => setData({})}
            className="h-9 px-4 rounded-lg border border-gray-200 text-sm font-medium text-gray-500
                       hover:bg-gray-50 transition-colors">
            クリア
          </button>
          <button onClick={downloadCSV}
            className="h-9 px-5 rounded-lg bg-blue-600 text-white text-sm font-semibold
                       hover:bg-blue-700 transition-colors shadow-sm shadow-blue-200">
            ↓ CSVダウンロード
          </button>
        </div>
      </div>

      {/* ── 目標設定 + グラフ ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 mb-5">

        {/* 目標設定 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <SectionTitle>目標設定・達成度</SectionTitle>
          <div className="flex flex-col gap-4">
            {([
              { label: '目標粗利額', val: goalProfit, set: setGoalProfit, unit: '円', ph: '例：3,000,000' },
              { label: '目標粗利率', val: goalRate,   set: setGoalRate,   unit: '%', ph: '例：92' },
            ] as const).map(({ label, val, set, unit, ph }) => (
              <div key={label}>
                <label className="text-sm font-medium text-gray-500 block mb-1.5">{label}</label>
                <div className="flex items-center gap-2">
                  <input type="number" value={val} placeholder={ph}
                    onKeyDown={blockInvalid} onChange={e => set(e.target.value)}
                    className="flex-1 h-10 border border-gray-200 rounded-lg px-3 text-sm text-right
                               text-gray-700 bg-white outline-none
                               focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition" />
                  <span className="text-sm text-gray-400 w-5">{unit}</span>
                </div>
              </div>
            ))}

            {/* 達成度 */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
              {([
                {
                  label: '粗利額達成度',
                  pct: profitPct,
                  diff: profitPct !== null ? sPf - gp : null,
                  fmt2: (d: number) => fmt(Math.round(Math.abs(d))) + ' 円',
                },
                {
                  label: '粗利率達成度',
                  pct: ratePct,
                  diff: ratePct !== null && tRate !== null ? tRate - gr : null,
                  fmt2: (d: number) => Math.abs(d).toFixed(1) + ' pt',
                },
              ] as const).map(({ label, pct, diff, fmt2 }) => (
                <div key={label} className="bg-gray-50 rounded-xl p-3">
                  <div className="text-xs text-gray-400 font-medium mb-1">{label}</div>
                  <div className={`text-3xl font-black leading-none ${
                    pct === null ? 'text-gray-300' : pct >= 100 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {pct !== null ? pct.toFixed(1) + '%' : '—'}
                  </div>
                  <div className={`text-xs font-semibold mt-1 ${
                    diff === null ? 'text-gray-400' : diff >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {diff !== null
                      ? (diff >= 0 ? '＋' : '−') + fmt2(diff)
                      : '目標未設定'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* グラフ */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <SectionTitle>月次粗利率推移</SectionTitle>
          <div className="relative" style={{ height: '200px' }}>
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
          </div>
        </div>
      </div>

      {/* ── 設定 + 警告 ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-6 py-4 mb-5
                      flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-600 whitespace-nowrap">時間外手当単価</label>
          <input type="number" value={overtimeRate} placeholder="例：2500"
            onKeyDown={blockInvalid} onChange={e => setOvertimeRate(e.target.value)}
            className="w-36 h-9 border border-gray-200 rounded-lg px-3 text-sm text-right
                       text-gray-700 bg-white outline-none
                       focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition" />
          <span className="text-sm text-gray-400">円 / h</span>
        </div>
        <div className="w-px h-5 bg-gray-200 hidden sm:block" />
        <div className="flex gap-2 flex-wrap items-center">
          {any && warnMonths.length === 0 && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600
                             bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
              <span className="text-base">✓</span> 全月 粗利率90%以上
            </span>
          )}
          {warnMonths.map(r => (
            <span key={r.m}
              className="inline-flex items-center gap-1.5 bg-rose-50 border border-rose-200
                         text-rose-600 text-sm font-semibold px-3 py-1 rounded-full">
              ⚠ {r.m}月 {r.rPct!.toFixed(1)}%（90%未満）
            </span>
          ))}
        </div>
      </div>

      {/* ── メインテーブル ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 mb-5 overflow-hidden">
        <div className="px-6 pt-5 pb-3">
          <SectionTitle>月別入力</SectionTitle>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ tableLayout: 'fixed', minWidth: '1100px' }}>
            <colgroup>
              {['3.8%','10.4%','7.1%','7.1%','6.6%','6.6%','6.5%','8.2%','9.8%','8.4%','8.2%','8.7%','8.6%']
                .map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2} className={`${gTh} bg-gray-600`}>月</th>
                <th className={`${gTh} bg-blue-600`}>売上</th>
                <th colSpan={5} className={`${gTh} bg-amber-500`}>時間管理</th>
                <th colSpan={4} className={`${gTh} bg-rose-600`}>コスト</th>
                <th colSpan={2} className={`${gTh} bg-emerald-600`}>粗利</th>
              </tr>
              <tr>
                <th className={`${cTh} bg-blue-50  text-blue-700`}>売上高（円）</th>
                <th className={`${cTh} bg-amber-50  text-amber-700`}>社外合計（h）</th>
                <th className={`${cTh} bg-amber-50  text-amber-700`}>定時外（h）</th>
                <th className={`${cTh} bg-amber-50  text-amber-700`}>休日（h）</th>
                <th className={`${cTh} bg-amber-50  text-amber-700`}>深夜（h）</th>
                <th className={`${cTh} bg-amber-50  text-amber-700`}>残業時間計</th>
                <th className={`${cTh} bg-rose-50   text-rose-700`}>残業額（円）</th>
                <th className={`${cTh} bg-rose-50   text-rose-700`}>人件費（円）</th>
                <th className={`${cTh} bg-rose-50   text-rose-700`}>社会保険等（円）</th>
                <th className={`${cTh} bg-rose-50   text-rose-700`}>コスト計（円）</th>
                <th className={`${cTh} bg-emerald-50 text-emerald-700`}>粗利額（円）</th>
                <th className={`${cTh} bg-emerald-50 text-emerald-700`}>粗利率</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const isWarn = r.rPct !== null && r.rPct < WARN;
                return (
                  <tr key={r.m}
                    className={`transition-colors ${
                      isWarn ? 'bg-rose-50/60' : idx % 2 === 1 ? 'bg-gray-50/60' : 'bg-white'
                    } hover:bg-blue-50/40`}>
                    <td className="text-center text-sm font-bold text-gray-600 py-2.5 align-middle
                                   bg-gray-50 border-b border-gray-100 border-r-2 border-r-gray-200">
                      {r.m}月
                    </td>
                    <td className={bTd}>
                      <NumInput value={data[r.m]?.revenue ?? ''} onChange={v => update(r.m, 'revenue', v)} />
                    </td>
                    <td className={bTd}>
                      <NumInput value={data[r.m]?.ext ?? ''} step=".5" onChange={v => update(r.m, 'ext', v)} />
                    </td>
                    <td className={bTd}>
                      <NumInput value={data[r.m]?.ot ?? ''} step=".5" onChange={v => update(r.m, 'ot', v)} />
                    </td>
                    <td className={bTd}>
                      <NumInput value={data[r.m]?.hol ?? ''} step=".5" onChange={v => update(r.m, 'hol', v)} />
                    </td>
                    <td className={bTd}>
                      <NumInput value={data[r.m]?.night ?? ''} step=".5" onChange={v => update(r.m, 'night', v)} />
                    </td>
                    <td className={`${bTd} font-semibold text-amber-700`}>{fmt(r.otT, 1)} h</td>
                    <td className={`${bTd} font-semibold text-rose-600`}>{fmt(r.otP)} 円</td>
                    <td className={bTd}>
                      <NumInput value={data[r.m]?.labor ?? ''} onChange={v => update(r.m, 'labor', v)} />
                    </td>
                    <td className={bTd}>
                      <NumInput value={data[r.m]?.ins ?? ''} onChange={v => update(r.m, 'ins', v)} />
                    </td>
                    <td className={`${bTd} font-semibold text-rose-600`}>{fmt(r.cost)} 円</td>
                    <td className={`${bTd} font-semibold ${r.prof >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {fmt(r.prof)} 円
                    </td>
                    <td className={`${bTd} font-bold text-base ${
                      isWarn ? 'text-rose-600' : r.rPct !== null ? 'text-emerald-600' : 'text-gray-400'}`}>
                      {r.rPct !== null ? r.rPct.toFixed(1) + '%' : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="text-center text-sm font-bold py-3 bg-emerald-50 border-t-2 border-emerald-400
                               text-gray-700 border-r-2 border-r-emerald-200 align-middle">合計</td>
                <td className={fTd}>{any ? fmt(sRev) + ' 円' : '—'}</td>
                <td className={fTd}>{any ? fmt(sExt,1) + ' h'   : '—'}</td>
                <td className={fTd}>{any ? fmt(sOt,1) + ' h'    : '—'}</td>
                <td className={fTd}>{any ? fmt(sHol,1) + ' h'   : '—'}</td>
                <td className={fTd}>{any ? fmt(sNight,1) + ' h' : '—'}</td>
                <td className={`${fTd} text-amber-700`}>{any ? fmt(sOtT,1) + ' h' : '—'}</td>
                <td className={`${fTd} text-rose-600`}>{any ? fmt(sOtP) + ' 円'  : '—'}</td>
                <td className={fTd}>{any ? fmt(sLab) + ' 円' : '—'}</td>
                <td className={fTd}>{any ? fmt(sIns) + ' 円' : '—'}</td>
                <td className={`${fTd} text-rose-600`}>{any ? fmt(sCost) + ' 円' : '—'}</td>
                <td className={`${fTd} text-lg ${sPf >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {any ? fmt(sPf) + ' 円' : '—'}
                </td>
                <td className={`${fTd} text-lg ${tRate !== null ? (tRate >= 0 ? 'text-emerald-600' : 'text-rose-600') : ''}`}>
                  {any && tRate !== null ? tRate.toFixed(1) + '%' : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── サマリーカード ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {([
          { label: '売上高合計',   value: any ? fmt(sRev)    + ' 円' : '—', sub: '半期累計', color: 'border-blue-400',    val: 'text-gray-800' },
          { label: 'コスト合計',   value: any ? fmt(sCost)   + ' 円' : '—', sub: '人件費+社保+残業', color: 'border-rose-400',  val: 'text-rose-600' },
          { label: '粗利額合計',   value: any ? fmt(sPf)     + ' 円' : '—', sub: '半期累計', color: 'border-emerald-500', val: any ? (sPf >= 0 ? 'text-emerald-600' : 'text-rose-600') : '' },
          { label: '粗利率',       value: any && tRate !== null ? tRate.toFixed(1) + '%' : '—', sub: '半期平均', color: 'border-emerald-500', val: any && tRate !== null ? (tRate >= 0 ? 'text-emerald-600' : 'text-rose-600') : '' },
          { label: '残業時間合計', value: any ? fmt(sOtT, 1) + ' h'  : '—', sub: '定時外+休日+深夜', color: 'border-amber-400', val: 'text-amber-700' },
          { label: '残業額合計',   value: any ? fmt(sOtP)    + ' 円' : '—', sub: '単価×残業時間', color: 'border-rose-400',  val: 'text-rose-600' },
        ] as const).map(({ label, value, sub, color, val }) => (
          <div key={label}
            className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-5 border-t-4 ${color}`}>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{label}</div>
            <div className={`text-lg font-bold whitespace-nowrap ${val}`}>{value}</div>
            <div className="text-xs text-gray-400 mt-1">{sub}</div>
          </div>
        ))}
      </div>

    </div>
  );
}
