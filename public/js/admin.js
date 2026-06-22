document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('benhub_token');
  const user = JSON.parse(localStorage.getItem('benhub_user'));

  // Allow admin access
  if (!token || !user) {
    window.location.href = '/';
    return;
  }

  // Set user info
  document.getElementById('user-name').textContent = user.name;
  const userAvatar = document.getElementById('user-avatar');
  if (user.photo_url) {
    userAvatar.textContent = '';
    userAvatar.style.backgroundImage = `url(${user.photo_url})`;
    userAvatar.style.backgroundSize = 'cover';
    userAvatar.style.backgroundPosition = 'center';
  } else {
    userAvatar.textContent = user.name.charAt(0).toUpperCase();
  }

  // Logout
  document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.clear();
    window.location.href = '/';
  });

  // TABS LOGIC
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-target');
      document.getElementById(targetId).classList.add('active');
    });
  });

  // GLOBALS
  window.hierarchiesList = [];

  // DOM ELEMENTS - USERS
  const usersTbody = document.getElementById('users-tbody');
  const userModal = document.getElementById('user-modal');
  const userForm = document.getElementById('user-form');

  // DOM ELEMENTS - HIERARCHIES
  const hierarchiesTbody = document.getElementById('hierarchies-tbody');
  const hierarchyModal = document.getElementById('hierarchy-modal');
  const hierarchyForm = document.getElementById('hierarchy-form');

  // INITIAL LOAD
  loadHierarchies().then(() => {
    loadUsers();
  });

  // =====================================
  // HIERARCHIES LOGIC
  // =====================================
  async function loadHierarchies() {
    try {
      const res = await fetch('/api/admin/hierarchies', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const hierarchies = await res.json();
      window.hierarchiesList = hierarchies;
      
      hierarchiesTbody.innerHTML = '';
      hierarchies.forEach(h => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${h.name}</td>
          <td>${h.level}</td>
          <td>${h.allow_same_level_chat ? 'Sim' : 'Não'}</td>
          <td>${h.can_manage_system ? 'Sim' : 'Não'}</td>
          <td>
            <button class="btn-action edit-hierarchy" data-hierarchy='${JSON.stringify(h)}'>✏️</button>
            <button class="btn-action delete-hierarchy" data-id="${h.id}">🗑️</button>
          </td>
        `;
        hierarchiesTbody.appendChild(tr);
      });

      // Bind events
      document.querySelectorAll('.edit-hierarchy').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const data = JSON.parse(e.currentTarget.getAttribute('data-hierarchy'));
          openHierarchyModal(data);
        });
      });

      document.querySelectorAll('.delete-hierarchy').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          if (confirm('Tem certeza que deseja deletar esta hierarquia?')) {
            const res = await fetch(`/api/admin/hierarchies/${id}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
              loadHierarchies();
            } else {
              const data = await res.json();
              alert(data.error || 'Erro ao deletar.');
            }
          }
        });
      });
    } catch (err) {
      console.error('Erro ao carregar hierarquias', err);
    }
  }

  document.getElementById('add-hierarchy-btn').addEventListener('click', () => {
    openHierarchyModal();
  });

  document.getElementById('cancel-hierarchy-modal').addEventListener('click', () => {
    hierarchyModal.classList.remove('active');
  });

  hierarchyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('hierarchy-id').value;
    const name = document.getElementById('form-hierarchy-name').value;
    const level = parseInt(document.getElementById('form-hierarchy-level').value, 10);
    const allow_same_level_chat = document.getElementById('form-hierarchy-allow-chat').checked;
    const can_manage_system = document.getElementById('form-hierarchy-manage-system').checked;

    const payload = { name, level, allow_same_level_chat, can_manage_system };
    const url = id ? `/api/admin/hierarchies/${id}` : '/api/admin/hierarchies';
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
        hierarchyModal.classList.remove('active');
        loadHierarchies();
      } else {
        const data = await res.json();
        alert(data.error || 'Erro ao salvar hierarquia');
      }
    } catch (err) {
      alert('Erro de conexão');
    }
  });

  function openHierarchyModal(hierarchy = null) {
    document.getElementById('hierarchy-modal-title').textContent = hierarchy ? 'Editar Hierarquia' : 'Nova Hierarquia';
    document.getElementById('hierarchy-id').value = hierarchy ? hierarchy.id : '';
    document.getElementById('form-hierarchy-name').value = hierarchy ? hierarchy.name : '';
    document.getElementById('form-hierarchy-level').value = hierarchy ? hierarchy.level : '';
    document.getElementById('form-hierarchy-allow-chat').checked = hierarchy ? hierarchy.allow_same_level_chat : false;
    document.getElementById('form-hierarchy-manage-system').checked = hierarchy ? hierarchy.can_manage_system : false;
    hierarchyModal.classList.add('active');
  }

  // =====================================
  // USERS LOGIC
  // =====================================
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
          <td>${u.hierarchy_name || '-'}</td>
          <td>${new Date(u.created_at).toLocaleDateString()}</td>
          <td>
            <button class="btn-action edit-user" data-user='${JSON.stringify(u)}'>✏️</button>
            <button class="btn-action delete-user" data-id="${u.id}">🗑️</button>
          </td>
        `;
        usersTbody.appendChild(tr);
      });

      document.querySelectorAll('.edit-user').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const userData = JSON.parse(e.currentTarget.getAttribute('data-user'));
          openModal(userData);
        });
      });

      document.querySelectorAll('.delete-user').forEach(btn => {
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

  document.getElementById('add-user-btn').addEventListener('click', () => {
    openModal();
  });

  document.getElementById('cancel-modal').addEventListener('click', () => {
    userModal.classList.remove('active');
  });

  userForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('user-id').value;
    const name = document.getElementById('form-name').value;
    const email = document.getElementById('form-email').value;
    const password = document.getElementById('form-password').value;
    const hierarchyId = document.getElementById('form-hierarchy').value;
    const contactNumber = document.getElementById('form-contact').value;

    const payload = { name, email, hierarchyId, contactNumber };
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
        userModal.classList.remove('active');
        loadUsers();
      } else {
        const data = await res.json();
        alert(data.error || 'Erro ao salvar usuário');
      }
    } catch (err) {
      alert('Erro de conexão');
    }
  });

  function openModal(user = null) {
    document.getElementById('modal-title').textContent = user ? 'Editar Operador' : 'Novo Operador';
    document.getElementById('user-id').value = user ? user.id : '';
    document.getElementById('form-name').value = user ? user.name : '';
    document.getElementById('form-email').value = user ? user.email : '';
    document.getElementById('form-password').value = '';
    document.getElementById('form-contact').value = user ? (user.contact_number || '') : '';
    
    // Populate hierarchy select
    const hierarchySelect = document.getElementById('form-hierarchy');
    hierarchySelect.innerHTML = '';
    window.hierarchiesList.forEach(h => {
      const option = document.createElement('option');
      option.value = h.id;
      option.textContent = h.name;
      if (user && user.hierarchy_id === h.id) {
        option.selected = true;
      }
      hierarchySelect.appendChild(option);
    });

    userModal.classList.add('active');
  }
});
