/* ================================================================
 * 问答·计算训练
 * 问答题：闪卡自评（会了/模糊/不会）+ 3/7/14天间隔复习
 * 计算题：填数自动判分（带容差）+ 分步提示 + 公式卡
 * 挑战题：跨章节案例（连环小问）
 * ================================================================ */
(() => {
'use strict';

const BANK = window.QA_BANK;
const SUBJECTS = BANK.subjects;
const STORAGE_KEY = 'qa_state_v1';

// ---------------- 工具 ----------------
const $ = (sel, p=document) => p.querySelector(sel);
const $$ = (sel, p=document) => Array.from(p.querySelectorAll(sel));
const escHtml = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const shuffle = (arr) => { const a = arr.slice(); for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const addDays = (dateStr, n) => { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate()+n); return todayFrom(d); };
const todayFrom = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const stars = (n) => '★'.repeat(n) + '☆'.repeat(3-n);
const STAR_TAG = { 1:'tag-diff-1', 2:'tag-diff-2', 3:'tag-diff-3' };
const GROUP_TAG = { '监管规则':'tag-group-1', '保险公司财务管理':'tag-group-2', '财务成本管理':'tag-group-3', '财务管理制度':'tag-group-2' };

// ---------------- 状态 ----------------
const DEFAULT_SUBJ = () => ({ attempts:{}, wrong:[], qaSRS:{}, dailyStat:{}, challengeQa:{}, challengeCalc:{} });
const DEFAULT_STATE = () => ({
  checkin: { lastDate: '', streak: 0, totalDays: 0 },
  settings: { darkMode: false, subject: 'solvency' },
  subjects: { solvency: DEFAULT_SUBJ(), fm: DEFAULT_SUBJ() },
});

let state = loadState();
function loadState() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) {
      const parsed = JSON.parse(s);
      const st = Object.assign(DEFAULT_STATE(), parsed);
      for (const k of Object.keys(SUBJECTS)) st.subjects[k] = Object.assign(DEFAULT_SUBJ(), (parsed.subjects||{})[k] || {});
      return st;
    }
  } catch(e) {}
  return DEFAULT_STATE();
}
function saveState() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e) { toast('存储失败'); } }

// URL 参数指定科目（入口卡片深链）
(function initSubject() {
  const p = new URLSearchParams(location.search).get('subject');
  if (p && SUBJECTS[p]) state.settings.subject = p;
  saveState();
})();
let S = state.settings.subject;                 // 当前科目 key
const subj = () => state.subjects[S];           // 当前科目状态
const curBank = () => SUBJECTS[S];              // 当前科目题库

// ---------------- 题目索引 ----------------
function unitOf(unitId) { return curBank().units.find(u => u.id === unitId); }
function allQa() { const arr = []; curBank().units.forEach(u => u.qa.forEach(q => arr.push({ ...q, unitId: u.id, unitName: u.name, group: u.group }))); return arr; }
function allCalc() { const arr = []; curBank().units.forEach(u => u.calc.forEach(q => arr.push({ ...q, unitId: u.id, unitName: u.name, group: u.group }))); return arr; }

// ---------------- 打卡 ----------------
function isCheckedToday() { return state.checkin.lastDate === todayStr(); }
function doCheckin() {
  const t = todayStr();
  if (state.checkin.lastDate === t) return;
  const y = new Date(); y.setDate(y.getDate()-1);
  state.checkin.streak = (state.checkin.lastDate === todayFrom(y)) ? state.checkin.streak + 1 : 1;
  state.checkin.lastDate = t;
  state.checkin.totalDays += 1;
  saveState();
}

// ---------------- 记录 ----------------
function bumpDaily(kind) {
  const t = todayStr();
  if (!subj().dailyStat[t]) subj().dailyStat[t] = { qa: 0, calc: 0, correct: 0 };
  subj().dailyStat[t][kind] += 1;
}
function todayStat() { return subj().dailyStat[todayStr()] || { qa: 0, calc: 0, correct: 0 }; }

function recordCalc(cid, correct) {
  const st = subj();
  if (!st.attempts[cid]) st.attempts[cid] = { tries: 0, correct: 0, lastDate: '' };
  st.attempts[cid].tries += 1;
  if (correct) st.attempts[cid].correct += 1;
  st.attempts[cid].lastDate = todayStr();
  if (correct) {
    st.wrong = st.wrong.filter(x => x !== cid);
    if (st.attempts[cid].tries >= 2 && st.attempts[cid].correct / st.attempts[cid].tries >= 0.8) st.mastered = st.mastered || {};
  } else {
    if (!st.wrong.includes(cid)) st.wrong.push(cid);
  }
  bumpDaily('calc');
  if (correct) bumpDaily('correct');
  state.checkin.totalQuestions = (state.checkin.totalQuestions || 0) + 1;
  saveState();
}

// 问答题 SRS：会了 streak+1（间隔 3/7/14），模糊 1天后重来，不会 当次会话重现
function recordQa(qid, rating) {
  const st = subj();
  const prev = st.qaSRS[qid] || { streak: 0, due: todayStr() };
  let next;
  if (rating === 'good') {
    const gaps = [3, 7, 14];
    next = { streak: prev.streak + 1, due: addDays(todayStr(), gaps[Math.min(prev.streak, 2)]) };
  } else if (rating === 'fuzzy') {
    next = { streak: 0, due: addDays(todayStr(), 1) };
  } else {
    next = { streak: 0, due: todayStr() };
  }
  st.qaSRS[qid] = next;
  if (rating === 'bad' && !st.wrong.includes(qid)) st.wrong.push(qid);
  if (rating === 'good') st.wrong = st.wrong.filter(x => x !== qid);
  bumpDaily('qa');
  state.checkin.totalQuestions = (state.checkin.totalQuestions || 0) + 1;
  saveState();
}

// ---------------- 统计 ----------------
function qaMastered() { const st = subj(); return Object.keys(st.qaSRS).filter(id => st.qaSRS[id].streak >= 2).length; }
function calcStat() {
  const st = subj();
  let tries = 0, correct = 0;
  Object.values(st.attempts).forEach(a => { tries += a.tries; correct += a.correct; });
  return { tries, correct, accuracy: tries ? Math.round(correct/tries*100) : 0 };
}
function dueQaCount() {
  const st = subj(); const t = todayStr();
  return allQa().filter(q => { const r = st.qaSRS[q.id]; return r && r.due <= t; }).length;
}
function unitMastery(qaIds, calcIds) {
  const st = subj();
  const m = qaIds.filter(id => st.qaSRS[id] && st.qaSRS[id].streak >= 2).length;
  const c = calcIds.filter(id => st.attempts[id] && st.attempts[id].tries >= 2 && st.attempts[id].correct / st.attempts[id].tries >= 0.8).length;
  return { m, c, total: qaIds.length + calcIds.length };
}

// ---------------- 路由 ----------------
let currentPage = 'home';
function go(page) {
  currentPage = page;
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  render();
}
$$('.nav-btn').forEach(b => b.addEventListener('click', () => go(b.dataset.page)));

// ---------------- 渲染：首页 ----------------
function renderHome() {
  const checked = isCheckedToday();
  const t = todayStat();
  const goalQa = 5, goalCalc = 3;
  const goalPct = Math.min(100, Math.round((Math.min(t.qa, goalQa) + Math.min(t.calc, goalCalc)) / (goalQa + goalCalc) * 100));
  const cs = calcStat();
  const due = dueQaCount();
  const wrongN = subj().wrong.length;
  const chDone = Object.keys(subj().challengeQa).length + Object.keys(subj().challengeCalc).length;

  return `
  <div class="card">
    <div class="flex items-center justify-between mb-3">
      <div>
        <div class="text-xs text-slate-500 dark:text-slate-400">当前科目</div>
        <div class="text-lg font-bold">${curBank().icon} ${curBank().name}</div>
      </div>
      <div class="text-right">
        <div class="text-3xl font-bold text-brand-700 dark:text-brand-100">${state.checkin.streak || 0}</div>
        <div class="text-[11px] text-slate-500">连续打卡天数</div>
      </div>
    </div>
    <button class="checkin-btn ${checked ? 'done' : ''}" id="btn-checkin" ${checked ? 'disabled' : ''}>
      ${checked ? '✓ 今日已打卡' : '打卡 · 坚持第 ' + ((state.checkin.streak || 0) + 1) + ' 天'}
    </button>
  </div>

  <div class="card">
    <div class="flex items-center justify-between mb-2">
      <div class="text-sm font-semibold">今日目标</div>
      <div class="text-xs text-slate-500">问答 ${Math.min(t.qa, goalQa)}/${goalQa} · 计算 ${Math.min(t.calc, goalCalc)}/${goalCalc}</div>
    </div>
    <div class="bar mb-3"><div style="width:${goalPct}%"></div></div>
    <div class="grid grid-cols-3">
      <div class="stat-cell"><div class="stat-num">${t.qa + t.calc}</div><div class="stat-label">今日已练</div></div>
      <div class="stat-cell"><div class="stat-num">${t.correct}</div><div class="stat-label">今日判对</div></div>
      <div class="stat-cell"><div class="stat-num">${due}</div><div class="stat-label">待复习</div></div>
    </div>
  </div>

  <div class="card">
    <div class="text-sm font-semibold mb-3">学习概览</div>
    <div class="grid grid-cols-4">
      <div class="stat-cell"><div class="stat-num">${qaMastered()}</div><div class="stat-label">问答已掌握</div></div>
      <div class="stat-cell"><div class="stat-num">${cs.accuracy}%</div><div class="stat-label">计算正确率</div></div>
      <div class="stat-cell"><div class="stat-num">${wrongN}</div><div class="stat-label">错题数</div></div>
      <div class="stat-cell"><div class="stat-num">${chDone}/20</div><div class="stat-label">挑战完成</div></div>
    </div>
  </div>

  <div class="card">
    <div class="text-sm font-semibold mb-1">推荐学习</div>
    <div class="qrow" data-go="qa" role="button"><span>🗒️</span><div class="flex-1"><div class="text-sm font-medium">问答练习</div><div class="text-xs text-slate-500">闪卡自评 · ${due > 0 ? `有 ${due} 道到期复习` : '按章节/难度筛选'}</div></div><span class="text-slate-400">›</span></div>
    <div class="qrow" data-go="calc" role="button"><span>🧮</span><div class="flex-1"><div class="text-sm font-medium">计算练习</div><div class="text-xs text-slate-500">填数判分 · 分步提示 · 公式卡</div></div><span class="text-slate-400">›</span></div>
    <div class="qrow" data-go="challenge" role="button"><span>🏆</span><div class="flex-1"><div class="text-sm font-medium">挑战题</div><div class="text-xs text-slate-500">跨章节案例 · 连环小问</div></div><span class="text-slate-400">›</span></div>
    ${wrongN ? `<div class="qrow" id="go-wrong" role="button"><span>❌</span><div class="flex-1"><div class="text-sm font-medium">错题回顾</div><div class="text-xs text-slate-500">${wrongN} 道错题等待消灭</div></div><span class="text-slate-400">›</span></div>` : ''}
  </div>`;
}

// ---------------- 渲染：筛选器（问答/计算共用） ----------------
function filterBar(kind) {
  const st = subj();
  const f = st['filter_' + kind] || (subj()['filter_' + kind] = { unit: 'all', diff: 'all' });
  const units = curBank().units;
  const groups = [...new Set(units.map(u => u.group))];
  const opts = groups.map(g => `<optgroup label="${escHtml(g)}">${units.filter(u => u.group === g).map(u => `<option value="${u.id}" ${f.unit === u.id ? 'selected' : ''}>${escHtml(u.name)}</option>`).join('')}</optgroup>`).join('');
  return `
  <div class="card">
    <div class="text-sm font-semibold mb-2">选择范围</div>
    <select id="sel-unit" class="blank-input mb-3 text-sm">
      <option value="all">全部单元</option>${opts}
    </select>
    <div class="flex gap-2 mb-1">
      ${[['all','全部'],['1','★☆☆'],['2','★★☆'],['3','★★★']].map(([v,l]) => `<button class="chip ${f.diff === v ? 'active' : ''}" data-diff="${v}">${l}</button>`).join('')}
    </div>
  </div>`;
}
function readFilter(kind) {
  const sel = $('#sel-unit');
  const diffChip = $('.chip.active[data-diff]');
  const f = subj()['filter_' + kind] || {};
  f.unit = sel ? sel.value : 'all';
  f.diff = diffChip ? diffChip.dataset.diff : 'all';
  subj()['filter_' + kind] = f;
  saveState();
  return f;
}
function applyFilter(pool, f) {
  let arr = pool;
  if (f.unit !== 'all') arr = arr.filter(q => q.unitId === f.unit);
  if (f.diff !== 'all') arr = arr.filter(q => q.difficulty === Number(f.diff));
  return arr;
}

// ---------------- 渲染：问答页 ----------------
function renderQa() {
  const bank = allQa();
  const st = subj();
  const t = todayStr();
  const due = bank.filter(q => { const r = st.qaSRS[q.id]; return r && r.due <= t; });
  const mastered = qaMastered();
  const unitStats = curBank().units.map(u => {
    const m = unitMastery(u.qa.map(q => q.id), u.calc.map(q => q.id));
    return { name: u.name, pct: Math.round((m.m + m.c) / Math.max(1, m.total) * 100) };
  });
  const avg = Math.round(unitStats.reduce((s, x) => s + x.pct, 0) / Math.max(1, unitStats.length));
  return `
  <div class="card">
    <div class="grid grid-cols-3 mb-3">
      <div class="stat-cell"><div class="stat-num">${bank.length}</div><div class="stat-label">问答题总数</div></div>
      <div class="stat-cell"><div class="stat-num">${due.length}</div><div class="stat-label">到期复习</div></div>
      <div class="stat-cell"><div class="stat-num">${mastered}</div><div class="stat-label">已掌握</div></div>
    </div>
    <div class="flex items-center gap-2 mb-1">
      <span class="text-xs text-slate-500 whitespace-nowrap">整体掌握</span>
      <div class="mbar ${avg >= 80 ? 'mbar-green' : avg >= 60 ? 'mbar-yellow' : 'mbar-red'}"><div style="width:${avg}%"></div></div>
      <span class="text-xs font-semibold">${avg}%</span>
    </div>
  </div>
  ${due.length ? `<div class="card"><button class="checkin-btn" id="btn-due-review">🔁 复习到期的 ${due.length} 道问答题</button></div>` : ''}
  ${filterBar('qa')}
  <div class="card"><button class="checkin-btn" id="btn-qa-start">开始问答练习（10 题）</button></div>
  <div class="card">
    <div class="text-sm font-semibold mb-2">答题方式说明</div>
    <div class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
      看题 → 自己口述或写草稿 → 看参考要点逐条自查 → 自评「会了 / 模糊 / 不会」。<br>
      「会了」按 3 → 7 → 14 天间隔滚动重现；「模糊」明天再来；「不会」本次会稍后重现并进入错题。
    </div>
  </div>`;
}

// ---------------- 渲染：计算页 ----------------
function renderCalc() {
  const bank = allCalc();
  const cs = calcStat();
  return `
  <div class="card">
    <div class="grid grid-cols-3">
      <div class="stat-cell"><div class="stat-num">${bank.length}</div><div class="stat-label">计算题总数</div></div>
      <div class="stat-cell"><div class="stat-num">${cs.tries}</div><div class="stat-label">已答次数</div></div>
      <div class="stat-cell"><div class="stat-num">${cs.accuracy}%</div><div class="stat-label">正确率</div></div>
    </div>
  </div>
  ${filterBar('calc')}
  <div class="card"><button class="checkin-btn" id="btn-calc-start">开始计算练习（5 题）</button></div>
  <div class="card"><button class="btn btn-outline w-full" id="btn-formula">📇 公式卡速查</button></div>
  <div class="card">
    <div class="text-sm font-semibold mb-2">答题方式说明</div>
    <div class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
      读题干 → 填写数值答案 → 系统自动判分（带容差）→ 查看分步解析和易错点。卡住了可以逐条点「提示」看步骤，先扶后放。
    </div>
  </div>`;
}

// ---------------- 渲染：挑战页 ----------------
function renderChallenge() {
  const ch = curBank().challenge;
  const st = subj();
  const doneQa = ch.qa.filter(q => st.challengeQa[q.id]).length;
  const doneCalc = ch.calc.filter(q => st.challengeCalc[q.id]).length;
  const caseRow = (q, type, done) => `
    <div class="qrow ch-case" data-id="${q.id}" data-type="${type}" role="button">
      <span>${type === 'qa' ? '🗒️' : '🧮'}</span>
      <div class="flex-1">
        <div class="text-sm font-medium">${escHtml(q.title)} ${done ? '<span class="tag tag-diff-1 ml-1">已完成</span>' : ''}</div>
        <div class="text-xs text-slate-500">${q.parts.length} 个连环小问 · ${type === 'qa' ? '要点式作答' : '填数判分'}</div>
      </div>
      <span class="text-slate-400">›</span>
    </div>`;
  return `
  <div class="card">
    <div class="grid grid-cols-2">
      <div class="stat-cell"><div class="stat-num">${doneQa}/${ch.qa.length}</div><div class="stat-label">案例问答完成</div></div>
      <div class="stat-cell"><div class="stat-num">${doneCalc}/${ch.calc.length}</div><div class="stat-label">案例计算完成</div></div>
    </div>
  </div>
  <div class="card">
    <div class="text-sm font-semibold mb-1">🧮 案例计算（综合卷难度 ★★★）</div>
    <div class="text-xs text-slate-500 mb-2">长题干 + 连环小问，跨章节链条计算，模拟真实考卷</div>
    ${ch.calc.map(q => caseRow(q, 'calc', st.challengeCalc[q.id])).join('')}
  </div>
  <div class="card">
    <div class="text-sm font-semibold mb-1">🗒️ 案例问答（综合卷难度 ★★★）</div>
    <div class="text-xs text-slate-500 mb-2">场景化案例，逐小问对照要点自查</div>
    ${ch.qa.map(q => caseRow(q, 'qa', st.challengeQa[q.id])).join('')}
  </div>`;
}

// ---------------- 渲染：我的 ----------------
function renderMe() {
  const cs = calcStat();
  const t = todayStr();
  const totalDays = state.checkin.totalDays || 0;
  const totalQ = state.checkin.totalQuestions || 0;
  // 各单元掌握度
  const rows = curBank().units.map(u => {
    const m = unitMastery(u.qa.map(q => q.id), u.calc.map(q => q.id));
    const pct = Math.round((m.m + m.c) / Math.max(1, m.total) * 100);
    const cls = pct >= 80 ? 'mbar-green' : pct >= 60 ? 'mbar-yellow' : 'mbar-red';
    return `<div class="mb-3">
      <div class="flex justify-between text-xs mb-1"><span class="truncate mr-2">${escHtml(u.name)}</span><span class="text-slate-500">${pct}%</span></div>
      <div class="flex items-center gap-2"><div class="mbar ${cls}"><div style="width:${pct}%"></div></div><span class="text-[10px] text-slate-400 whitespace-nowrap">${m.m + m.c}/${m.total}</span></div>
    </div>`;
  }).join('');
  // 近7天
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = todayFrom(d); const s2 = subj().dailyStat[k]; days.push({ k, n: s2 ? s2.qa + s2.calc : 0 }); }
  const maxN = Math.max(1, ...days.map(d => d.n));
  const week = days.map(d => `<div class="flex flex-col items-center gap-1 flex-1"><div class="w-full rounded-t bg-brand-500" style="height:${Math.max(2, d.n / maxN * 48)}px" title="${d.k}: ${d.n}题"></div><span class="text-[9px] text-slate-400">${d.k.slice(5)}</span></div>`).join('');
  return `
  <div class="card">
    <div class="text-sm font-semibold mb-2">切换科目</div>
    <div class="subject-switch">
      ${Object.entries(SUBJECTS).map(([k, v]) => `<button class="ss-btn ${S === k ? 'active' : ''}" data-subject="${k}">${v.icon} ${v.name}</button>`).join('')}
    </div>
    <div class="text-[11px] text-slate-500 mt-2">两个科目的学习进度分开记录，互不影响。</div>
  </div>
  <div class="card">
    <div class="text-sm font-semibold mb-3">学习统计</div>
    <div class="grid grid-cols-4">
      <div class="stat-cell"><div class="stat-num">${totalDays}</div><div class="stat-label">打卡天数</div></div>
      <div class="stat-cell"><div class="stat-num">${totalQ}</div><div class="stat-label">累计答题</div></div>
      <div class="stat-cell"><div class="stat-num">${qaMastered()}</div><div class="stat-label">问答掌握</div></div>
      <div class="stat-cell"><div class="stat-num">${cs.accuracy}%</div><div class="stat-label">计算正确率</div></div>
    </div>
    <div class="text-xs text-slate-500 mt-3 mb-1">近 7 天练习量（当前科目）</div>
    <div class="flex items-end gap-2 h-16">${week}</div>
  </div>
  <div class="card">
    <div class="text-sm font-semibold mb-3">各单元掌握度</div>
    ${rows}
  </div>
  <div class="card">
    <div class="text-sm font-semibold mb-3">数据管理</div>
    <div class="flex gap-2">
      <button class="btn btn-outline flex-1" id="btn-export">导出记录</button>
      <button class="btn btn-outline flex-1" id="btn-import">导入记录</button>
    </div>
    <input type="file" id="file-import" accept=".json" class="hidden" />
    <div class="text-[11px] text-slate-500 mt-2">换手机前请导出记录备份；换设备后导入即可恢复。</div>
  </div>`;
}

// ---------------- 渲染入口 ----------------
function render() {
  const map = { home: renderHome, qa: renderQa, calc: renderCalc, challenge: renderChallenge, me: renderMe };
  $('#main').innerHTML = map[currentPage]();
  bindPage();
}
function bindPage() {
  const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
  on('#btn-checkin', () => { doCheckin(); render(); toast('打卡成功，连续 ' + state.checkin.streak + ' 天 💪'); });
  $$('[data-go]').forEach(el => el.addEventListener('click', () => go(el.dataset.go)));
  on('#go-wrong', () => startSession('calc', shuffle(subj().wrong.map(findCalc).filter(Boolean)).slice(0, 10), '错题回顾'));
  // 筛选
  const selU = $('#sel-unit');
  if (selU) selU.addEventListener('change', () => { readFilter(currentPage); });
  $$('[data-diff]').forEach(c => c.addEventListener('click', () => { $$('[data-diff]').forEach(x => x.classList.remove('active')); c.classList.add('active'); readFilter(currentPage); }));
  on('#btn-qa-start', () => { const f = readFilter('qa'); const pool = applyFilter(allQa(), f); const qs = pickQaSession(pool, 10); if (!qs.length) return toast('该范围内没有题目'); startSession('qa', qs, '问答练习'); });
  on('#btn-due-review', () => { const t2 = todayStr(); const due = allQa().filter(q => { const r = subj().qaSRS[q.id]; return r && r.due <= t2; }); startSession('qa', shuffle(due).slice(0, 15), '到期复习'); });
  on('#btn-calc-start', () => { const f = readFilter('calc'); const pool = applyFilter(allCalc(), f); const qs = shuffle(pool).slice(0, 5); if (!qs.length) return toast('该范围内没有题目'); startSession('calc', qs, '计算练习'); });
  on('#btn-formula', () => showFormulaCards());
  $$('.ch-case').forEach(el => el.addEventListener('click', () => {
    const q = curBank().challenge[el.dataset.type === 'qa' ? 'qa' : 'calc'].find(x => x.id === el.dataset.id);
    startSession('ch-' + el.dataset.type, [q], '挑战案例');
  }));
  $$('[data-subject]').forEach(b => b.addEventListener('click', () => {
    S = b.dataset.subject; state.settings.subject = S; saveState();
    toast('已切换到 ' + curBank().name); render();
  }));
  on('#btn-export', () => {
    const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'qa_learning_backup.json'; a.click();
  });
  on('#btn-import', () => $('#file-import').click());
  const fi = $('#file-import');
  if (fi) fi.addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.subjects) throw new Error('格式不对');
        state = Object.assign(DEFAULT_STATE(), parsed);
        for (const k of Object.keys(SUBJECTS)) state.subjects[k] = Object.assign(DEFAULT_SUBJ(), (parsed.subjects || {})[k] || {});
        S = state.settings.subject || S; saveState(); applyDark(); render(); toast('导入成功');
      } catch (err) { toast('导入失败：' + err.message); }
    };
    reader.readAsText(file);
  });
}

function pickQaSession(pool, n) {
  const st = subj(); const t = todayStr();
  const due = pool.filter(q => { const r = st.qaSRS[q.id]; return r && r.due <= t; });
  const fresh = pool.filter(q => !st.qaSRS[q.id]);
  const out = shuffle(due).slice(0, Math.ceil(n / 2)).concat(shuffle(fresh).slice(0, Math.ceil(n / 2)));
  if (out.length < n) out.push(...shuffle(pool.filter(q => !out.includes(q))).slice(0, n - out.length));
  return shuffle(out).slice(0, n);
}

function findCalc(id) {
  for (const u of curBank().units) { const q = u.calc.find(x => x.id === id); if (q) return { ...q, unitId: u.id, unitName: u.name, group: u.group }; }
  return null;
}

// ---------------- 公式卡速查 ----------------
function showFormulaCards() {
  const m = $('#session-modal'); m.classList.remove('hidden');
  $('#session-progress').textContent = '公式卡';
  $('#session-mode').textContent = curBank().name;
  const cards = [];
  curBank().units.forEach(u => {
    const items = u.calc.filter(c => c.formula_card).map(c => `<div class="step-item"><b>${escHtml(c.formula_card.split('=')[0].trim())}</b>：${escHtml(c.formula_card)}</div>`);
    if (items.length) cards.push(`<div class="text-sm font-bold mt-3 mb-1">${escHtml(u.name)}</div>${items.join('')}`);
  });
  $('#session-body').innerHTML = `<div class="formula-card mb-3">📇 ${cards.reduce((s, x) => s + (x.match(/step-item/g) || []).length, 0)} 张公式卡 · 考前过一遍</div>` + cards.join('');
  $('#session-footer').innerHTML = `<button class="btn btn-primary w-full" id="fc-close">关 闭</button>`;
  $('#fc-close').addEventListener('click', closeSession);
  $('#session-exit').onclick = closeSession;
}

// ---------------- 练习会话引擎 ----------------
let session = null;
function startSession(type, questions, label) {
  if (!questions || !questions.length) return toast('没有可练习的题目');
  session = { type, questions, idx: 0, results: [], label, stepsShown: 0, requeue: [] };
  const m = $('#session-modal'); m.classList.remove('hidden');
  $('#session-exit').onclick = () => { if (confirm('退出本次练习？已答题目会计入记录。')) closeSession(); };
  nextItem();
}
function closeSession() {
  $('#session-modal').classList.add('hidden');
  session = null;
  render();
  go(currentPage === 'home' ? 'home' : currentPage);
}
function sessionFooter(html) { $('#session-footer').innerHTML = html; }

function nextItem() {
  const s = session;
  // 会话内重排队列（问答"不会"）
  if (s.idx >= s.questions.length && s.requeue.length) {
    s.questions.push(s.requeue.shift());
  }
  if (s.idx >= s.questions.length) return finishSession();
  const q = s.questions[s.idx];
  $('#session-progress').textContent = `${s.idx + 1} / ${s.questions.length}`;
  $('#session-mode').textContent = s.label;
  if (s.type === 'qa') renderQaItem(q);
  else if (s.type === 'calc') renderCalcItem(q);
  else if (s.type === 'ch-qa') renderChQaPart(q, 0);
  else renderChCalcPart(q, 0);
}

// ---- 问答题（闪卡） ----
function renderQaItem(q) {
  const points = q.answer_points.map((p, i) => `<div class="point-item"><span class="pt">${i + 1}. ${escHtml(p.point)}</span><br/>${escHtml(p.detail)}</div>`).join('');
  $('#session-body').innerHTML = `
    <div class="flex items-center gap-2 mb-2 flex-wrap">
      <span class="tag ${GROUP_TAG[q.group] || 'tag-group-1'}">${escHtml(q.tag || q.group || '')}</span>
      <span class="tag ${STAR_TAG[q.difficulty]}">${stars(q.difficulty)}</span>
      <span class="text-xs text-slate-500 truncate">${escHtml(q.unitName)}</span>
    </div>
    <div class="text-lg font-semibold leading-relaxed mb-4">${escHtml(q.q)}</div>
    <div id="qa-answer" class="hidden">
      <div class="text-sm font-semibold mb-2">📋 参考要点（踩点给分）</div>
      ${points}
      ${q.framework ? `<div class="text-xs text-slate-500 dark:text-slate-400 mt-2">💡 答题框架：${escHtml(q.framework)}</div>` : ''}
      ${q.memo ? `<div class="text-xs mt-1" style="color:#d97706">⚠️ 易错提醒：${escHtml(q.memo)}</div>` : ''}
    </div>`;
  sessionFooter(`<button class="btn btn-primary w-full" id="btn-reveal">看参考答案</button>`);
  $('#btn-reveal').addEventListener('click', () => {
    $('#qa-answer').classList.remove('hidden');
    $('#btn-reveal').parentElement.innerHTML = `
      <button class="rate-btn rate-bad" data-rate="bad">不会</button>
      <button class="rate-btn rate-fuzzy" data-rate="fuzzy">模糊</button>
      <button class="rate-btn rate-good" data-rate="good">会了 ✓</button>`;
    $$('[data-rate]').forEach(b => b.addEventListener('click', () => {
      const r = b.dataset.rate;
      recordQa(q.id, r);
      session.results.push({ id: q.id, q: q.q.slice(0, 40), ok: r === 'good' });
      if (r === 'bad') session.requeue.push(q);
      session.idx += 1; nextItem();
    }));
  });
}

// ---- 计算题（填数判分） ----
function renderCalcItem(q) {
  session.stepsShown = 0;
  $('#session-body').innerHTML = `
    <div class="flex items-center gap-2 mb-2 flex-wrap">
      <span class="tag ${GROUP_TAG[q.group] || 'tag-group-1'}">${escHtml(q.group || '')}</span>
      <span class="tag ${STAR_TAG[q.difficulty]}">${stars(q.difficulty)}</span>
      <span class="text-xs text-slate-500 truncate">${escHtml(q.unitName)}</span>
    </div>
    <div class="text-base font-semibold leading-relaxed mb-3">${escHtml(q.stem)}</div>
    <div class="space-y-3 mb-3" id="calc-blanks">
      ${q.blanks.map((b, i) => `<div><label class="text-sm text-slate-600 dark:text-slate-300 block mb-1">${escHtml(b.label)}</label><input class="blank-input" data-blank="${i}" inputmode="decimal" placeholder="填入数值" /></div>`).join('')}
    </div>
    <div id="calc-steps"></div>
    <div class="mb-3"><button class="btn btn-outline btn-sm" id="btn-step">💡 提示（${q.steps.length} 步）</button></div>
    <div id="calc-feedback" class="hidden"></div>`;
  sessionFooter(`
    <button class="btn btn-outline w-1/3" id="btn-step2">💡 提示</button>
    <button class="btn btn-primary flex-1" id="btn-submit">提 交</button>`);
  $('#btn-step').addEventListener('click', showStep);
  $('#btn-step2').addEventListener('click', showStep);
  function showStep() {
    if (session.stepsShown >= q.steps.length) return toast('没有更多提示了');
    const el = $('#calc-steps');
    el.insertAdjacentHTML('beforeend', `<div class="step-item">${escHtml(q.steps[session.stepsShown])}</div>`);
    session.stepsShown += 1;
    $('#btn-step2').textContent = `💡 提示（${session.stepsShown}/${q.steps.length}）`;
  }
  $('#btn-submit').addEventListener('click', () => {
    const inputs = $$('[data-blank]');
    if (inputs.some(inp => inp.value.trim() === '')) return toast('请填写所有空');
    let allOk = true;
    const details = [];
    inputs.forEach(inp => {
      const b = q.blanks[Number(inp.dataset.blank)];
      const v = parseFloat(inp.value);
      const ok = !isNaN(v) && Math.abs(v - b.answer) <= (b.tolerance || 0.5);
      inp.classList.add(ok ? 'correct' : 'wrong'); inp.disabled = true;
      if (!ok) allOk = false;
      details.push(`${b.label}：${ok ? '✓' : '✗ 正确答案 ' + b.answer}`);
    });
    recordCalc(q.id, allOk);
    session.results.push({ id: q.id, q: q.stem.slice(0, 40), ok: allOk });
    const fb = $('#calc-feedback');
    fb.className = `p-3 rounded-lg text-sm leading-relaxed mb-3 ${allOk ? 'fb-ok' : 'fb-bad'}`;
    fb.innerHTML = `
      <div class="font-semibold mb-1">${allOk ? '✅ 全部正确！' : '❌ 有错误，看解析'}</div>
      <div class="mb-2">${details.map(escHtml).join('<br/>')}</div>
      <div class="formula-card mb-2">📐 ${escHtml(q.formula_card)}</div>
      <div class="mb-1"><b>解析：</b>${escHtml(q.analysis)}</div>
      <div style="color:#d97706"><b>易错点：</b>${escHtml(q.trap)}</div>`;
    fb.classList.remove('hidden');
    $('#btn-step').classList.add('hidden');
    sessionFooter(`<button class="btn btn-primary w-full" id="btn-next">下一题 →</button>`);
    $('#btn-next').addEventListener('click', () => { session.idx += 1; nextItem(); });
  });
}

// ---- 挑战案例·问答 ----
function renderChQaPart(q, pi) {
  const part = q.parts[pi];
  const isLast = pi === q.parts.length - 1;
  $('#session-progress').textContent = `小问 ${pi + 1} / ${q.parts.length}`;
  const points = part.answer_points.map((p, i) => `<div class="point-item"><span class="pt">${i + 1}. ${escHtml(p.point)}</span><br/>${escHtml(p.detail)}</div>`).join('');
  $('#session-body').innerHTML = `
    <div class="tag tag-diff-3 mb-2 inline-block">★★★ 挑战案例</div>
    <div class="p-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm leading-relaxed mb-3">${escHtml(q.stem)}</div>
    <div class="text-base font-semibold leading-relaxed mb-3">${escHtml(part.q)}</div>
    <div id="qa-answer" class="hidden">
      <div class="text-sm font-semibold mb-2">📋 参考要点</div>
      ${points}
    </div>`;
  sessionFooter(`<button class="btn btn-primary w-full" id="btn-reveal">看参考答案</button>`);
  $('#btn-reveal').addEventListener('click', () => {
    $('#qa-answer').classList.remove('hidden');
    sessionFooter(isLast
      ? `<button class="btn btn-primary w-full" id="btn-next">完成本案例 →</button>`
      : `<button class="btn btn-primary w-full" id="btn-next">下一小问 →</button>`);
    $('#btn-next').addEventListener('click', () => {
      if (isLast) {
        subj().challengeQa[q.id] = todayStr(); saveState();
        session.results.push({ id: q.id, q: q.title, ok: true });
        session.idx += 1; nextItem();
      } else renderChQaPart(q, pi + 1);
    });
  });
}

// ---- 挑战案例·计算 ----
function renderChCalcPart(q, pi) {
  const part = q.parts[pi];
  const isLast = pi === q.parts.length - 1;
  session.stepsShown = 0;
  $('#session-progress').textContent = `小问 ${pi + 1} / ${q.parts.length}`;
  $('#session-body').innerHTML = `
    <div class="tag tag-diff-3 mb-2 inline-block">★★★ 挑战案例</div>
    <div class="p-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm leading-relaxed mb-3">${escHtml(q.stem)}</div>
    <div class="text-base font-semibold leading-relaxed mb-3">${escHtml(part.q)}</div>
    <div class="space-y-3 mb-3" id="calc-blanks">
      ${part.blanks.map((b, i) => `<div><label class="text-sm text-slate-600 dark:text-slate-300 block mb-1">${escHtml(b.label)}</label><input class="blank-input" data-blank="${i}" inputmode="decimal" placeholder="填入数值" /></div>`).join('')}
    </div>
    <div id="calc-steps"></div>
    <div id="calc-feedback" class="hidden"></div>`;
  sessionFooter(`
    <button class="btn btn-outline w-1/3" id="btn-step">💡 提示（${part.steps.length} 步）</button>
    <button class="btn btn-primary flex-1" id="btn-submit">提 交</button>`);
  $('#btn-step').addEventListener('click', () => {
    if (session.stepsShown >= part.steps.length) return toast('没有更多提示了');
    $('#calc-steps').insertAdjacentHTML('beforeend', `<div class="step-item">${escHtml(part.steps[session.stepsShown])}</div>`);
    session.stepsShown += 1;
    $('#btn-step').textContent = `💡 提示（${session.stepsShown}/${part.steps.length}）`;
  });
  $('#btn-submit').addEventListener('click', () => {
    const inputs = $$('[data-blank]');
    if (inputs.some(inp => inp.value.trim() === '')) return toast('请填写所有空');
    let allOk = true;
    const details = [];
    inputs.forEach(inp => {
      const b = part.blanks[Number(inp.dataset.blank)];
      const v = parseFloat(inp.value);
      const ok = !isNaN(v) && Math.abs(v - b.answer) <= (b.tolerance || 0.5);
      inp.classList.add(ok ? 'correct' : 'wrong'); inp.disabled = true;
      if (!ok) allOk = false;
      details.push(`${b.label}：${ok ? '✓' : '✗ 正确答案 ' + b.answer}`);
    });
    session.results.push({ id: q.id + '-' + pi, q: part.q.slice(0, 40), ok: allOk });
    const fb = $('#calc-feedback');
    fb.className = `p-3 rounded-lg text-sm leading-relaxed mb-3 ${allOk ? 'fb-ok' : 'fb-bad'}`;
    fb.innerHTML = `
      <div class="font-semibold mb-1">${allOk ? '✅ 全部正确！' : '❌ 有错误'}</div>
      <div class="mb-2">${details.map(escHtml).join('<br/>')}</div>
      <div class="formula-card mb-2">📐 ${escHtml(part.formula_card)}</div>`;
    fb.classList.remove('hidden');
    sessionFooter(isLast
      ? `<button class="btn btn-primary w-full" id="btn-next">完成本案例 →</button>`
      : `<button class="btn btn-primary w-full" id="btn-next">下一小问 →</button>`);
    $('#btn-next').addEventListener('click', () => {
      if (isLast) {
        subj().challengeCalc[q.id] = todayStr(); saveState();
        $('#calc-feedback').insertAdjacentHTML('beforeend', `<div class="mt-2 pt-2 border-t border-slate-300 dark:border-slate-600"><b>全案总解析：</b>${escHtml(q.analysis)}<br/><span style="color:#d97706"><b>易错点：</b>${escHtml(q.trap)}</span></div>`);
        sessionFooter(`<button class="btn btn-primary w-full" id="btn-done">结 束</button>`);
        $('#btn-done').addEventListener('click', () => { session.idx += 1; nextItem(); });
      } else renderChCalcPart(q, pi + 1);
    });
  });
}

// ---------------- 结算 ----------------
function finishSession() {
  const s = session;
  const okN = s.results.filter(r => r.ok).length;
  $('#session-modal').classList.add('hidden');
  $('#result-emoji').textContent = okN === s.results.length && s.results.length ? '🎉' : okN >= s.results.length / 2 ? '👍' : '💪';
  $('#result-title').textContent = `${s.label}完成`;
  $('#result-stats').innerHTML = `
    <div class="stat-cell"><div class="stat-num">${s.results.length}</div><div class="stat-label">答题数</div></div>
    <div class="stat-cell"><div class="stat-num">${s.results.length ? Math.round(okN / s.results.length * 100) : 0}%</div><div class="stat-label">表现</div></div>`;
  $('#result-detail').innerHTML = s.results.map(r => `<div>${r.ok ? '✅' : '❌'} ${escHtml(r.q)}</div>`).join('');
  $('#result-modal').classList.remove('hidden');
  session = null;
  render();
}
$('#result-close').addEventListener('click', () => $('#result-modal').classList.add('hidden'));

// ---------------- 深色模式 / Toast ----------------
function applyDark() {
  document.documentElement.classList.toggle('dark', state.settings.darkMode);
  $('#icon-dark').textContent = state.settings.darkMode ? '☀️' : '🌙';
}
$('#btn-dark').addEventListener('click', () => { state.settings.darkMode = !state.settings.darkMode; saveState(); applyDark(); });

let toastTimer = null;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 1800);
}

// ---------------- 启动 ----------------
applyDark();
render();
})();
