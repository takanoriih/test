'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';

// ── 型 ───────────────────────────────────────────────────
type ContractType = 'haken' | 'ukeoi';
type ColKey = 'revenue' | 'unitRate' | 'ext' | 'ot' | 'hol' | 'night' | 'labor' | 'ins';
type MD = Record<ColKey, string> & { ctype: ContractType };

const emptyMD = (): MD => ({
  ctype: 'ukeoi', revenue: '', unitRate: '', ext: '', ot: '', hol: '', night: '', labor: '', ins: '',
});

const pf = (s?: string) => parseFloat(s ?? '') || 0;
const fmt = (n: number, d = 0) => n.toLocaleString('ja-JP', { maximumFractionDigits: d });

// HH:MM または数値文字列 → 時間（小数）
function parseTime(s: string): number {
  if (!s) return 0;
  if (s.includes(':')) {
    const [h, m] = s.split(':').map(v => parseInt(v, 10) || 0);
    return h + m / 60;
  }
  return parseFloat(s) || 0;
}

function blockInvalid(e: React.KeyboardEvent<HTMLInputElement>) {
  if (['e', 'E', '+'].includes(e.key)) { e.preventDefault(); return; }
  if (e.key === '-' && (e.target as HTMLInputElement).value.includes('-')) e.preventDefault();
}

// ── Canvas グラフ描画 ─────────────────────────────────────
function drawChart(
  canvas: HTMLCanvasElement,
  months: number[],
  rates: (number | null)[],
) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  if (!W || !H) return;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const ml = 44, mr = 16, mt = 16, mb = 28;
  const iW = W - ml - mr, iH = H - mt - mb;
  const n = months.length;

  const valid = rates.filter((r): r is number => r !== null);
  const maxVal = Math.max(100, ...valid);
  const yMax = Math.ceil(maxVal / 10) * 10;
  const toY = (r: number) => mt + iH - (r / yMax * iH);
  const toX = (i: number) => ml + (n === 1 ? iW / 2 : (i / (n - 1)) * iW);

  // 背景グラデーション
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#f8faff');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // グリッド線
  [0, 25, 50, 75, 100].forEach(g => {
    if (g > yMax) return;
    const y = toY(g);
    ctx.beginPath();
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.moveTo(ml, y); ctx.lineTo(ml + iW, y);
    ctx.stroke();
    ctx.fillStyle = '#9ca3af';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(g + '%', ml - 6, y);
  });

  // 折れ線
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
      const y = toY(r);
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#10b981'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = '#059669';
      ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center';
      ctx.textBaseline = y < mt + 24 ? 'top' : 'bottom';
      ctx.fillText(r.toFixed(1) + '%', x, y + (y < mt + 24 ? 10 : -10));
    }
  });
}

// ── 時間入力（HH:MM 形式） ────────────────────────────────
function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text" value={value} placeholder="0:00"
      onChange={e => onChange(e.target.value.replace(/[^0-9:]/g, ''))}
      className="w-full h-9 border border-gray-200 rounded-lg px-1 text-right text-xs
                 bg-white outline-none transition
                 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
    />
  );
}

// ── 金額入力（カンマ自動挿入） ────────────────────────────
function MoneyInput({ value, onChange, placeholder, className }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; className?: string;
}) {
  const display = value !== '' ? Number(value).toLocaleString('ja-JP') : '';
  return (
    <input
      type="text" inputMode="numeric"
      value={display} placeholder={placeholder ?? '0'}
      onChange={e => {
        const raw = e.target.value.replace(/[^0-9]/g, '');
        onChange(raw);
      }}
      className={className ?? `w-full h-9 border border-gray-200 rounded-lg px-2 text-right text-sm
                 bg-white outline-none transition
                 focus:border-blue-400 focus:ring-2 focus:ring-blue-100`}
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
      const ctype = d.ctype;
      const ext   = parseTime(d.ext);
      const ot    = parseTime(d.ot);
      const hol   = parseTime(d.hol);
      const night = parseTime(d.night);

      // 売上高：派遣=時間単価×社外時間、請負=月契約単価
      const rev = ctype === 'haken'
        ? Math.round(pf(d.unitRate) * ext)
        : pf(d.revenue);

      const otT   = ot + hol + night;
      const otP   = Math.round(otT * rate);
      const labor = pf(d.labor);
      const ins   = pf(d.ins);
      const cost  = otP + labor + ins;
      const prof  = rev - cost;
      const rPct  = rev !== 0 ? prof / rev * 100 : null;

      sRev+=rev; sExt+=ext; sOt+=ot; sHol+=hol; sNight+=night;
      sOtT+=otT; sOtP+=otP; sLab+=labor; sIns+=ins; sCost+=cost; sPf+=prof;
      if (rev||ext||ot||hol||night||labor||ins) any = true;

      return { m, ctype, rev, ext, ot, hol, night, otT, otP, labor, ins, cost, prof, rPct };
    });
    const tRate = sRev !== 0 ? sPf / sRev * 100 : null;
    const extN = rows.filter(r => r.ext > 0).length;
    const avgExt = extN > 0 ? sExt / extN : 0;
    return { rows, sRev, sExt, avgExt, sOt, sHol, sNight, sOtT, sOtP, sLab, sIns, sCost, sPf, tRate, any };
  }, [data, overtimeRate, months]);

  const gp = pf(goalProfit);
  const profitPct = gp > 0 && calc.any ? calc.sPf / gp * 100 : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rates = calc.rows.map(r => r.rPct);
    const draw = () => drawChart(canvas, months, rates);
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [calc, months]);

  const update = useCallback((m: number, col: string, val: string) => {
    setData(prev => ({ ...prev, [m]: { ...(prev[m] ?? emptyMD()), [col]: val } }));
  }, []);

  const downloadCSV = () => {
    const halfLabel = half === '1' ? '上期' : '下期';
    const { rows, sRev, sExt, sOt, sHol, sNight, sOtT, sOtP, sLab, sIns, sCost, sPf, tRate } = calc;
    const rate = pf(overtimeRate);
    const csvRows: (string | number)[][] = [
      [`半期粗利計算（${year}年${halfLabel}）`],
      ['時間外手当単価（円/h）', rate], [],
      ['月','契約種別','売上高','社外合計(h)','定時外(h)','休日(h)','深夜(h)',
       '残業時間計(h)','残業額','人件費','社会保険等','コスト計','粗利額','粗利率(%)'],
    ];
    rows.forEach(r => csvRows.push([
      `${r.m}月`,
      r.ctype === 'haken' ? '派遣' : '請負・準委任',
      r.rev, r.ext.toFixed(2), r.ot.toFixed(2), r.hol.toFixed(2), r.night.toFixed(2),
      r.otT.toFixed(2), r.otP, r.labor, r.ins, r.cost, r.prof,
      r.rPct !== null ? r.rPct.toFixed(1) : '',
    ]));
    csvRows.push(['合計','', sRev, sExt.toFixed(2), sOt.toFixed(2), sHol.toFixed(2), sNight.toFixed(2),
      sOtT.toFixed(2), sOtP, sLab, sIns, sCost, sPf, tRate !== null ? tRate.toFixed(1) : '']);
    if (gp > 0) csvRows.push([], ['目標粗利額', gp],
      ['粗利額達成度(%)', (sPf/gp*100).toFixed(1)], ['差額', sPf-gp]);
    const csv = csvRows.map(r => r.map(c => `"${c ?? ''}"`).join(',')).join('\r\n');
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })),
      download: `粗利計算_${year}年${halfLabel}.csv`,
    });
    a.click(); URL.revokeObjectURL(a.href);
  };

  const { rows, sRev, sExt, avgExt, sOt, sHol, sNight, sOtT, sOtP, sLab, sIns, sCost, sPf, tRate, any } = calc;

  const gTh = 'text-white text-xs font-bold tracking-wide uppercase py-2.5 text-center';
  const cTh = 'text-xs font-semibold text-right py-2.5 px-2 border-b-2 border-gray-200 whitespace-nowrap';
  const bTd = 'text-right text-sm px-2 py-2 border-b border-gray-100 align-middle';
  const fTd = 'text-right text-xs font-bold px-2 py-2 bg-emerald-50 border-t-2 border-emerald-400';

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
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 mb-5">

        {/* 目標設定 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <SectionTitle>目標設定・達成度</SectionTitle>
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-sm font-medium text-gray-500 block mb-1.5">目標粗利額</label>
              <div className="flex items-center gap-2">
                <MoneyInput value={goalProfit} onChange={setGoalProfit} placeholder="例：3,000,000"
                  className="flex-1 h-10 border border-gray-200 rounded-lg px-3 text-sm text-right
                             text-gray-700 bg-white outline-none
                             focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition" />
                <span className="text-sm text-gray-400 w-5">円</span>
              </div>
            </div>

            {/* 達成度 */}
            <div className="pt-2 border-t border-gray-100">
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-xs text-gray-400 font-medium mb-1">粗利額達成度</div>
                <div className={`text-3xl font-black leading-none ${
                  profitPct === null ? 'text-gray-300'
                  : profitPct >= 100 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {profitPct !== null ? profitPct.toFixed(1) + '%' : '—'}
                </div>
                <div className={`text-xs font-semibold mt-1.5 ${
                  profitPct === null ? 'text-gray-400'
                  : (sPf - gp) >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {profitPct !== null
                    ? ((sPf - gp) >= 0 ? '＋' : '−') + fmt(Math.round(Math.abs(sPf - gp))) + ' 円'
                    : '目標未設定'}
                </div>
              </div>
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

      {/* ── 設定バー ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-6 py-4 mb-5
                      flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-600 whitespace-nowrap">時間外手当単価</label>
          <MoneyInput value={overtimeRate} onChange={setOvertimeRate} placeholder="例：2,500"
            className="w-36 h-9 border border-gray-200 rounded-lg px-3 text-sm text-right
                       text-gray-700 bg-white outline-none
                       focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition" />
          <span className="text-sm text-gray-400">円 / h</span>
        </div>
        <div className="text-xs text-gray-400">
          ※ 時間入力は <code className="bg-gray-100 px-1 rounded">166:30</code> 形式（時間:分）または小数で入力できます
        </div>
      </div>

      {/* ── メインテーブル ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 mb-5 overflow-hidden">
        <div className="px-6 pt-5 pb-3">
          <SectionTitle>月別入力</SectionTitle>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ tableLayout: 'fixed', minWidth: '1070px' }}>
            <colgroup>
              {[44, 106, 84, 78, 72, 72, 72, 72, 62, 68, 88, 86, 76, 80, 70]
                .map((w, i) => <col key={i} style={{ width: w + 'px' }} />)}
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2} className={`${gTh} bg-gray-600`}>月</th>
                <th rowSpan={2} className={`${gTh} bg-purple-600`}>契約種別</th>
                <th colSpan={2} className={`${gTh} bg-blue-600`}>売上</th>
                <th colSpan={5} className={`${gTh} bg-amber-500`}>時間管理</th>
                <th colSpan={4} className={`${gTh} bg-rose-600`}>コスト</th>
                <th colSpan={2} className={`${gTh} bg-emerald-600`}>粗利</th>
              </tr>
              <tr>
                <th className={`${cTh} bg-blue-50 text-blue-700`}>単価 / 月額（円）</th>
                <th className={`${cTh} bg-blue-50 text-blue-700`}>売上高（円）</th>
                <th className={`${cTh} bg-amber-50 text-amber-700`}>社外合計</th>
                <th className={`${cTh} bg-amber-50 text-amber-700`}>定時外</th>
                <th className={`${cTh} bg-amber-50 text-amber-700`}>休日</th>
                <th className={`${cTh} bg-amber-50 text-amber-700`}>深夜</th>
                <th className={`${cTh} bg-amber-50 text-amber-700`}>残業時間計</th>
                <th className={`${cTh} bg-rose-50 text-rose-700`}>残業額（円）</th>
                <th className={`${cTh} bg-rose-50 text-rose-700`}>人件費（円）</th>
                <th className={`${cTh} bg-rose-50 text-rose-700`}>社会保険等（円）</th>
                <th className={`${cTh} bg-rose-50 text-rose-700`}>コスト計（円）</th>
                <th className={`${cTh} bg-emerald-50 text-emerald-700`}>粗利額（円）</th>
                <th className={`${cTh} bg-emerald-50 text-emerald-700`}>粗利率</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const d = data[r.m] ?? emptyMD();
                const isHaken = d.ctype === 'haken';
                return (
                  <tr key={r.m}
                    className={`transition-colors ${
                      idx % 2 === 1 ? 'bg-gray-50/60' : 'bg-white'
                    } hover:bg-blue-50/40`}>
                    <td className="text-center text-sm font-bold text-gray-600 py-2.5 align-middle
                                   bg-gray-50 border-b border-gray-100 border-r-2 border-r-gray-200">
                      {r.m}月
                    </td>
                    {/* 契約種別 */}
                    <td className={bTd}>
                      <select
                        value={d.ctype}
                        onChange={e => update(r.m, 'ctype', e.target.value)}
                        className="w-full h-9 border border-gray-200 rounded-lg px-1 text-xs leading-tight
                                   bg-white outline-none focus:border-blue-400 cursor-pointer
                                   overflow-hidden text-ellipsis">
                        <option value="haken">派遣</option>
                        <option value="ukeoi">請負・準委任</option>
                      </select>
                    </td>
                    {/* 単価 / 月額 入力 */}
                    <td className={bTd}>
                      {isHaken ? (
                        <MoneyInput value={d.unitRate ?? ''} onChange={v => update(r.m, 'unitRate', v)} placeholder="時間単価" />
                      ) : (
                        <MoneyInput value={d.revenue ?? ''} onChange={v => update(r.m, 'revenue', v)} placeholder="月契約額" />
                      )}
                    </td>
                    {/* 売上高（派遣=自動計算, 請負=入力値） */}
                    <td className={`${bTd} font-semibold text-blue-700 whitespace-nowrap`}>
                      {r.rev > 0 ? fmt(r.rev) + ' 円' : '—'}
                    </td>
                    {/* 時間列 */}
                    <td className={bTd}>
                      <TimeInput value={d.ext ?? ''} onChange={v => update(r.m, 'ext', v)} />
                    </td>
                    <td className={bTd}>
                      <TimeInput value={d.ot ?? ''} onChange={v => update(r.m, 'ot', v)} />
                    </td>
                    <td className={bTd}>
                      <TimeInput value={d.hol ?? ''} onChange={v => update(r.m, 'hol', v)} />
                    </td>
                    <td className={bTd}>
                      <TimeInput value={d.night ?? ''} onChange={v => update(r.m, 'night', v)} />
                    </td>
                    <td className={`${bTd} font-semibold text-amber-700`}>
                      {r.otT > 0 ? fmt(r.otT, 2) + ' h' : '—'}
                    </td>
                    <td className={`${bTd} font-semibold text-rose-600 whitespace-nowrap`}>
                      {r.otP > 0 ? fmt(r.otP) + ' 円' : '—'}
                    </td>
                    <td className={bTd}>
                      <MoneyInput value={d.labor ?? ''} onChange={v => update(r.m, 'labor', v)} />
                    </td>
                    <td className={bTd}>
                      <MoneyInput value={d.ins ?? ''} onChange={v => update(r.m, 'ins', v)} />
                    </td>
                    <td className={`${bTd} font-semibold text-rose-600 whitespace-nowrap`}>
                      {r.cost > 0 ? fmt(r.cost) + ' 円' : '—'}
                    </td>
                    <td className={`${bTd} font-semibold whitespace-nowrap ${r.prof >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {(r.rev > 0 || r.cost > 0) ? fmt(r.prof) + ' 円' : '—'}
                    </td>
                    <td className={`${bTd} font-bold text-base ${r.rPct !== null ? 'text-emerald-600' : 'text-gray-400'}`}>
                      {r.rPct !== null ? r.rPct.toFixed(1) + '%' : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="text-center text-sm font-bold py-3 bg-emerald-50 border-t-2 border-emerald-400
                               text-gray-700 border-r-2 border-r-emerald-200 align-middle">合計</td>
                <td className={fTd}>—</td>
                <td className={fTd}>{any ? fmt(sRev) : '—'}</td>
                <td className={fTd}>
                  {any ? <><span className="font-normal text-gray-400">均 </span>{fmt(avgExt, 2) + 'h'}</> : '—'}
                </td>
                <td className={fTd}>{any ? fmt(sOt, 2) + 'h' : '—'}</td>
                <td className={fTd}>{any ? fmt(sHol, 2) + 'h' : '—'}</td>
                <td className={fTd}>{any ? fmt(sNight, 2) + 'h' : '—'}</td>
                <td className={`${fTd} text-amber-700`}>{any ? fmt(sOtT, 2) + 'h' : '—'}</td>
                <td className={`${fTd} text-rose-600`}>{any ? fmt(sOtP) : '—'}</td>
                <td className={fTd}>{any ? fmt(sLab) : '—'}</td>
                <td className={fTd}>{any ? fmt(sIns) : '—'}</td>
                <td className={`${fTd} text-rose-600`}>{any ? fmt(sCost) : '—'}</td>
                <td className={`${fTd} text-sm ${sPf >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {any ? fmt(sPf) : '—'}
                </td>
                <td className={`${fTd} text-sm ${tRate !== null ? (tRate >= 0 ? 'text-emerald-600' : 'text-rose-600') : ''}`}>
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
          { label: '売上高合計',   value: any ? fmt(sRev)    + ' 円' : '—', sub: '半期累計',       color: 'border-blue-400',    val: 'text-gray-800' },
          { label: 'コスト合計',   value: any ? fmt(sCost)   + ' 円' : '—', sub: '人件費+社保+残業', color: 'border-rose-400',    val: 'text-rose-600' },
          { label: '粗利額合計',   value: any ? fmt(sPf)     + ' 円' : '—', sub: '半期累計',       color: 'border-emerald-500', val: any ? (sPf >= 0 ? 'text-emerald-600' : 'text-rose-600') : '' },
          { label: '粗利率',       value: any && tRate !== null ? tRate.toFixed(1) + '%' : '—', sub: '半期平均', color: 'border-emerald-500', val: any && tRate !== null ? (tRate >= 0 ? 'text-emerald-600' : 'text-rose-600') : '' },
          { label: '残業時間合計', value: any ? fmt(sOtT, 2) + ' h'  : '—', sub: '定時外+休日+深夜', color: 'border-amber-400',  val: 'text-amber-700' },
          { label: '残業額合計',   value: any ? fmt(sOtP)    + ' 円' : '—', sub: '単価×残業時間',  color: 'border-rose-400',    val: 'text-rose-600' },
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
