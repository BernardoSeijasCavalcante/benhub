document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('benhub_token');
  const user = JSON.parse(localStorage.getItem('benhub_user'));

  if (!token || !user || user.role !== 'admin') {
    window.location.href = '/';
    return;
  }

  // Set user info
  document.getElementById('user-name').textContent = user.name;
  document.getElementById('user-avatar').textContent = user.name.charAt(0).toUpperCase();

  // Logout
  document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.clear();
    window.location.href = '/';
  });

  const usersTbody = document.getElementById('users-tbody');
  const modal = document.getElementById('user-modal');
  const form = document.getElementById('user-form');
  
  loadUsers();

  document.getElementById('add-user-btn').addEventListener('click', () => {
    openModal();
  });

  document.getElementById('cancel-modal').addEventListener('click', () => {
    modal.classList.remove('active');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('user-id').value;
    const name = document.getElementById('form-name').value;
    const email = document.getElementById('form-email').value;
    const password = document.getElementById('form-password').value;
    const role = document.getElementById('form-role').value;
    const contactNumber = document.getElementById('form-contact').value;

    const payload = { name, email, role, contactNumber };
    if (password) payload.password = password;

    const url = id ? `/api/admin/users/${id}` : '/api/admin/users';
    const method = id ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        modal.classList.remove('active');
        loadUsers();
      } else {
        const data = await res.json();
        alert(data.error || 'Erro ao salvar usuário');
      }
    } catch (err) {
      alert('Erro de conexão');
    }
  });

  async function loadUsers() {
    try {
      const res = await fetch('/api/admin/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const users = await res.json();
      
      usersTbody.innerHTML = '';
      users.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${u.name}</td>
          <td>${u.email}</td>
          <td>${u.contact_number || '-'}</td>
          <td>${u.role === 'admin' ? 'Administrador' : 'Operador'}</td>
          <td>${new Date(u.created_at).toLocaleDateString()}</td>
          <td>
            <button class="btn-action edit" data-user='${JSON.stringify(u)}'>✏️</button>
            <button class="btn-action delete" data-id="${u.id}">🗑️</button>
          </td>
        `;
        usersTbody.appendChild(tr);
      });

      // Bind events
      document.querySelectorAll('.edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const userData = JSON.parse(e.currentTarget.getAttribute('data-user'));
          openModal(userData);
        });
      });

      document.querySelectorAll('.delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          if (confirm('Tem certeza que deseja deletar este usuário?')) {
            await fetch(`/api/admin/users/${id}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${token}` }
            });
            loadUsers();
          }
        });
      });

    } catch (err) {
      console.error('Erro ao carregar usuários', err);
    }
  }

  function openModal(user = null) {
    document.getElementById('modal-title').textContent = user ? 'Editar Operador' : 'Novo Operador';
    document.getElementById('user-id').value = user ? user.id : '';
    document.getElementById('form-name').value = user ? user.name : '';
    document.getElementById('form-email').value = user ? user.email : '';
    document.getElementById('form-password').value = '';
    document.getElementById('form-contact').value = user ? (user.contact_number || '') : '';
    document.getElementById('form-role').value = user ? user.role : 'operator';
    modal.classList.add('active');
  }
});
