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

// ── Canvas グラフ描画（目標 vs 実績） ─────────────────────
function drawChart(
  canvas: HTMLCanvasElement,
  months: number[],
  profits: (number | null)[],  // 月別実績粗利額
  goalProfit: number,           // 半期目標粗利額
) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  if (!W || !H) return;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const ml = 50, mr = 38, mt = 20, mb = 32;
  const iW = W - ml - mr, iH = H - mt - mb;
  const n = months.length;
  const yMax = 120; // 常に120%まで表示
  const toY = (v: number) => mt + iH - Math.min(v / yMax, 1) * iH;
  const toX = (i: number) => ml + (i + 0.5) * (iW / n);
  const barW = Math.max(Math.min(iW / n * 0.55, 48), 20);
  const monthlyTarget = goalProfit > 0 ? goalProfit / n : 0;

  // 背景
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // グリッド線
  [0, 25, 50, 75, 100, 120].forEach(g => {
    const y = toY(g);
    const is100 = g === 100;
    ctx.beginPath();
    ctx.strokeStyle = is100 ? '#6366f1' : '#e5e7eb';
    ctx.lineWidth = is100 ? 1.5 : 1;
    ctx.setLineDash(is100 ? [6, 4] : []);
    ctx.moveTo(ml, y); ctx.lineTo(ml + iW, y);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = is100 ? '#6366f1' : '#9ca3af';
    ctx.font = `${is100 ? 'bold ' : ''}11px system-ui`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(g + '%', ml - 6, y);
  });

  // 目標ラベル（チャート内右寄せ、100%線の上）
  if (goalProfit > 0) {
    ctx.fillStyle = '#6366f1'; ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('目標', ml + iW, toY(100) - 3);
  }

  // 棒グラフ＋ラベル
  months.forEach((m, i) => {
    const p = profits[i];
    const x = toX(i);

    // 月ラベル
    ctx.fillStyle = '#9ca3af'; ctx.font = '11px system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(m + '月', x, mt + iH + 6);

    if (p === null || monthlyTarget === 0) return;

    const rate = p / monthlyTarget * 100;
    const clampedRate = Math.min(rate, yMax);
    const barH = clampedRate / yMax * iH;
    const y = mt + iH - barH;

    const isOver = rate >= 100;
    const barColor = isOver ? '#10b981' : '#f59e0b';
    const barAlpha = isOver ? '33' : '44';

    // バー
    ctx.fillStyle = barColor + barAlpha;
    ctx.fillRect(x - barW / 2, y, barW, barH);
    ctx.strokeStyle = barColor;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - barW / 2, y, barW, barH);

    // 達成率ラベル（バー上端より2px上、キャンバス上端を超えないよう14px下限）
    ctx.fillStyle = isOver ? '#059669' : '#d97706';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const labelY = Math.max(y - 2, 14);
    ctx.fillText(rate.toFixed(1) + '%', x, labelY);
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

// ── 金額入力（フォーカス中は生数値・離れたらカンマ整形） ──
function MoneyInput({ value, onChange, placeholder, className }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const display = focused ? value : (value !== '' ? Number(value).toLocaleString('ja-JP') : '');
  return (
    <input
      type="text" inputMode="numeric"
      value={display} placeholder={placeholder ?? '0'}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
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
const GP_PREFIX = 'gp';

export default function GrossProfitCalculator() {
  const [year,         setYear]         = useState('2026');
  const [half,         setHalf]         = useState<'1' | '2'>('1');
  const [overtimeRate, setOvertimeRate] = useState('');
  const [goalProfit,   setGoalProfit]   = useState('');
  const [data,         setData]         = useState<Record<number, MD>>({});
  const [savedAt,      setSavedAt]      = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ロード中のフラグ（ロード直後の保存をスキップするため）
  const skipSaveRef = useRef(true);
  const yearRef = useRef(year);
  const halfRef = useRef(half);
  yearRef.current = year;
  halfRef.current = half;

  // ── 年度・半期が変わるたびに対応データをロード ──
  useEffect(() => {
    skipSaveRef.current = true;
    const key = `${GP_PREFIX}-${year}-${half}`;
    try {
      const s = JSON.parse(localStorage.getItem(key) ?? 'null');
      setOvertimeRate(s?.overtimeRate ?? '');
      setGoalProfit(s?.goalProfit ?? '');
      setData(s?.data ?? {});
      setSavedAt(s?.savedAt ?? null);
    } catch { skipSaveRef.current = false; }
  }, [year, half]);

  // ── 入力変更時に自動保存（ロード直後はスキップ） ──
  useEffect(() => {
    if (skipSaveRef.current) { skipSaveRef.current = false; return; }
    const at = new Date().toLocaleString('ja-JP');
    const key = `${GP_PREFIX}-${yearRef.current}-${halfRef.current}`;
    try {
      localStorage.setItem(key, JSON.stringify({ overtimeRate, goalProfit, data, savedAt: at }));
      setSavedAt(at);
    } catch {}
  }, [overtimeRate, goalProfit, data]);

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
    const profits = calc.rows.map(r => (r.rev > 0 || r.cost > 0) ? r.prof : null);
    const draw = () => drawChart(canvas, months, profits, gp);
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [calc, months, gp]);

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
  const cTh = 'text-xs font-semibold text-center py-2.5 px-2 border-b-2 border-gray-200 whitespace-nowrap';
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
              min={1996} max={2050}
              onChange={e => setYear(e.target.value)}
              onBlur={e => {
                const n = Number(e.target.value);
                if (!e.target.value || n < 1996) setYear('1996');
                else if (n > 2050) setYear('2050');
              }}
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

            {/* 粗利額合計 */}
            <div className="pt-2 border-t border-gray-100">
              <div className="text-xs text-gray-400 font-medium mb-1">粗利額合計</div>
              <div className={`text-2xl font-black leading-none ${
                !any ? 'text-gray-300' : sPf >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                {any ? fmt(sPf) + ' 円' : '—'}
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
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col">
          <SectionTitle>月次粗利 目標対比</SectionTitle>
          <div className="relative flex-1 min-h-[180px]">
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
        {savedAt && (
          <div className="ml-auto flex items-center gap-1.5 text-xs text-gray-400">
            <span>💾</span><span>最終保存: {savedAt}</span>
          </div>
        )}
      </div>

      {/* ── メインテーブル ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 mb-5 overflow-hidden">
        <div className="px-6 pt-5 pb-3 flex items-center gap-4 flex-wrap">
          <SectionTitle>月別入力</SectionTitle>
          <p className="text-xs text-gray-400 mb-4">
            ※ 時間入力は <code className="bg-gray-100 px-1 rounded">hhh:mm</code> 形式（時間:分）または小数で入力できます
          </p>
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
          { label: '残業時間合計', value: any ? fmt(sOtT, 2) + ' h'  : '—', sub: '定時外+休日+深夜', color: 'border-amber-400',  val: 'text-amber-700' },
          { label: '残業額合計',   value: any ? fmt(sOtP)    + ' 円' : '—', sub: '単価×残業時間',  color: 'border-rose-400',    val: 'text-rose-600' },
          { label: 'コスト合計',   value: any ? fmt(sCost)   + ' 円' : '—', sub: '人件費+社保+残業', color: 'border-rose-400',    val: 'text-rose-600' },
          { label: '粗利額合計',   value: any ? fmt(sPf)     + ' 円' : '—', sub: '半期累計',       color: 'border-emerald-500', val: any ? (sPf >= 0 ? 'text-emerald-600' : 'text-rose-600') : '' },
          { label: '粗利率',       value: any && tRate !== null ? tRate.toFixed(1) + '%' : '—', sub: '半期平均', color: 'border-emerald-500', val: any && tRate !== null ? (tRate >= 0 ? 'text-emerald-600' : 'text-rose-600') : '' },
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
