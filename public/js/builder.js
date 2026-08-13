// js/builder.js — ported from the original single-file admin panel, split
// out into its own module and extended with:
//   - subject list scoped to the logged-in editor's mapped subjects
//   - save button disabled (with a clear reason) when the editor lacks
//     can_edit on the active subject — the server enforces this too
//   - a new "SQL Playground" section per chapter: { schema, sampleQueries }
//     matching the shape you already use in your JSON, e.g.:
//       "playground": { "schema": "CREATE TABLE ...", "sampleQueries": [...] }
const QTYPE_COLORS = { MCQ: '#6C3FF5', MSQ: '#0891b2', NAT: '#d97706' };
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
  activeVariantId: null, // for subjects with multiple named variants (e.g. "Class 6 — by Muthu" vs "by Karthi")
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

function renderSubjectPills() {
  const row = document.getElementById('builder-subject-pills');
  row.innerHTML = '';
  builder.subjects.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'subj-pill' + (s.code === builder.activeCode ? ' active' : '');
    btn.textContent = `${s.subject} (${s.code})`;
    if (s.code === builder.activeCode) { btn.style.background = s.color; btn.style.borderColor = 'transparent'; }
    btn.onclick = () => loadSubjectIntoBuilder(s.code);
    row.appendChild(btn);
  });
}

async function loadSubjectIntoBuilder(code) {
  builder.activeCode = code;
  builder.activeVariantId = null;
  builder.activeUnitId = null;
  builder.activeChapterId = null;
  builder.openBodyIndex = null;
  renderSubjectPills();

  document.getElementById('builder-tree').innerHTML = '<div class="editor-empty"><div class="big">⏳</div><p style="font-size:12px">Loading…</p></div>';
  document.getElementById('builder-editor').innerHTML = '<div class="editor-empty"><div class="big">👈</div><p style="font-size:12px">Select a chapter to edit</p></div>';

  const res = await Api.get('/api/content', { code });
  const meta = builder.subjects.find(s => s.code === code) || { subject: code, code, color: '#6C3FF5' };
  builder.activeData = res.data || { subject: meta.subject, code: meta.code, color: meta.color, units: [] };

  document.getElementById('builder-tree-subject-label').textContent = `${builder.activeData.subject} — Units & Chapters`;

  const canEdit = Auth.canEditSubject(builder.session, code);
  document.getElementById('btn-save-subject').disabled = !canEdit;
  document.getElementById('builder-lock-note').textContent = canEdit ? '' : '👁 View only — you are not permitted to edit this subject.';

  if (isVariantMode() && builder.activeData.categories.length) {
    builder.activeVariantId = builder.activeData.categories[0].id;
  }

  renderVariantPills();
  renderBuilderTree();
  renderBuilderEditor();
}

// ── Variants — multiple named versions of the same subject, e.g. "Class 6
// Physics — Prepared by Muthu" vs "...by Karthi". Each variant has its own
// independent units/chapters, all stored in one subject_content.data blob
// as { ..., categories: [{id, title, subtitle, icon, units:[...]}, ...] }.
// This is the same "categories" shape the learner app (view.html) already
// knows how to browse — no frontend changes needed there.
function isVariantMode() {
  return Array.isArray(builder.activeData?.categories);
}
function getActiveVariant() {
  if (!isVariantMode()) return null;
  return builder.activeData.categories.find(c => c.id === builder.activeVariantId) || null;
}
// Returns the object whose `.units` array should be edited right now —
// either the whole subject (flat/simple mode) or the selected variant
// (variant mode). Returns null if in variant mode with nothing selected.
function getUnitsContainer() {
  if (!builder.activeData) return null;
  if (isVariantMode()) {
    const variant = getActiveVariant();
    if (!variant) return null;
    variant.units = variant.units || [];
    return variant;
  }
  builder.activeData.units = builder.activeData.units || [];
  return builder.activeData;
}

function renderVariantPills() {
  const wrap = document.getElementById('builder-variant-pills');
  if (!wrap) return;
  if (!builder.activeData) { wrap.innerHTML = ''; return; }

  if (!isVariantMode()) {
    const hasContent = (builder.activeData.units || []).length > 0;
    wrap.innerHTML = `<div style="padding:10px 16px 4px"><button class="b-btn b-btn-outline b-btn-sm" onclick="enableVariantMode()">+ Add another version of this subject (e.g. by a different teacher/class)</button>${hasContent ? `<div class="b-field-hint" style="margin-top:6px">Doing this moves your current units/chapters into a first named version — nothing is lost.</div>` : ''}</div>`;
    return;
  }

  let html = '<div class="subj-pill-row" style="padding:10px 16px 4px">';
  builder.activeData.categories.forEach(cat => {
    const active = cat.id === builder.activeVariantId;
    html += `<button class="subj-pill${active ? ' active' : ''}" style="${active ? `background:${builder.activeData.color};border-color:transparent` : ''}" onclick="selectVariant('${cat.id}')">${escHtml(cat.title)}</button>`;
  });
  html += `<button class="b-btn b-btn-outline b-btn-sm" onclick="addVariant()">+ Add Version</button>`;
  if (getActiveVariant()) {
    html += `<button class="b-btn b-btn-outline b-btn-sm" onclick="renameVariant()">✎ Rename</button>`;
    html += `<button class="b-btn b-btn-danger b-btn-sm" onclick="deleteVariant()">🗑 Delete Version</button>`;
  }
  html += '</div>';
  wrap.innerHTML = html;
}

function enableVariantMode() {
  if (!builder.activeData) return;
  const firstName = prompt('Name this first version (e.g. "Class 6 — Prepared by Muthu"):', builder.activeData.subject);
  if (!firstName || !firstName.trim()) return;
  const firstCategory = { id: uid('cat'), title: firstName.trim(), subtitle: '', icon: '📘', units: builder.activeData.units || [] };
  builder.activeData.categories = [firstCategory];
  delete builder.activeData.units;
  builder.activeVariantId = firstCategory.id;
  builder.activeUnitId = null; builder.activeChapterId = null;
  renderVariantPills(); renderBuilderTree(); renderBuilderEditor(); markDirty();
  setBuilderStatus('Enabled multiple versions — add another with "+ Add Version".', '');
}
function addVariant() {
  const title = prompt('Name for this version (e.g. "Class 6 — Prepared by Karthi"):');
  if (!title || !title.trim()) return;
  const cat = { id: uid('cat'), title: title.trim(), subtitle: '', icon: '📘', units: [] };
  builder.activeData.categories.push(cat);
  builder.activeVariantId = cat.id;
  builder.activeUnitId = null; builder.activeChapterId = null;
  renderVariantPills(); renderBuilderTree(); renderBuilderEditor(); markDirty();
}
function renameVariant() {
  const cat = getActiveVariant(); if (!cat) return;
  const title = prompt('Rename this version:', cat.title);
  if (!title || !title.trim()) return;
  cat.title = title.trim();
  renderVariantPills(); markDirty();
}
function deleteVariant() {
  const cat = getActiveVariant(); if (!cat) return;
  if (!confirm(`Delete "${cat.title}" and everything in it? This can't be undone.`)) return;
  builder.activeData.categories = builder.activeData.categories.filter(c => c.id !== cat.id);
  builder.activeVariantId = builder.activeData.categories[0]?.id || null;
  builder.activeUnitId = null; builder.activeChapterId = null;
  renderVariantPills(); renderBuilderTree(); renderBuilderEditor(); markDirty();
}
function selectVariant(id) {
  builder.activeVariantId = id;
  builder.activeUnitId = null; builder.activeChapterId = null; builder.openBodyIndex = null;
  renderVariantPills(); renderBuilderTree(); renderBuilderEditor();
}

// ── TREE ──
function renderBuilderTree() {
  const wrap = document.getElementById('builder-tree');
  const data = builder.activeData;
  if (!data) { wrap.innerHTML = '<div class="editor-empty"><div class="big">📚</div><p style="font-size:12px">Select a subject</p></div>'; return; }
  if (isVariantMode() && !getActiveVariant()) {
    wrap.innerHTML = '<div class="editor-empty"><div class="big">🗂️</div><p style="font-size:12px">Select or add a version above</p></div>';
    return;
  }
  const container = getUnitsContainer();

  let html = '';
  (container.units || []).forEach(unit => {
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
    concept: { title: title.trim(), latex: true, body: [] },
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
  const out = { title: concept.title || fallbackTitle || '', latex: concept.latex !== false, body: [] };
  (Array.isArray(concept.body) ? concept.body : []).forEach(b => {
    if (typeof b === 'string') out.body.push({ type: 'paragraph', text: b });
    else if (b && b.type) out.body.push(b);
  });
  (concept.formulas || []).forEach(f => { if (typeof f === 'string' && f.trim()) out.body.push({ type: 'formula', text: f }); });
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
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="b-btn b-btn-outline b-btn-sm" onclick="addQuestion('MCQ')">+ MCQ</button>
        <button class="b-btn b-btn-outline b-btn-sm" onclick="addQuestion('MSQ')">+ MSQ</button>
        <button class="b-btn b-btn-outline b-btn-sm" onclick="addQuestion('NAT')">+ NAT</button>
      </div>
    </div>`;

  renderBodyItemsList(concept);
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
  chapter.concept = chapter.concept || { title: '', latex: true, body: [] };
  chapter.concept[field] = val; markDirty();
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
  const q = type === 'NAT'
    ? { id: uid('q'), type: 'NAT', latex: false, question: '', image: '', answer: 0, tolerance: 0, unit: '', explanation: '' }
    : { id: uid('q'), type, latex: false, question: '', image: '', options: ['', '', '', ''], optionImages: ['', '', '', ''], answer: [], explanation: '' };
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
    const summary = q.question ? q.question.replace(/\$/g, '').slice(0, 60) : '(empty question)';
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

function renderQuestionEditor(q, container) {
  let optsHtml = '';
  if (q.type !== 'NAT') {
    q.optionImages = q.optionImages || (q.options || []).map(() => '');
    (q.options || []).forEach((opt, i) => {
      const checked = (q.answer || []).includes(i);
      const inputType = q.type === 'MCQ' ? 'radio' : 'checkbox';
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
  container.innerHTML = `
    <div class="b-field"><label>Question Text</label><textarea rows="2" oninput="updateQuestionField('${q.id}','question',this.value)">${escHtml(q.question)}</textarea></div>
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
    ${q.type !== 'NAT' ? `<div class="b-field"><label>Options ${q.type === 'MCQ' ? '(select the one correct radio)' : '(check all correct boxes)'}</label>${optsHtml}<button class="b-btn b-btn-outline b-btn-sm" onclick="addOption('${q.id}')">+ Add Option</button></div>` : natHtml}
    <div class="b-field"><label>Explanation</label><textarea rows="2" oninput="updateQuestionField('${q.id}','explanation',this.value)">${escHtml(q.explanation)}</textarea></div>`;
}
function updateQuestionField(qid, field, val) {
  const q = findQuestion(qid); if (!q) return;
  q[field] = val;
  if (field === 'question') renderQuestionsList(getActiveChapterObj());
  markDirty();
}
function updateNatField(qid, field, val) { const q = findQuestion(qid); if (!q) return; q[field] = isNaN(val) ? 0 : val; markDirty(); }
function updateOptionText(qid, idx, val) { const q = findQuestion(qid); if (!q) return; q.options[idx] = val; markDirty(); }
function toggleOptionCorrect(qid, idx, checked) {
  const q = findQuestion(qid); if (!q) return;
  if (q.type === 'MCQ') q.answer = checked ? [idx] : [];
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

// ── Question / option image uploads (base64-embedded, same pattern as concept-block images) ──
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
    const res = await Api.post('/api/content', {
      code: builder.activeData.code,
      subject: builder.activeData.subject,
      color: builder.activeData.color,
      data: builder.activeData,
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
let ns_codeEdited = false;
function openNewSubjectPrompt() {
  document.getElementById('ns-name').value = '';
  document.getElementById('ns-subtopic').value = '';
  document.getElementById('ns-code').value = '';
  document.getElementById('ns-color').value = '#9333EA';
  document.getElementById('ns-err').textContent = '';
  ns_codeEdited = false;
  document.getElementById('subject-modal-overlay').classList.add('open');
}
function closeNewSubjectModal() {
  document.getElementById('subject-modal-overlay').classList.remove('open');
}
// Suggests "PH0001"-style codes: first 2 letters of the name (uppercase),
// then the next free 4-digit number among subjects sharing that prefix.
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
function onNewSubjectNameInput() {
  if (ns_codeEdited) return; // don't clobber a code the admin already typed themselves
  document.getElementById('ns-code').value = suggestSubjectCode(document.getElementById('ns-name').value);
}
function submitNewSubject() {
  const name = document.getElementById('ns-name').value.trim();
  const subtopic = document.getElementById('ns-subtopic').value.trim();
  let code = document.getElementById('ns-code').value.trim().toUpperCase();
  const color = document.getElementById('ns-color').value || '#9333EA';
  const errEl = document.getElementById('ns-err');
  errEl.textContent = '';

  if (!name) { errEl.textContent = 'Subject name is required.'; return; }
  if (!code) code = suggestSubjectCode(name);
  if (builder.subjects.find(s => s.code === code)) { errEl.textContent = `A subject with code "${code}" already exists.`; return; }

  const newSubject = { code, subject: name, color };
  builder.subjects.push(newSubject);
  builder.activeCode = code;
  if (subtopic) {
    const firstCategory = { id: uid('cat'), title: subtopic, subtitle: '', icon: '📘', units: [] };
    builder.activeData = { subject: name, code, color, categories: [firstCategory] };
    builder.activeVariantId = firstCategory.id;
  } else {
    builder.activeData = { subject: name, code, color, units: [] };
    builder.activeVariantId = null;
  }
  builder.activeUnitId = null; builder.activeChapterId = null; builder.openBodyIndex = null;

  renderSubjectPills();
  document.getElementById('builder-tree-subject-label').textContent = `${name} — Units & Chapters`;
  document.getElementById('btn-save-subject').disabled = false;
  document.getElementById('builder-lock-note').textContent = '';
  renderVariantPills();
  renderBuilderTree();
  renderBuilderEditor();
  markDirty();
  setBuilderStatus('New subject created — add a unit to get started, then Save.', '');
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
function renderChapterPreviewHtml(chapter) {
  const concept = normalizeConcept(chapter.concept, chapter.title);
  let html = `<div style="font-size:18px;font-weight:800;margin-bottom:14px">${escHtml(concept.title)}</div>`;
  (concept.body || []).forEach(item => { html += pvBodyItemHtml(item); });
  if (!(concept.body || []).length) html += '<div style="color:#9ca3af;font-size:13px">No concept content yet.</div>';

  const pg = chapter.playground;
  if (pg && (pg.schema || (pg.sampleQueries || []).length)) {
    html += `<div style="margin-top:16px;padding:14px;border-radius:10px;border:1.5px solid #99f6e4;background:#f0fdfa"><strong style="color:#0f766e;font-size:12.5px">🛢️ SQL Playground</strong>`;
    if (pg.schema) html += `<pre style="margin-top:8px;background:#1e1e2e;color:#a6e3a1;padding:10px;border-radius:8px;font-size:11.5px;overflow-x:auto">${escHtml(pg.schema)}</pre>`;
    html += '</div>';
  }

  const questions = chapter.questions || [];
  if (questions.length) {
    html += `<div style="font-size:15px;font-weight:800;margin:18px 0 8px">Practice Questions (${questions.length})</div>`;
    questions.forEach((q, qi) => {
      const qImgHtml = q.image ? `<img src="${escAttr(q.image)}" style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid #e5e7eb;display:block;margin:8px 0;object-fit:contain" onerror="this.style.display='none'">` : '';
      const qImgAbove = (q.imagePosition || 'above') === 'above';
      html += `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin-bottom:10px"><div style="font-size:11px;color:#9ca3af;margin-bottom:6px">Q${qi + 1} · ${q.type}</div>${qImgAbove ? qImgHtml : ''}<div style="font-size:13.5px;margin-bottom:8px">${escHtml(q.question || '(empty)')}</div>${qImgAbove ? '' : qImgHtml}`;
      if (q.type === 'NAT') {
        html += `<div style="font-size:12.5px;color:#16a34a">Answer: ${q.answer ?? 0}${q.tolerance ? ` (± ${q.tolerance})` : ''}</div>`;
      } else {
        (q.options || []).forEach((opt, oi) => {
          const isCorrect = (q.answer || []).includes(oi);
          const optImg = (q.optionImages || [])[oi];
          html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:7px;margin-bottom:4px;font-size:12.5px;${isCorrect ? 'background:#f0fdf4;color:#15803d;font-weight:600' : 'background:#f9fafb'}">${optImg ? `<img src="${escAttr(optImg)}" style="max-width:60px;max-height:40px;border-radius:5px;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'">` : ''}<span>${String.fromCharCode(65 + oi)}. ${escHtml(opt)}${isCorrect ? ' ✓' : ''}</span></div>`;
        });
      }
      if (q.explanation) html += `<div style="font-size:12px;color:#6b7280;background:#f9fafb;border-radius:8px;padding:8px 10px;margin-top:8px">💡 ${escHtml(q.explanation)}</div>`;
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
// IDs are always regenerated on import so two people's offline files never
// collide when merged in. Nothing touches the database until you press
// "Save Subject to Database" afterwards — import only edits the in-memory
// copy, same as every other change in this editor.
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
    chapters: (u.chapters || []).map(c => ({
      id: uid('c'),
      title: c.title || 'Untitled Chapter',
      concept: normalizeConcept(c.concept, c.title),
      questions: (c.questions || []).map(q => ({
        latex: false, options: [], optionImages: [], answer: [],
        ...q, id: uid('q'),
      })),
      playground: { schema: '', sampleQueries: [], ...(c.playground || {}) },
    })),
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
  builder.subjects.push({ code, subject: meta.subject, color: meta.color || '#6C3FF5' });
  builder.activeCode = code;
  builder.activeData = { subject: meta.subject, code, color: meta.color || '#6C3FF5', units: [] };
  builder.activeUnitId = null; builder.activeChapterId = null; builder.openBodyIndex = null;
  renderSubjectPills();
  document.getElementById('builder-tree-subject-label').textContent = `${meta.subject} — Units & Chapters`;
  document.getElementById('btn-save-subject').disabled = false;
  document.getElementById('builder-lock-note').textContent = '';
  renderVariantPills();
  appendUnitsToActiveSubject(units);
}

function appendUnitsToActiveSubject(rawUnits) {
  const normalized = normalizeImportedUnits(rawUnits);
  const container = getUnitsContainer();
  if (!container) { alert('Select or add a version first (this subject has multiple versions).'); return; }
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
            },
            // Optional — only meaningful for interactive subjects like SQL,
            // but any subject can include it.
            playground: {
              schema: '',
              sampleQueries: [],
            },
            questions: [
              {
                type: 'MCQ', // MCQ | MSQ | NAT
                latex: false,
                question: 'Sample question text goes here?',
                options: ['Option A', 'Option B', 'Option C', 'Option D'],
                answer: [0], // index/indices of the correct option(s); MSQ can have more than one
                explanation: 'Why the correct answer is correct.',
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
