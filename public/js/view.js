// js/view.js — public, no login. Fetches straight from /api/content (which
// is intentionally unauthenticated — see api/content.js) and renders it the
// same way the real learner app would, so this doubles as a quick way to
// sanity-check what's actually live after saving in the admin panel.
let viewState = { subjects: [], activeCode: null, activeData: null, activeChapter: null };

document.addEventListener('DOMContentLoaded', loadSubjects);

async function loadSubjects() {
  const res = await fetch('/api/content').then(r => r.json()).catch(() => ({}));
  viewState.subjects = res.subjects || [];
  const wrap = document.getElementById('view-subjects');
  if (!viewState.subjects.length) {
    wrap.innerHTML = '<div class="empty-table"><div class="big">📭</div><p style="font-size:12px">No subjects published yet</p></div>';
    return;
  }
  wrap.innerHTML = '';
  viewState.subjects.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'view-subj-btn';
    btn.textContent = `${s.subject} (${s.code})`;
    btn.onclick = () => selectSubject(s.code, s.color);
    wrap.appendChild(btn);
  });
  selectSubject(viewState.subjects[0].code, viewState.subjects[0].color);
}

async function selectSubject(code, color) {
  viewState.activeCode = code;
  viewState.activeChapter = null;
  document.querySelectorAll('.view-subj-btn').forEach(b => {
    const isActive = b.textContent.includes(`(${code})`);
    b.classList.toggle('active', isActive);
    b.style.background = isActive ? (color || '#6C3FF5') : '';
  });

  document.getElementById('view-nav').innerHTML = '<div class="editor-empty"><div class="big">⏳</div><p style="font-size:12px">Loading…</p></div>';
  document.getElementById('view-content').innerHTML = '<div class="editor-empty"><div class="big">👆</div><p style="font-size:12px">Pick a chapter</p></div>';

  const row = await fetch(`/api/content?code=${encodeURIComponent(code)}`).then(r => r.json()).catch(() => null);
  viewState.activeData = row && row.data ? row.data : { units: [] };
  renderNav();
}

function renderNav() {
  const wrap = document.getElementById('view-nav');
  const units = viewState.activeData.units || [];
  if (!units.length) {
    wrap.innerHTML = '<div class="editor-empty"><div class="big">📭</div><p style="font-size:12px">No content in this subject yet</p></div>';
    return;
  }
  let html = '';
  units.forEach(unit => {
    html += `<div class="view-unit-title">${esc(unit.title)}</div>`;
    (unit.chapters || []).forEach(ch => {
      const isActive = viewState.activeChapter && viewState.activeChapter.id === ch.id;
      const qCount = (ch.questions || []).length;
      html += `<button class="view-chap-btn${isActive ? ' active' : ''}" onclick="openChapterById('${unit.id}','${ch.id}')">
        <span>${esc(ch.title)}</span>${qCount ? `<span class="view-chap-qcount">${qCount}</span>` : ''}
      </button>`;
    });
  });
  wrap.innerHTML = html;
}

function openChapterById(unitId, chapterId) {
  const unit = (viewState.activeData.units || []).find(u => u.id === unitId);
  const chapter = unit && (unit.chapters || []).find(c => c.id === chapterId);
  if (!chapter) return;
  viewState.activeChapter = chapter;
  renderNav();
  renderChapter(chapter);
}

// ── Rendering (same shapes as the admin builder writes) ──
function normalizeConceptView(concept, fallbackTitle) {
  concept = concept || {};
  const out = { title: concept.title || fallbackTitle || '', latex: concept.latex !== false, body: [] };
  (Array.isArray(concept.body) ? concept.body : []).forEach(b => {
    if (typeof b === 'string') out.body.push({ type: 'paragraph', text: b });
    else if (b && b.type) out.body.push(b);
  });
  (concept.formulas || []).forEach(f => { if (typeof f === 'string' && f.trim()) out.body.push({ type: 'formula', text: f }); });
  return out;
}

function extractYouTubeId(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}
function parseTimeToSeconds(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return Math.max(0, Math.floor(val));
  const parts = String(val).split(':').map(p => parseInt(p, 10) || 0);
  let secs = 0; parts.forEach(p => { secs = secs * 60 + p; });
  return Math.max(0, secs);
}

function bodyItemHtml(item) {
  switch (item.type) {
    case 'heading': return `<div class="pv-h">${esc(item.text || '')}</div>`;
    case 'paragraph': return `<div class="pv-p">${esc(item.text || '')}</div>`;
    case 'note': return `<div class="pv-note">💡 ${esc(item.text || '')}</div>`;
    case 'formula': return `<div class="pv-formula">${esc(item.text || '')}</div>`;
    case 'syntax': return `<div class="pv-syntax">${esc(item.code || '')}</div>`;
    case 'list': return `<ul class="pv-list">${(item.items || []).map(li => `<li>${esc(li)}</li>`).join('')}</ul>`;
    case 'table': {
      const headers = item.headers || [], rows = item.rows || [];
      let h = `<div class="pv-table-wrap"><table class="pv-table"><tr>${headers.map(x => `<th>${esc(x)}</th>`).join('')}</tr>`;
      rows.forEach(r => { h += `<tr>${headers.map((_, ci) => `<td>${esc(r[ci] || '')}</td>`).join('')}</tr>`; });
      return h + '</table></div>';
    }
    case 'image': {
      let h = '';
      if (item.image) h += `<div class="pv-img-wrap"><img src="${escAttr(item.image)}" alt="${escAttr(item.title || '')}" onerror="this.parentElement.innerHTML='⚠️ Image failed to load'">${item.title ? `<div class="pv-img-title">${esc(item.title)}</div>` : ''}</div>`;
      if (item.pdf) h += `<a class="pv-pdf-link" href="${escAttr(item.pdf)}" target="_blank">📄 ${esc(item.title || 'View PDF')}</a>`;
      return h || '';
    }
    case 'video': {
      const id = extractYouTubeId(item.url);
      if (!id) return item.url ? `<a class="pv-pdf-link" href="${escAttr(item.url)}" target="_blank">▶ ${esc(item.title || 'Watch video')}</a>` : '';
      const start = parseTimeToSeconds(item.start);
      const src = `https://www.youtube.com/embed/${id}?rel=0${start ? `&start=${start}` : ''}`;
      return `${item.title ? `<div class="pv-img-title" style="text-align:left;margin-bottom:8px;font-weight:700;color:#374151">${esc(item.title)}</div>` : ''}<div class="pv-video-wrap"><iframe src="${src}" allowfullscreen></iframe></div>`;
    }
    case 'exercise': {
      let h = item.image ? `<div class="pv-img-wrap"><img src="${escAttr(item.image)}" onerror="this.parentElement.style.display='none'"></div>` : '';
      return h + `<div class="pv-exercise"><div class="pv-exercise-head"><span class="pv-exercise-badge">✏️ Practice</span>${item.title ? `<span class="pv-exercise-title">${esc(item.title)}</span>` : ''}</div>
        <ol>${(item.steps || []).map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>`;
    }
    case 'steps': {
      let h = item.image ? `<div class="pv-img-wrap"><img src="${escAttr(item.image)}" onerror="this.parentElement.style.display='none'"></div>` : '';
      return h + `<div class="pv-steps">${item.title ? `<div class="pv-steps-title">${esc(item.title)}</div>` : ''}
        <ol>${(item.steps || []).map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>`;
    }
    default: return '';
  }
}

function playgroundHtml(pg) {
  if (!pg || (!pg.schema && !(pg.sampleQueries || []).length)) return '';
  let h = '<div class="pv-playground"><div class="pv-playground-title">🛢️ SQL Playground</div>';
  if (pg.schema) h += `<div class="pv-syntax">${esc(pg.schema)}</div>`;
  (pg.sampleQueries || []).filter(Boolean).forEach(q => {
    h += `<div class="pv-pg-query" title="Click to copy" onclick="copyQuery(this)">${esc(q)}</div>`;
  });
  h += '</div>';
  return h;
}
function copyQuery(el) {
  navigator.clipboard.writeText(el.textContent).then(() => {
    const orig = el.textContent;
    el.textContent = '✓ Copied';
    setTimeout(() => { el.textContent = orig; }, 900);
  }).catch(() => {});
}

function questionHtml(q, qi) {
  let h = `<div class="pv-q" data-qid="${escAttr(q.id || qi)}"><div class="pv-q-num">Q${qi + 1} · ${q.type}</div>`;
  if (q.image) h += `<div class="pv-q-img"><img src="${escAttr(q.image)}" onerror="this.parentElement.style.display='none'"></div>`;
  h += `<div class="pv-p" style="margin-bottom:10px">${esc(q.question || '')}</div>`;

  if (q.type === 'NAT') {
    h += `<div class="pv-nat-input"><input type="number" step="any" placeholder="Your answer" id="nat-${qi}">
      <button class="b-btn b-btn-outline b-btn-sm pv-reveal-btn" onclick="checkNat(${qi}, ${q.answer ?? 0}, ${q.tolerance ?? 0})">Check</button></div>
      <div class="pv-explain" id="explain-${qi}">💡 ${esc(q.explanation || '')}</div>`;
  } else {
    (q.options || []).forEach((opt, oi) => {
      const optImg = (q.optionImages || [])[oi];
      h += `<div class="pv-opt" onclick="revealOption(this, ${qi}, ${oi}, ${JSON.stringify(q.answer || [])})">${optImg ? `<img src="${escAttr(optImg)}">` : ''}<span>${String.fromCharCode(65 + oi)}. ${esc(opt)}</span></div>`;
    });
    h += `<div class="pv-explain" id="explain-${qi}">💡 ${esc(q.explanation || '')}</div>`;
  }
  return h + '</div>';
}
function revealOption(el, qi, oi, correctIndices) {
  const card = el.closest('.pv-q');
  card.querySelectorAll('.pv-opt').forEach((o, i) => {
    o.classList.remove('revealed-correct', 'revealed-wrong');
    if (correctIndices.includes(i)) o.classList.add('revealed-correct');
    else if (i === oi) o.classList.add('revealed-wrong');
  });
  document.getElementById(`explain-${qi}`).classList.add('open');
}
function checkNat(qi, answer, tolerance) {
  const val = parseFloat(document.getElementById(`nat-${qi}`).value);
  const input = document.getElementById(`nat-${qi}`);
  if (!isNaN(val) && Math.abs(val - answer) <= (tolerance || 0)) input.style.borderColor = '#16a34a';
  else input.style.borderColor = '#dc2626';
  document.getElementById(`explain-${qi}`).classList.add('open');
}

function renderChapter(chapter) {
  const concept = normalizeConceptView(chapter.concept, chapter.title);
  const wrap = document.getElementById('view-content');
  let html = `<div class="pv-title">${esc(concept.title)}</div>`;
  (concept.body || []).forEach(item => { html += bodyItemHtml(item); });
  html += playgroundHtml(chapter.playground);

  const questions = chapter.questions || [];
  if (questions.length) {
    html += `<div class="pv-h" style="margin-top:26px">Practice Questions (${questions.length})</div>`;
    questions.forEach((q, qi) => { html += questionHtml(q, qi); });
  }

  html += feedbackWidgetHtml();
  wrap.innerHTML = html;

  if (window.renderMathInElement) {
    try {
      renderMathInElement(wrap, {
        delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
        throwOnError: false,
      });
    } catch (e) {}
  }
  wrap.scrollTop = 0;
}

// ── Feedback widget ──
let selectedStars = 0;
function feedbackWidgetHtml() {
  return `
    <div class="view-feedback">
      <div class="view-feedback-title">Rate this subject: ${esc(viewState.activeCode || '')}</div>
      <div class="view-stars" id="fb-stars">
        ${[1, 2, 3, 4, 5].map(n => `<span class="view-star" data-n="${n}" onclick="setStars(${n})">★</span>`).join('')}
      </div>
      <textarea rows="2" id="fb-message" placeholder="Optional comment…"></textarea>
      <button class="b-btn b-btn-primary b-btn-sm" onclick="submitFeedback()">Submit Feedback</button>
      <span id="fb-status" style="margin-left:10px;font-size:11.5px;color:#9ca3af"></span>
    </div>`;
}
function setStars(n) {
  selectedStars = n;
  document.querySelectorAll('#fb-stars .view-star').forEach(s => {
    s.classList.toggle('filled', Number(s.dataset.n) <= n);
  });
}
async function submitFeedback() {
  const statusEl = document.getElementById('fb-status');
  if (!selectedStars) { statusEl.textContent = 'Pick a star rating first'; return; }
  statusEl.textContent = 'Sending…';
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'anonymous',
        subject: viewState.activeCode,
        rating: selectedStars,
        message: document.getElementById('fb-message').value,
      }),
    }).then(r => r.json());
    statusEl.textContent = res.success ? '✓ Thanks for your feedback!' : (res.error || 'Could not submit');
    if (res.success) { selectedStars = 0; document.getElementById('fb-message').value = ''; setStars(0); }
  } catch {
    statusEl.textContent = 'Network error — try again';
  }
}

function esc(s) { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escAttr(s) { return String(s ?? '').replace(/"/g, '&quot;'); }
