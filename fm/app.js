/* ================================================================
 * 财务管理·学习训练
 * ================================================================ */
(() => {
'use strict';

const QB = window.QUESTION_BANK;
const ALL_Q = QB.questions;
const RULES = QB.rules;
const STORAGE_KEY = 'fm_state_v1';

// ---------------- 工具函数 ----------------
const $ = (sel, p=document) => p.querySelector(sel);
const $$ = (sel, p=document) => Array.from(p.querySelectorAll(sel));
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const fmtMin = (m) => m < 60 ? `${m}分` : `${Math.floor(m/60)}时${m%60}分`;
const escHtml = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const shuffle = (arr) => { const a = arr.slice(); for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
const sumBy = (arr, fn) => arr.reduce((s,x)=>s+fn(x),0);

const PILLAR_TAG = { '第一支柱·定量资本': 'tag-pillar1', '第二支柱·定性监管': 'tag-pillar2', '第三支柱·市场约束': 'tag-pillar3', '特殊主体·保险集团': 'tag-pillar4', '特殊主体·劳合社中国': 'tag-pillar4' };

// ---------------- 状态管理 ----------------
const DEFAULT_STATE = {
  checkin: { lastDate: '', streak: 0, totalDays: 0, totalQuestions: 0 },
  attempts: {}, // qid -> { tries, correct, lastDate }
  wrong: [],   // [qid]
  mastered: {}, // qid -> true
  settings: { darkMode: false, examSize: 30, examTime: 25, dailyGoal: 5 },
  dailyStat: {}, // 'YYYY-MM-DD' -> { questions, correct, minutes }
  theta: 2.0,    // 用户能力估计
  examHistory: [], // [{date, score, total, mode, theta}]
};

let state = loadState();
function loadState() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) return Object.assign({}, DEFAULT_STATE, JSON.parse(s));
  } catch(e) {}
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e) { toast('存储失败'); }
}

// ---------------- 统计函数 ----------------
function isCheckedToday() { return state.checkin.lastDate === todayStr(); }
function doCheckin() {
  const t = todayStr();
  if (state.checkin.lastDate === t) return;
  const y = new Date(); y.setDate(y.getDate()-1);
  const yest = `${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,'0')}-${String(y.getDate()).padStart(2,'0')}`;
  state.checkin.streak = (state.checkin.lastDate === yest) ? state.checkin.streak + 1 : 1;
  state.checkin.lastDate = t;
  state.checkin.totalDays += 1;
  saveState();
}
function recordAttempt(qid, correct) {
  if (!state.attempts[qid]) state.attempts[qid] = { tries: 0, correct: 0, lastDate: '' };
  state.attempts[qid].tries += 1;
  if (correct) state.attempts[qid].correct += 1;
  state.attempts[qid].lastDate = todayStr();
  // 错题集
  if (correct) {
    state.wrong = state.wrong.filter(x => x !== qid);
    // 连续3次正确视为掌握
    if (state.attempts[qid].tries >= 3 && state.attempts[qid].correct / state.attempts[qid].tries >= 0.9) {
      state.mastered[qid] = true;
    }
  } else {
    if (!state.wrong.includes(qid)) state.wrong.push(qid);
    delete state.mastered[qid];
  }
  // 每日统计
  const t = todayStr();
  if (!state.dailyStat[t]) state.dailyStat[t] = { questions: 0, correct: 0, minutes: 0 };
  state.dailyStat[t].questions += 1;
  if (correct) state.dailyStat[t].correct += 1;
  // 累计答题数
  state.checkin.totalQuestions += 1;
  saveState();
}
function getOverall() {
  const attempted = Object.keys(state.attempts).length;
  const totalCorrect = sumBy(Object.values(state.attempts), a => a.correct);
  const totalTries = sumBy(Object.values(state.attempts), a => a.tries);
  const accuracy = totalTries ? (totalCorrect / totalTries * 100) : 0;
  return { attempted, totalCorrect, totalTries, accuracy, total: ALL_Q.length,
           wrongCount: state.wrong.length, masteredCount: Object.keys(state.mastered).length };
}
function getRuleStat(ruleNo) {
  const ids = ALL_Q.filter(q => q.rule_no === ruleNo).map(q => q.id);
  const att = ids.map(id => state.attempts[id]).filter(Boolean);
  const tries = sumBy(att, a => a.tries);
  const correct = sumBy(att, a => a.correct);
  return { total: ids.length, tried: att.length, tries, correct,
           accuracy: tries ? correct/tries*100 : 0,
           mastery: ids.filter(id => state.mastered[id]).length };
}
function getWeakRules(topN=3) {
  return RULES.map(r => ({ ...r, ...getRuleStat(r.no) }))
    .filter(r => r.tries >= 5)
    .sort((a,b) => a.accuracy - b.accuracy)
    .slice(0, topN);
}

// ---------------- 题目查找 ----------------
function findQ(id) { return ALL_Q.find(q => q.id === id); }
function qByRule(ruleNo) { return ALL_Q.filter(q => q.rule_no === ruleNo); }

// ---------------- 自适应选题 ----------------
function empiricalDifficulty(q) {
  // 1=易 2=中 3=难（标称）
  const a = state.attempts[q.id];
  if (!a || a.tries < 2) return q.difficulty; // 样本不足用标称
  // 正确率高 -> 实际偏易；反之偏难
  const acc = a.correct / a.tries;
  if (acc > 0.85) return Math.max(1, q.difficulty - 1);
  if (acc < 0.4) return Math.min(3, q.difficulty + 1);
  return q.difficulty;
}
function pickAdaptive(n, pool) {
  const candidates = pool.filter(q => !state.mastered[q.id]);
  if (candidates.length === 0) return shuffle(pool).slice(0, n);
  // 按"经验难度 vs 能力"差距 + 未答次数加权
  const scored = candidates.map(q => {
    const a = state.attempts[q.id];
    const notTried = !a ? 1 : 0;
    const wrongRecently = a ? Math.max(0, a.tries - a.correct) : 0;
    const empDiff = empiricalDifficulty(q);
    const diff = Math.abs(empDiff - state.theta);
    return { q, score: diff * 1.0 - notTried * 0.5 - wrongRecently * 0.2 };
  });
  scored.sort((x,y) => x.score - y.score);
  // 取前 n*2 再随机抽 n，保留一些变化
  const top = scored.slice(0, Math.min(n*2, scored.length)).map(s => s.q);
  return shuffle(top).slice(0, n);
}
function pickRandom(n, pool, opts={}) {
  let arr = pool.slice();
  if (opts.avoidMastered) arr = arr.filter(q => !state.mastered[q.id]);
  if (opts.qtype) arr = arr.filter(q => q.qtype === opts.qtype);
  return shuffle(arr).slice(0, n);
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
  const ov = getOverall();
  const checked = isCheckedToday();
  const today = state.dailyStat[todayStr()] || { questions: 0, correct: 0, minutes: 0 };
  const goalPct = Math.min(100, Math.round(today.questions / state.settings.dailyGoal * 100));
  const weak = getWeakRules(3);

  return `
    <section class="card">
      <div class="flex items-center justify-between mb-3">
        <div>
          <div class="text-xs text-slate-500 dark:text-slate-400">今日打卡</div>
          <div class="text-2xl font-bold mt-1">${state.checkin.streak} <span class="text-sm font-normal text-slate-500">天连续</span></div>
        </div>
        <button class="checkin-btn ${checked?'done':''}" id="btn-checkin" ${checked?'disabled':''}>
          ${checked ? '✓ 今日已打卡' : '点击打卡'}
        </button>
      </div>
      <div class="text-xs text-slate-500 dark:text-slate-400 flex justify-between">
        <span>累计打卡 <b class="text-slate-800 dark:text-slate-200">${state.checkin.totalDays}</b> 天</span>
        <span>累计答题 <b class="text-slate-800 dark:text-slate-200">${state.checkin.totalQuestions}</b> 题</span>
      </div>
    </section>

    <section class="card">
      <div class="flex justify-between items-center mb-2">
        <div class="font-semibold">今日目标 · ${state.settings.dailyGoal}题</div>
        <div class="text-xs text-slate-500">${today.questions}/${state.settings.dailyGoal}</div>
      </div>
      <div class="bar"><div style="width:${goalPct}%"></div></div>
      <div class="grid grid-cols-3 gap-3 mt-3 text-center">
        <div class="stat-cell"><div class="stat-num text-brand-500">${today.questions}</div><div class="stat-label">今日答题</div></div>
        <div class="stat-cell"><div class="stat-num text-emerald-500">${today.correct}</div><div class="stat-label">答对</div></div>
        <div class="stat-cell"><div class="stat-num text-amber-500">${fmtMin(today.minutes)}</div><div class="stat-label">学习时长</div></div>
      </div>
      <div class="flex gap-2 mt-4">
        <button class="btn btn-primary flex-1" data-action="quick3">🎯 每日3题</button>
        <button class="btn btn-outline flex-1" data-action="quick10">📚 随机10题</button>
      </div>
    </section>

    <section class="card">
      <div class="font-semibold mb-3">学习概览</div>
      <div class="grid grid-cols-4 gap-2 text-center">
        <div class="stat-cell"><div class="stat-num">${ov.attempted}</div><div class="stat-label">已答题目</div></div>
        <div class="stat-cell"><div class="stat-num text-emerald-500">${ov.accuracy.toFixed(0)}%</div><div class="stat-label">总正确率</div></div>
        <div class="stat-cell"><div class="stat-num text-red-500">${ov.wrongCount}</div><div class="stat-label">错题数</div></div>
        <div class="stat-cell"><div class="stat-num text-purple-500">${ov.masteredCount}</div><div class="stat-label">已掌握</div></div>
      </div>
    </section>

    ${weak.length > 0 ? `
    <section class="card">
      <div class="font-semibold mb-2">薄弱规则 TOP 3</div>
      <div class="space-y-2">
        ${weak.map(w => `
          <div class="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-700/50">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate">${escHtml(w.title)}</div>
              <div class="text-xs text-slate-500">已做 ${w.tries} 题 · 正确率 ${w.accuracy.toFixed(0)}%</div>
            </div>
            <button class="btn btn-outline text-xs" data-action="rule" data-rule="${w.no}">练习</button>
          </div>
        `).join('')}
      </div>
    </section>` : ''}

    <section class="card">
      <div class="font-semibold mb-3">推荐学习</div>
      <div class="space-y-2 text-sm">
        <button class="w-full text-left p-3 rounded-lg bg-slate-50 dark:bg-slate-700/50 flex justify-between" data-action="wrong">
          <span>❌ 复习错题 <span class="text-slate-500">(${ov.wrongCount})</span></span><span class="text-slate-400">→</span>
        </button>
        <button class="w-full text-left p-3 rounded-lg bg-slate-50 dark:bg-slate-700/50 flex justify-between" data-action="exam">
          <span>📝 开始一次模拟考试</span><span class="text-slate-400">→</span>
        </button>
        <button class="w-full text-left p-3 rounded-lg bg-slate-50 dark:bg-slate-700/50 flex justify-between" data-action="random">
          <span>🎲 随机练习20题</span><span class="text-slate-400">→</span>
        </button>
      </div>
    </section>
  `;
}

// ---------------- 渲染：学习 ----------------
function renderLearn() {
  return `
    <div class="font-semibold mb-3">选择规则开始练习</div>
    <div class="grid grid-cols-2 gap-3">
      ${RULES.map(r => {
        const st = getRuleStat(r.no);
        const pct = st.total ? Math.round(st.mastery / st.total * 100) : 0;
        return `
          <div class="card !mb-0 cursor-pointer hover:shadow-md transition" data-action="rule" data-rule="${r.no}">
            <div class="flex items-center justify-between mb-1">
              <span class="tag ${PILLAR_TAG[r.pillar]}">${r.pillar.split('·')[1] || r.pillar}</span>
              <span class="text-xs text-slate-500">${r.count}题</span>
            </div>
            <div class="text-sm font-semibold leading-snug mb-2">${escHtml(r.title)}</div>
            <div class="bar mb-1"><div style="width:${pct}%"></div></div>
            <div class="text-[11px] text-slate-500">已答 ${st.tried}/${st.total} · 掌握 ${pct}%</div>
          </div>`;
      }).join('')}
    </div>
  `;
}

// ---------------- 渲染：考试 ----------------
function renderExam() {
  const last = state.examHistory.slice(-1)[0];
  return `
    <div class="card">
      <div class="font-semibold mb-3">📝 模拟考试</div>
      <div class="space-y-3 text-sm">
        <div>
          <div class="text-slate-500 mb-1">考试模式</div>
          <div class="grid grid-cols-2 gap-2">
            <label class="opt !p-3 cursor-pointer"><input type="radio" name="mode" value="adaptive" class="mr-1"> 自适应</label>
            <label class="opt !p-3 cursor-pointer"><input type="radio" name="mode" value="fixed" class="mr-1" checked> 固定抽题</label>
          </div>
        </div>
        <div>
          <div class="text-slate-500 mb-1">题量</div>
          <div class="grid grid-cols-4 gap-2">
            ${[20,30,50,80].map(n => `<label class="opt !p-3 text-center cursor-pointer"><input type="radio" name="size" value="${n}" ${n===state.settings.examSize?'checked':''} class="hidden peer"><span class="peer-checked:font-bold">${n}题</span></label>`).join('')}
          </div>
        </div>
        <div>
          <div class="text-slate-500 mb-1">时长(分钟)</div>
          <div class="grid grid-cols-4 gap-2">
            ${[15,25,45,60].map(n => `<label class="opt !p-3 text-center cursor-pointer"><input type="radio" name="time" value="${n}" ${n===state.settings.examTime?'checked':''} class="hidden"><span>${n}</span></label>`).join('')}
          </div>
        </div>
        <div>
          <div class="text-slate-500 mb-1">范围</div>
          <div class="grid grid-cols-2 gap-2">
            <label class="opt !p-3 cursor-pointer"><input type="radio" name="scope" value="all" class="mr-1" checked> 全部20份</label>
            <label class="opt !p-3 cursor-pointer"><input type="radio" name="scope" value="weak" class="mr-1"> 仅薄弱</label>
          </div>
        </div>
      </div>
      <button class="checkin-btn mt-4" data-action="exam-start">开始考试</button>
    </div>

    ${last ? `
    <div class="card">
      <div class="text-xs text-slate-500 mb-1">上次考试</div>
      <div class="flex justify-between items-center">
        <div>
          <div class="text-lg font-bold">${last.score}/${last.total} <span class="text-sm text-slate-500">${(last.score/last.total*100).toFixed(0)}%</span></div>
          <div class="text-xs text-slate-500">${last.mode === 'adaptive' ? '自适应' : '固定'} · ${last.date} · 能力分 ${last.theta?.toFixed(1) || '-'}</div>
        </div>
      </div>
    </div>` : ''}

    <div class="card">
      <div class="text-xs text-slate-500 mb-2">说明</div>
      <ul class="text-xs text-slate-600 dark:text-slate-300 space-y-1 leading-relaxed">
        <li>· 自适应：根据你的答题表现动态调整难度，连对升难、连错降难。</li>
        <li>· 固定抽题：随机抽取所选题量，难度不调整。</li>
        <li>· 考试期间可暂停查看答题卡，提前交卷将不计入历史。</li>
      </ul>
    </div>
  `;
}

// ---------------- 渲染：错题 ----------------
function renderWrong() {
  if (state.wrong.length === 0) {
    return `<div class="card text-center py-12">
      <div class="text-5xl mb-2">🎉</div>
      <div class="font-semibold mb-1">暂无错题</div>
      <div class="text-sm text-slate-500 mb-4">继续保持，答错的题会自动收集在这里</div>
      <button class="btn btn-primary" data-action="random">开始随机练习</button>
    </div>`;
  }
  const wrongQs = state.wrong.map(findQ).filter(Boolean);
  return `
    <div class="flex items-center justify-between mb-3">
      <div class="font-semibold">共 ${wrongQs.length} 道错题</div>
      <div class="flex gap-2">
        <button class="btn btn-outline text-xs" data-action="wrong-clear">清空</button>
        <button class="btn btn-primary text-xs" data-action="wrong-practice">开始复习</button>
      </div>
    </div>
    <div class="card">
      ${wrongQs.slice(0, 100).map(q => {
        const a = state.attempts[q.id] || {};
        return `
          <div class="qrow">
            <div class="flex-1 min-w-0">
              <div class="text-xs text-slate-500 mb-0.5">${escHtml(q.material||'')} · ${q.qtype==='single'?'单选':'多选'}</div>
              <div class="text-sm truncate">${escHtml(q.q)}</div>
            </div>
            <div class="text-xs text-red-500">${a.tries ? Math.round(a.correct/a.tries*100)+'%' : '-'}</div>
          </div>`;
      }).join('')}
      ${wrongQs.length > 100 ? `<div class="text-xs text-slate-500 text-center pt-2">仅显示前100题，复习将随机抽题</div>` : ''}
    </div>
  `;
}

// ---------------- 渲染：我的 ----------------
let charts = [];
function renderMe() {
  // 销毁旧图表
  charts.forEach(c => c.destroy()); charts = [];
  setTimeout(() => {
    drawDailyChart();
  }, 30);
  const ov = getOverall();
  const days = Object.keys(state.dailyStat).length;
  return `
    <div class="card">
      <div class="font-semibold mb-3">学习统计</div>
      <div class="grid grid-cols-2 gap-3">
        <div class="stat-cell !p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
          <div class="stat-num text-brand-500">${ov.totalCorrect}</div>
          <div class="stat-label">累计答对</div>
        </div>
        <div class="stat-cell !p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
          <div class="stat-num">${ov.totalTries}</div>
          <div class="stat-label">累计作答</div>
        </div>
        <div class="stat-cell !p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
          <div class="stat-num text-emerald-500">${ov.accuracy.toFixed(1)}%</div>
          <div class="stat-label">总正确率</div>
        </div>
        <div class="stat-cell !p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
          <div class="stat-num text-amber-500">${state.theta.toFixed(2)}</div>
          <div class="stat-label">能力估计θ</div>
        </div>
        <div class="stat-cell !p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
          <div class="stat-num text-purple-500">${ov.masteredCount}</div>
          <div class="stat-label">已掌握</div>
        </div>
        <div class="stat-cell !p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
          <div class="stat-num text-pink-500">${days}</div>
          <div class="stat-label">学习天数</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="font-semibold mb-2">各规则掌握度</div>
      ${masteryListHtml()}
    </div>

    <div class="card">
      <div class="font-semibold mb-2">近14天学习量</div>
      <div class="relative" style="height:180px"><canvas id="chart-daily"></canvas></div>
    </div>

    <div class="card">
      <div class="font-semibold mb-2">数据管理</div>
      <div class="grid grid-cols-2 gap-2">
        <button class="btn btn-outline" data-action="export">📤 导出进度</button>
        <button class="btn btn-outline" data-action="import">📥 导入进度</button>
        <button class="btn btn-outline" data-action="set-goal">🎯 设定每日目标</button>
        <button class="btn btn-outline text-red-500" data-action="reset">🗑 重置数据</button>
      </div>
    </div>

    <div class="card text-center text-xs text-slate-500">
      财务管理 · 学习训练 v1.0<br>
      共 ${ALL_Q.length} 题 · 单选 ${ALL_Q.filter(q=>q.qtype==='single').length} · 多选 ${ALL_Q.filter(q=>q.qtype==='multi').length}
    </div>
  `;
}
function masteryListHtml() {
  // 纯 HTML 进度条列表：无图表引擎，瞬时渲染，天然适配屏幕宽度
  const pillars = [...new Set(RULES.map(r => r.pillar))];
  return pillars.map(p => {
    const rows = RULES.filter(r => r.pillar === p).map(r => {
      const s = getRuleStat(r.no);
      const acc = Math.round(s.accuracy);
      const barColor = !s.tries ? 'bg-slate-300 dark:bg-slate-600'
        : acc < 60 ? 'bg-red-500' : acc < 80 ? 'bg-amber-500' : 'bg-emerald-500';
      const right = s.tries
        ? `<span class="text-slate-500 dark:text-slate-400">正确率${acc}% · 掌握${s.mastery}/${s.total}</span>`
        : `<span class="text-slate-400 dark:text-slate-500">未作答 · ${s.total}题</span>`;
      return `
        <div class="py-1.5">
          <div class="flex items-center justify-between gap-2 text-xs mb-1">
            <div class="truncate text-slate-600 dark:text-slate-300" title="${escHtml(r.title)}">${escHtml(r.title)}</div>
            <div class="flex-shrink-0 whitespace-nowrap">${right}</div>
          </div>
          <div class="h-1.5 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div class="h-full ${barColor} rounded-full transition-all" style="width:${s.tries ? acc : 0}%"></div>
          </div>
        </div>`;
    }).join('');
    return `<div class="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-2 mb-0.5">${escHtml(p)}</div>${rows}`;
  }).join('');
}
function drawDailyChart() {
  const el = $('#chart-daily'); if (!el) return;
  const days = [];
  const now = new Date();
  for (let i=13; i>=0; i--) {
    const d = new Date(now); d.setDate(d.getDate()-i);
    days.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
  }
  const data = days.map(d => state.dailyStat[d] || { questions: 0, correct: 0 });
  const ctx = el.getContext('2d');
  const dark = document.documentElement.classList.contains('dark');
  const fg = dark ? '#cbd5e1' : '#475569';
  const grid = dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.08)';
  charts.push(new Chart(ctx, {
    type: 'bar',
    data: { labels: days.map(d=>d.slice(5)), datasets: [
      { label: '答题数', data: data.map(d=>d.questions), backgroundColor: '#1f4e79' },
      { label: '答对', data: data.map(d=>d.correct), backgroundColor: '#16a34a' },
    ]},
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: fg } } }, scales: { x: { ticks: { color: fg } }, y: { beginAtZero: true, ticks: { color: fg }, grid: { color: grid } } } }
  }));
}

// ---------------- 路由渲染 ----------------
function render() {
  const main = $('#main');
  if (currentPage === 'home') main.innerHTML = renderHome();
  else if (currentPage === 'learn') main.innerHTML = renderLearn();
  else if (currentPage === 'exam') main.innerHTML = renderExam();
  else if (currentPage === 'wrong') main.innerHTML = renderWrong();
  else if (currentPage === 'me') main.innerHTML = renderMe();
  bindActions();
  main.scrollTop = 0;
}

// ---------------- 事件绑定 ----------------
function bindActions() {
  $$('[data-action]').forEach(b => {
    b.addEventListener('click', (e) => {
      const a = b.dataset.action;
      if (a === 'rule') startPractice({ ruleNo: parseInt(b.dataset.rule) });
      else if (a === 'exam') go('exam');
      else if (a === 'exam-start') startExam();
      else if (a === 'random') startPractice({ random: 20 });
      else if (a === 'quick3') startPractice({ random: 3, mode: 'adaptive' });
      else if (a === 'quick10') startPractice({ random: 10 });
      else if (a === 'wrong') go('wrong');
      else if (a === 'wrong-practice') startWrongPractice();
      else if (a === 'wrong-clear') { if (confirm('清空所有错题？')) { state.wrong = []; saveState(); render(); toast('已清空'); } }
      else if (a === 'export') exportData();
      else if (a === 'import') importData();
      else if (a === 'set-goal') setGoal();
      else if (a === 'reset') { if (confirm('重置全部数据？此操作不可恢复！')) { state = JSON.parse(JSON.stringify(DEFAULT_STATE)); saveState(); render(); toast('已重置'); } }
    });
  });
  const cb = $('#btn-checkin');
  if (cb && !cb.disabled) cb.addEventListener('click', () => { doCheckin(); render(); toast('打卡成功！开始今日学习吧'); });
}

// ---------------- 答题引擎 ----------------
let session = null;
function newSession(questions, opts={}) {
  session = {
    questions, idx: 0, results: [], // {qid, correct, picked, time}
    startTime: Date.now(),
    timeLimit: opts.timeLimit || 0,
    timerHandle: null,
    title: opts.title || '练习',
    showFeedbackImmediately: opts.showFeedback !== false,
    mode: opts.mode || 'normal',
    adaptive: !!opts.adaptive,
  };
  $('#quiz-progress').textContent = `1 / ${questions.length}`;
  $('#quiz-modal').classList.remove('hidden');
  if (session.timeLimit > 0) startTimer();
  showQ();
}
function startTimer() {
  let left = session.timeLimit * 60;
  const update = () => {
    const m = Math.floor(left/60), s = left%60;
    $('#quiz-timer').textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    if (left <= 60) $('#quiz-timer').classList.add('text-red-500');
    if (left <= 0) { finishSession(true); return; }
    left -= 1;
    session.timerHandle = setTimeout(update, 1000);
  };
  update();
}
function showQ() {
  const q = session.questions[session.idx];
  $('#quiz-progress').textContent = `${session.idx+1} / ${session.questions.length}`;
  $('#quiz-rule-tag').textContent = `${escHtml(q.material||'')} · ${escHtml(q.rule_title)} · ${q.qtype==='single'?'单选':'多选'}`;
  $('#quiz-question').textContent = q.q;
  const wrap = $('#quiz-options'); wrap.innerHTML = '';
  const fb = $('#quiz-feedback'); fb.classList.add('hidden');
  $('#quiz-submit').classList.toggle('hidden', q.qtype !== 'multi');
  $('#quiz-next').classList.add('hidden');

  q.options.forEach((opt, i) => {
    const letter = String.fromCharCode(65+i);
    const btn = document.createElement('button');
    btn.className = 'opt';
    btn.dataset.letter = letter;
    btn.innerHTML = `<span class="font-semibold mr-1">${letter}.</span>${escHtml(opt)}`;
    btn.addEventListener('click', () => onPick(letter, btn));
    wrap.appendChild(btn);
  });

  session._picked = [];
  session._submitted = false;
  if (q.qtype === 'single' && session.showFeedbackImmediately) {
    // 单选点击即判
  }
}
function onPick(letter, btn) {
  if (session._submitted) return;
  const q = session.questions[session.idx];
  if (q.qtype === 'single') {
    // 单选直接判
    session._picked = [letter];
    $$('.opt', $('#quiz-options')).forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    judgeSingle();
  } else {
    // 多选：多选切换
    if (session._picked.includes(letter)) {
      session._picked = session._picked.filter(x => x !== letter);
      btn.classList.remove('selected');
    } else {
      session._picked.push(letter);
      btn.classList.add('selected');
    }
  }
}
function judgeSingle() {
  const q = session.questions[session.idx];
  const ans = q.answer;
  const correct = session._picked[0] === ans;
  showFeedback(correct);
  recordAndMark(correct, q, session._picked);
}
function showFeedback(correct) {
  const q = session.questions[session.idx];
  const ans = Array.isArray(q.answer) ? q.answer.sort().join('') : q.answer;
  const picked = (session._picked || []).slice().sort().join('') || '(未选)';
  // 标记正确/错误
  $$('.opt', $('#quiz-options')).forEach(b => {
    const L = b.dataset.letter;
    if (Array.isArray(q.answer) ? q.answer.includes(L) : q.answer === L) b.classList.add('correct');
    else if (session._picked.includes(L)) b.classList.add('wrong');
  });
  const fb = $('#quiz-feedback');
  fb.classList.remove('hidden');
  fb.innerHTML = `<div class="font-semibold mb-1 ${correct?'text-emerald-600':'text-red-500'}">${correct?'✓ 回答正确':'✗ 回答错误'} · 你的答案: ${picked} · 正确答案: ${ans}</div><div class="text-slate-600 dark:text-slate-300">${escHtml(q.explanation || '')}</div>`;
  // 滚动到反馈
  setTimeout(() => fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  $('#quiz-next').classList.remove('hidden');
  $('#quiz-submit').classList.add('hidden');
}
function recordAndMark(correct, q, picked) {
  if (session._submitted) return;
  session._submitted = true;
  recordAttempt(q.id, correct);
  // 自适应更新 theta
  if (session.adaptive) {
    state.theta = Math.max(0.3, Math.min(3.0, state.theta + (correct ? 0.15 : -0.15)));
    saveState();
  }
  session.results.push({ qid: q.id, correct, picked, correctAns: q.answer });
}
function nextQ() {
  if (session.idx + 1 >= session.questions.length) {
    finishSession(false);
  } else {
    session.idx += 1;
    showQ();
  }
}
function finishSession(timeout) {
  if (session.timerHandle) clearTimeout(session.timerHandle);
  const total = session.questions.length;
  const correct = session.results.filter(r => r.correct).length;
  const wrongList = session.results.filter(r => !r.correct);
  const elapsed = Math.round((Date.now() - session.startTime) / 60000);
  // 累计时长
  if (elapsed > 0) {
    const t = todayStr();
    if (!state.dailyStat[t]) state.dailyStat[t] = { questions: 0, correct: 0, minutes: 0 };
    state.dailyStat[t].minutes += elapsed;
    saveState();
  }
  // 考试历史
  if (session.mode === 'exam') {
    state.examHistory.push({ date: todayStr(), score: correct, total, mode: session.adaptive?'adaptive':'fixed', theta: state.theta });
    if (state.examHistory.length > 30) state.examHistory = state.examHistory.slice(-30);
    saveState();
  }
  // 关闭弹层
  $('#quiz-modal').classList.add('hidden');
  // 显示结果
  const pct = total ? Math.round(correct/total*100) : 0;
  let emoji = '🎉', title = '完成！';
  if (pct < 60) { emoji = '😢'; title = '继续加油'; }
  else if (pct < 80) { emoji = '💪'; title = '继续努力'; }
  else if (pct < 95) { emoji = '👏'; title = '表现优秀'; }
  else { emoji = '🏆'; title = '完美！'; }
  $('#result-emoji').textContent = emoji;
  $('#result-title').textContent = (timeout?'⏰ 时间到 · ':'') + title;
  $('#result-stats').innerHTML = `
    <div class="bg-slate-50 dark:bg-slate-700/50 rounded-lg"><div class="stat-num text-brand-500">${correct}/${total}</div><div class="stat-label">答对</div></div>
    <div class="bg-slate-50 dark:bg-slate-700/50 rounded-lg"><div class="stat-num">${pct}%</div><div class="stat-label">正确率</div></div>
    <div class="bg-slate-50 dark:bg-slate-700/50 rounded-lg"><div class="stat-num">${fmtMin(elapsed)}</div><div class="stat-label">用时</div></div>
    <div class="bg-slate-50 dark:bg-slate-700/50 rounded-lg"><div class="stat-num">${state.theta.toFixed(1)}</div><div class="stat-label">能力θ</div></div>
  `;
  const detail = wrongList.length > 0
    ? `<div class="mb-1 font-semibold text-slate-700 dark:text-slate-200">错题已自动加入错题集：</div>` + wrongList.slice(0,8).map(r => {
        const q = findQ(r.qid);
        if (!q) return '';
        return `<div class="text-xs">· ${escHtml(q.rule_title)} ${escHtml(q.q.slice(0,24))}${q.q.length>30?'…':''} (答${r.picked}/正${Array.isArray(r.correctAns)?r.correctAns.join(''):r.correctAns})</div>`;
      }).join('') + (wrongList.length>8?`<div class="text-xs text-slate-500 mt-1">... 共${wrongList.length}题</div>`:'')
    : '<div class="text-emerald-500">全部答对！太棒了</div>';
  $('#result-detail').innerHTML = detail;
  $('#result-close').onclick = () => $('#result-modal').classList.add('hidden');
  $('#result-review').onclick = () => { $('#result-modal').classList.add('hidden'); go('wrong'); };
  $('#result-modal').classList.remove('hidden');
  session = null;
  if (isCheckedToday() === false && total >= 5) { doCheckin(); }
}

// ---------------- 启动各种模式 ----------------
function startPractice({ ruleNo, random }) {
  let qs;
  if (ruleNo) {
    qs = qByRule(ruleNo);
  } else {
    qs = ALL_Q;
  }
  // 默认自适应
  qs = pickAdaptive(random || Math.min(qs.length, 20), qs);
  newSession(qs, { title: ruleNo ? `${(RULES.find(x=>x.no===ruleNo)||{}).title||''}练习` : '随机练习', mode: 'practice', adaptive: true });
}
function startWrongPractice() {
  const qs = state.wrong.map(findQ).filter(Boolean);
  if (qs.length === 0) return toast('暂无错题');
  newSession(shuffle(qs), { title: '错题复习', mode: 'practice', adaptive: false });
}
function startExam() {
  const size = parseInt(($('input[name="size"]:checked') || {}).value || state.settings.examSize);
  const time = parseInt(($('input[name="time"]:checked') || {}).value || state.settings.examTime);
  const mode = ($('input[name="mode"]:checked') || {}).value || 'fixed';
  const scope = ($('input[name="scope"]:checked') || {}).value || 'all';
  let pool = ALL_Q;
  if (scope === 'weak') {
    const weakIds = new Set();
    getWeakRules(10).forEach(r => qByRule(r.no).forEach(q => weakIds.add(q.id)));
    pool = ALL_Q.filter(q => weakIds.has(q.id));
  }
  const qs = mode === 'adaptive' ? pickAdaptive(size, pool) : pickRandom(size, pool);
  state.settings.examSize = size; state.settings.examTime = time; saveState();
  newSession(qs, { title: '模拟考试', mode: 'exam', adaptive: mode==='adaptive', timeLimit: time, showFeedback: false });
}

// ---------------- 答题事件 ----------------
$('#quiz-submit').addEventListener('click', () => {
  if (!session) return;
  const q = session.questions[session.idx];
  if (session._picked.length === 0) return toast('请先选择');
  const ans = (Array.isArray(q.answer) ? q.answer.slice().sort().join('') : q.answer);
  const picked = session._picked.slice().sort().join('');
  const correct = ans === picked;
  showFeedback(correct);
  recordAndMark(correct, q, session._picked);
});
$('#quiz-next').addEventListener('click', nextQ);
$('#quiz-close').addEventListener('click', () => {
  if (!confirm('确认退出本次练习？进度不会保存。')) return;
  if (session.timerHandle) clearTimeout(session.timerHandle);
  $('#quiz-modal').classList.add('hidden');
  session = null;
  render();
});

// ---------------- 设置 ----------------
function setGoal() {
  const v = prompt('每日答题目标(题)：', state.settings.dailyGoal);
  const n = parseInt(v);
  if (n && n > 0 && n <= 100) {
    state.settings.dailyGoal = n;
    saveState(); render(); toast('已设定每日' + n + '题');
  }
}
function exportData() {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `财务管理学习进度-${todayStr()}.json`;
  a.click();
  toast('已导出');
}
function importData() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json';
  inp.onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const obj = JSON.parse(r.result);
        state = Object.assign({}, DEFAULT_STATE, obj);
        saveState(); render(); toast('已导入');
      } catch(e) { toast('文件格式错误'); }
    };
    r.readAsText(f);
  };
  inp.click();
}

// ---------------- 深色模式 ----------------
function applyDark() {
  document.documentElement.classList.toggle('dark', state.settings.darkMode);
  $('#icon-dark').textContent = state.settings.darkMode ? '☀️' : '🌙';
}
$('#btn-dark').addEventListener('click', () => {
  state.settings.darkMode = !state.settings.darkMode;
  saveState(); applyDark();
});

// ---------------- Toast ----------------
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 1800);
}

// ---------------- 启动 ----------------
applyDark();
go('home');

// 重新可见时刷新（适配切换页面）
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

})();
