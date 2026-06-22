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
    if (s === 'failed') return 'Falha';
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

});
