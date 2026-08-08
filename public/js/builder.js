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
  exercise: '#f59e0b', steps: '#6C3FF5', video: '#dc2626'
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

  renderBuilderTree();
  renderBuilderEditor();
}

// ── TREE ──
function renderBuilderTree() {
  const wrap = document.getElementById('builder-tree');
  const data = builder.activeData;
  if (!data) { wrap.innerHTML = '<div class="editor-empty"><div class="big">📚</div><p style="font-size:12px">Select a subject</p></div>'; return; }

  let html = '';
  (data.units || []).forEach(unit => {
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
  const title = prompt('Unit title:');
  if (!title || !title.trim()) return;
  builder.activeData.units = builder.activeData.units || [];
  builder.activeData.units.push({ id: uid('u'), title: title.trim(), chapters: [] });
  renderBuilderTree(); markDirty();
}
function renameUnit(unitId) {
  const unit = builder.activeData.units.find(u => u.id === unitId);
  if (!unit) return;
  const title = prompt('Rename unit:', unit.title);
  if (!title || !title.trim()) return;
  unit.title = title.trim(); renderBuilderTree(); markDirty();
}
function deleteUnit(unitId) {
  if (!confirm('Delete this unit and all its chapters/questions?')) return;
  builder.activeData.units = builder.activeData.units.filter(u => u.id !== unitId);
  if (builder.activeUnitId === unitId) { builder.activeUnitId = null; builder.activeChapterId = null; renderBuilderEditor(); }
  renderBuilderTree(); markDirty();
}
function addChapter(unitId) {
  const title = prompt('Chapter title:');
  if (!title || !title.trim()) return;
  const unit = builder.activeData.units.find(u => u.id === unitId);
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
  if (!confirm('Delete this chapter and all its questions?')) return;
  const unit = builder.activeData.units.find(u => u.id === unitId);
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
  const unit = builder.activeData?.units?.find(u => u.id === builder.activeUnitId);
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
          ${['heading','paragraph','list','table','note','formula','syntax','image','video','steps','exercise'].map(t => `<button class="b-btn b-btn-outline b-btn-sm" onclick="addBodyItem('${t}')">+ ${t}</button>`).join('')}
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
  if (item.type === 'list') return (item.items || []).filter(Boolean).join(', ') || '(empty list)';
  if (item.type === 'table') return (item.headers || []).join(' | ') || '(empty table)';
  if (item.type === 'syntax') return item.code || '(empty code)';
  if (item.type === 'image') return item.title || item.image || item.pdf || '(empty image/pdf)';
  if (item.type === 'video') return item.title || item.url || '(no video URL)';
  if (item.type === 'steps' || item.type === 'exercise') return item.title || (item.steps || []).filter(Boolean).join(' → ') || `(empty ${item.type})`;
  return item.text || '(empty)';
}
function addBodyItem(type) {
  const chapter = getActiveChapterObj(); if (!chapter) return;
  chapter.concept.body = chapter.concept.body || [];
  let item;
  if (type === 'list') item = { type: 'list', items: [''] };
  else if (type === 'table') item = { type: 'table', headers: ['Column 1', 'Column 2'], rows: [['', '']] };
  else if (type === 'syntax') item = { type: 'syntax', language: 'text', code: '' };
  else if (type === 'image') item = { type: 'image', title: '', image: '', pdf: '' };
  else if (type === 'video') item = { type: 'video', title: '', url: '', start: '' };
  else if (type === 'steps' || type === 'exercise') item = { type, title: '', steps: [''], image: '' };
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
  if (item.type === 'list') {
    let rows = (item.items || []).map((li, li_i) => `<div class="b-list-item"><input type="text" value="${escAttr(li)}" oninput="updateListItemText(${i},${li_i},this.value)"><button class="b-icon-btn danger" onclick="removeListItemAt(${i},${li_i})">✕</button></div>`).join('');
    container.innerHTML = `<div class="b-field"><label>List Items</label>${rows}<button class="b-btn b-btn-outline b-btn-sm" onclick="addListItemAt(${i})">+ Add Item</button></div>`;
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
    let rows = (item.steps || []).map((s, si) => `<div class="b-list-item"><textarea rows="1" oninput="updateStepText(${i},${si},this.value)">${escHtml(s)}</textarea><button class="b-icon-btn danger" onclick="removeStepAt(${i},${si})">✕</button></div>`).join('');
    container.innerHTML = `<div class="b-field"><label>Title</label><input type="text" value="${escAttr(item.title || '')}" oninput="updateImageField(${i},'title',this.value)"></div>
      <div class="b-field"><label>Items</label>${rows}<button class="b-btn b-btn-outline b-btn-sm" onclick="addStepAt(${i})">+ Add</button></div>`;
    return;
  }
}
function updateBodyText(i, val) { getActiveChapterObj().concept.body[i].text = val; refreshBodyItemSummary(i); markDirty(); }
function addListItemAt(i) { const item = getActiveChapterObj().concept.body[i]; item.items = item.items || []; item.items.push(''); renderBodyItemEditor(item, i, document.getElementById(`bbody-${i}`)); markDirty(); }
function updateListItemText(i, li, val) { getActiveChapterObj().concept.body[i].items[li] = val; refreshBodyItemSummary(i); markDirty(); }
function removeListItemAt(i, li) { const item = getActiveChapterObj().concept.body[i]; item.items.splice(li, 1); renderBodyItemEditor(item, i, document.getElementById(`bbody-${i}`)); markDirty(); }
function addStepAt(i) { const item = getActiveChapterObj().concept.body[i]; item.steps = item.steps || []; item.steps.push(''); renderBodyItemEditor(item, i, document.getElementById(`bbody-${i}`)); markDirty(); }
function updateStepText(i, si, val) { getActiveChapterObj().concept.body[i].steps[si] = val; markDirty(); }
function removeStepAt(i, si) { const item = getActiveChapterObj().concept.body[i]; item.steps.splice(si, 1); renderBodyItemEditor(item, i, document.getElementById(`bbody-${i}`)); markDirty(); }
function tableEditorHtml(item, i) {
  const headers = item.headers || []; const rows = item.rows || [];
  let html = '<div class="b-field"><label>Table</label><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><tr>';
  headers.forEach((h, ci) => { html += `<td><input type="text" value="${escAttr(h)}" oninput="updateTableHeader(${i},${ci},this.value)"></td>`; });
  html += `<td><button class="b-icon-btn" onclick="addTableCol(${i})">+col</button></td></tr>`;
  rows.forEach((r, ri) => {
    html += '<tr>';
    headers.forEach((_, ci) => { html += `<td><input type="text" value="${escAttr(r[ci] || '')}" oninput="updateTableCell(${i},${ri},${ci},this.value)"></td>`; });
    html += `<td><button class="b-icon-btn danger" onclick="removeTableRow(${i},${ri})">✕</button></td></tr>`;
  });
  html += `</table></div><button class="b-btn b-btn-outline b-btn-sm" style="margin-top:6px" onclick="addTableRow(${i})">+ Add Row</button></div>`;
  return html;
}
function rerenderTableEditor(i) {
  const item = getActiveChapterObj().concept.body[i];
  const container = document.getElementById(`bbody-${i}`);
  if (container) container.innerHTML = tableEditorHtml(item, i);
  markDirty();
}
function addTableCol(i) { const item = getActiveChapterObj().concept.body[i]; item.headers.push(`Column ${item.headers.length + 1}`); (item.rows || []).forEach(r => r.push('')); rerenderTableEditor(i); }
function addTableRow(i) { const item = getActiveChapterObj().concept.body[i]; item.rows = item.rows || []; item.rows.push((item.headers || []).map(() => '')); rerenderTableEditor(i); }
function removeTableRow(i, ri) { getActiveChapterObj().concept.body[i].rows.splice(ri, 1); rerenderTableEditor(i); }
function updateTableHeader(i, ci, val) { getActiveChapterObj().concept.body[i].headers[ci] = val; markDirty(); }
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
      optsHtml += `<div class="b-opt-row" style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
        <span style="width:22px;height:22px;border-radius:6px;background:#f3f4f6;color:#6b7280;font-size:10.5px;font-weight:700;display:flex;align-items:center;justify-content:center">${String.fromCharCode(65 + i)}</span>
        <input type="text" style="flex:1" value="${escAttr(opt)}" oninput="updateOptionText('${q.id}',${i},this.value)">
        <input type="${inputType}" name="correct-${q.id}" ${checked ? 'checked' : ''} onchange="toggleOptionCorrect('${q.id}',${i},this.checked)">
        <button class="b-icon-btn danger" onclick="removeOption('${q.id}',${i})">✕</button>
      </div>`;
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
    ${q.type !== 'NAT' ? `<div class="b-field"><label>Options</label>${optsHtml}<button class="b-btn b-btn-outline b-btn-sm" onclick="addOption('${q.id}')">+ Add Option</button></div>` : natHtml}
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
  appendUnitsToActiveSubject(units);
}

function appendUnitsToActiveSubject(rawUnits) {
  const normalized = normalizeImportedUnits(rawUnits);
  builder.activeData.units = builder.activeData.units || [];
  builder.activeData.units.push(...normalized);
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
