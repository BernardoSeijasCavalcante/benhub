document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('benhub_token');
  if (!token) {
    window.location.href = 'index.html';
    return;
  }

  // Parse JWT for user info
  const payload = JSON.parse(atob(token.split('.')[1]));
  document.getElementById('current-user-name').textContent = payload.name;
  
  if (payload.can_manage_system || payload.role === 'admin') {
    const navAdmin = document.getElementById('nav-admin');
    if(navAdmin) navAdmin.style.display = 'flex';
  }
  
  if (payload.can_view_sms_dashboard || payload.role === 'admin') {
    const navDashboard = document.getElementById('tab-dashboard');
    if(navDashboard) navDashboard.style.display = 'flex';
  }

  // Socket connection for force logout handling
  const socket = io();
  socket.on('connect', () => {
    socket.emit('authenticate', token);
  });
  socket.on('force_logout', () => {
    alert('Sua sessão expirou ou foi invalidada.');
    localStorage.removeItem('benhub_token');
    window.location.href = 'index.html';
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('benhub_token');
    window.location.href = 'index.html';
  });

  // Initialize date filters to today
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('filter-start-date').value = today;
  document.getElementById('filter-end-date').value = today;

  let dashboardData = null;

  async function fetchDashboardData() {
    const startDate = document.getElementById('filter-start-date').value;
    const endDate = document.getElementById('filter-end-date').value;

    const resultsContainer = document.getElementById('dashboard-results');
    resultsContainer.innerHTML = '<div class="empty-state"><p>Carregando...</p></div>';

    try {
      const response = await fetch(`/api/dashboard/sms?startDate=${startDate}&endDate=${endDate}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.status === 403) {
        document.body.innerHTML = `
          <div style="display:flex; height:100vh; align-items:center; justify-content:center; color:#fff; flex-direction:column; gap:16px;">
            <h2>Acesso Negado</h2>
            <p>Você não tem permissão para visualizar o dashboard de SMS.</p>
            <button class="btn-primary" onclick="window.location.href='sms_dispatch.html'">Voltar</button>
          </div>
        `;
        return;
      }

      if (!response.ok) {
        throw new Error('Falha ao carregar dados');
      }

      const data = await response.json();
      dashboardData = data.groups;
      populateGroupSelect();
    } catch (err) {
      console.error(err);
      resultsContainer.innerHTML = `<div class="empty-state"><p>Erro ao carregar dados. Tente novamente mais tarde.</p></div>`;
    }
  }

  function populateGroupSelect() {
    const select = document.getElementById('group-select');
    select.innerHTML = '<option value="">-- Selecione um grupo --</option>';

    if (!dashboardData || dashboardData.length === 0) {
      document.getElementById('dashboard-results').innerHTML = `
        <div class="empty-state">
          <div class="icon">📊</div>
          <p>Você não faz parte de nenhum grupo com dados para exibir.</p>
        </div>
      `;
      return;
    }

    dashboardData.forEach(group => {
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = group.name;
      select.appendChild(option);
    });

    // Auto select first group if exists
    if (dashboardData.length > 0) {
      select.value = dashboardData[0].id;
      renderGroup(dashboardData[0].id);
    }
  }

  function renderGroup(groupId) {
    const resultsContainer = document.getElementById('dashboard-results');
    if (!groupId) {
      resultsContainer.innerHTML = `
        <div class="empty-state">
          <div class="icon">📊</div>
          <p>Selecione um grupo para visualizar os dados.</p>
        </div>
      `;
      return;
    }

    const group = dashboardData.find(g => g.id == groupId);
    if (!group) return;

    if (!group.members || group.members.length === 0) {
      resultsContainer.innerHTML = `
        <div class="empty-state">
          <p>Nenhum membro neste grupo.</p>
        </div>
      `;
      return;
    }

    resultsContainer.innerHTML = group.members.map(member => {
      const stats = member.stats;
      const total = stats.total || 0;
      
      const deliveredPct = total > 0 ? (stats.delivered / total * 100) : 0;
      const failedPct = total > 0 ? (stats.failed / total * 100) : 0;
      const pendingPct = total > 0 ? (stats.pending / total * 100) : 0;
      const sentPct = total > 0 ? (stats.sent / total * 100) : 0;
      const otherPct = sentPct; // Assuming sent is "in transit" basically

      return `
        <div class="user-card">
          <div class="user-card-header">
            <img src="${member.photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(member.name)}&background=1e293b&color=f8fafc`}" alt="${member.name}">
            <div class="user-card-info">
              <h4>${member.name}</h4>
            </div>
          </div>
          
          <div class="stats-grid">
            <div class="stat-item total">
              <span class="stat-label">Total Disparos</span>
              <span class="stat-value">${total}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Entregue</span>
              <span class="stat-value delivered">${stats.delivered}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Falhou</span>
              <span class="stat-value failed">${stats.failed}</span>
            </div>
          </div>

          <div class="progress-container">
            <div class="progress-bar-bg">
              <div class="progress-fill delivered" style="width: ${deliveredPct}%" title="Entregue: ${deliveredPct.toFixed(1)}%"></div>
              <div class="progress-fill pending" style="width: ${pendingPct}%" title="Pendente: ${pendingPct.toFixed(1)}%"></div>
              <div class="progress-fill other" style="width: ${otherPct}%" title="Enviado: ${otherPct.toFixed(1)}%"></div>
              <div class="progress-fill failed" style="width: ${failedPct}%" title="Falhou: ${failedPct.toFixed(1)}%"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  document.getElementById('apply-filters-btn').addEventListener('click', fetchDashboardData);
  
  document.getElementById('group-select').addEventListener('change', (e) => {
    renderGroup(e.target.value);
  });

  // Initial fetch
  fetchDashboardData();
});
