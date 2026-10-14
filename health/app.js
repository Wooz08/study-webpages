/* ================================================================
 * 健康保险实务 · 刷题训练
 * 题库结构：window.QUESTION_BANK = { modules:[{code,title,desc,topics:[{no,title,count}]}], questions:[{id,module,topic_no,topic,qtype,q,options,answer,explanation,difficulty,tags}] }
 * ================================================================ */
(() => {
'use strict';

const QB = window.QUESTION_BANK || { modules: [], questions: [] };
const ALL_Q = QB.questions;
const MODULES = QB.modules;
const STORAGE_KEY = 'healthins_state_v1';

// -------- 章节（topic）扁平化 --------
const TOPICS = [];
MODULES.forEach(m => m.topics.forEach(t => TOPICS.push({
  key: m.code + '-' + t.no, code: m.code, no: t.no, title: t.title,
  modTitle: m.title, count: t.count
})));

const $ = (sel, p = document) => p.querySelector(sel);
const $$ = (sel, p = document) => Array.from(p.querySelectorAll(sel));
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const fmtMin = (m) => m < 60 ? `${m}分` : `${Math.floor(m/60)}时${m%60}分`;
const escHtml = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const shuffle = (arr) => { const a = arr.slice(); for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
const sumBy = (arr, fn) => arr.reduce((s,x)=>s+fn(x),0);
const tkey = (q) => q.module + '-' + q.topic_no;
const MOD_CLS = { A: 'tag-modA', B: 'tag-modB', C: 'tag-modC' };
const modOf = (code) => MODULES.find(m => m.code === code) || { title: code };

// -------- 状态 --------
const DEFAULT_STATE = {
  checkin: { lastDate: '', streak: 0, totalDays: 0, totalQuestions: 0 },
  attempts: {},        // qid -> { tries, correct, lastDate }
  wrong: [],           // [qid]
  mastered: {},        // qid -> true
  settings: { darkMode: false, examSize: 30, examTime: 25, examScope: 'all', examType: 'mixed', dailyGoal: 10 },
  dailyStat: {},       // 'YYYY-MM-DD' -> { questions, correct, minutes }
  theta: 2.0,
  examHistory: []
};
let state = loadState();
function loadState() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) { const o = Object.assign({}, DEFAULT_STATE, JSON.parse(s)); o.settings = Object.assign({}, DEFAULT_STATE.settings, o.settings || {}); return o; }
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}
function saveState() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { toast('存储失败'); } }

// -------- 打卡与统计 --------
function isCheckedToday() { return state.checkin.lastDate === todayStr(); }
function doCheckin() {
  const t = todayStr();
  if (state.checkin.lastDate === t) return;
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yest = `${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,'0')}-${String(y.getDate()).padStart(2,'0')}`;
  state.checkin.streak = (state.checkin.lastDate === yest) ? state.checkin.streak + 1 : 1;
  state.checkin.lastDate = t;
  state.checkin.totalDays += 1;
  saveState();
}
function recordAttempt(qid, correct) {
  if (!state.attempts[qid]) state.attempts[qid] = { tries: 0, correct: 0, lastDate: '' };
  const a = state.attempts[qid];
  a.tries += 1;
  if (correct) a.correct += 1;
  a.lastDate = todayStr();
  if (correct) {
    state.wrong = state.wrong.filter(x => x !== qid);
    if (a.tries >= 3 && a.correct / a.tries >= 0.9) state.mastered[qid] = true;
  } else {
    if (!state.wrong.includes(qid)) state.wrong.push(qid);
    delete state.mastered[qid];
  }
  const t = todayStr();
  if (!state.dailyStat[t]) state.dailyStat[t] = { questions: 0, correct: 0, minutes: 0 };
  state.dailyStat[t].questions += 1;
  if (correct) state.dailyStat[t].correct += 1;
  state.checkin.totalQuestions += 1;
  saveState();
}
function getOverall() {
  const attempted = Object.keys(state.attempts).length;
  const totalCorrect = sumBy(Object.values(state.attempts), a => a.correct);
  const totalTries = sumBy(Object.values(state.attempts), a => a.tries);
  return {
    attempted, totalCorrect, totalTries, total: ALL_Q.length,
    accuracy: totalTries ? totalCorrect / totalTries * 100 : 0,
    wrongCount: state.wrong.length,
    masteredCount: Object.keys(state.mastered).length
  };
}
function getTopicStat(key) {
  const ids = ALL_Q.filter(q => tkey(q) === key).map(q => q.id);
  const att = ids.map(id => state.attempts[id]).filter(Boolean);
  const tries = sumBy(att, a => a.tries);
  const correct = sumBy(att, a => a.correct);
  return { total: ids.length, tried: att.length, tries, correct,
    accuracy: tries ? correct / tries * 100 : 0,
    mastery: ids.filter(id => state.mastered[id]).length };
}
function getModuleStat(code) {
  const ids = ALL_Q.filter(q => q.module === code).map(q => q.id);
  const att = ids.map(id => state.attempts[id]).filter(Boolean);
  const tries = sumBy(att, a => a.tries);
  const correct = sumBy(att, a => a.correct);
  return { total: ids.length, tried: att.length, tries, correct,
    accuracy: tries ? correct / tries * 100 : 0,
    mastery: ids.filter(id => state.mastered[id]).length };
}
function getWeakTopics(topN = 3) {
  return TOPICS.map(t => ({ ...t, ...getTopicStat(t.key) }))
    .filter(t => t.tries >= 4)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, topN);
}
function getWeakTopicsForExam(topN = 6) {
  return TOPICS.map(t => ({ ...t, ...getTopicStat(t.key) }))
    .filter(t => t.tries >= 3)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, topN);
}

// -------- 选题 --------
function findQ(id) { return ALL_Q.find(q => q.id === id); }
function qByTopic(key) { return ALL_Q.filter(q => tkey(q) === key); }
function qByModule(code) { return ALL_Q.filter(q => q.module === code); }
function filterByType(pool, type) {
  if (type === 'single') return pool.filter(q => q.qtype === 'single');
  if (type === 'multi') return pool.filter(q => q.qtype === 'multi');
  return pool;
}
function empiricalDifficulty(q) {
  const a = state.attempts[q.id];
  if (!a || a.tries < 2) return q.difficulty;
  const acc = a.correct / a.tries;
  if (acc > 0.85) return Math.max(1, q.difficulty - 1);
  if (acc < 0.4) return Math.min(3, q.difficulty + 1);
  return q.difficulty;
}
function pickAdaptive(n, pool) {
  const candidates = pool.filter(q => !state.mastered[q.id]);
  if (candidates.length === 0) return shuffle(pool).slice(0, n);
  const scored = candidates.map(q => {
    const a = state.attempts[q.id];
    const notTried = !a ? 1 : 0;
    const wrongRecently = a ? Math.max(0, a.tries - a.correct) : 0;
    const diff = Math.abs(empiricalDifficulty(q) - state.theta);
    return { q, score: diff * 1.0 - notTried * 0.5 - wrongRecently * 0.2 };
  });
  scored.sort((x, y) => x.score - y.score);
  const top = scored.slice(0, Math.min(n * 2, scored.length)).map(s => s.q);
  return shuffle(top).slice(0, n);
}
function pickRandom(n, pool) { return shuffle(pool).slice(0, n); }

// -------- 路由 --------
let currentPage = 'home';
function go(page) {
  currentPage = page;
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  render();
}
$$('.nav-btn').forEach(b => b.addEventListener('click', () => go(b.dataset.page)));

let learnScope = 'all';   // all | A | B | C
let practiceType = 'mixed'; // mixed | single | multi

// -------- 首页 --------
function renderHome() {
  const ov = getOverall();
  const checked = isCheckedToday();
  const today = state.dailyStat[todayStr()] || { questions: 0, correct: 0, minutes: 0 };
  const goalPct = Math.min(100, Math.round(today.questions / state.settings.dailyGoal * 100));
  const weak = getWeakTopics(3);
  const pctAll = ALL_Q.length ? Math.round(ov.attempted / ALL_Q.length * 100) : 0;

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
        <div class="font-semibold">今日目标 · ${state.settings.dailyGoal} 题</div>
        <div class="text-xs text-slate-500">${today.questions}/${state.settings.dailyGoal}</div>
      </div>
      <div class="bar"><div style="width:${goalPct}%"></div></div>
      <div class="grid grid-cols-3 gap-3 mt-3 text-center">
        <div class="stat-cell"><div class="stat-num text-brand-500">${today.questions}</div><div class="stat-label">今日答题</div></div>
        <div class="stat-cell"><div class="stat-num text-emerald-500">${today.correct}</div><div class="stat-label">答对</div></div>
        <div class="stat-cell"><div class="stat-num text-amber-500">${fmtMin(today.minutes)}</div><div class="stat-label">学习时长</div></div>
      </div>
      <div class="flex gap-2 mt-4">
        <button class="btn btn-primary flex-1" data-action="quick10">🎯 每日10题</button>
        <button class="btn btn-outline flex-1" data-action="quick-wrong">❌ 错题速刷</button>
      </div>
    </section>

    <section class="card">
      <div class="flex items-center justify-between mb-3">
        <div class="font-semibold">题库进度</div>
        <div class="text-xs text-slate-500">${ov.attempted} / ${ov.total}（${pctAll}%）</div>
      </div>
      <div class="bar mb-3"><div style="width:${pctAll}%"></div></div>
      <div class="grid grid-cols-4 gap-2 text-center">
        <div class="stat-cell"><div class="stat-num">${ov.attempted}</div><div class="stat-label">已答题</div></div>
        <div class="stat-cell"><div class="stat-num text-emerald-500">${ov.accuracy.toFixed(0)}%</div><div class="stat-label">正确率</div></div>
        <div class="stat-cell"><div class="stat-num text-red-500">${ov.wrongCount}</div><div class="stat-label">错题</div></div>
        <div class="stat-cell"><div class="stat-num text-purple-500">${ov.masteredCount}</div><div class="stat-label">已掌握</div></div>
      </div>
    </section>

    <section class="card">
      <div class="font-semibold mb-3">三大分区</div>
      <div class="space-y-2">
        ${MODULES.map(m => {
          const st = getModuleStat(m.code);
          const pct = st.total ? Math.round(st.mastery / st.total * 100) : 0;
          return `
          <button class="w-full text-left p-3 rounded-lg bg-slate-50 dark:bg-slate-700/50 mod-card ${m.code}" data-action="module" data-mod="${m.code}">
            <div class="flex items-center justify-between mb-1">
              <span class="tag ${MOD_CLS[m.code]}">${m.code} 区</span>
              <span class="text-xs text-slate-500">${m.topics.length} 个章节 · ${st.total} 题</span>
            </div>
            <div class="text-sm font-semibold">${escHtml(m.title)}</div>
            <div class="text-[11px] text-slate-500 mb-1.5">${escHtml(m.desc)}</div>
            <div class="bar"><div style="width:${pct}%"></div></div>
          </button>`;
        }).join('')}
      </div>
    </section>

    ${weak.length > 0 ? `
    <section class="card">
      <div class="font-semibold mb-2">薄弱章节 TOP 3</div>
      <div class="space-y-2">
        ${weak.map(w => `
          <div class="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-700/50">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate">${escHtml(w.title)}</div>
              <div class="text-xs text-slate-500">已做 ${w.tries} 题 · 正确率 ${w.accuracy.toFixed(0)}%</div>
            </div>
            <button class="btn btn-outline text-xs" data-action="topic" data-key="${w.key}">练习</button>
          </div>`).join('')}
      </div>
    </section>` : ''}

    <section class="card">
      <div class="font-semibold mb-3">快速开始</div>
      <div class="space-y-2 text-sm">
        <button class="w-full text-left p-3 rounded-lg bg-slate-50 dark:bg-slate-700/50 flex justify-between" data-action="random20">
          <span>🎲 随机练习 20 题</span><span class="text-slate-400">→</span>
        </button>
        <button class="w-full text-left p-3 rounded-lg bg-slate-50 dark:bg-slate-700/50 flex justify-between" data-action="exam">
          <span>📝 开始一次模拟测验</span><span class="text-slate-400">→</span>
        </button>
        <button class="w-full text-left p-3 rounded-lg bg-slate-50 dark:bg-slate-700/50 flex justify-between" data-action="wrong">
          <span>❌ 复习错题 <span class="text-slate-500">(${ov.wrongCount})</span></span><span class="text-slate-400">→</span>
        </button>
      </div>
    </section>
  `;
}

// -------- 刷题（章节列表） --------
function renderLearn() {
  const tabs = [{ k: 'all', t: '全部' }].concat(MODULES.map(m => ({ k: m.code, t: m.code + ' 区' })));
  const list = learnScope === 'all' ? TOPICS : TOPICS.filter(t => t.code === learnScope);
  return `
    <div class="flex gap-2 mb-3">
      ${tabs.map(tb => `<button class="btn ${learnScope===tb.k?'btn-primary':'btn-outline'} text-xs flex-1" data-action="scope" data-scope="${tb.k}">${tb.t}</button>`).join('')}
    </div>

    <div class="card">
      <div class="text-xs text-slate-500 dark:text-slate-400 mb-2">题型</div>
      <div class="flex gap-2">
        ${[['mixed','混合'],['single','单选'],['multi','多选']].map(([k,t]) => `<button class="btn ${practiceType===k?'btn-primary':'btn-outline'} text-xs flex-1" data-action="ptype" data-ptype="${k}">${t}</button>`).join('')}
      </div>
      <div class="text-[11px] text-slate-500 mt-2">当前题库：单选 ${ALL_Q.filter(q=>q.qtype==='single').length} 题 · 多选 ${ALL_Q.filter(q=>q.qtype==='multi').length} 题</div>
    </div>

    <div class="grid grid-cols-1 gap-3">
      ${list.map(t => {
        const st = getTopicStat(t.key);
        const pct = st.total ? Math.round(st.mastery / st.total * 100) : 0;
        return `
        <div class="card !mb-0 cursor-pointer hover:shadow-md transition" data-action="topic" data-key="${t.key}">
          <div class="flex items-center justify-between mb-1">
            <span class="tag ${MOD_CLS[t.code]}">${t.code} 区 · ${t.no}</span>
            <span class="text-xs text-slate-500">${t.count} 题</span>
          </div>
          <div class="text-sm font-semibold leading-snug mb-2">${escHtml(t.title)}</div>
          <div class="bar mb-1"><div style="width:${pct}%"></div></div>
          <div class="text-[11px] text-slate-500">已答 ${st.tried}/${st.total} · 掌握 ${pct}%</div>
        </div>`;
      }).join('')}
    </div>

    <button class="checkin-btn mt-3" data-action="start-all">开始综合练习（本范围随机 20 题）</button>
  `;
}

// -------- 测验 --------
function renderExam() {
  const last = state.examHistory.slice(-1)[0];
  const scopes = [{ k: 'all', t: '全部' }].concat(MODULES.map(m => ({ k: m.code, t: m.code + ' 区' }))).concat([{ k: 'weak', t: '仅薄弱章节' }]);
  return `
    <div class="card">
      <div class="font-semibold mb-3">📝 模拟测验</div>
      <div class="space-y-3 text-sm">
        <div>
          <div class="text-slate-500 mb-1">题量</div>
          <div class="grid grid-cols-4 gap-2">
            ${[20,30,50,80].map(n => `<label class="opt !p-3 text-center cursor-pointer"><input type="radio" name="size" value="${n}" ${n===state.settings.examSize?'checked':''} class="mr-1">${n}</label>`).join('')}
          </div>
        </div>
        <div>
          <div class="text-slate-500 mb-1">时长（分钟）</div>
          <div class="grid grid-cols-4 gap-2">
            ${[15,25,45,60].map(n => `<label class="opt !p-3 text-center cursor-pointer"><input type="radio" name="time" value="${n}" ${n===state.settings.examTime?'checked':''} class="mr-1">${n}</label>`).join('')}
          </div>
        </div>
        <div>
          <div class="text-slate-500 mb-1">范围</div>
          <div class="grid grid-cols-3 gap-2">
            ${scopes.map(s => `<label class="opt !p-3 text-center cursor-pointer"><input type="radio" name="scope" value="${s.k}" ${s.k===state.settings.examScope?'checked':''} class="mr-1">${s.t}</label>`).join('')}
          </div>
        </div>
        <div>
          <div class="text-slate-500 mb-1">题型</div>
          <div class="grid grid-cols-3 gap-2">
            ${[['mixed','混合'],['single','单选'],['multi','多选']].map(([k,t]) => `<label class="opt !p-3 text-center cursor-pointer"><input type="radio" name="etype" value="${k}" ${k===state.settings.examType?'checked':''} class="mr-1">${t}</label>`).join('')}
          </div>
        </div>
      </div>
      <button class="checkin-btn mt-4" data-action="exam-start">开始测验</button>
    </div>

    ${last ? `
    <div class="card">
      <div class="text-xs text-slate-500 mb-1">上次测验</div>
      <div class="text-lg font-bold">${last.score}/${last.total} <span class="text-sm text-slate-500">${(last.score/last.total*100).toFixed(0)}%</span></div>
      <div class="text-xs text-slate-500">${last.date} · 用时 ${fmtMin(last.minutes)}</div>
    </div>` : ''}

    <div class="card">
      <div class="text-xs text-slate-500 mb-2">说明</div>
      <ul class="text-xs text-slate-600 dark:text-slate-300 space-y-1 leading-relaxed">
        <li>· 测验过程中不立即显示答案，交卷后统一评分。</li>
        <li>· 答错的题目自动进入错题本。</li>
        <li>· 多选题需全部选对才计分。</li>
      </ul>
    </div>
  `;
}

// -------- 错题 --------
function renderWrong() {
  if (state.wrong.length === 0) {
    return `<div class="card text-center py-12">
      <div class="text-5xl mb-2">🎉</div>
      <div class="font-semibold mb-1">暂无错题</div>
      <div class="text-sm text-slate-500 mb-4">答错的题会自动收集在这里</div>
      <button class="btn btn-primary" data-action="random20">开始随机练习</button>
    </div>`;
  }
  const wrongQs = state.wrong.map(findQ).filter(Boolean);
  const byMod = {};
  wrongQs.forEach(q => { byMod[q.module] = (byMod[q.module] || 0) + 1; });
  return `
    <div class="flex items-center justify-between mb-3">
      <div class="font-semibold">共 ${wrongQs.length} 道错题</div>
      <div class="flex gap-2">
        <button class="btn btn-outline text-xs" data-action="wrong-clear">清空</button>
        <button class="btn btn-primary text-xs" data-action="wrong-practice">开始复习</button>
      </div>
    </div>
    <div class="card text-xs text-slate-500">
      分布：${MODULES.map(m => `${m.code} 区 ${byMod[m.code] || 0} 题`).join(' · ')}
    </div>
    <div class="card">
      ${wrongQs.slice(0, 120).map(q => {
        const a = state.attempts[q.id] || {};
        return `
          <div class="qrow">
            <div class="flex-1 min-w-0">
              <div class="text-xs text-slate-500 mb-0.5">${q.module} 区 · ${escHtml(q.topic)} · ${q.qtype==='single'?'单选':'多选'}</div>
              <div class="text-sm truncate">${escHtml(q.q)}</div>
            </div>
            <div class="text-xs text-red-500">${a.tries ? Math.round(a.correct/a.tries*100)+'%' : '-'}</div>
          </div>`;
      }).join('')}
      ${wrongQs.length > 120 ? `<div class="text-xs text-slate-500 text-center pt-2">仅显示前 120 题，复习将随机抽题</div>` : ''}
    </div>
  `;
}

// -------- 我的 --------
let charts = [];
function renderMe() {
  charts.forEach(c => c.destroy()); charts = [];
  setTimeout(drawDailyChart, 30);
  const ov = getOverall();
  const days = Object.keys(state.dailyStat).length;
  return `
    <div class="card">
      <div class="font-semibold mb-3">学习统计</div>
      <div class="grid grid-cols-2 gap-3">
        <div class="stat-cell !p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg"><div class="stat-num text-brand-500">${ov.totalCorrect}</div><div class="stat-label">累计答对</div></div>
        <div class="stat-cell !p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg"><div class="stat-num">${ov.totalTries}</div><div class="stat-label">累计作答</div></div>
        <div class="stat-cell !p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg"><div class="stat-num text-emerald-500">${ov.accuracy.toFixed(1)}%</div><div class="stat-label">总正确率</div></div>
        <div class="stat-cell !p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg"><div class="stat-num text-amber-500">${state.theta.toFixed(2)}</div><div class="stat-label">能力估计θ</div></div>
        <div class="stat-cell !p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg"><div class="stat-num text-purple-500">${ov.masteredCount}</div><div class="stat-label">已掌握</div></div>
        <div class="stat-cell !p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg"><div class="stat-num text-pink-500">${days}</div><div class="stat-label">学习天数</div></div>
      </div>
    </div>

    <div class="card">
      <div class="font-semibold mb-2">各章节掌握度</div>
      ${masteryListHtml()}
    </div>

    <div class="card">
      <div class="font-semibold mb-2">近 14 天学习量</div>
      <div class="relative" style="height:180px"><canvas id="chart-daily"></canvas></div>
    </div>

    <div class="card">
      <div class="font-semibold mb-2">数据管理</div>
      <div class="grid grid-cols-2 gap-2">
        <button class="btn btn-outline" data-action="export">📤 导出进度</button>
        <button class="btn btn-outline" data-action="import">📥 导入进度</button>
        <button class="btn btn-outline" data-action="set-goal">🎯 每日目标</button>
        <button class="btn btn-outline text-red-500" data-action="reset">🗑 重置数据</button>
      </div>
    </div>

    <div class="card text-center text-xs text-slate-500">
      健康保险实务 · 刷题训练 v1.0<br>
      共 ${ALL_Q.length} 题 · 单选 ${ALL_Q.filter(q=>q.qtype==='single').length} · 多选 ${ALL_Q.filter(q=>q.qtype==='multi').length}<br>
      题源：13 份监管文件 · 《健康保险经营与管理》 · 《健康保险学》
    </div>
  `;
}
function masteryListHtml() {
  return MODULES.map(m => {
    const rows = TOPICS.filter(t => t.code === m.code).map(t => {
      const s = getTopicStat(t.key);
      const acc = Math.round(s.accuracy);
      const barColor = !s.tries ? 'bg-slate-300 dark:bg-slate-600'
        : acc < 60 ? 'bg-red-500' : acc < 80 ? 'bg-amber-500' : 'bg-emerald-500';
      const right = s.tries
        ? `<span class="text-slate-500 dark:text-slate-400">正确率 ${acc}% · 掌握 ${s.mastery}/${s.total}</span>`
        : `<span class="text-slate-400 dark:text-slate-500">未作答 · ${s.total} 题</span>`;
      return `
        <div class="py-1.5">
          <div class="flex items-center justify-between gap-2 text-xs mb-1">
            <div class="truncate text-slate-600 dark:text-slate-300" title="${escHtml(t.title)}">${escHtml(t.title)}</div>
            <div class="flex-shrink-0 whitespace-nowrap">${right}</div>
          </div>
          <div class="h-1.5 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div class="h-full ${barColor} rounded-full transition-all" style="width:${s.tries ? acc : 0}%"></div>
          </div>
        </div>`;
    }).join('');
    return `<div class="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-2 mb-0.5">${m.code} 区 · ${escHtml(m.title)}</div>${rows}`;
  }).join('');
}
function drawDailyChart() {
  const el = $('#chart-daily'); if (!el || typeof Chart === 'undefined') return;
  const days = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    days.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
  }
  const data = days.map(d => state.dailyStat[d] || { questions: 0, correct: 0 });
  const ctx = el.getContext('2d');
  const dark = document.documentElement.classList.contains('dark');
  const fg = dark ? '#cbd5e1' : '#475569';
  const grid = dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.08)';
  charts.push(new Chart(ctx, {
    type: 'bar',
    data: { labels: days.map(d => d.slice(5)), datasets: [
      { label: '答题数', data: data.map(d => d.questions), backgroundColor: '#0e6f64' },
      { label: '答对', data: data.map(d => d.correct), backgroundColor: '#16a34a' }
    ] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: fg } } },
      scales: { x: { ticks: { color: fg } }, y: { beginAtZero: true, ticks: { color: fg }, grid: { color: grid } } } }
  }));
}

// -------- 渲染 --------
function render() {
  const main = $('#main');
  if (currentPage === 'home') main.innerHTML = renderHome();
  else if (currentPage === 'learn') main.innerHTML = renderLearn();
  else if (currentPage === 'exam') main.innerHTML = renderExam();
  else if (currentPage === 'wrong') main.innerHTML = renderWrong();
  else main.innerHTML = renderMe();
  bindActions();
  main.scrollTop = 0;
}

function bindActions() {
  $$('[data-action]').forEach(b => {
    b.addEventListener('click', () => {
      const a = b.dataset.action;
      if (a === 'scope') { learnScope = b.dataset.scope; render(); }
      else if (a === 'ptype') { practiceType = b.dataset.ptype; render(); }
      else if (a === 'module') { learnScope = b.dataset.mod; go('learn'); }
      else if (a === 'topic') startPractice({ topicKey: b.dataset.key });
      else if (a === 'start-all') {
        const pool = filterByType(learnScope === 'all' ? ALL_Q : qByModule(learnScope), practiceType);
        if (!pool.length) return toast('该范围没有符合条件的题目');
        newSession(pickAdaptive(Math.min(20, pool.length), pool), { title: '综合练习', mode: 'practice', adaptive: false });
      }
      else if (a === 'exam') go('exam');
      else if (a === 'exam-start') startExam();
      else if (a === 'random20') {
        const pool = filterByType(ALL_Q, practiceType);
        newSession(pickRandom(20, pool), { title: '随机练习', mode: 'practice' });
      }
      else if (a === 'quick10') {
        const pool = filterByType(ALL_Q, practiceType);
        newSession(pickAdaptive(10, pool), { title: '每日10题', mode: 'practice', adaptive: true });
      }
      else if (a === 'quick-wrong') { go('wrong'); }
      else if (a === 'wrong') go('wrong');
      else if (a === 'wrong-practice') startWrongPractice();
      else if (a === 'wrong-clear') { if (confirm('清空所有错题？')) { state.wrong = []; saveState(); render(); toast('已清空'); } }
      else if (a === 'export') exportData();
      else if (a === 'import') importData();
      else if (a === 'set-goal') setGoal();
      else if (a === 'reset') { if (confirm('重置全部数据？此操作不可恢复！')) { state = JSON.parse(JSON.stringify(DEFAULT_STATE)); saveState(); applyDark(); render(); toast('已重置'); } }
    });
  });
  const cb = $('#btn-checkin');
  if (cb && !cb.disabled) cb.addEventListener('click', () => { doCheckin(); render(); toast('打卡成功！开始今日学习吧'); });
}

// -------- 答题引擎 --------
let session = null;
function newSession(questions, opts = {}) {
  if (!questions || !questions.length) return toast('暂无可用题目');
  session = {
    questions, idx: 0, results: [],
    startTime: Date.now(),
    timeLimit: opts.timeLimit || 0,
    timerHandle: null,
    title: opts.title || '练习',
    showFeedbackImmediately: opts.showFeedback !== false,
    mode: opts.mode || 'normal',
    adaptive: !!opts.adaptive
  };
  $('#quiz-modal').classList.remove('hidden');
  $('#quiz-timer').classList.remove('text-red-500');
  if (session.timeLimit > 0) startTimer(); else $('#quiz-timer').textContent = '--:--';
  showQ();
}
function startTimer() {
  let left = session.timeLimit * 60;
  const update = () => {
    const m = Math.floor(left / 60), s = left % 60;
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
  $('#quiz-rule-tag').textContent = `${q.module} 区 · ${q.topic} · ${q.qtype==='single'?'单选':'多选'} · 难度 ${'★'.repeat(q.difficulty)}`;
  $('#quiz-question').textContent = q.q;
  const wrap = $('#quiz-options'); wrap.innerHTML = '';
  $('#quiz-feedback').classList.add('hidden');
  $('#quiz-next').classList.add('hidden');
  $('#quiz-submit').classList.toggle('hidden', session.showFeedbackImmediately && q.qtype !== 'multi');
  q.options.forEach((opt, i) => {
    const letter = String.fromCharCode(65 + i);
    const btn = document.createElement('button');
    btn.className = 'opt';
    btn.dataset.letter = letter;
    btn.innerHTML = `<span class="font-semibold mr-1">${letter}.</span>${escHtml(opt)}`;
    btn.addEventListener('click', () => onPick(letter, btn));
    wrap.appendChild(btn);
  });
  session._picked = [];
  session._submitted = false;
}
function onPick(letter, btn) {
  if (session._submitted) return;
  const q = session.questions[session.idx];
  if (q.qtype === 'single') {
    session._picked = [letter];
    $$('.opt', $('#quiz-options')).forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    if (session.showFeedbackImmediately) judgeSingle();
  } else {
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
  const correct = session._picked[0] === q.answer;
  showFeedback(correct);
  recordAndMark(correct, q, session._picked);
}
function showFeedback(correct) {
  const q = session.questions[session.idx];
  const ans = Array.isArray(q.answer) ? q.answer.slice().sort().join('') : q.answer;
  const picked = (session._picked || []).slice().sort().join('') || '(未选)';
  $$('.opt', $('#quiz-options')).forEach(b => {
    const L = b.dataset.letter;
    if (Array.isArray(q.answer) ? q.answer.includes(L) : q.answer === L) b.classList.add('correct');
    else if (session._picked.includes(L)) b.classList.add('wrong');
  });
  const fb = $('#quiz-feedback');
  fb.classList.remove('hidden');
  fb.innerHTML = `<div class="font-semibold mb-1 ${correct?'text-emerald-600':'text-red-500'}">${correct?'✓ 回答正确':'✗ 回答错误'} · 你的答案：${picked} · 正确答案：${ans}</div><div class="text-slate-600 dark:text-slate-300">${escHtml(q.explanation || '')}</div>`;
  setTimeout(() => fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  $('#quiz-next').classList.remove('hidden');
  $('#quiz-submit').classList.add('hidden');
}
function recordAndMark(correct, q, picked) {
  if (session._submitted) return;
  session._submitted = true;
  recordAttempt(q.id, correct);
  if (session.adaptive) { state.theta = Math.max(0.3, Math.min(3.0, state.theta + (correct ? 0.15 : -0.15))); saveState(); }
  session.results.push({ qid: q.id, correct, picked, correctAns: q.answer });
}
function nextQ() {
  if (session.idx + 1 >= session.questions.length) finishSession(false);
  else { session.idx += 1; showQ(); }
}
function finishSession(timeout) {
  if (!session) return;
  if (session.timerHandle) clearTimeout(session.timerHandle);
  const total = session.questions.length;
  const answered = session.results.length;
  const correct = session.results.filter(r => r.correct).length;
  const wrongList = session.results.filter(r => !r.correct);
  const elapsed = Math.max(1, Math.round((Date.now() - session.startTime) / 60000));
  const t = todayStr();
  if (!state.dailyStat[t]) state.dailyStat[t] = { questions: 0, correct: 0, minutes: 0 };
  state.dailyStat[t].minutes += elapsed;
  if (session.mode === 'exam') {
    state.examHistory.push({ date: t, score: correct, total: answered || total, minutes: elapsed });
    if (state.examHistory.length > 30) state.examHistory = state.examHistory.slice(-30);
  }
  saveState();
  $('#quiz-modal').classList.add('hidden');
  const base = answered || total;
  const pct = base ? Math.round(correct / base * 100) : 0;
  let emoji = '🎉', title = '完成！';
  if (pct < 60) { emoji = '😢'; title = '继续加油'; }
  else if (pct < 80) { emoji = '💪'; title = '继续努力'; }
  else if (pct < 95) { emoji = '👏'; title = '表现优秀'; }
  else { emoji = '🏆'; title = '完美！'; }
  $('#result-emoji').textContent = emoji;
  $('#result-title').textContent = (timeout ? '⏰ 时间到 · ' : '') + title;
  $('#result-stats').innerHTML = `
    <div class="bg-slate-50 dark:bg-slate-700/50 rounded-lg"><div class="stat-num text-brand-500">${correct}/${base}</div><div class="stat-label">答对</div></div>
    <div class="bg-slate-50 dark:bg-slate-700/50 rounded-lg"><div class="stat-num">${pct}%</div><div class="stat-label">正确率</div></div>
    <div class="bg-slate-50 dark:bg-slate-700/50 rounded-lg"><div class="stat-num">${fmtMin(elapsed)}</div><div class="stat-label">用时</div></div>
    <div class="bg-slate-50 dark:bg-slate-700/50 rounded-lg"><div class="stat-num">${wrongList.length}</div><div class="stat-label">错题</div></div>
  `;
  $('#result-detail').innerHTML = wrongList.length > 0
    ? `<div class="mb-1 font-semibold text-slate-700 dark:text-slate-200">错题已自动加入错题集：</div>` +
      wrongList.slice(0, 8).map(r => {
        const q = findQ(r.qid); if (!q) return '';
        return `<div class="text-xs">· [${q.module}] ${escHtml(q.q.slice(0, 26))}${q.q.length > 26 ? '…' : ''}（答 ${r.picked.join('') || '—'} / 正 ${Array.isArray(r.correctAns) ? r.correctAns.join('') : r.correctAns}）</div>`;
      }).join('') + (wrongList.length > 8 ? `<div class="text-xs text-slate-500 mt-1">… 共 ${wrongList.length} 题</div>` : '')
    : '<div class="text-emerald-500">全部答对！太棒了</div>';
  $('#result-close').onclick = () => $('#result-modal').classList.add('hidden');
  $('#result-review').onclick = () => { $('#result-modal').classList.add('hidden'); go('wrong'); };
  $('#result-modal').classList.remove('hidden');
  session = null;
  if (!isCheckedToday() && base >= 5) doCheckin();
}

// -------- 启动练习/测验 --------
function startPractice({ topicKey }) {
  const t = TOPICS.find(x => x.key === topicKey);
  if (!t) return;
  let pool = filterByType(qByTopic(topicKey), practiceType);
  if (!pool.length) return toast('该章节没有符合条件的题目');
  newSession(pickAdaptive(Math.min(pool.length, 25), pool), { title: t.title, mode: 'practice', adaptive: true });
}
function startWrongPractice() {
  const qs = state.wrong.map(findQ).filter(Boolean);
  if (!qs.length) return toast('暂无错题');
  newSession(shuffle(qs), { title: '错题复习', mode: 'practice', adaptive: false });
}
function startExam() {
  const size = parseInt((($('input[name="size"]:checked') || {}).value) || state.settings.examSize);
  const time = parseInt((($('input[name="time"]:checked') || {}).value) || state.settings.examTime);
  const scope = (($('input[name="scope"]:checked') || {}).value) || 'all';
  const etype = (($('input[name="etype"]:checked') || {}).value) || 'mixed';
  let pool = ALL_Q;
  if (scope === 'weak') {
    const keys = new Set(getWeakTopicsForExam(6).map(t => t.key));
    pool = ALL_Q.filter(q => keys.has(tkey(q)));
    if (!pool.length) { toast('薄弱章节样本不足，已改为全部范围'); pool = ALL_Q; }
  } else if (scope !== 'all') {
    pool = qByModule(scope);
  }
  pool = filterByType(pool, etype);
  if (!pool.length) return toast('该范围没有符合条件的题目');
  const qs = pickRandom(Math.min(size, pool.length), pool);
  state.settings.examSize = size; state.settings.examTime = time;
  state.settings.examScope = scope; state.settings.examType = etype;
  saveState();
  newSession(qs, { title: '模拟测验', mode: 'exam', timeLimit: time, showFeedback: false });
}

// -------- 答题事件 --------
$('#quiz-submit').addEventListener('click', () => {
  if (!session) return;
  const q = session.questions[session.idx];
  if (session._picked.length === 0) return toast('请先选择');
  const ans = Array.isArray(q.answer) ? q.answer.slice().sort().join('') : q.answer;
  const picked = session._picked.slice().sort().join('');
  const correct = ans === picked;
  showFeedback(correct);
  recordAndMark(correct, q, session._picked);
});
$('#quiz-next').addEventListener('click', () => { if (session) nextQ(); });
$('#quiz-close').addEventListener('click', () => {
  if (!session) return;
  if (!confirm('确认退出本次练习？当前进度不会保存。')) return;
  if (session.timerHandle) clearTimeout(session.timerHandle);
  $('#quiz-modal').classList.add('hidden');
  session = null;
  render();
});

// -------- 设置 --------
function setGoal() {
  const v = prompt('每日答题目标（题）：', state.settings.dailyGoal);
  const n = parseInt(v);
  if (n && n > 0 && n <= 200) { state.settings.dailyGoal = n; saveState(); render(); toast('已设定每日 ' + n + ' 题'); }
}
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `健康保险实务刷题进度-${todayStr()}.json`;
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
        state.settings = Object.assign({}, DEFAULT_STATE.settings, obj.settings || {});
        saveState(); applyDark(); render(); toast('已导入');
      } catch (e) { toast('文件格式错误'); }
    };
    r.readAsText(f);
  };
  inp.click();
}

// -------- 深色模式 --------
function applyDark() {
  document.documentElement.classList.toggle('dark', !!state.settings.darkMode);
  const ic = $('#icon-dark'); if (ic) ic.textContent = state.settings.darkMode ? '☀️' : '🌙';
}
$('#btn-dark').addEventListener('click', () => {
  state.settings.darkMode = !state.settings.darkMode;
  saveState(); applyDark(); render();
});

// -------- Toast --------
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 1800);
}

// -------- 启动 --------
applyDark();
go('home');
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

})();
