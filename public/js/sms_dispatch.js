document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('benhub_token');
  const user = JSON.parse(localStorage.getItem('benhub_user'));

  if (!token || !user) {
    window.location.href = '/';
    return;
  }

  // Socket connection
  const socket = io();
  socket.on('connect', () => {
    socket.emit('authenticate', token);
  });

  // Decode token to check permissions
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.can_view_sms_dashboard || payload.role === 'admin') {
      const innerTabs = document.getElementById('inner-tabs-container');
      if (innerTabs) innerTabs.style.display = 'flex';
    }
  } catch (e) {
    console.error('Error decoding token', e);
  }

  socket.on('force_logout', () => {
    alert('Você fez login em outro dispositivo. Esta sessão foi encerrada.');
    localStorage.removeItem('benhub_token');
    localStorage.removeItem('benhub_user');
    window.location.href = '/';
  });

  // UI Setup
  document.getElementById('operator-name').textContent = user.name;
  const operatorAvatar = document.getElementById('operator-avatar');
  if (user.photo_url) {
    operatorAvatar.textContent = '';
    operatorAvatar.style.backgroundImage = `url(${user.photo_url})`;
    operatorAvatar.style.backgroundSize = 'cover';
    operatorAvatar.style.backgroundPosition = 'center';
  } else {
    operatorAvatar.textContent = user.name.charAt(0).toUpperCase();
  }

  if (user.role === 'admin') {
    document.getElementById('admin-btn').style.display = 'block';
    const adminFilters = document.getElementById('admin-filters');
    if (adminFilters) adminFilters.style.display = 'flex';
    
    // Carregar operadores para o filtro
    fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(res => res.json())
      .then(users => {
        const select = document.getElementById('filter-operator');
        if (select) {
          users.forEach(u => {
            const option = document.createElement('option');
            option.value = u.id;
            option.textContent = u.name;
            select.appendChild(option);
          });
          select.addEventListener('change', () => loadRecentLogs());
        }
      })
      .catch(err => console.error('Erro ao carregar operadores', err));
  }

  document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.clear();
    window.location.href = '/';
  });

  // Dispatch Form
  const form = document.getElementById('dispatch-form');
  const alertBox = document.getElementById('alert-message');
  const submitBtn = document.getElementById('btn-submit');

  function showAlert(msg, isSuccess) {
    alertBox.textContent = msg;
    alertBox.style.display = 'block';
    alertBox.style.backgroundColor = isSuccess ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)';
    alertBox.style.color = isSuccess ? '#10b981' : '#ef4444';
    setTimeout(() => { alertBox.style.display = 'none'; }, 5000);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = document.getElementById('client-phone').value.trim();
    const clientName = document.getElementById('client-name').value.trim();

    if (!phone || !clientName) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ phone, clientName })
      });

      const data = await res.json();
      if (res.ok) {
        showAlert('SMS enviado com sucesso!', true);
        form.reset();
        loadRecentLogs();
      } else {
        showAlert(data.error || 'Erro ao enviar SMS', false);
      }
    } catch (err) {
      showAlert('Erro de conexão com o servidor', false);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enviar SMS';
    }
  });

  // Recent Logs
  const logTbody = document.getElementById('log-tbody');

  async function loadRecentLogs() {
    try {
      let url = '/api/chat/recent';
      if (user.role === 'admin') {
        const operatorId = document.getElementById('filter-operator')?.value;
        if (operatorId) {
          url += `?operator_id=${operatorId}`;
        }
      }

      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const messages = await res.json();

      logTbody.innerHTML = '';
      if (messages.length === 0) {
        logTbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Nenhum disparo recente.</td></tr>';
        return;
      }

      messages.forEach(m => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${m.customer_phone}</td>
          <td>${m.customer_name || '-'}</td>
          <td style="max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${m.content}">${m.content}</td>
          <td><span class="status-badge status-${m.status}" id="status-${m.id}">${translateStatus(m.status)}</span></td>
          <td>${new Date(m.timestamp).toLocaleString()}</td>
        `;
        logTbody.appendChild(tr);
      });
    } catch (err) {
      logTbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red;">Erro ao carregar log.</td></tr>';
    }
  }

  function translateStatus(s) {
    if (s === 'pending') return 'Pendente';
    if (s === 'sent') return 'Enviado';
    if (s === 'delivered') return 'Entregue';
    if (s === 'failed') return 'Falhou';
    return s;
  }

  loadRecentLogs();

  // Socket Updates
  socket.on('message_status_update', (data) => {
    // Apenas atualizar o status na tabela visualmente, ou recarregar
    const badge = document.getElementById(`status-${data.messageId}`);
    if (badge) {
      badge.className = `status-badge status-${data.status}`;
      badge.textContent = translateStatus(data.status);
    } else {
      // Se não achou na tela, recarrega
      loadRecentLogs();
    }
  });

  // --- DASHBOARD LOGIC ---
  const btnViewForm = document.getElementById('btn-view-form');
  const btnViewDashboard = document.getElementById('btn-view-dashboard');
  const viewForm = document.getElementById('view-form');
  const viewDashboard = document.getElementById('view-dashboard');

  if (btnViewForm && btnViewDashboard) {
    btnViewForm.addEventListener('click', () => {
      btnViewForm.classList.add('active');
      btnViewDashboard.classList.remove('active');
      viewForm.style.display = 'block';
      viewDashboard.style.display = 'none';
    });

    btnViewDashboard.addEventListener('click', () => {
      btnViewDashboard.classList.add('active');
      btnViewForm.classList.remove('active');
      viewForm.style.display = 'none';
      viewDashboard.style.display = 'flex';
      
      if (!dashboardData) fetchDashboardData();
    });
  }

  const filterStartDate = document.getElementById('filter-start-date');
  const filterEndDate = document.getElementById('filter-end-date');
  if (filterStartDate) filterStartDate.value = new Date().toISOString().split('T')[0];
  if (filterEndDate) filterEndDate.value = new Date().toISOString().split('T')[0];

  let dashboardData = null;

  async function fetchDashboardData() {
    if (!filterStartDate) return;
    const startDate = filterStartDate.value;
    const endDate = filterEndDate.value;
    const resultsContainer = document.getElementById('dashboard-results');
    if (resultsContainer) resultsContainer.innerHTML = '<div class="empty-state"><p>Carregando...</p></div>';

    try {
      const response = await fetch(`/api/dashboard/sms?startDate=${startDate}&endDate=${endDate}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.status === 403) {
        if (resultsContainer) resultsContainer.innerHTML = `<div class="empty-state"><p>Acesso Negado.</p></div>`;
        return;
      }
      if (!response.ok) throw new Error('Falha ao carregar dados');
      const data = await response.json();
      dashboardData = data.groups;
      populateGroupSelect();
    } catch (err) {
      if (resultsContainer) resultsContainer.innerHTML = `<div class="empty-state"><p>Erro ao carregar dados.</p></div>`;
    }
  }

  function populateGroupSelect() {
    const select = document.getElementById('group-select');
    if (!select) return;
    select.innerHTML = '<option value="">-- Selecione um grupo --</option>';
    if (!dashboardData || dashboardData.length === 0) {
      document.getElementById('dashboard-results').innerHTML = `<div class="empty-state"><div class="icon">📊</div><p>Nenhum grupo encontrado.</p></div>`;
      return;
    }
    dashboardData.forEach(group => {
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = group.name;
      select.appendChild(option);
    });
    if (dashboardData.length > 0) {
      select.value = dashboardData[0].id;
      renderGroup(dashboardData[0].id);
    }
  }

  function renderGroup(groupId) {
    const resultsContainer = document.getElementById('dashboard-results');
    if (!resultsContainer) return;
    if (!groupId) return;
    const group = dashboardData.find(g => g.id == groupId);
    if (!group || !group.members || group.members.length === 0) {
      resultsContainer.innerHTML = `<div class="empty-state"><p>Nenhum membro neste grupo.</p></div>`;
      return;
    }
    resultsContainer.innerHTML = group.members.map(member => {
      const stats = member.stats;
      const total = stats.total || 0;
      const deliveredPct = total > 0 ? (stats.delivered / total * 100) : 0;
      const failedPct = total > 0 ? (stats.failed / total * 100) : 0;
      const pendingPct = total > 0 ? (stats.pending / total * 100) : 0;
      const sentPct = total > 0 ? (stats.sent / total * 100) : 0;
      return `
        <div class="user-card">
          <div class="user-card-header">
            <img src="${member.photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(member.name)}&background=1e293b&color=f8fafc`}" alt="${member.name}">
            <div class="user-card-info">
              <h4>${member.name}</h4>
            </div>
          </div>
          <div class="stats-grid">
            <div class="stat-item total"><span class="stat-label">Total Disparos</span><span class="stat-value">${total}</span></div>
            <div class="stat-item"><span class="stat-label">Entregue</span><span class="stat-value delivered">${stats.delivered}</span></div>
            <div class="stat-item"><span class="stat-label">Falhou</span><span class="stat-value failed">${stats.failed}</span></div>
          </div>
          <div class="progress-container">
            <div class="progress-bar-bg">
              <div class="progress-fill delivered" style="width: ${deliveredPct}%" title="Entregue: ${deliveredPct.toFixed(1)}%"></div>
              <div class="progress-fill pending" style="width: ${pendingPct}%" title="Pendente: ${pendingPct.toFixed(1)}%"></div>
              <div class="progress-fill other" style="width: ${sentPct}%" title="Enviado: ${sentPct.toFixed(1)}%"></div>
              <div class="progress-fill failed" style="width: ${failedPct}%" title="Falhou: ${failedPct.toFixed(1)}%"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  const applyFiltersBtn = document.getElementById('apply-filters-btn');
  if (applyFiltersBtn) applyFiltersBtn.addEventListener('click', fetchDashboardData);
  const groupSelect = document.getElementById('group-select');
  if (groupSelect) groupSelect.addEventListener('change', (e) => renderGroup(e.target.value));

});
