// js/builder.js — Admin Question Builder
//
// Supports: subject list scoped to the logged-in editor's mapped subjects;
// save disabled (with a reason) when the editor lacks can_edit; a SQL
// Playground section per chapter; a Key Formulas box per concept; optional
// Case Studies / shared passages per chapter; and five question types —
// MCQ, MSQ, NAT, Assertion-Reason (AR), and Match the Following (MATCH).
const QTYPE_COLORS = { MCQ: '#6C3FF5', MSQ: '#0891b2', NAT: '#d97706', AR: '#be123c', MATCH: '#7c3aed' };
const BTYPE_COLORS = {
  heading: '#4f46e5', paragraph: '#6b7280', note: '#7c3aed', formula: '#0891b2',
  list: '#d97706', table: '#059669', syntax: '#dc2626', image: '#db2777',
  exercise: '#f59e0b', steps: '#6C3FF5', video: '#dc2626', example: '#0ea5e9', summary: '#0d9488'
};

let builder = {
  session: null,
  subjects: [],
  activeCode: null,
  activeData: null,
  activeUnitId: null,
  activeChapterId: null,
  openQuestionId: null,
  openBodyIndex: null,
  dirty: false,
};

const BuilderModule = { init: initBuilder };

function uid(prefix) { return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; }
function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escAttr(s) { return String(s ?? '').replace(/"/g, '&quot;'); }
function setBuilderStatus(msg, type) {
  const el = document.getElementById('builder-status');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'builder-status' + (type ? ' ' + type : '');
}
function markDirty() { builder.dirty = true; setBuilderStatus('Unsaved changes', ''); }

async function initBuilder(session) {
  builder.session = session;
  setBuilderStatus('Loading subjects…');

  // /api/content's GET is intentionally public (the learner-facing app reads
  // it without logging in), so it isn't subject-scoped server-side — filter
  // to the editor's mapped subjects here instead. Admin/super_admin see all.
  const res = await Api.get('/api/content');
  const allowed = Auth.allowedCodes(session); // null = unrestricted
  builder.subjects = allowed ? (res.subjects || []).filter(s => allowed.includes(s.code)) : (res.subjects || []);
  renderSubjectPills();
  setBuilderStatus('');

  if (builder.subjects.length) await loadSubjectIntoBuilder(builder.subjects[0].code);
  else document.getElementById('builder-tree').innerHTML = '<div class="editor-empty"><div class="big">📭</div><p style="font-size:12px">No subjects assigned to you yet</p></div>';
}

// Each subject NAME can have several rows — one per topic — each with its
// own unique code (e.g. Accounts → AC0001 "Journal Entries", AC0002
// "Ledger Posting"). Pills show "Subject — Topic (CODE)" so multiple
// topics under the same subject name are easy to tell apart.
function renderSubjectPills() {
  const row = document.getElementById('builder-subject-pills');
  row.innerHTML = '';
  builder.subjects.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'subj-pill' + (s.code === builder.activeCode ? ' active' : '');
    btn.textContent = s.subject_title ? `${s.subject} — ${s.subject_title} (${s.code})` : `${s.subject} (${s.code})`;
    if (s.code === builder.activeCode) { btn.style.background = s.color; btn.style.borderColor = 'transparent'; }
    btn.onclick = () => loadSubjectIntoBuilder(s.code);
    row.appendChild(btn);
  });
}

async function loadSubjectIntoBuilder(code) {
  builder.activeCode = code;
  builder.activeUnitId = null;
  builder.activeChapterId = null;
  builder.openBodyIndex = null;
  renderSubjectPills();

  document.getElementById('builder-tree').innerHTML = '<div class="editor-empty"><div class="big">⏳</div><p style="font-size:12px">Loading…</p></div>';
  document.getElementById('builder-editor').innerHTML = '<div class="editor-empty"><div class="big">👈</div><p style="font-size:12px">Select a chapter to edit</p></div>';

  const res = await Api.get('/api/content', { code });
  const meta = builder.subjects.find(s => s.code === code) || { subject: code, code, color: '#6C3FF5' };
  builder.activeData = res.data || { subject: meta.subject, code: meta.code, color: meta.color, units: [] };
  builder.activeData.subjectTitle = meta.subject_title || builder.activeData.subjectTitle || '';

  document.getElementById('builder-tree-subject-label').textContent = `${builder.activeData.subject} — Units & Chapters`;
  renderTopicInfo(meta);

  const canEdit = Auth.canEditSubject(builder.session, code);
  document.getElementById('btn-save-subject').disabled = !canEdit;
  document.getElementById('builder-lock-note').textContent = canEdit ? '' : '👁 View only — you are not permitted to edit this subject.';

  renderBuilderTree();
  renderBuilderEditor();
}

// Shows which topic this row/code represents, with a rename option.
function renderTopicInfo(meta) {
  const wrap = document.getElementById('builder-variant-pills');
  if (!wrap) return;
  wrap.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:10px 16px 4px;flex-wrap:wrap">
      <span class="b-field-hint" style="margin:0">Subject Topic: <strong style="color:#374151">${escHtml(meta.subject_title || '(untitled topic)')}</strong></span>
      <button class="b-btn b-btn-outline b-btn-sm" onclick="renameTopic()">✎ Rename Topic</button>
    </div>`;
}
function renameTopic() {
  if (!builder.activeData) return;
  const title = prompt('Rename this topic:', builder.activeData.subjectTitle || '');
  if (title === null || !title.trim()) return;
  builder.activeData.subjectTitle = title.trim();
  const meta = builder.subjects.find(s => s.code === builder.activeCode);
  if (meta) meta.subject_title = title.trim();
  renderSubjectPills();
  renderTopicInfo({ subject_title: title.trim() });
  markDirty();
}

// ── TREE ──
function renderBuilderTree() {
  const wrap = document.getElementById('builder-tree');
  const data = builder.activeData;
  if (!data) { wrap.innerHTML = '<div class="editor-empty"><div class="big">📚</div><p style="font-size:12px">Select a subject</p></div>'; return; }
  data.units = data.units || [];

  let html = '';
  data.units.forEach(unit => {
    html += `<div class="b-unit">
      <div class="b-unit-row">
        <span class="b-unit-title" title="${escAttr(unit.title)}">${escHtml(unit.title)}</span>
        <button class="b-icon-btn" onclick="event.stopPropagation();renameUnit('${unit.id}')">✎</button>
        <button class="b-icon-btn danger" onclick="event.stopPropagation();deleteUnit('${unit.id}')">🗑</button>
      </div>
      <div class="b-chap-list">`;
    (unit.chapters || []).forEach(ch => {
      const isActive = ch.id === builder.activeChapterId;
      const qCount = (ch.questions || []).length;
      html += `<div class="b-chap-row${isActive ? ' active' : ''}" style="${isActive ? `background:${data.color};color:#fff` : ''}" onclick="selectChapterInBuilder('${unit.id}','${ch.id}')">
        <span class="b-chap-title" title="${escAttr(ch.title)}">${escHtml(ch.title)}</span>
        <span class="b-chap-qcount">${qCount}</span>
        <button class="b-icon-btn" style="${isActive ? 'color:rgba(255,255,255,.8)' : ''}" onclick="event.stopPropagation();deleteChapter('${unit.id}','${ch.id}')">✕</button>
      </div>`;
    });
    html += `<button class="b-add-btn" onclick="addChapter('${unit.id}')">+ Add Chapter</button></div></div>`;
  });
  html += `<button class="b-add-btn" onclick="addUnit()">+ Add Unit</button>`;
  wrap.innerHTML = html;
}

// Every subject in this editor is a flat { units: [...] } document — no
// nested "categories/variants" layer — so this always resolves to the
// active subject's data object directly.
function getUnitsContainer() {
  return builder.activeData || null;
}

function addUnit() {
  const container = getUnitsContainer(); if (!container) return;
  const title = prompt('Unit title:');
  if (!title || !title.trim()) return;
  container.units = container.units || [];
  container.units.push({ id: uid('u'), title: title.trim(), chapters: [] });
  renderBuilderTree(); markDirty();
}
function renameUnit(unitId) {
  const container = getUnitsContainer(); if (!container) return;
  const unit = container.units.find(u => u.id === unitId);
  if (!unit) return;
  const title = prompt('Rename unit:', unit.title);
  if (!title || !title.trim()) return;
  unit.title = title.trim(); renderBuilderTree(); markDirty();
}
function deleteUnit(unitId) {
  const container = getUnitsContainer(); if (!container) return;
  if (!confirm('Delete this unit and all its chapters/questions?')) return;
  container.units = container.units.filter(u => u.id !== unitId);
  if (builder.activeUnitId === unitId) { builder.activeUnitId = null; builder.activeChapterId = null; renderBuilderEditor(); }
  renderBuilderTree(); markDirty();
}
function addChapter(unitId) {
  const container = getUnitsContainer(); if (!container) return;
  const title = prompt('Chapter title:');
  if (!title || !title.trim()) return;
  const unit = container.units.find(u => u.id === unitId);
  if (!unit) return;
  const chapter = {
    id: uid('c'), title: title.trim(),
    concept: { title: title.trim(), latex: true, body: [], formulas: [] },
    cases: [],
    questions: [],
    playground: { schema: '', sampleQueries: [] },
  };
  unit.chapters = unit.chapters || [];
  unit.chapters.push(chapter);
  renderBuilderTree();
  selectChapterInBuilder(unitId, chapter.id);
  markDirty();
}
function deleteChapter(unitId, chapterId) {
  const container = getUnitsContainer(); if (!container) return;
  if (!confirm('Delete this chapter and all its questions?')) return;
  const unit = container.units.find(u => u.id === unitId);
  if (!unit) return;
  unit.chapters = unit.chapters.filter(c => c.id !== chapterId);
  if (builder.activeChapterId === chapterId) { builder.activeChapterId = null; renderBuilderEditor(); }
  renderBuilderTree(); markDirty();
}
function selectChapterInBuilder(unitId, chapterId) {
  builder.activeUnitId = unitId; builder.activeChapterId = chapterId;
  builder.openQuestionId = null; builder.openBodyIndex = null;
  renderBuilderTree(); renderBuilderEditor();
}
function getActiveChapterObj() {
  const container = getUnitsContainer();
  const unit = container?.units?.find(u => u.id === builder.activeUnitId);
  return unit?.chapters?.find(c => c.id === builder.activeChapterId) || null;
}

function normalizeConcept(concept, fallbackTitle) {
  concept = concept || {};
  const out = { title: concept.title || fallbackTitle || '', latex: concept.latex !== false, body: [], formulas: [] };
  (Array.isArray(concept.body) ? concept.body : []).forEach(b => {
    if (typeof b === 'string') out.body.push({ type: 'paragraph', text: b });
    else if (b && b.type) out.body.push(b);
  });
  // Key Formulas is its own field — a row of chips shown separately from
  // the body blocks (see the Key Formulas editor section + preview).
  (Array.isArray(concept.formulas) ? concept.formulas : []).forEach(f => {
    if (typeof f === 'string' && f.trim()) out.formulas.push(f);
  });
  return out;
}

// ── EDITOR ──
function renderBuilderEditor() {
  const wrap = document.getElementById('builder-editor');
  const chapter = getActiveChapterObj();
  const label = document.getElementById('builder-editor-label');
  if (!chapter) {
    label.textContent = 'Editor';
    wrap.innerHTML = '<div class="editor-empty"><div class="big">👈</div><p style="font-size:12px">Select a chapter to edit its concept &amp; questions</p></div>';
    return;
  }
  label.textContent = chapter.title;
  chapter.concept = normalizeConcept(chapter.concept, chapter.title);
  chapter.cases = chapter.cases || [];
  chapter.playground = chapter.playground || { schema: '', sampleQueries: [] };
  const concept = chapter.concept;
  const pg = chapter.playground;
  const isSql = (builder.activeData.code || '').toUpperCase() === 'SQL';

  wrap.innerHTML = `
    <div class="editor-section">
      <div class="editor-section-title">Chapter Title</div>
      <div class="b-field"><input type="text" value="${escAttr(chapter.title)}" oninput="updateChapterTitle(this.value)"></div>
    </div>

    <div class="editor-section">
      <div class="editor-section-title">💡 Concept / Theory</div>
      <div class="b-field"><label>Concept Title</label><input type="text" value="${escAttr(concept.title || '')}" oninput="updateConceptField('title', this.value)"></div>
      <div class="b-field"><label><input type="checkbox" ${concept.latex ? 'checked' : ''} onchange="updateConceptField('latex', this.checked)" style="width:auto;margin-right:6px"> Enable LaTeX rendering</label></div>
      <div class="b-field">
        <label>Content Blocks</label>
        <div id="ed-body-list"></div>
        <div class="badge-type-row" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
          ${['heading','paragraph','list','summary','table','note','formula','syntax','image','video','steps','exercise','example'].map(t => `<button class="b-btn b-btn-outline b-btn-sm" onclick="addBodyItem('${t}')">+ ${t}</button>`).join('')}
        </div>
      </div>
    </div>

    <div class="editor-section">
      <div class="editor-section-title">🧮 Key Formulas</div>
      <div class="b-field">
        <label>Shown together in a highlighted "Key Formulas" box at the end of the concept. Supports LaTeX (e.g. <code>$Z = A^p B^q/C^r$</code>) when LaTeX is enabled above.</label>
        <div id="ed-formulas-list"></div>
        <button class="b-btn b-btn-outline b-btn-sm" onclick="addKeyFormula()">+ Add Key Formula</button>
      </div>
    </div>

    <div class="editor-section">
      <div class="editor-section-title">📋 Case Studies / Shared Passages (optional)</div>
      <div class="b-field-hint">Create a passage once, then assign it to a group of questions below — for case-study/comprehension-style questions.</div>
      <div id="ed-cases-list"></div>
      <button class="b-btn b-btn-outline b-btn-sm" onclick="addCase()">+ Add Case / Passage</button>
    </div>

    ${isSql ? `
    <div class="editor-section">
      <div class="editor-section-title">🛢️ SQL Playground</div>
      <div class="b-field">
        <label>Schema (DDL + seed INSERTs run before the learner's own queries)</label>
        <textarea rows="6" style="font-family:monospace" oninput="updatePlaygroundField('schema', this.value)" placeholder="CREATE TABLE Student (...);">${escHtml(pg.schema || '')}</textarea>
      </div>
      <div class="b-field">
        <label>Sample Queries</label>
        <div id="ed-pg-queries"></div>
        <button class="b-btn b-btn-outline b-btn-sm" onclick="addPlaygroundQuery()">+ Add Sample Query</button>
      </div>
      <div class="b-field-hint">Saved as <code>chapter.playground = {"schema": "...", "sampleQueries": [...]}</code>, ready for an in-app SQL practice sandbox.</div>
    </div>` : ''}

    <div class="editor-section">
      <div class="editor-section-title"><span>Practice Questions (${(chapter.questions || []).length})</span></div>
      <div id="ed-questions-list"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <button class="b-btn b-btn-outline b-btn-sm" onclick="addQuestion('MCQ')">+ MCQ</button>
        <button class="b-btn b-btn-outline b-btn-sm" onclick="addQuestion('MSQ')">+ MSQ</button>
        <button class="b-btn b-btn-outline b-btn-sm" onclick="addQuestion('NAT')">+ NAT</button>
        <button class="b-btn b-btn-outline b-btn-sm" onclick="addQuestion('AR')">+ Assertion-Reason</button>
        <button class="b-btn b-btn-outline b-btn-sm" onclick="addQuestion('MATCH')">+ Match the Following</button>
      </div>
    </div>`;

  renderBodyItemsList(concept);
  renderKeyFormulasList(concept);
  renderCasesList(chapter);
  renderPlaygroundQueries(pg);
  renderQuestionsList(chapter);
}

function updateChapterTitle(val) {
  const chapter = getActiveChapterObj(); if (!chapter) return;
  chapter.title = val; renderBuilderTree();
  document.getElementById('builder-editor-label').textContent = val; markDirty();
}
function updateConceptField(field, val) {
  const chapter = getActiveChapterObj(); if (!chapter) return;
  chapter.concept = chapter.concept || { title: '', latex: true, body: [], formulas: [] };
  chapter.concept[field] = val; markDirty();
}

// ── Key Formulas ──
function renderKeyFormulasList(concept) {
  const wrap = document.getElementById('ed-formulas-list'); if (!wrap) return;
  wrap.innerHTML = '';
  (concept.formulas || []).forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'b-list-item';
    row.innerHTML = `<input type="text" style="font-family:monospace" value="${escAttr(f)}" oninput="updateKeyFormula(${i}, this.value)" placeholder="e.g. Relative error = \\$\\Delta a/a\\$">
      <button class="b-icon-btn danger" onclick="removeKeyFormula(${i})">✕</button>`;
    wrap.appendChild(row);
  });
}
function addKeyFormula() {
  const chapter = getActiveChapterObj(); if (!chapter) return;
  chapter.concept.formulas = chapter.concept.formulas || [];
  chapter.concept.formulas.push('');
  renderKeyFormulasList(chapter.concept);
  markDirty();
}
function updateKeyFormula(i, val) {
  const chapter = getActiveChapterObj(); if (!chapter) return;
  chapter.concept.formulas[i] = val;
  markDirty();
}
function removeKeyFormula(i) {
  const chapter = getActiveChapterObj(); if (!chapter) return;
  chapter.concept.formulas.splice(i, 1);
  renderKeyFormulasList(chapter.concept);
  markDirty();
}

// ── Case Studies / shared passages ──
function renderCasesList(chapter) {
  const wrap = document.getElementById('ed-cases-list'); if (!wrap) return;
  wrap.innerHTML = '';
  (chapter.cases || []).forEach((c) => {
    const card = document.createElement('div');
    card.style.cssText = 'border:1.5px solid #e5e7eb;border-radius:10px;margin-bottom:10px;padding:12px';
    card.innerHTML = `
      <div class="b-field"><label>Title</label><input type="text" value="${escAttr(c.title || '')}" oninput="updateCaseField('${c.id}','title',this.value)" placeholder="e.g. Case Study 1"></div>
      <div class="b-field"><label>Passage</label><textarea rows="3" oninput="updateCaseField('${c.id}','passage',this.value)">${escHtml(c.passage || '')}</textarea></div>
      <div class="b-field"><label>Image (optional)</label>
        <input type="text" value="${escAttr(c.image || '')}" oninput="updateCaseField('${c.id}','image',this.value)">
        <div class="b-upload-row"><input type="file" accept="image/*" onchange="handleCaseImageUpload('${c.id}',this)"></div>
      </div>
      <button class="b-icon-btn danger b-btn-sm" onclick="removeCase('${c.id}')">🗑 Remove Case</button>`;
    wrap.appendChild(card);
  });
}
function addCase() {
  const chapter = getActiveChapterObj(); if (!chapter) return;
  chapter.cases = chapter.cases || [];
  chapter.cases.push({ id: uid('case'), title: '', passage: '', image: '' });
  renderCasesList(chapter); markDirty();
}
function updateCaseField(caseId, field, val) {
  const chapter = getActiveChapterObj(); if (!chapter) return;
  const c = (chapter.cases || []).find(x => x.id === caseId); if (!c) return;
  c[field] = val; markDirty();
}
async function handleCaseImageUpload(caseId, inputEl) {
  const file = inputEl.files[0]; if (!file) return;
  const chapter = getActiveChapterObj(); if (!chapter) return;
  const c = (chapter.cases || []).find(x => x.id === caseId); if (!c) return;
  try { c.image = await fileToBase64(file); renderCasesList(chapter); markDirty(); }
  catch { alert('Could not read that image file.'); }
}
function removeCase(caseId) {
  const chapter = getActiveChapterObj(); if (!chapter) return;
  if (!confirm('Remove this case? Questions assigned to it will lose the reference.')) return;
  chapter.cases = (chapter.cases || []).filter(c => c.id !== caseId);
  (chapter.questions || []).forEach(q => { if (q.caseId === caseId) q.caseId = ''; });
  renderCasesList(chapter); renderQuestionsList(chapter); markDirty();
}

// ── Playground ──
function renderPlaygroundQueries(pg) {
  const wrap = document.getElementById('ed-pg-queries');
  if (!wrap) return;
  wrap.innerHTML = '';
  (pg.sampleQueries || []).forEach((sq, i) => {
    const row = document.createElement('div');
    row.className = 'b-list-item';
    row.innerHTML = `<input type="text" style="font-family:monospace" value="${escAttr(sq)}" oninput="updatePlaygroundQuery(${i}, this.value)" placeholder="SELECT * FROM Student;">
      <button class="b-icon-btn danger" onclick="removePlaygroundQuery(${i})">✕</button>`;
    wrap.appendChild(row);
  });
}
function updatePlaygroundField(field, val) {
  const chapter = getActiveChapterObj(); if (!chapter) return;
  chapter.playground = chapter.playground || { schema: '', sampleQueries: [] };
  chapter.playground[field] = val; markDirty();
}
function addPlaygroundQuery() {
  const chapter = getActiveChapterObj(); if (!chapter) return;
  chapter.playground.sampleQueries = chapter.playground.sampleQueries || [];
  chapter.playground.sampleQueries.push('');
  renderPlaygroundQueries(chapter.playground); markDirty();
}
function updatePlaygroundQuery(i, val) {
  const chapter = getActiveChapterObj(); if (!chapter) return;
  chapter.playground.sampleQueries[i] = val; markDirty();
}
function removePlaygroundQuery(i) {
  const chapter = getActiveChapterObj(); if (!chapter) return;
  chapter.playground.sampleQueries.splice(i, 1);
  renderPlaygroundQueries(chapter.playground); markDirty();
}

// ── Content blocks (condensed but functionally complete) ──
function bodyItemSummary(item) {
  if (item.type === 'list' || item.type === 'summary') return (item.items || []).filter(Boolean).join(', ') || `(empty ${item.type})`;
  if (item.type === 'table') return (item.headers || []).join(' | ') || '(empty table)';
  if (item.type === 'syntax') return item.code || '(empty code)';
  if (item.type === 'image') return item.title || item.image || item.pdf || '(empty image/pdf)';
  if (item.type === 'video') return item.title || item.url || '(no video URL)';
  if (item.type === 'steps' || item.type === 'exercise') return item.title || (item.steps || []).filter(Boolean).join(' → ') || `(empty ${item.type})`;
  if (item.type === 'example') return item.title || item.before || '(empty example)';
  return item.text || '(empty)';
}
function addBodyItem(type) {
  const chapter = getActiveChapterObj(); if (!chapter) return;
  chapter.concept.body = chapter.concept.body || [];
  let item;
  if (type === 'list') item = { type: 'list', items: [''] };
  else if (type === 'summary') item = { type: 'summary', items: [''] };
  else if (type === 'table') item = { type: 'table', headers: ['Column 1', 'Column 2'], rows: [['', '']] };
  else if (type === 'syntax') item = { type: 'syntax', language: 'text', code: '' };
  else if (type === 'image') item = { type: 'image', title: '', image: '', pdf: '' };
  else if (type === 'video') item = { type: 'video', title: '', url: '', start: '' };
  else if (type === 'steps' || type === 'exercise') item = { type, title: '', steps: [''], image: '' };
  else if (type === 'example') item = { type: 'example', title: '', before: '', steps: [''], formula: '', after: '', image: '' };
  else item = { type, text: '' };
  chapter.concept.body.push(item);
  builder.openBodyIndex = chapter.concept.body.length - 1;
  renderBodyItemsList(chapter.concept); markDirty();
}
function renderBodyItemsList(concept) {
  const wrap = document.getElementById('ed-body-list'); if (!wrap) return;
  wrap.innerHTML = '';
  (concept.body || []).forEach((item, i) => {
    const isOpen = builder.openBodyIndex === i;
    const card = document.createElement('div');
    card.className = 'b-item-card';
    card.style.cssText = 'border:1.5px solid #e5e7eb;border-radius:12px;margin-bottom:10px;overflow:hidden';
    const summary = bodyItemSummary(item).replace(/\$/g, '').slice(0, 60);
    card.innerHTML = `
      <div class="b-item-head" style="display:flex;align-items:center;gap:8px;padding:9px 12px;background:#f9fafb;cursor:pointer" onclick="toggleBodyItemOpen(${i})">
        <span style="font-size:9.5px;font-weight:700;padding:2px 7px;border-radius:20px;color:#fff;background:${BTYPE_COLORS[item.type] || '#6b7280'};text-transform:uppercase">${item.type}</span>
        <span style="flex:1;font-size:12px;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(summary)}</span>
        <button class="b-icon-btn" onclick="event.stopPropagation();moveBodyItem(${i},-1)">↑</button>
        <button class="b-icon-btn" onclick="event.stopPropagation();moveBodyItem(${i},1)">↓</button>
        <button class="b-icon-btn danger" onclick="event.stopPropagation();removeBodyItem(${i})">✕</button>
      </div>
      <div class="b-item-body${isOpen ? ' open' : ''}" style="padding:12px;display:${isOpen ? 'block' : 'none'}" id="bbody-${i}"></div>`;
    wrap.appendChild(card);
    if (isOpen) renderBodyItemEditor(item, i, document.getElementById(`bbody-${i}`));
  });
}
function toggleBodyItemOpen(i) { builder.openBodyIndex = builder.openBodyIndex === i ? null : i; renderBodyItemsList(getActiveChapterObj().concept); }
function moveBodyItem(i, dir) {
  const arr = getActiveChapterObj().concept.body; const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]]; builder.openBodyIndex = j;
  renderBodyItemsList(getActiveChapterObj().concept); markDirty();
}
function removeBodyItem(i) {
  if (!confirm('Remove this content block?')) return;
  getActiveChapterObj().concept.body.splice(i, 1);
  builder.openBodyIndex = null;
  renderBodyItemsList(getActiveChapterObj().concept); markDirty();
}
function refreshBodyItemSummary(i) {
  const item = getActiveChapterObj().concept.body[i];
  const wrap = document.getElementById('ed-body-list');
  const headSpan = wrap?.children[i]?.querySelector('span:nth-child(2)');
  if (headSpan) headSpan.textContent = bodyItemSummary(item).replace(/\$/g, '').slice(0, 60);
}
function renderBodyItemEditor(item, i, container) {
  if (['heading', 'paragraph', 'note', 'formula'].includes(item.type)) {
    container.innerHTML = `<div class="b-field"><label>Text</label><textarea rows="${item.type === 'heading' ? 1 : 3}" oninput="updateBodyText(${i}, this.value)">${escHtml(item.text || '')}</textarea></div>`;
    return;
  }
  if (item.type === 'list' || item.type === 'summary') {
    let rows = (item.items || []).map((li, li_i) => `<div class="b-list-item"><input type="text" value="${escAttr(li)}" oninput="updateListItemText(${i},${li_i},this.value)" onpaste="handleListItemPaste(${i},${li_i},event)"><button class="b-icon-btn danger" onclick="removeListItemAt(${i},${li_i})">✕</button></div>`).join('');
    container.innerHTML = `<div class="b-field"><label>${item.type === 'summary' ? 'Summary Points' : 'List Items'}</label>${rows}<button class="b-btn b-btn-outline b-btn-sm" onclick="addListItemAt(${i})">+ Add Item</button><div class="b-field-hint">Tip: paste multiple lines into any item box to add them all as separate items at once.</div></div>`;
    return;
  }
  if (item.type === 'table') { container.innerHTML = tableEditorHtml(item, i); return; }
  if (item.type === 'syntax') {
    container.innerHTML = `<div class="b-field"><label>Language</label><input type="text" value="${escAttr(item.language || 'text')}" oninput="updateSyntaxField(${i},'language',this.value)"></div>
      <div class="b-field"><label>Code</label><textarea rows="4" style="font-family:monospace" oninput="updateSyntaxField(${i},'code',this.value)">${escHtml(item.code || '')}</textarea></div>`;
    return;
  }
  if (item.type === 'image') {
    container.innerHTML = `<div class="b-field"><label>Title</label><input type="text" value="${escAttr(item.title || '')}" oninput="updateImageField(${i},'title',this.value)"></div>
      <div class="b-field"><label>Image URL / base64</label><input type="text" value="${escAttr(item.image || '')}" oninput="updateImageField(${i},'image',this.value)">
      <div class="b-upload-row" style="margin-top:8px"><input type="file" accept="image/*" onchange="handleImageUpload(${i},this)"></div></div>
      <div class="b-field"><label>PDF URL / base64</label><input type="text" value="${escAttr(item.pdf || '')}" oninput="updateImageField(${i},'pdf',this.value)"></div>`;
    return;
  }
  if (item.type === 'video') {
    container.innerHTML = `<div class="b-field"><label>Title</label><input type="text" value="${escAttr(item.title || '')}" oninput="updateImageField(${i},'title',this.value)"></div>
      <div class="b-field"><label>YouTube URL</label><input type="text" value="${escAttr(item.url || '')}" oninput="updateImageField(${i},'url',this.value)"></div>
      <div class="b-field"><label>Start at (sec or mm:ss)</label><input type="text" value="${escAttr(item.start || '')}" oninput="updateImageField(${i},'start',this.value)"></div>`;
    return;
  }
  if (item.type === 'steps' || item.type === 'exercise') {
    let rows = (item.steps || []).map((s, si) => `<div class="b-list-item"><textarea rows="1" oninput="updateStepText(${i},${si},this.value)" onpaste="handleStepPaste(${i},${si},event)">${escHtml(s)}</textarea><button class="b-icon-btn danger" onclick="removeStepAt(${i},${si})">✕</button></div>`).join('');
    container.innerHTML = `<div class="b-field"><label>Title</label><input type="text" value="${escAttr(item.title || '')}" oninput="updateImageField(${i},'title',this.value)"></div>
      <div class="b-field"><label>Items</label>${rows}<button class="b-btn b-btn-outline b-btn-sm" onclick="addStepAt(${i})">+ Add</button><div class="b-field-hint">Tip: paste multiple lines into any step box to add them all at once.</div></div>`;
    return;
  }
  if (item.type === 'example') {
    let rows = (item.steps || []).map((s, si) => `<div class="b-list-item"><textarea rows="1" oninput="updateStepText(${i},${si},this.value)" onpaste="handleStepPaste(${i},${si},event)">${escHtml(s)}</textarea><button class="b-icon-btn danger" onclick="removeStepAt(${i},${si})">✕</button></div>`).join('');
    container.innerHTML = `<div class="b-field"><label>Title</label><input type="text" value="${escAttr(item.title || '')}" oninput="updateImageField(${i},'title',this.value)" placeholder="e.g. AVERAGEIF() Example"></div>
      <div class="b-field"><label>Before (the problem / setup)</label><textarea rows="2" oninput="updateImageField(${i},'before',this.value)" placeholder="e.g. Find the average marks of students belonging to Physics.">${escHtml(item.before || '')}</textarea></div>
      <div class="b-field"><label>Steps</label>${rows}<button class="b-btn b-btn-outline b-btn-sm" onclick="addStepAt(${i})">+ Add Step</button><div class="b-field-hint">Tip: paste multiple lines into any step box to add them all at once.</div></div>
      <div class="b-field"><label>Formula (optional)</label><input type="text" style="font-family:monospace" value="${escAttr(item.formula || '')}" oninput="updateImageField(${i},'formula',this.value)" placeholder='=AVERAGEIF(B2:B20,"Physics",D2:D20)'></div>
      <div class="b-field"><label>After (the result)</label><input type="text" value="${escAttr(item.after || '')}" oninput="updateImageField(${i},'after',this.value)" placeholder="e.g. Average marks of Physics students"></div>
      <div class="b-field"><label>Image (optional)</label>
        <input type="text" value="${escAttr(item.image || '')}" oninput="updateImageField(${i},'image',this.value)">
        <div class="b-upload-row" style="margin-top:8px"><input type="file" accept="image/*" onchange="handleImageUpload(${i},this)"></div>
      </div>`;
    return;
  }
}
function updateBodyText(i, val) { getActiveChapterObj().concept.body[i].text = val; refreshBodyItemSummary(i); markDirty(); }
function addListItemAt(i) { const item = getActiveChapterObj().concept.body[i]; item.items = item.items || []; item.items.push(''); renderBodyItemEditor(item, i, document.getElementById(`bbody-${i}`)); markDirty(); }
function updateListItemText(i, li, val) { getActiveChapterObj().concept.body[i].items[li] = val; refreshBodyItemSummary(i); markDirty(); }
function removeListItemAt(i, li) { const item = getActiveChapterObj().concept.body[i]; item.items.splice(li, 1); renderBodyItemEditor(item, i, document.getElementById(`bbody-${i}`)); markDirty(); }
// Pasting several lines into one list-item box adds them all as separate
// items at once, instead of forcing one-at-a-time entry.
function handleListItemPaste(i, li, event) {
  const text = (event.clipboardData || window.clipboardData).getData('text');
  const lines = (text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (lines.length < 2) return; // single line: let the normal paste happen
  event.preventDefault();
  const item = getActiveChapterObj().concept.body[i];
  item.items = item.items || [];
  item.items.splice(li, 1, ...lines);
  renderBodyItemEditor(item, i, document.getElementById(`bbody-${i}`));
  refreshBodyItemSummary(i);
  markDirty();
}
function addStepAt(i) { const item = getActiveChapterObj().concept.body[i]; item.steps = item.steps || []; item.steps.push(''); renderBodyItemEditor(item, i, document.getElementById(`bbody-${i}`)); markDirty(); }
function updateStepText(i, si, val) { getActiveChapterObj().concept.body[i].steps[si] = val; markDirty(); }
function removeStepAt(i, si) { const item = getActiveChapterObj().concept.body[i]; item.steps.splice(si, 1); renderBodyItemEditor(item, i, document.getElementById(`bbody-${i}`)); markDirty(); }
function handleStepPaste(i, si, event) {
  const text = (event.clipboardData || window.clipboardData).getData('text');
  const lines = (text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (lines.length < 2) return;
  event.preventDefault();
  const item = getActiveChapterObj().concept.body[i];
  item.steps = item.steps || [];
  item.steps.splice(si, 1, ...lines);
  renderBodyItemEditor(item, i, document.getElementById(`bbody-${i}`));
  markDirty();
}
function tableEditorHtml(item, i) {
  const headers = item.headers || []; const rows = item.rows || [];
  let html = '<div class="b-field"><label>Table</label><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><tr>';
  headers.forEach((h, ci) => {
    html += `<td><input type="text" value="${escAttr(h)}" oninput="updateTableHeader(${i},${ci},this.value)"></td>`;
  });
  html += `<td><button class="b-icon-btn" onclick="addTableCol(${i})" title="Add column">+col</button></td></tr><tr>`;
  headers.forEach((_, ci) => {
    html += `<td style="text-align:center"><button class="b-icon-btn danger b-btn-sm" onclick="removeTableCol(${i},${ci})" title="Remove this column" ${headers.length <= 1 ? 'disabled' : ''}>✕ col</button></td>`;
  });
  html += `<td></td></tr>`;
  rows.forEach((r, ri) => {
    html += '<tr>';
    headers.forEach((_, ci) => { html += `<td><input type="text" value="${escAttr(r[ci] || '')}" oninput="updateTableCell(${i},${ri},${ci},this.value)"></td>`; });
    html += `<td><button class="b-icon-btn danger" onclick="removeTableRow(${i},${ri})" title="Remove row">✕</button></td></tr>`;
  });
  html += '</table></div>';
  html += `<button class="b-btn b-btn-outline b-btn-sm" style="margin-top:6px" onclick="addTableRow(${i})">+ Add Row</button>`;
  html += `
    <details style="margin-top:10px">
      <summary style="cursor:pointer;font-size:11.5px;font-weight:700;color:#6b7280">📋 Paste table data (from Excel/Sheets, tab-separated — or comma-separated)</summary>
      <div style="margin-top:8px">
        <textarea id="table-paste-${i}" rows="4" style="font-family:monospace;font-size:12px" placeholder="Header 1\tHeader 2\tHeader 3&#10;Row1 A\tRow1 B\tRow1 C&#10;Row2 A\tRow2 B\tRow2 C"></textarea>
        <div style="display:flex;gap:8px;margin-top:6px">
          <button class="b-btn b-btn-primary b-btn-sm" onclick="parseTablePaste(${i}, true)">Replace table with pasted data</button>
          <button class="b-btn b-btn-outline b-btn-sm" onclick="parseTablePaste(${i}, false)">Append as new rows</button>
        </div>
        <div class="b-field-hint">First line becomes the header row when replacing. Paste straight from a spreadsheet — tabs are detected automatically, commas work too.</div>
      </div>
    </details></div>`;
  return html;
}
function splitTableLine(line) {
  return line.includes('\t') ? line.split('\t') : line.split(',');
}
function parseTablePaste(i, replace) {
  const textarea = document.getElementById(`table-paste-${i}`);
  const raw = (textarea?.value || '').trim();
  if (!raw) return;
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length);
  if (!lines.length) return;
  const item = getActiveChapterObj().concept.body[i];

  if (replace) {
    item.headers = splitTableLine(lines[0]).map(s => s.trim());
    item.rows = lines.slice(1).map(l => splitTableLine(l).map(s => s.trim()));
  } else {
    item.headers = item.headers || [];
    const width = item.headers.length || splitTableLine(lines[0]).length;
    item.rows = item.rows || [];
    lines.forEach(l => {
      const cells = splitTableLine(l).map(s => s.trim());
      while (cells.length < width) cells.push('');
      item.rows.push(cells.slice(0, width));
    });
  }
  rerenderTableEditor(i);
}
function rerenderTableEditor(i) {
  const item = getActiveChapterObj().concept.body[i];
  const container = document.getElementById(`bbody-${i}`);
  if (container) container.innerHTML = tableEditorHtml(item, i);
  refreshBodyItemSummary(i);
  markDirty();
}
function addTableCol(i) { const item = getActiveChapterObj().concept.body[i]; item.headers.push(`Column ${item.headers.length + 1}`); (item.rows || []).forEach(r => r.push('')); rerenderTableEditor(i); }
function removeTableCol(i, ci) {
  const item = getActiveChapterObj().concept.body[i];
  if (item.headers.length <= 1) return;
  item.headers.splice(ci, 1);
  (item.rows || []).forEach(r => r.splice(ci, 1));
  rerenderTableEditor(i);
}
function addTableRow(i) { const item = getActiveChapterObj().concept.body[i]; item.rows = item.rows || []; item.rows.push((item.headers || []).map(() => '')); rerenderTableEditor(i); }
function removeTableRow(i, ri) { getActiveChapterObj().concept.body[i].rows.splice(ri, 1); rerenderTableEditor(i); }
function updateTableHeader(i, ci, val) { getActiveChapterObj().concept.body[i].headers[ci] = val; refreshBodyItemSummary(i); markDirty(); }
function updateTableCell(i, ri, ci, val) { getActiveChapterObj().concept.body[i].rows[ri][ci] = val; markDirty(); }
function updateSyntaxField(i, field, val) { getActiveChapterObj().concept.body[i][field] = val; refreshBodyItemSummary(i); markDirty(); }
function updateImageField(i, field, val) { getActiveChapterObj().concept.body[i][field] = val; refreshBodyItemSummary(i); markDirty(); }

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file);
  });
}
async function handleImageUpload(i, inputEl) {
  const file = inputEl.files[0]; if (!file) return;
  const dataUrl = await fileToBase64(file);
  getActiveChapterObj().concept.body[i].image = dataUrl;
  renderBodyItemEditor(getActiveChapterObj().concept.body[i], i, document.getElementById(`bbody-${i}`));
  markDirty();
}

// ── Questions ──
function addQuestion(type) {
  const chapter = getActiveChapterObj(); if (!chapter) return;
  chapter.questions = chapter.questions || [];
  const base = { explanation: '', explanationImage: '', explanationVideo: '', explanationLink: '', caseId: '' };
  let q;
  if (type === 'NAT') {
    q = { id: uid('q'), type: 'NAT', latex: false, question: '', image: '', answer: 0, tolerance: 0, unit: '', ...base };
  } else if (type === 'AR') {
    q = {
      id: uid('q'), type: 'AR', latex: false, question: '', image: '',
      assertion: '', reason: '',
      options: [
        'Both A and R are true and R is the correct explanation of A',
        'Both A and R are true but R is not the correct explanation of A',
        'A is true but R is false',
        'A is false but R is true',
      ],
      optionImages: ['', '', '', ''],
      answer: [], ...base,
    };
  } else if (type === 'MATCH') {
    q = {
      id: uid('q'), type: 'MATCH', latex: false, question: '', image: '',
      columnATitle: 'Column A', columnBTitle: 'Column B',
      pairs: [{ left: '', right: '' }, { left: '', right: '' }],
      ...base,
    };
  } else {
    q = { id: uid('q'), type, latex: false, question: '', image: '', options: ['', '', '', ''], optionImages: ['', '', '', ''], answer: [], ...base };
  }
  chapter.questions.push(q);
  builder.openQuestionId = q.id;
  renderBuilderEditor(); markDirty();
}
function renderQuestionsList(chapter) {
  const wrap = document.getElementById('ed-questions-list'); wrap.innerHTML = '';
  (chapter.questions || []).forEach(q => {
    const isOpen = builder.openQuestionId === q.id;
    const card = document.createElement('div');
    card.style.cssText = 'border:1.5px solid #e5e7eb;border-radius:12px;margin-bottom:12px;overflow:hidden';
    const summary = q.question ? q.question.replace(/\$/g, '').slice(0, 60)
      : q.type === 'AR' ? (q.assertion || '(empty assertion)').replace(/\$/g, '').slice(0, 60)
      : q.type === 'MATCH' ? `${(q.pairs || []).length} pair(s) to match`
      : '(empty question)';
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:#f9fafb;cursor:pointer" onclick="toggleQuestionOpen('${q.id}')">
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;color:#fff;background:${QTYPE_COLORS[q.type]}">${q.type}</span>
        <span style="flex:1;font-size:12px;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(summary)}</span>
        <button class="b-icon-btn danger" onclick="event.stopPropagation();deleteQuestion('${q.id}')">🗑</button>
      </div>
      <div style="padding:14px;display:${isOpen ? 'block' : 'none'}" id="qbody-${q.id}"></div>`;
    wrap.appendChild(card);
    if (isOpen) renderQuestionEditor(q, document.getElementById(`qbody-${q.id}`));
  });
}
function toggleQuestionOpen(qid) { builder.openQuestionId = builder.openQuestionId === qid ? null : qid; renderQuestionsList(getActiveChapterObj()); }
function deleteQuestion(qid) {
  if (!confirm('Delete this question?')) return;
  const chapter = getActiveChapterObj();
  chapter.questions = chapter.questions.filter(q => q.id !== qid);
  renderBuilderTree(); renderQuestionsList(chapter); markDirty();
}
function findQuestion(qid) { return getActiveChapterObj()?.questions?.find(q => q.id === qid); }

function explanationFieldsHtml(q) {
  return `
    <div class="b-field"><label>Explanation</label><textarea rows="2" oninput="updateQuestionField('${q.id}','explanation',this.value)">${escHtml(q.explanation)}</textarea></div>
    <div class="b-field">
      <label>Explanation Image (optional)</label>
      <input type="text" value="${escAttr(q.explanationImage || '')}" oninput="updateQuestionField('${q.id}','explanationImage',this.value)">
      <div class="b-upload-row">
        <input type="file" accept="image/*" onchange="handleExplanationImageUpload('${q.id}',this)">
        ${q.explanationImage ? `<img src="${escAttr(q.explanationImage)}" class="b-thumb" style="max-width:160px;max-height:110px;border-radius:8px;border:1px solid #e5e7eb;object-fit:cover" onerror="this.style.display='none'"><button class="b-icon-btn danger b-btn-sm" onclick="clearExplanationImage('${q.id}')">Remove image</button>` : ''}
      </div>
    </div>
    <div class="b-field"><label>Explanation Video (YouTube URL, optional)</label><input type="text" value="${escAttr(q.explanationVideo || '')}" oninput="updateQuestionField('${q.id}','explanationVideo',this.value)"></div>
    <div class="b-field"><label>Explanation Link (optional)</label><input type="text" value="${escAttr(q.explanationLink || '')}" oninput="updateQuestionField('${q.id}','explanationLink',this.value)"></div>`;
}

function caseSelectHtml(q) {
  const chapter = getActiveChapterObj();
  if (!chapter || !(chapter.cases || []).length) return '';
  const caseOptions = (chapter.cases || []).map(c =>
    `<option value="${c.id}" ${q.caseId === c.id ? 'selected' : ''}>${escHtml(c.title || '(untitled case)')}</option>`).join('');
  return `
    <div class="b-field"><label>Part of Case / Passage (optional)</label>
      <select onchange="updateQuestionField('${q.id}','caseId',this.value)">
        <option value="">— None —</option>${caseOptions}
      </select>
    </div>`;
}

function renderQuestionEditor(q, container) {
  if (q.type === 'MATCH') { renderMatchQuestionEditor(q, container); return; }

  let optsHtml = '';
  if (q.type !== 'NAT') {
    q.optionImages = q.optionImages || (q.options || []).map(() => '');
    (q.options || []).forEach((opt, i) => {
      const checked = (q.answer || []).includes(i);
      const inputType = (q.type === 'MCQ' || q.type === 'AR') ? 'radio' : 'checkbox';
      const optImg = q.optionImages[i] || '';
      optsHtml += `<div class="b-opt-row" style="display:flex;align-items:center;gap:8px;margin-bottom:${optImg ? '2px' : '7px'}">
        <span style="width:22px;height:22px;border-radius:6px;background:#f3f4f6;color:#6b7280;font-size:10.5px;font-weight:700;display:flex;align-items:center;justify-content:center">${String.fromCharCode(65 + i)}</span>
        <input type="text" style="flex:1" value="${escAttr(opt)}" oninput="updateOptionText('${q.id}',${i},this.value)" placeholder="Option ${String.fromCharCode(65 + i)}">
        <input type="${inputType}" name="correct-${q.id}" ${checked ? 'checked' : ''} onchange="toggleOptionCorrect('${q.id}',${i},this.checked)" title="Mark as correct">
        <label class="b-icon-btn" title="Add/replace option image" style="cursor:pointer">🖼<input type="file" accept="image/*" style="display:none" onchange="handleOptionImageUpload('${q.id}',${i},this)"></label>
        <button class="b-icon-btn danger" onclick="removeOption('${q.id}',${i})" title="Remove option">✕</button>
      </div>
      ${optImg ? `<div style="display:flex;align-items:center;gap:8px;margin:-3px 0 10px 30px"><img src="${escAttr(optImg)}" style="max-width:110px;max-height:70px;border-radius:6px;border:1px solid #e5e7eb;object-fit:cover" onerror="this.style.display='none'"><button class="b-icon-btn danger b-btn-sm" onclick="clearOptionImage('${q.id}',${i})">Remove image</button></div>` : ''}`;
    });
  }
  let natHtml = '';
  if (q.type === 'NAT') {
    natHtml = `<div class="b-field-row">
      <div class="b-field"><label>Correct Answer</label><input type="number" step="any" value="${q.answer ?? 0}" oninput="updateNatField('${q.id}','answer',parseFloat(this.value))"></div>
      <div class="b-field"><label>Tolerance (±)</label><input type="number" step="any" value="${q.tolerance ?? 0}" oninput="updateNatField('${q.id}','tolerance',parseFloat(this.value))"></div>
    </div>
    <div class="b-field"><label>Unit (optional)</label><input type="text" value="${escAttr(q.unit || '')}" oninput="updateNatField('${q.id}','unit',this.value)"></div>`;
  }
  let arHtml = '';
  if (q.type === 'AR') {
    arHtml = `
      <div class="b-field"><label>Assertion (A)</label><textarea rows="2" oninput="updateQuestionField('${q.id}','assertion',this.value)">${escHtml(q.assertion || '')}</textarea></div>
      <div class="b-field"><label>Reason (R)</label><textarea rows="2" oninput="updateQuestionField('${q.id}','reason',this.value)">${escHtml(q.reason || '')}</textarea></div>`;
  }

  container.innerHTML = `
    ${caseSelectHtml(q)}
    <div class="b-field"><label>${q.type === 'AR' ? 'Instructions (optional)' : 'Question Text'}</label><textarea rows="2" oninput="updateQuestionField('${q.id}','question',this.value)">${escHtml(q.question)}</textarea></div>
    ${arHtml}
    <div class="b-field"><label><input type="checkbox" ${q.latex ? 'checked' : ''} onchange="updateQuestionField('${q.id}','latex',this.checked)" style="width:auto;margin-right:6px"> Enable LaTeX</label></div>
    <div class="b-field">
      <label>Question Image (optional)</label>
      <input type="text" id="qimg-url-${q.id}" value="${escAttr(q.image || '')}" oninput="updateQuestionField('${q.id}','image',this.value)" placeholder="/data/imagepdf/qimg1.jpeg or paste a URL">
      <div class="b-upload-row">
        <input type="file" accept="image/*" onchange="handleQuestionImageUpload('${q.id}',this)">
        ${q.image ? `<img src="${escAttr(q.image)}" class="b-thumb" style="max-width:160px;max-height:110px;border-radius:8px;border:1px solid #e5e7eb;object-fit:cover" onerror="this.style.display='none'"><button class="b-icon-btn danger b-btn-sm" onclick="clearQuestionImage('${q.id}')">Remove image</button>` : ''}
      </div>
      ${q.image ? `<div class="b-field" style="margin-top:8px"><label>Image position</label><select onchange="updateQuestionField('${q.id}','imagePosition',this.value)">
        <option value="above" ${(q.imagePosition || 'above') === 'above' ? 'selected' : ''}>Above the question text</option>
        <option value="below" ${q.imagePosition === 'below' ? 'selected' : ''}>Below the question text</option>
      </select></div>` : ''}
    </div>
    ${q.type !== 'NAT' ? `<div class="b-field"><label>Options ${(q.type === 'MCQ' || q.type === 'AR') ? '(select the one correct radio)' : '(check all correct boxes)'}</label>${optsHtml}<button class="b-btn b-btn-outline b-btn-sm" onclick="addOption('${q.id}')">+ Add Option</button></div>` : natHtml}
    ${explanationFieldsHtml(q)}`;
}

function renderMatchQuestionEditor(q, container) {
  q.pairs = q.pairs || [];
  const rows = q.pairs.map((p, i) => `
    <div class="b-list-item" style="display:flex;gap:8px;align-items:center">
      <span style="width:20px;color:#9ca3af;font-size:11px;font-weight:700">${i + 1}</span>
      <input type="text" style="flex:1" value="${escAttr(p.left)}" oninput="updateMatchPair('${q.id}',${i},'left',this.value)" placeholder="Column A item">
      <span style="color:#9ca3af">↔</span>
      <input type="text" style="flex:1" value="${escAttr(p.right)}" oninput="updateMatchPair('${q.id}',${i},'right',this.value)" placeholder="Column B item">
      <button class="b-icon-btn danger" onclick="removeMatchPair('${q.id}',${i})">✕</button>
    </div>`).join('');

  container.innerHTML = `
    ${caseSelectHtml(q)}
    <div class="b-field"><label>Instructions (optional)</label><textarea rows="2" oninput="updateQuestionField('${q.id}','question',this.value)" placeholder="e.g. Match the Accounting Standards with their subject matter">${escHtml(q.question)}</textarea></div>
    <div class="b-field"><label><input type="checkbox" ${q.latex ? 'checked' : ''} onchange="updateQuestionField('${q.id}','latex',this.checked)" style="width:auto;margin-right:6px"> Enable LaTeX</label></div>
    <div class="b-field-row">
      <div class="b-field"><label>Column A Title</label><input type="text" value="${escAttr(q.columnATitle || 'Column A')}" oninput="updateQuestionField('${q.id}','columnATitle',this.value)"></div>
      <div class="b-field"><label>Column B Title</label><input type="text" value="${escAttr(q.columnBTitle || 'Column B')}" oninput="updateQuestionField('${q.id}','columnBTitle',this.value)"></div>
    </div>
    <div class="b-field"><label>Pairs (each row is one correct match)</label>${rows}<button class="b-btn b-btn-outline b-btn-sm" onclick="addMatchPair('${q.id}')">+ Add Pair</button></div>
    ${explanationFieldsHtml(q)}`;
}
function updateMatchPair(qid, i, side, val) { const q = findQuestion(qid); if (!q) return; q.pairs[i][side] = val; markDirty(); }
function addMatchPair(qid) {
  const q = findQuestion(qid); if (!q) return;
  q.pairs = q.pairs || []; q.pairs.push({ left: '', right: '' });
  renderQuestionEditor(q, document.getElementById(`qbody-${qid}`)); markDirty();
}
function removeMatchPair(qid, i) {
  const q = findQuestion(qid); if (!q) return;
  q.pairs.splice(i, 1);
  renderQuestionEditor(q, document.getElementById(`qbody-${qid}`)); markDirty();
}

function updateQuestionField(qid, field, val) {
  const q = findQuestion(qid); if (!q) return;
  q[field] = val;
  if (field === 'question' || field === 'assertion') renderQuestionsList(getActiveChapterObj());
  markDirty();
}
function updateNatField(qid, field, val) { const q = findQuestion(qid); if (!q) return; q[field] = isNaN(val) ? 0 : val; markDirty(); }
function updateOptionText(qid, idx, val) { const q = findQuestion(qid); if (!q) return; q.options[idx] = val; markDirty(); }
function toggleOptionCorrect(qid, idx, checked) {
  const q = findQuestion(qid); if (!q) return;
  if (q.type === 'MCQ' || q.type === 'AR') q.answer = checked ? [idx] : [];
  else { q.answer = q.answer || []; if (checked) { if (!q.answer.includes(idx)) q.answer.push(idx); } else q.answer = q.answer.filter(a => a !== idx); }
  markDirty();
}
function addOption(qid) {
  const q = findQuestion(qid); if (!q) return;
  if (q.options.length >= 6) { alert('Maximum 6 options.'); return; }
  q.options.push(''); q.optionImages = q.optionImages || []; q.optionImages.push('');
  renderQuestionEditor(q, document.getElementById(`qbody-${qid}`)); markDirty();
}
function removeOption(qid, idx) {
  const q = findQuestion(qid); if (!q) return;
  q.options.splice(idx, 1); if (q.optionImages) q.optionImages.splice(idx, 1);
  q.answer = (q.answer || []).filter(a => a !== idx).map(a => a > idx ? a - 1 : a);
  renderQuestionEditor(q, document.getElementById(`qbody-${qid}`)); markDirty();
}

// ── Question / option / explanation image uploads (base64-embedded, same pattern as concept-block images) ──
async function handleQuestionImageUpload(qid, inputEl) {
  const file = inputEl.files[0]; if (!file) return;
  const q = findQuestion(qid); if (!q) return;
  try {
    const dataUrl = await fileToBase64(file);
    q.image = dataUrl;
    renderQuestionEditor(q, document.getElementById(`qbody-${qid}`));
    markDirty();
  } catch { alert('Could not read that image file.'); }
}
function clearQuestionImage(qid) {
  const q = findQuestion(qid); if (!q) return;
  q.image = '';
  renderQuestionEditor(q, document.getElementById(`qbody-${qid}`));
  markDirty();
}
async function handleOptionImageUpload(qid, idx, inputEl) {
  const file = inputEl.files[0]; if (!file) return;
  const q = findQuestion(qid); if (!q) return;
  try {
    const dataUrl = await fileToBase64(file);
    q.optionImages = q.optionImages || (q.options || []).map(() => '');
    q.optionImages[idx] = dataUrl;
    renderQuestionEditor(q, document.getElementById(`qbody-${qid}`));
    markDirty();
  } catch { alert('Could not read that image file.'); }
}
function clearOptionImage(qid, idx) {
  const q = findQuestion(qid); if (!q || !q.optionImages) return;
  q.optionImages[idx] = '';
  renderQuestionEditor(q, document.getElementById(`qbody-${qid}`));
  markDirty();
}
async function handleExplanationImageUpload(qid, inputEl) {
  const file = inputEl.files[0]; if (!file) return;
  const q = findQuestion(qid); if (!q) return;
  try {
    const dataUrl = await fileToBase64(file);
    q.explanationImage = dataUrl;
    renderQuestionEditor(q, document.getElementById(`qbody-${qid}`));
    markDirty();
  } catch { alert('Could not read that image file.'); }
}
function clearExplanationImage(qid) {
  const q = findQuestion(qid); if (!q) return;
  q.explanationImage = '';
  renderQuestionEditor(q, document.getElementById(`qbody-${qid}`));
  markDirty();
}

// ── Save / Export ──
async function saveSubjectContent() {
  if (!builder.activeData) return;
  if (!Auth.canEditSubject(builder.session, builder.activeData.code)) {
    setBuilderStatus('⚠ You do not have edit access to this subject', 'error');
    return;
  }
  const btn = document.getElementById('btn-save-subject');
  btn.disabled = true;
  setBuilderStatus('Saving…', '');
  try {
    // api/content.js expects `subjectTitle` at the top level (saved to the
    // subject_title column) and `requesterId` so editor saves pass the
    // can_edit mapping check — both were missing before this fix.
    const requesterId = builder.session?.user?.id ?? builder.session?.id ?? null;
    const res = await Api.post('/api/content', {
      code: builder.activeData.code,
      subject: builder.activeData.subject,
      subjectTitle: builder.activeData.subjectTitle || '',
      color: builder.activeData.color,
      data: builder.activeData,
      requesterId,
    });
    if (res && res.success) { builder.dirty = false; setBuilderStatus('✓ Saved to database', 'success'); }
    else setBuilderStatus('⚠ ' + (res?.error || 'Save failed'), 'error');
  } catch { setBuilderStatus('⚠ Network error while saving', 'error'); }
  btn.disabled = false;
}
function downloadSubjectJson() {
  if (!builder.activeData) return;
  const blob = new Blob([JSON.stringify(builder.activeData, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `${(builder.activeData.code || 'subject').toLowerCase()}.json`; a.click();
}

window.addEventListener('beforeunload', (e) => { if (builder.dirty) { e.preventDefault(); e.returnValue = ''; } });

// ── New Subject modal ──
// Subject Name is picked from a fixed dropdown; the Subject Code is always
// auto-generated per subject name (AC0001, AC0002, ...) — no duplicate-name
// check is needed since the code is the real unique key, so the same
// subject name can be picked again and just gets the next code.
function openNewSubjectPrompt() {
  document.getElementById('ns-name').value = '';
  document.getElementById('ns-subtopic').value = '';
  document.getElementById('ns-code').value = '';
  document.getElementById('ns-color').value = '#9333EA';
  document.getElementById('ns-err').textContent = '';
  document.getElementById('subject-modal-overlay').classList.add('open');
}
function closeNewSubjectModal() {
  document.getElementById('subject-modal-overlay').classList.remove('open');
}
function updateCodePreview() {
  const name = document.getElementById('ns-name').value;
  document.getElementById('ns-code').value = name ? suggestSubjectCode(name) : '';
}
// Suggests "PH0001"-style codes: first 2 letters of the name (uppercase),
// then the next free 4-digit number among subjects sharing that prefix.
// NOTE: computed client-side from whatever subjects are currently loaded —
// two admins creating a subject with the same name at the exact same
// moment could in theory get the same code. If that's a real risk for your
// team size, this generation should move server-side into api/content.js.
function suggestSubjectCode(name) {
  const letters = (name || '').replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 2) || 'SB';
  let n = 1, code;
  const existing = new Set(builder.subjects.map(s => s.code));
  do {
    code = letters + String(n).padStart(4, '0');
    n++;
  } while (existing.has(code));
  return code;
}

function submitNewSubject() {
  const name = document.getElementById('ns-name').value.trim();
  const subtopic = document.getElementById('ns-subtopic').value.trim();
  const color = document.getElementById('ns-color').value || '#9333EA';
  const errEl = document.getElementById('ns-err');
  errEl.textContent = '';

  if (!name) { errEl.textContent = 'Please select a Subject Name.'; return; }
  if (!subtopic) { errEl.textContent = 'Subject Topic Name is required.'; return; }

  const code = suggestSubjectCode(name);
  const newSubject = { code, subject: name, subject_title: subtopic, color };
  builder.subjects.push(newSubject);
  builder.activeCode = code;
  builder.activeData = { subject: name, code, color, subjectTitle: subtopic, units: [] };
  builder.activeUnitId = null; builder.activeChapterId = null; builder.openBodyIndex = null;

  renderSubjectPills();
  document.getElementById('builder-tree-subject-label').textContent = `${name} — Units & Chapters`;
  document.getElementById('btn-save-subject').disabled = false;
  document.getElementById('builder-lock-note').textContent = '';
  renderTopicInfo(newSubject);
  renderBuilderTree();
  renderBuilderEditor();
  markDirty();
  setBuilderStatus(`New subject "${code}" created — add a unit, then Save.`, '');
  closeNewSubjectModal();
}

// ── Live Preview / Raw JSON modal ──
function pvBodyItemHtml(item) {
  const esc = escHtml;
  switch (item.type) {
    case 'heading': return `<div style="font-size:16px;font-weight:800;color:#4f46e5;margin:18px 0 8px">${esc(item.text || '')}</div>`;
    case 'paragraph': return `<div style="font-size:13.5px;line-height:1.7;color:#374151;margin-bottom:10px">${esc(item.text || '')}</div>`;
    case 'note': return `<div style="background:#faf5ff;border-left:3px solid #7c3aed;padding:10px 14px;border-radius:8px;font-size:12.5px;color:#6b21a8;margin-bottom:12px">💡 ${esc(item.text || '')}</div>`;
    case 'formula': return `<div style="background:#1e1e2e;color:#cdd6f4;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:12px;text-align:center">${esc(item.text || '')}</div>`;
    case 'syntax': return `<div style="background:#1e1e2e;color:#a6e3a1;font-family:monospace;padding:12px 14px;border-radius:8px;font-size:12px;white-space:pre-wrap;margin-bottom:12px">${esc(item.code || '')}</div>`;
    case 'list': return `<ul style="margin:0 0 12px 20px;font-size:13px;color:#374151;line-height:1.8">${(item.items || []).map(li => `<li>${esc(li)}</li>`).join('')}</ul>`;
    case 'summary': return `<div style="background:#f0fdfa;border:1.5px solid #99f6e4;border-radius:10px;padding:12px 16px;margin-bottom:12px"><div style="font-size:11px;font-weight:800;color:#0d9488;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">📌 Summary</div><ul style="margin:0 0 0 18px;font-size:13px;color:#374151;line-height:1.8">${(item.items || []).map(li => `<li>${esc(li)}</li>`).join('')}</ul></div>`;
    case 'table': {
      const headers = item.headers || [], rows = item.rows || [];
      let h = `<div style="overflow-x:auto;margin-bottom:12px"><table style="width:100%;border-collapse:collapse;font-size:12.5px"><tr>${headers.map(x => `<th style="border:1px solid #e5e7eb;padding:6px 10px;background:#f9fafb">${esc(x)}</th>`).join('')}</tr>`;
      rows.forEach(r => { h += `<tr>${headers.map((_, ci) => `<td style="border:1px solid #e5e7eb;padding:6px 10px">${esc(r[ci] || '')}</td>`).join('')}</tr>`; });
      return h + '</table></div>';
    }
    case 'image': {
      let h = '';
      if (item.image) h += `<div style="margin-bottom:12px"><img src="${escAttr(item.image)}" style="max-width:100%;border-radius:8px;border:1px solid #e5e7eb" onerror="this.parentElement.innerHTML='⚠️ Image failed to load'"></div>`;
      if (item.pdf) h += `<a href="${escAttr(item.pdf)}" target="_blank" style="display:inline-block;padding:8px 14px;border-radius:8px;background:#f3f4f6;color:#374151;font-size:12px;text-decoration:none;margin-bottom:12px">📄 ${esc(item.title || 'View PDF')}</a>`;
      return h;
    }
    case 'video': {
      const m = (item.url || '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
      if (!m) return item.url ? `<a href="${escAttr(item.url)}" target="_blank" style="display:inline-block;margin-bottom:12px">▶ ${esc(item.title || 'Watch video')}</a>` : '';
      return `<div style="position:relative;width:100%;padding-top:56.25%;border-radius:10px;overflow:hidden;margin-bottom:12px"><iframe src="https://www.youtube.com/embed/${m[1]}?rel=0" style="position:absolute;inset:0;width:100%;height:100%;border:none" allowfullscreen></iframe></div>`;
    }
    case 'exercise': return `<div style="border-radius:10px;border:1.5px solid #fde68a;background:#fffbeb;margin-bottom:12px;padding:12px 14px"><strong style="color:#92400e;font-size:12px">✏️ ${esc(item.title || 'Practice')}</strong><ol style="margin:8px 0 0 18px">${(item.steps || []).map(s => `<li style="margin-bottom:4px;font-size:13px">${esc(s)}</li>`).join('')}</ol></div>`;
    case 'example': return `<div style="border-radius:10px;border:1.5px solid #bae6fd;background:#f0f9ff;margin-bottom:12px;padding:12px 14px">
      ${item.title ? `<strong style="color:#0369a1;font-size:13px">${esc(item.title)}</strong>` : ''}
      ${item.before ? `<div style="font-size:12.5px;margin-top:6px"><strong>Input:</strong> ${esc(item.before)}</div>` : ''}
      ${(item.steps || []).length ? `<ol style="margin:8px 0 0 18px">${(item.steps || []).map(s => `<li style="margin-bottom:4px;font-size:12.5px">${esc(s)}</li>`).join('')}</ol>` : ''}
      ${item.formula ? `<div style="background:#1e1e2e;color:#a6e3a1;font-family:monospace;padding:8px 10px;border-radius:6px;font-size:12px;margin-top:8px">${esc(item.formula)}</div>` : ''}
      ${item.after ? `<div style="font-size:12.5px;margin-top:8px"><strong>Result:</strong> ${esc(item.after)}</div>` : ''}
    </div>`;
    case 'steps': return `<div style="margin-bottom:12px">${item.title ? `<div style="font-weight:700;margin-bottom:6px;font-size:13.5px">${esc(item.title)}</div>` : ''}<ol style="margin:0 0 0 18px">${(item.steps || []).map(s => `<li style="margin-bottom:4px;font-size:13px">${esc(s)}</li>`).join('')}</ol></div>`;
    default: return '';
  }
}
function pvCaseCard(caseObj) {
  if (!caseObj) return '';
  return `<div style="border:1.5px solid #ddd6fe;background:#f5f3ff;border-radius:12px;padding:14px 16px;margin:14px 0 10px">
    ${caseObj.title ? `<div style="font-weight:800;color:#5b21b6;font-size:13px;margin-bottom:6px">📋 ${escHtml(caseObj.title)}</div>` : ''}
    ${caseObj.image ? `<img src="${escAttr(caseObj.image)}" style="max-width:100%;border-radius:8px;margin-bottom:8px" onerror="this.style.display='none'">` : ''}
    <div style="font-size:13px;color:#4c1d95;white-space:pre-wrap;line-height:1.7">${escHtml(caseObj.passage || '')}</div>
  </div>`;
}
function renderChapterPreviewHtml(chapter) {
  const concept = normalizeConcept(chapter.concept, chapter.title);
  let html = `<div style="font-size:18px;font-weight:800;margin-bottom:14px">${escHtml(concept.title)}</div>`;
  (concept.body || []).forEach(item => { html += pvBodyItemHtml(item); });
  if (!(concept.body || []).length) html += '<div style="color:#9ca3af;font-size:13px">No concept content yet.</div>';

  const formulas = concept.formulas || [];
  if (formulas.length) {
    html += `<div style="margin-top:16px;padding:16px 18px;border-radius:12px;background:#f9fafb;border:1px solid #f0f0f0">
      <div style="font-size:11.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#9ca3af;margin-bottom:10px">Key Formulas</div>
      ${formulas.map(f => `<span style="display:inline-block;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:8px 14px;margin:0 7px 7px 0;font-size:14.5px;color:#1f2937">${escHtml(f)}</span>`).join('')}
    </div>`;
  }

  const pg = chapter.playground;
  if (pg && (pg.schema || (pg.sampleQueries || []).length)) {
    html += `<div style="margin-top:16px;padding:14px;border-radius:10px;border:1.5px solid #99f6e4;background:#f0fdfa"><strong style="color:#0f766e;font-size:12.5px">🛢️ SQL Playground</strong>`;
    if (pg.schema) html += `<pre style="margin-top:8px;background:#1e1e2e;color:#a6e3a1;padding:10px;border-radius:8px;font-size:11.5px;overflow-x:auto">${escHtml(pg.schema)}</pre>`;
    html += '</div>';
  }

  const questions = chapter.questions || [];
  if (questions.length) {
    html += `<div style="font-size:15px;font-weight:800;margin:18px 0 8px">Practice Questions (${questions.length})</div>`;
    let lastCaseId = null;
    questions.forEach((q, qi) => {
      if (q.caseId && q.caseId !== lastCaseId) {
        const c = (chapter.cases || []).find(x => x.id === q.caseId);
        if (c) html += pvCaseCard(c);
      }
      lastCaseId = q.caseId || null;

      const qImgHtml = q.image ? `<img src="${escAttr(q.image)}" style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid #e5e7eb;display:block;margin:8px 0;object-fit:contain" onerror="this.style.display='none'">` : '';
      const qImgAbove = (q.imagePosition || 'above') === 'above';
      html += `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin-bottom:10px"><div style="font-size:11px;color:#9ca3af;margin-bottom:6px">Q${qi + 1} · ${q.type}</div>${qImgAbove ? qImgHtml : ''}`;

      if (q.type === 'AR') {
        html += `<div style="font-size:12.5px;margin-bottom:4px"><strong>Assertion (A):</strong> ${escHtml(q.assertion || '')}</div>`;
        html += `<div style="font-size:12.5px;margin-bottom:8px"><strong>Reason (R):</strong> ${escHtml(q.reason || '')}</div>`;
      }
      if (q.question) html += `<div style="font-size:13.5px;margin-bottom:8px">${escHtml(q.question)}</div>`;
      html += qImgAbove ? '' : qImgHtml;

      if (q.type === 'NAT') {
        html += `<div style="font-size:12.5px;color:#16a34a">Answer: ${q.answer ?? 0}${q.tolerance ? ` (± ${q.tolerance})` : ''}</div>`;
      } else if (q.type === 'MATCH') {
        html += `<table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:12.5px">
          <tr><th style="text-align:left;padding:4px 6px;border-bottom:1px solid #e5e7eb">${escHtml(q.columnATitle || 'Column A')}</th><th style="text-align:left;padding:4px 6px;border-bottom:1px solid #e5e7eb">${escHtml(q.columnBTitle || 'Column B')}</th></tr>
          ${(q.pairs || []).map((p, pi) => `<tr><td style="padding:4px 6px;border-bottom:1px solid #f3f4f6">${pi + 1}. ${escHtml(p.left)}</td><td style="padding:4px 6px;border-bottom:1px solid #f3f4f6">${String.fromCharCode(65 + pi)}. ${escHtml(p.right)}</td></tr>`).join('')}
        </table>`;
      } else {
        (q.options || []).forEach((opt, oi) => {
          const isCorrect = (q.answer || []).includes(oi);
          const optImg = (q.optionImages || [])[oi];
          html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:7px;margin-bottom:4px;font-size:12.5px;${isCorrect ? 'background:#f0fdf4;color:#15803d;font-weight:600' : 'background:#f9fafb'}">${optImg ? `<img src="${escAttr(optImg)}" style="max-width:60px;max-height:40px;border-radius:5px;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'">` : ''}<span>${String.fromCharCode(65 + oi)}. ${escHtml(opt)}${isCorrect ? ' ✓' : ''}</span></div>`;
        });
      }

      const hasExplanation = q.explanation || q.explanationImage || q.explanationVideo || q.explanationLink;
      if (hasExplanation) {
        html += `<div style="font-size:12px;color:#6b7280;background:#f9fafb;border-radius:8px;padding:8px 10px;margin-top:8px">`;
        if (q.explanation) html += `💡 ${escHtml(q.explanation)}`;
        if (q.explanationImage) html += `<div style="margin-top:6px"><img src="${escAttr(q.explanationImage)}" style="max-width:100%;max-height:200px;border-radius:6px;object-fit:contain" onerror="this.style.display='none'"></div>`;
        if (q.explanationVideo) {
          const m = (q.explanationVideo || '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
          html += m
            ? `<div style="position:relative;width:100%;padding-top:56.25%;border-radius:8px;overflow:hidden;margin-top:6px"><iframe src="https://www.youtube.com/embed/${m[1]}?rel=0" style="position:absolute;inset:0;width:100%;height:100%;border:none" allowfullscreen></iframe></div>`
            : `<div style="margin-top:6px"><a href="${escAttr(q.explanationVideo)}" target="_blank">▶ Watch video</a></div>`;
        }
        if (q.explanationLink) html += `<div style="margin-top:6px"><a href="${escAttr(q.explanationLink)}" target="_blank">🔗 ${escHtml(q.explanationLink)}</a></div>`;
        html += `</div>`;
      }
      html += '</div>';
    });
  }
  return html;
}
function jsonForDisplay(value) {
  if (Array.isArray(value)) return value.map(jsonForDisplay);
  if (value && typeof value === 'object') { const out = {}; for (const k in value) out[k] = jsonForDisplay(value[k]); return out; }
  if (typeof value === 'string' && value.startsWith('data:')) return `[uploaded file — ${value.length.toLocaleString()} chars, hidden from preview]`;
  return value;
}
function showJsonPreview() {
  if (!builder.activeData) { alert('Select or create a subject first.'); return; }
  document.getElementById('json-modal-title').textContent = `${builder.activeData.subject} (${builder.activeData.code})`;
  document.getElementById('json-modal-content').textContent = JSON.stringify(jsonForDisplay(builder.activeData), null, 2);

  const chapter = getActiveChapterObj();
  document.getElementById('pv-pane-preview').innerHTML = chapter
    ? `<div class="pv-app">${renderChapterPreviewHtml(chapter)}</div>`
    : '<div class="editor-empty"><div class="big">👈</div><p style="font-size:12px">Select a chapter on the left to preview it here</p></div>';

  switchPvTab('preview');
  document.getElementById('json-modal-overlay').classList.add('open');

  if (chapter && window.renderMathInElement) {
    try {
      renderMathInElement(document.getElementById('pv-pane-preview'), {
        delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
        throwOnError: false,
      });
    } catch (e) {}
  }
}
function switchPvTab(tab) {
  document.getElementById('pv-tab-preview').classList.toggle('active', tab === 'preview');
  document.getElementById('pv-tab-json').classList.toggle('active', tab === 'json');
  document.getElementById('pv-pane-preview').classList.toggle('active', tab === 'preview');
  document.getElementById('pv-pane-json').classList.toggle('active', tab === 'json');
}
function closeJsonPreview() { document.getElementById('json-modal-overlay').classList.remove('open'); }
function copyJsonPreview() {
  const text = document.getElementById('json-modal-content').textContent;
  navigator.clipboard.writeText(text).then(() => setBuilderStatus('✓ Copied JSON to clipboard', 'success'))
    .catch(() => alert('Could not copy automatically — please select and copy manually.'));
}

// ── Find Chapter search — maps a chapter id / title back to its subject +
// unit, across every subject the current user can see. Fetches each
// subject's full JSON once (lazily, on first search) and caches it, so
// typing further just filters in memory. ──
let chapterSearchDebounce = null;
function onChapterSearchInput(val) {
  clearTimeout(chapterSearchDebounce);
  chapterSearchDebounce = setTimeout(() => runChapterSearch(val.trim()), 250);
}

async function runChapterSearch(query) {
  const resultsEl = document.getElementById('chapter-search-results');
  if (!query) { resultsEl.innerHTML = ''; return; }
  resultsEl.innerHTML = '<div class="b-field-hint">Searching…</div>';

  builder.searchCache = builder.searchCache || {};
  const toFetch = builder.subjects.filter(s => !builder.searchCache[s.code]);
  if (toFetch.length) {
    await Promise.all(toFetch.map(async (s) => {
      const res = await Api.get('/api/content', { code: s.code });
      builder.searchCache[s.code] = res.data || { units: [] };
    }));
  }

  const q = query.toLowerCase();
  const matches = [];
  builder.subjects.forEach(s => {
    const data = builder.searchCache[s.code] || { units: [] };
    (data.units || []).forEach(unit => {
      (unit.chapters || []).forEach(ch => {
        if ((ch.title || '').toLowerCase().includes(q) || (ch.id || '').toLowerCase().includes(q)) {
          matches.push({
            code: s.code, subjectName: s.subject,
            unitId: unit.id, chapterId: ch.id, chapterTitle: ch.title,
            qCount: (ch.questions || []).length,
          });
        }
      });
    });
  });

  if (!matches.length) { resultsEl.innerHTML = '<div class="b-field-hint">No chapters matched.</div>'; return; }

  resultsEl.innerHTML = matches.slice(0, 30).map(m => `
    <div class="search-result-row" onclick="jumpToSearchResult('${m.code}','${m.unitId}','${m.chapterId}')">
      <span class="badge badge-blue">${escHtml(m.code)}</span>
      <span class="search-result-title">${escHtml(m.chapterTitle)} <span class="search-result-subject">— ${escHtml(m.subjectName)}</span></span>
      <span class="search-result-id">${escHtml(m.chapterId)}</span>
    </div>`).join('');
}

async function jumpToSearchResult(code, unitId, chapterId) {
  document.getElementById('chapter-search-results').innerHTML = '<div class="b-field-hint">Opening…</div>';
  await loadSubjectIntoBuilder(code);
  selectChapterInBuilder(unitId, chapterId);
  document.getElementById('chapter-search-input').value = '';
  document.getElementById('chapter-search-results').innerHTML = '';
}

// ── Import from JSON (for people authoring offline in their own editor) ──
// Accepted shapes, in order of preference:
//   1) A full subject:      { code, subject, color, units: [...] }
//   2) Units to append:     { units: [...] }
//   3) A bare array of units: [ { title, chapters: [...] }, ... ]
//   4) A single chapter:    { title, concept, questions, playground }
// IDs are always regenerated on import (including case IDs, which are
// remapped and re-linked to their questions' caseId) so two people's
// offline files never collide when merged in. Nothing touches the database
// until you press "Save Subject to Database" afterwards — import only
// edits the in-memory copy, same as every other change in this editor.
function openImportJson() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      handleImportedJson(json);
    } catch (err) {
      alert('Could not read that file — make sure it is valid JSON.\n\n' + err.message);
    }
  };
  input.click();
}

function normalizeImportedUnits(rawUnits) {
  return (rawUnits || []).map(u => ({
    id: uid('u'),
    title: u.title || 'Untitled Unit',
    chapters: (u.chapters || []).map(c => {
      const caseIdMap = {};
      const newCases = (c.cases || []).map(cs => {
        const newId = uid('case');
        if (cs.id) caseIdMap[cs.id] = newId;
        return { ...cs, id: newId };
      });
      return {
        id: uid('c'),
        title: c.title || 'Untitled Chapter',
        concept: normalizeConcept(c.concept, c.title),
        cases: newCases,
        questions: (c.questions || []).map(q => ({
          latex: false, options: [], optionImages: [], answer: [],
          explanation: '', explanationImage: '', explanationVideo: '', explanationLink: '', caseId: '',
          ...q,
          id: uid('q'),
          caseId: q.caseId && caseIdMap[q.caseId] ? caseIdMap[q.caseId] : '',
        })),
        playground: { schema: '', sampleQueries: [], ...(c.playground || {}) },
      };
    }),
  }));
}

function handleImportedJson(json) {
  let units = null, asNewSubject = null;

  if (Array.isArray(json)) {
    units = json;
  } else if (json.units && Array.isArray(json.units)) {
    units = json.units;
    if (json.code && json.subject) asNewSubject = json;
  } else if (json.title && (json.concept || json.questions)) {
    units = [{ title: 'Imported', chapters: [json] }];
  } else {
    alert('Unrecognized JSON shape.\n\nExpected one of:\n• { code, subject, units:[...] } — a full new subject\n• { units:[...] } — units to append\n• a single chapter object\n\nDownload the template for a working example.');
    return;
  }

  const totalChapters = units.reduce((n, u) => n + (u.chapters || []).length, 0);
  const totalQuestions = units.reduce((n, u) => n + (u.chapters || []).reduce((m, c) => m + (c.questions || []).length, 0), 0);

  if (asNewSubject) {
    const makeNew = confirm(
      `This file looks like a full subject: "${asNewSubject.subject}" (${asNewSubject.code.toUpperCase()}) — ` +
      `${units.length} unit(s), ${totalChapters} chapter(s), ${totalQuestions} question(s).\n\n` +
      `OK = create it as a NEW subject\nCancel = append its content into the CURRENTLY SELECTED subject instead`
    );
    if (makeNew) { createSubjectFromImport(asNewSubject, units); return; }
  } else {
    if (!builder.activeData) { alert('Select or create a subject first, or upload a file that includes "code" and "subject".'); return; }
    if (!confirm(`Import ${units.length} unit(s), ${totalChapters} chapter(s), ${totalQuestions} question(s) into "${builder.activeData.subject}"?`)) return;
  }

  appendUnitsToActiveSubject(units);
}

function createSubjectFromImport(meta, units) {
  const code = (meta.code || '').trim().toUpperCase();
  if (!code) { alert('The file is missing a subject "code".'); return; }
  const existing = builder.subjects.find(s => s.code === code);
  if (existing) {
    if (!confirm(`A subject with code "${code}" already exists ("${existing.subject}"). Load it and append this content instead?`)) return;
    loadSubjectIntoBuilder(code).then(() => appendUnitsToActiveSubject(units));
    return;
  }
  builder.subjects.push({ code, subject: meta.subject, subject_title: meta.subject_title || '', color: meta.color || '#6C3FF5' });
  builder.activeCode = code;
  builder.activeData = { subject: meta.subject, code, color: meta.color || '#6C3FF5', subjectTitle: meta.subject_title || '', units: [] };
  builder.activeUnitId = null; builder.activeChapterId = null; builder.openBodyIndex = null;
  renderSubjectPills();
  document.getElementById('builder-tree-subject-label').textContent = `${meta.subject} — Units & Chapters`;
  document.getElementById('btn-save-subject').disabled = false;
  document.getElementById('builder-lock-note').textContent = '';
  renderTopicInfo({ subject_title: meta.subject_title || '' });
  appendUnitsToActiveSubject(units);
}

function appendUnitsToActiveSubject(rawUnits) {
  const normalized = normalizeImportedUnits(rawUnits);
  const container = getUnitsContainer();
  if (!container) { alert('Select or add a subject first.'); return; }
  container.units = container.units || [];
  container.units.push(...normalized);
  renderBuilderTree();
  renderBuilderEditor();
  markDirty();
  setBuilderStatus(`✓ Imported ${normalized.length} unit(s) — review, then Save.`, 'success');
}

// A ready-to-fill example matching the exact shape the builder expects, so
// someone can write content in their own editor/spreadsheet-to-JSON tool
// offline and just upload it here when done.
function downloadTemplateJson() {
  const template = {
    code: 'NEW',
    subject: 'New Subject Name',
    subject_title: 'Example Topic Title',
    color: '#6C3FF5',
    units: [
      {
        title: 'Unit 1: Example Unit',
        chapters: [
          {
            title: 'Chapter 1: Example Chapter',
            concept: {
              title: 'Chapter 1: Example Chapter',
              latex: true,
              body: [
                { type: 'heading', text: 'Introduction' },
                { type: 'paragraph', text: 'Write your explanation here. Use $x^2$ for inline math, $$x^2$$ for display math.' },
                { type: 'note', text: 'Optional callout / tip shown in a highlighted box.' },
                { type: 'list', items: ['First point', 'Second point'] },
              ],
              // Key Formulas — shown as a row of chips at the end of the
              // concept, separate from the body blocks above. LaTeX works
              // here too when concept.latex is true.
              formulas: [
                'Dimensional formula: $[M^a L^b T^c]$',
                'Absolute error $\\Delta a = |a_{measured} - a_{true}|$',
                'Relative error $= \\Delta a/a$, Percentage error $= (\\Delta a/a) \\times 100$',
              ],
            },
            // Optional shared passages — assign a question to one via its
            // "caseId" field to group them together on the learner page.
            cases: [
              { id: 'case_example', title: 'Case Study 1', passage: 'Read the following scenario and answer the questions that follow: ...', image: '' },
            ],
            // Optional — only meaningful for interactive subjects like SQL,
            // but any subject can include it.
            playground: {
              schema: '',
              sampleQueries: [],
            },
            questions: [
              {
                type: 'MCQ', // MCQ | MSQ | NAT | AR | MATCH
                latex: false,
                question: 'Sample question text goes here?',
                options: ['Option A', 'Option B', 'Option C', 'Option D'],
                answer: [0], // index/indices of the correct option(s); MSQ can have more than one
                explanation: 'Why the correct answer is correct.',
                explanationImage: '', explanationVideo: '', explanationLink: '',
                caseId: '',
              },
              {
                type: 'AR',
                latex: false,
                question: 'Read Assertion (A) and Reason (R) and choose the correct option.',
                assertion: 'Depreciation is a non-cash expense.',
                reason: 'It represents the allocation of the cost of a fixed asset over its useful life.',
                options: [
                  'Both A and R are true and R is the correct explanation of A',
                  'Both A and R are true but R is not the correct explanation of A',
                  'A is true but R is false',
                  'A is false but R is true',
                ],
                answer: [0],
                explanation: 'R correctly explains why A is true.',
                caseId: '',
              },
              {
                type: 'MATCH',
                latex: false,
                question: 'Match the Accounting Standard with what it covers.',
                columnATitle: 'Accounting Standard',
                columnBTitle: 'Covers',
                pairs: [
                  { left: 'AS 1', right: 'Disclosure of Accounting Policies' },
                  { left: 'AS 2', right: 'Valuation of Inventories' },
                  { left: 'AS 6', right: 'Depreciation Accounting' },
                ],
                explanation: 'Standard AS numbering as per ICAI.',
                caseId: 'case_example',
              },
            ],
          },
        ],
      },
    ],
  };
  const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'unic-topic-template.json';
  a.click();
}
