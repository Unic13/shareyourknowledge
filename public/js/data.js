// js/data.js
const DataModule = (() => {
  let session, currentTab = 'attempts', allData = [], filteredData = [], currentPage = 1;
  const PAGE_SIZE = 20;

  function init(s) {
    session = s;
    // Editors don't see raw registrations (not subject-scoped data).
    if (!Auth.isAdminOrAbove(session)) {
      document.getElementById('tab-registrations').style.display = 'none';
      currentTab = 'attempts';
    }
    loadData(currentTab);
  }

  async function switchTab(type, btn) {
    currentTab = type;
    document.querySelectorAll('#section-data .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('search-input').value = '';
    await loadData(type);
  }

  async function loadData(type) {
    document.getElementById('table-container').innerHTML = '<div class="empty-table"><div class="big">⏳</div><p>Loading…</p></div>';
    try {
      const res = await Api.get('/api/data', { type });
      if (res.error) {
        document.getElementById('table-container').innerHTML = `<div class="empty-table"><div class="big">⚠️</div><p>${res.error}</p></div>`;
        document.getElementById('pagination').style.display = 'none';
        return;
      }
      if (res.message) {
        document.getElementById('table-container').innerHTML = `<div class="empty-table"><div class="big">🗄️</div><p style="font-weight:600;color:#374151">${res.message}</p></div>`;
        document.getElementById('pagination').style.display = 'none';
        return;
      }
      allData = res.records || [];
      filteredData = [...allData];
      currentPage = 1;
      renderTable();
    } catch {
      document.getElementById('table-container').innerHTML = '<div class="empty-table"><div class="big">⚠️</div><p>Failed to load data</p></div>';
    }
  }

  function renderTable() {
    if (!filteredData.length) {
      document.getElementById('table-container').innerHTML = `<div class="empty-table"><div class="big">📭</div><p>No ${currentTab} yet</p></div>`;
      document.getElementById('pagination').style.display = 'none';
      return;
    }
    const keys = Object.keys(filteredData[0]);
    const start = (currentPage - 1) * PAGE_SIZE;
    const page = filteredData.slice(start, start + PAGE_SIZE);
    const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);

    let html = '<div class="table-scroll"><table><thead><tr>';
    keys.forEach(k => html += `<th>${k}</th>`);
    html += '</tr></thead><tbody>';
    page.forEach(row => {
      html += '<tr>';
      keys.forEach(k => {
        const v = row[k];
        let cell;
        if (k === 'is_correct' || k === 'isCorrect') cell = v ? '<span class="badge badge-green">✓ Correct</span>' : '<span class="badge badge-red">✗ Wrong</span>';
        else if (k === 'subject') cell = `<span class="badge badge-blue">${v}</span>`;
        else if (isTimestampKey(k) && v) cell = formatIST(v);
        else if (typeof v === 'object' && v !== null) cell = JSON.stringify(v);
        else cell = String(v ?? '');
        html += `<td>${cell}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    document.getElementById('table-container').innerHTML = html;
    document.getElementById('pagination').style.display = 'flex';
    document.getElementById('page-info').textContent = `Page ${currentPage} of ${totalPages} (${filteredData.length} records)`;
    document.getElementById('btn-prev-page').disabled = currentPage === 1;
    document.getElementById('btn-next-page').disabled = currentPage === totalPages;
  }

  function filterTable() {
    const qv = document.getElementById('search-input').value.toLowerCase();
    filteredData = allData.filter(row => Object.values(row).some(v => String(v).toLowerCase().includes(qv)));
    currentPage = 1;
    renderTable();
  }

  function changePage(dir) {
    const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);
    currentPage = Math.max(1, Math.min(totalPages, currentPage + dir));
    renderTable();
  }

  function exportCSV() {
    if (!filteredData.length) return;
    const keys = Object.keys(filteredData[0]);
    const rows = [keys.join(','), ...filteredData.map(r => keys.map(k => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${currentTab}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return { init, switchTab, filterTable, changePage, exportCSV };
})();
