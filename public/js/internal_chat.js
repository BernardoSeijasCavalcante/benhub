document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('benhub_token');
  if (!token) {
    window.location.href = '/';
    return;
  }

  // Elementos UI
  const operatorNameEl = document.getElementById('operator-name');
  const operatorAvatarEl = document.getElementById('operator-avatar');
  const logoutBtn = document.getElementById('logout-btn');
  const adminBtn = document.getElementById('admin-btn');
  
  const contactsListEl = document.getElementById('contacts-list');
  const activeChatEl = document.getElementById('active-chat');
  const emptyStateEl = document.getElementById('empty-state');
  
  const chatAvatarEl = document.getElementById('chat-avatar');
  const chatContactNameEl = document.getElementById('chat-contact-name');
  const chatContactDescEl = document.getElementById('chat-contact-desc');
  const chatMessagesEl = document.getElementById('chat-messages');
  
  const messageForm = document.getElementById('send-message-form');
  const messageInput = document.getElementById('message-input');
  
  const sidebarRight = document.getElementById('sidebar-right');
  const toggleDetailsBtn = document.getElementById('toggle-details-btn');
  const closeDetailsBtn = document.getElementById('close-details-btn');
  const detailsBody = document.getElementById('details-body');

  const fileInput = document.getElementById('file-input');
  const btnAttachFile = document.getElementById('btn-attach-file');

  // Modals
  const modalNewGroup = document.getElementById('modal-new-group');
  const closeNewGroupBtn = document.getElementById('close-new-group');
  const newGroupBtn = document.getElementById('new-group-btn');
  const formNewGroup = document.getElementById('form-new-group');

  const modalAddMember = document.getElementById('modal-add-member');
  const closeAddMemberBtn = document.getElementById('close-add-member');
  const formAddMember = document.getElementById('form-add-member');
  const selectNewMember = document.getElementById('select-new-member');

  // Estado
  let currentUser = JSON.parse(localStorage.getItem('benhub_user'));
  let activeChatId = null;
  let allUsers = [];
  let currentChatInfo = null;
  let currentChatMembers = [];
  let isAdminOfCurrentGroup = false;

  // Socket.IO e Notificações Globais
  const socket = io();
  const tokenForSocket = localStorage.getItem('benhub_token');
  socket.emit('authenticate', tokenForSocket);

  let unreadSms = 0;

  function playNotificationSound() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime);
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.start();
      gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.3);
      oscillator.stop(audioCtx.currentTime + 0.3);
    } catch(e) {}
  }

  // Inicialização
  async function init() {
    try {
      if (!currentUser) throw new Error('Sessão inválida');
      
      operatorNameEl.textContent = currentUser.name;
      operatorAvatarEl.textContent = currentUser.name.charAt(0).toUpperCase();
      
      if (currentUser.role === 'admin') {
        adminBtn.style.display = 'block';
        adminBtn.addEventListener('click', () => window.location.href = '/admin.html');
      }

      // 2. Carregar chats e usuários
      await loadChatsAndUsers();

    } catch (error) {
      console.error(error);
      localStorage.clear();
      window.location.href = '/';
    }
  }

  async function loadChatsAndUsers() {
    try {
      const res = await fetch('/api/internal-chat/chats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      
      allUsers = data.users;
      renderContactsList(data.chats, data.users);

    } catch (error) {
      console.error('Erro ao carregar chats:', error);
    }
  }

  function renderContactsList(chats, users) {
    contactsListEl.innerHTML = '';
    
    // Renderizar Grupos e Chats Diretos Ativos
    chats.forEach(chat => {
      const el = document.createElement('div');
      el.className = `contact-item ${activeChatId === chat.id ? 'active' : ''}`;
      el.dataset.chatId = chat.id;
      
      let avatarLetter = chat.name ? chat.name.charAt(0).toUpperCase() : '?';
      let avatarClass = chat.type === 'group' ? 'group-avatar' : '';
      let style = chat.color ? `background-color: ${chat.color}; color: #000;` : '';

      el.innerHTML = `
        <div class="avatar ${avatarClass}" style="${style}">${avatarLetter}</div>
        <div class="contact-info">
          <div class="contact-header">
            <span class="contact-name">${chat.name || 'Chat sem nome'}</span>
          </div>
          <span class="contact-last-msg">${chat.type === 'group' ? 'Grupo' : 'Chat Direto'}</span>
        </div>
      `;
      
      el.addEventListener('click', () => openChat(chat.id, chat.name, chat.type, chat.color));
      contactsListEl.appendChild(el);
    });

    // Separador
    if (users.length > 0) {
      const sep = document.createElement('div');
      sep.innerHTML = '<small style="color:var(--text-secondary); padding: 10px 15px; display:block;">Nova Conversa Direta</small>';
      contactsListEl.appendChild(sep);
    }

    // Renderizar usuários para iniciar novo chat
    users.forEach(user => {
      // Se já existe chat direto ativo com ele, não duplica (opcional, aqui estamos simplificando)
      const el = document.createElement('div');
      el.className = 'contact-item';
      
      el.innerHTML = `
        <div class="avatar">${user.name.charAt(0).toUpperCase()}</div>
        <div class="contact-info">
          <div class="contact-header">
            <span class="contact-name">${user.name}</span>
          </div>
          <span class="contact-last-msg">Iniciar conversa</span>
        </div>
      `;
      
      el.addEventListener('click', () => startDirectChat(user.id, user.name));
      contactsListEl.appendChild(el);
    });
  }

  async function startDirectChat(targetUserId, targetUserName) {
    try {
      const res = await fetch('/api/internal-chat/direct', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ targetUserId })
      });
      const data = await res.json();
      
      // Recarrega lista e abre o chat
      await loadChatsAndUsers();
      openChat(data.chatId, targetUserName, 'direct');
    } catch (error) {
      console.error(error);
    }
  }

  async function openChat(chatId, chatName, chatType, color = null) {
    if (activeChatId) {
      socket.emit('leave_internal_chat', activeChatId);
    }
    
    activeChatId = chatId;
    socket.emit('join_internal_chat', chatId);

    emptyStateEl.style.display = 'none';
    activeChatEl.style.display = 'flex';
    
    chatContactNameEl.textContent = chatName;
    chatContactDescEl.textContent = chatType === 'group' ? 'Grupo' : 'Chat Direto';
    chatAvatarEl.textContent = chatName.charAt(0).toUpperCase();
    if(color) {
      chatAvatarEl.style.backgroundColor = color;
      chatAvatarEl.style.color = '#000';
    } else {
      chatAvatarEl.style.backgroundColor = 'var(--primary-color)';
      chatAvatarEl.style.color = '#fff';
    }

    // Atualizar UI da lista
    document.querySelectorAll('.contact-item').forEach(el => {
      el.classList.toggle('active', el.dataset.chatId == chatId);
    });

    // Carregar mensagens
    chatMessagesEl.innerHTML = '<div class="loading">Carregando mensagens...</div>';
    try {
      const res = await fetch(`/api/internal-chat/${chatId}/messages`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      
      currentChatInfo = data.chatInfo;
      currentChatMembers = data.members;
      
      const myMemberInfo = currentChatMembers.find(m => m.id === currentUser.id);
      isAdminOfCurrentGroup = myMemberInfo && myMemberInfo.role === 'admin';

      renderMessages(data.messages);
      renderDetailsPanel();

    } catch (error) {
      console.error(error);
      chatMessagesEl.innerHTML = '<div class="error">Erro ao carregar mensagens.</div>';
    }
  }

  function renderMessages(messages) {
    chatMessagesEl.innerHTML = '';
    messages.forEach(msg => appendMessage(msg));
    scrollToBottom();
  }

  function appendMessage(msg) {
    const isMine = msg.sender_id === currentUser.id;
    const el = document.createElement('div');
    el.className = `message ${isMine ? 'operator' : 'customer'}`;
    
    // SQLite CURRENT_TIMESTAMP returns UTC without 'Z', so we append 'Z' to parse it correctly
    const timeString = msg.created_at.includes('Z') ? msg.created_at : msg.created_at + 'Z';
    const time = new Date(timeString).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    let contentHtml = '';
    if (msg.content_type === 'text') {
      contentHtml = `<p class="text">${msg.content}</p>`;
    } else if (msg.content_type === 'image') {
      contentHtml = `<img src="${msg.file_url}" class="message-image" alt="Imagem enviada" onclick="window.open('${msg.file_url}', '_blank')">`;
      if(msg.content) contentHtml += `<p class="text" style="font-size:12px; margin-top:5px;">${msg.content}</p>`;
    } else if (msg.content_type === 'file') {
      contentHtml = `<a href="${msg.file_url}" target="_blank" class="message-file">📄 ${msg.content}</a>`;
    }

    let senderNameHtml = !isMine 
      ? `<div style="font-size: 0.75rem; font-weight: 600; color: var(--accent-gold); margin-bottom: 4px;">${msg.sender_name}</div>` 
      : '';

    el.innerHTML = `
      <div class="message-content">
        ${senderNameHtml}
        ${contentHtml}
      </div>
      <div class="message-meta">
        <span>${time}</span>
      </div>
    `;
    chatMessagesEl.appendChild(el);
  }

  function scrollToBottom() {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  // Socket listener
  socket.on('receive_internal_message', (msg) => {
    if (activeChatId == msg.chat_id) {
      appendMessage(msg);
      scrollToBottom();
    } else {
      if (msg.sender_id !== currentUser.id) {
        playNotificationSound();
      }
    }
    loadChatsAndUsers(); // Atualiza a lista lateral com a última mensagem
  });

  socket.on('new_message_received', (msg) => {
    unreadSms++;
    const tabSms = document.getElementById('tab-sms');
    if (tabSms) {
      tabSms.innerHTML = `Clientes (SMS) <span style="background:var(--danger, #ff6b6b);color:white;border-radius:10px;padding:2px 6px;font-size:10px;margin-left:5px;">${unreadSms}</span>`;
    }
    playNotificationSound();
  });

  // Enviar Mensagem Texto
  messageForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeChatId) return;

    const text = messageInput.value.trim();
    if (!text) return;

    messageInput.value = '';

    try {
      await fetch(`/api/internal-chat/${activeChatId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ content: text, content_type: 'text' })
      });
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
    }
  });

  // Upload de Arquivo
  btnAttachFile.addEventListener('click', () => fileInput.click());
  
  fileInput.addEventListener('change', async () => {
    if (!fileInput.files.length || !activeChatId) return;
    
    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('file', file);

    try {
      await fetch(`/api/internal-chat/${activeChatId}/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      fileInput.value = ''; // reseta
    } catch (error) {
      console.error('Erro no upload:', error);
      alert('Erro ao enviar arquivo.');
    }
  });

  // Detalhes Panel
  toggleDetailsBtn.addEventListener('click', () => {
    sidebarRight.classList.toggle('active');
  });
  closeDetailsBtn.addEventListener('click', () => {
    sidebarRight.classList.remove('active');
  });

  function renderDetailsPanel() {
    if (!currentChatInfo) return;

    let html = '';
    if (currentChatInfo.type === 'group') {
      html += `
        <div class="detail-avatar group-avatar" style="background-color: ${currentChatInfo.color || '#333'}">${(currentChatInfo.name || '?').charAt(0).toUpperCase()}</div>
        <h2>${currentChatInfo.name}</h2>
        <p class="text-secondary">${currentChatInfo.description || 'Sem descrição'}</p>
        
        <h4 style="margin-top:20px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:5px;">Membros (${currentChatMembers.length})</h4>
        <div class="members-list">
      `;
      
      currentChatMembers.forEach(m => {
        let badge = m.role === 'admin' ? '<span style="font-size:10px; background:var(--primary-color); padding:2px 5px; border-radius:4px; margin-left:5px;">Admin</span>' : '';
        html += `
          <div class="member-item">
            <div class="member-info">
              <div class="avatar" style="width:24px; height:24px; font-size:12px;">${m.name.charAt(0).toUpperCase()}</div>
              <span>${m.name} ${badge}</span>
            </div>
          </div>
        `;
      });
      html += `</div>`;

      if (isAdminOfCurrentGroup) {
        html += `
          <button id="btn-open-add-member" class="btn-primary" style="margin-top: 15px;">➕ Adicionar Membro</button>
        `;
      }
    } else {
      // Direct
      const otherMember = currentChatMembers.find(m => m.id !== currentUser.id) || { name: 'Desconhecido' };
      const displayName = otherMember.name;

      html += `
        <div class="detail-avatar">${displayName.charAt(0).toUpperCase()}</div>
        <h2>${displayName}</h2>
        <p class="text-secondary">Chat Direto</p>
      `;
    }

    detailsBody.innerHTML = html;

    // Attach events se for grupo admin
    const btnOpenAddMember = document.getElementById('btn-open-add-member');
    if (btnOpenAddMember) {
      btnOpenAddMember.addEventListener('click', () => {
        // Preencher select
        selectNewMember.innerHTML = '<option value="">Selecione...</option>';
        allUsers.forEach(u => {
          if (!currentChatMembers.find(m => m.id === u.id)) {
            selectNewMember.innerHTML += `<option value="${u.id}">${u.name}</option>`;
          }
        });
        modalAddMember.classList.add('active');
      });
    }
  }

  // Modals Logic
  newGroupBtn.addEventListener('click', () => modalNewGroup.classList.add('active'));
  closeNewGroupBtn.addEventListener('click', () => modalNewGroup.classList.remove('active'));
  closeAddMemberBtn.addEventListener('click', () => modalAddMember.classList.remove('active'));

  formNewGroup.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('group-name').value;
    const desc = document.getElementById('group-desc').value;
    const color = document.getElementById('group-color').value;

    try {
      const res = await fetch('/api/internal-chat/groups', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name, description: desc, color })
      });
      if(res.ok) {
        modalNewGroup.classList.remove('active');
        formNewGroup.reset();
        await loadChatsAndUsers();
      }
    } catch(err) {
      console.error(err);
    }
  });

  formAddMember.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = selectNewMember.value;
    if(!userId || !activeChatId) return;

    try {
      const res = await fetch(`/api/internal-chat/${activeChatId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ userId })
      });
      if(res.ok) {
        modalAddMember.classList.remove('active');
        // Recarregar chat para atualizar lista de membros
        openChat(activeChatId, currentChatInfo.name, currentChatInfo.type, currentChatInfo.color);
      }
    } catch(err) {
      console.error(err);
    }
  });

  logoutBtn.addEventListener('click', () => {
    localStorage.clear();
    window.location.href = '/';
  });

  init();
});
