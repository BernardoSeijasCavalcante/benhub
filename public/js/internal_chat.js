document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('benhub_token');
  if (!token) {
    window.location.href = '/';
    return;
  }

  // Elementos UI Globais
  const currentUser = JSON.parse(localStorage.getItem('benhub_user'));
  document.getElementById('operator-name').textContent = currentUser.name;
  document.getElementById('operator-avatar').textContent = currentUser.name.charAt(0).toUpperCase();

  if (currentUser.role === 'admin') {
    const adminBtn = document.getElementById('admin-btn');
    adminBtn.style.display = 'block';
    adminBtn.addEventListener('click', () => window.location.href = '/admin.html');
  }

  // Socket.IO
  const socket = io();
  socket.emit('authenticate', token);

  // Variáveis de Estado
  let activeChatId = null;
  let activeChatType = null;
  let allMyChats = []; // Array de contatos e grupos carregados
  let currentChatInfo = null;
  let currentChatMembers = [];
  let currentMessages = [];
  let isAdminOfCurrentGroup = false;

  // --- FUNÇÕES UTILITÁRIAS ---
  function playNotificationSound() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
      gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime);
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.start();
      gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.3);
      oscillator.stop(audioCtx.currentTime + 0.3);
    } catch(e) {}
  }

  // --- CARREGAR LISTA DE CONTATOS (PESSOAL + GRUPOS) ---
  async function loadChats() {
    try {
      const res = await fetch('/api/internal-chat/chats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      allMyChats = data.chats || [];
      renderContactsList();
    } catch (err) {
      console.error('Erro ao carregar chats:', err);
    }
  }

  function renderContactsList() {
    const listEl = document.getElementById('contacts-list');
    listEl.innerHTML = '';

    // Ordenar: Fixados primeiro, depois por nome
    const sorted = [...allMyChats].sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return b.is_pinned - a.is_pinned; // 1 antes de 0
      return (a.name || '').localeCompare(b.name || '');
    });

    sorted.forEach(chat => {
      const el = document.createElement('div');
      el.className = `contact-item ${activeChatId === chat.id && chat.id !== null ? 'active' : ''}`;
      
      let avatarLetter = chat.name ? chat.name.charAt(0).toUpperCase() : '?';
      let avatarClass = chat.type === 'group' ? 'group-avatar' : '';
      let style = chat.color ? `background-color: ${chat.color}; color: #000;` : '';
      let isGroup = chat.type === 'group';

      let pinIcon = chat.is_pinned ? '<span class="pin-icon">📌</span>' : '';

      el.innerHTML = `
        <div class="avatar ${avatarClass}" style="${style}">${avatarLetter}</div>
        <div class="contact-info" style="flex:1;">
          <div class="contact-header">
            <span class="contact-name">${chat.name || 'Chat sem nome'}</span>
            ${pinIcon}
          </div>
          <span class="contact-last-msg">${isGroup ? 'Grupo' : 'Contato'}</span>
        </div>
        <div class="contact-actions">
          <button class="btn-pin" title="${chat.is_pinned ? 'Desfixar' : 'Fixar'}">📌</button>
          <button class="btn-remove" title="${isGroup ? 'Sair do Grupo' : 'Remover'}">🗑️</button>
        </div>
      `;

      // Clicar para abrir chat
      el.addEventListener('click', (e) => {
        if (e.target.closest('.contact-actions')) return; // ignora se clicou nos botões
        if (chat.type === 'direct' && chat.id === null) {
          startDirectChat(chat.other_user_id, chat.name);
        } else {
          openChat(chat.id, chat.name, chat.type, chat.color);
        }
      });

      // Botão Fixar
      el.querySelector('.btn-pin').addEventListener('click', async () => {
        const action = chat.is_pinned ? 'unpin' : 'pin';
        const url = isGroup 
          ? `/api/internal-chat/groups/${chat.id}/${action}`
          : `/api/internal-chat/contacts/${chat.other_user_id}/${action}`;
        
        await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
        loadChats();
      });

      // Botão Remover
      el.querySelector('.btn-remove').addEventListener('click', async () => {
        if (!confirm(`Deseja realmente ${isGroup ? 'sair deste grupo' : 'remover este contato'}?`)) return;
        const url = isGroup 
          ? `/api/internal-chat/${chat.id}/leave`
          : `/api/internal-chat/contacts/${chat.other_user_id}`;
        
        await fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
        if (activeChatId === chat.id) closeChat();
        loadChats();
      });

      listEl.appendChild(el);
    });

    if(sorted.length === 0) {
      listEl.innerHTML = '<div style="padding:15px; text-align:center; color:#666;">Use a barra de pesquisa para adicionar colegas à sua lista.</div>';
    }
  }

  // --- PESQUISA GLOBAL E LOCAL ---
  const searchInput = document.getElementById('search-contact');
  const searchResults = document.getElementById('search-results');
  let searchTimeout;

  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const q = e.target.value.trim().toLowerCase();
    
    // 1. Filtro Local
    document.querySelectorAll('#contacts-list .contact-item').forEach(el => {
      const name = el.querySelector('.contact-name').textContent.toLowerCase();
      el.style.display = name.includes(q) ? 'flex' : 'none';
    });

    if (!q) {
      searchResults.style.display = 'none';
      searchResults.innerHTML = '';
      return;
    }
    
    // 2. Pesquisa Global
    searchTimeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/internal-chat/search/users?q=${encodeURIComponent(q)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        searchResults.innerHTML = '<div style="padding:5px 10px; font-size:11px; color:var(--accent-gold); text-transform:uppercase; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:5px;">Pesquisa Global</div>';
        
        if (data.users.length === 0) {
          searchResults.innerHTML += '<div style="padding:10px;color:#999;font-size:12px;">Nenhum outro usuário encontrado.</div>';
        } else {
          data.users.forEach(u => {
            // Verifica se já está na lista local
            const existingContact = allMyChats.find(c => c.type === 'direct' && c.other_user_id === u.id);
            
            const el = document.createElement('div');
            el.className = 'search-item';
            
            if (existingContact) {
              el.innerHTML = `
                <span>${u.name}</span>
                <button class="btn-add-contact" style="background:var(--bg-secondary); border:1px solid var(--accent-gold); color:var(--accent-gold);">Conversar</button>
              `;
              el.querySelector('button').addEventListener('click', () => {
                searchInput.value = '';
                searchResults.style.display = 'none';
                // Trigger evento local para restaurar a lista
                searchInput.dispatchEvent(new Event('input'));
                
                if (existingContact.id === null) {
                  startDirectChat(existingContact.other_user_id, existingContact.name);
                } else {
                  openChat(existingContact.id, existingContact.name, 'direct', existingContact.color);
                }
              });
            } else {
              el.innerHTML = `
                <span>${u.name}</span>
                <button class="btn-add-contact">Adicionar</button>
              `;
              el.querySelector('button').addEventListener('click', async () => {
                await fetch('/api/internal-chat/contacts', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                  body: JSON.stringify({ contactId: u.id })
                });
                searchInput.value = '';
                searchResults.style.display = 'none';
                searchInput.dispatchEvent(new Event('input'));
                await loadChats();
                
                // Tenta abrir o chat diretamente após adicionar
                const newContact = allMyChats.find(c => c.type === 'direct' && c.other_user_id === u.id);
                if (newContact) {
                  if (newContact.id === null) startDirectChat(newContact.other_user_id, newContact.name);
                  else openChat(newContact.id, newContact.name, 'direct');
                }
              });
            }
            
            searchResults.appendChild(el);
          });
        }
        searchResults.style.display = 'block';
      } catch (err) {
        console.error(err);
      }
    }, 300);
  });

  // --- ABRIR E GERENCIAR CHAT ---
  async function startDirectChat(targetUserId, targetUserName) {
    try {
      const res = await fetch('/api/internal-chat/direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ targetUserId })
      });
      const data = await res.json();
      await loadChats();
      openChat(data.chatId, targetUserName, 'direct');
    } catch (error) {
      console.error(error);
    }
  }

  function closeChat() {
    activeChatId = null;
    document.getElementById('empty-state').style.display = 'flex';
    document.getElementById('active-chat').style.display = 'none';
    document.getElementById('sidebar-right').classList.remove('active');
  }

  async function openChat(chatId, chatName, chatType, color = null) {
    if (activeChatId) socket.emit('leave_internal_chat', activeChatId);
    activeChatId = chatId;
    activeChatType = chatType;
    socket.emit('join_internal_chat', chatId);

    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('active-chat').style.display = 'flex';
    
    document.getElementById('chat-contact-name').textContent = chatName;
    document.getElementById('chat-contact-desc').textContent = chatType === 'group' ? 'Grupo' : 'Chat Direto';
    const avatar = document.getElementById('chat-avatar');
    avatar.textContent = chatName.charAt(0).toUpperCase();
    if(color) {
      avatar.style.backgroundColor = color;
      avatar.style.color = '#000';
    } else {
      avatar.style.backgroundColor = 'var(--primary-color)';
      avatar.style.color = '#fff';
    }

    renderContactsList(); // Atualizar item ativo
    document.getElementById('chat-messages').innerHTML = '<div class="loading">Carregando mensagens...</div>';

    try {
      const res = await fetch(`/api/internal-chat/${chatId}/messages`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      currentChatInfo = data.chatInfo;
      currentChatMembers = data.members;
      currentMessages = data.messages;
      
      const myMemberInfo = currentChatMembers.find(m => m.id === currentUser.id);
      isAdminOfCurrentGroup = myMemberInfo && myMemberInfo.role === 'admin';

      renderMessages();
      renderDetailsPanel();
    } catch (error) {
      console.error(error);
    }
  }

  function renderMessages() {
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    
    currentMessages.forEach(msg => {
      container.appendChild(createMessageElement(msg));
    });
    
    container.scrollTop = container.scrollHeight;
    renderPinnedBar();
  }

  function createMessageElement(msg) {
    const isMine = msg.sender_id === currentUser.id;
    const el = document.createElement('div');
    el.className = `message ${isMine ? 'operator' : 'customer'}`;
    el.dataset.msgId = msg.id;
    
    const timeString = msg.created_at.includes('Z') ? msg.created_at : msg.created_at + 'Z';
    const time = new Date(timeString).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    let contentHtml = '';
    if (msg.is_forwarded) {
      contentHtml += `<div class="forwarded-label">↪ Encaminhada</div>`;
    }

    if (msg.content_type === 'text') {
      contentHtml += `<p class="text">${msg.content}</p>`;
    } else if (msg.content_type === 'image') {
      contentHtml += `<img src="${msg.file_url}" class="message-image" alt="Imagem enviada" onclick="window.openFileViewer('${msg.file_url}', 'Imagem')">`;
      if(msg.content) contentHtml += `<p class="text" style="font-size:12px; margin-top:5px;">${msg.content}</p>`;
    } else if (msg.content_type === 'file') {
      contentHtml += `<a class="message-file" onclick="window.openFileViewer('${msg.file_url}', '${msg.content}')">📄 ${msg.content}</a>`;
    }

    let senderNameHtml = !isMine && activeChatType === 'group'
      ? `<div style="font-size: 0.75rem; font-weight: 600; color: var(--accent-gold); margin-bottom: 4px;">${msg.sender_name}</div>` 
      : '';

    // Reactions HTML
    let reactionsHtml = '';
    if (msg.reactions && msg.reactions.length > 0) {
      // Group reactions by emoji
      const groups = {};
      msg.reactions.forEach(r => {
        if(!groups[r.reaction]) groups[r.reaction] = [];
        groups[r.reaction].push(r);
      });
      reactionsHtml = `<div class="reactions-container">`;
      for (const [emoji, reacts] of Object.entries(groups)) {
        const hasMe = reacts.some(r => r.user_id === currentUser.id);
        const title = reacts.map(r => r.userName).join(', ');
        reactionsHtml += `<div class="reaction-badge" title="${title}" style="${hasMe ? 'border-color:var(--accent-gold);' : ''}">${emoji} ${reacts.length}</div>`;
      }
      reactionsHtml += `</div>`;
    }

    el.innerHTML = `
      <div class="message-content">
        ${senderNameHtml}
        ${contentHtml}
        ${reactionsHtml}
      </div>
      <div class="message-meta">
        <span>${time}</span>
      </div>
      
      <!-- Actions Button -->
      <button class="message-actions-trigger">⚙️</button>
      
      <!-- Actions Menu -->
      <div class="message-actions-menu">
        <button class="btn-act-react">Reagir</button>
        <button class="btn-act-forward">Encaminhar</button>
        <button class="btn-act-pin">${msg.is_pinned ? 'Desfixar' : 'Fixar'}</button>
      </div>

      <!-- Emoji Picker -->
      <div class="reaction-picker">
        <button>👍</button>
        <button>❤️</button>
        <button>😂</button>
        <button>😮</button>
        <button>😢</button>
      </div>
    `;

    // Eventos do Menu
    const trigger = el.querySelector('.message-actions-trigger');
    const menu = el.querySelector('.message-actions-menu');
    const picker = el.querySelector('.reaction-picker');

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close all other menus
      document.querySelectorAll('.message-actions-menu, .reaction-picker').forEach(m => m.style.display = 'none');
      menu.style.display = 'flex';
    });

    document.addEventListener('click', () => {
      menu.style.display = 'none';
      picker.style.display = 'none';
    });

    // Reações
    el.querySelector('.btn-act-react').addEventListener('click', (e) => {
      e.stopPropagation();
      menu.style.display = 'none';
      picker.style.display = 'flex';
    });

    picker.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const emoji = btn.textContent;
        picker.style.display = 'none';
        
        // Check if I already reacted with this emoji
        const myReact = (msg.reactions || []).find(r => r.user_id === currentUser.id && r.reaction === emoji);
        const method = myReact ? 'DELETE' : 'POST';

        try {
          await fetch(`/api/internal-chat/${activeChatId}/messages/${msg.id}/reactions`, {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ reaction: emoji })
          });
        } catch(err) {}
      });
    });

    // Clique nas badges existentes (para remover)
    el.querySelectorAll('.reaction-badge').forEach(badge => {
      badge.addEventListener('click', async (e) => {
        e.stopPropagation();
        const emoji = badge.textContent.split(' ')[0];
        try {
          await fetch(`/api/internal-chat/${activeChatId}/messages/${msg.id}/reactions`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ reaction: emoji })
          });
        } catch(err) {}
      });
    });

    // Encaminhar
    el.querySelector('.btn-act-forward').addEventListener('click', (e) => {
      e.stopPropagation();
      menu.style.display = 'none';
      openForwardModal(msg.id);
    });

    // Fixar
    el.querySelector('.btn-act-pin').addEventListener('click', async (e) => {
      e.stopPropagation();
      menu.style.display = 'none';
      const action = msg.is_pinned ? 'unpin' : 'pin';
      await fetch(`/api/internal-chat/${activeChatId}/messages/${msg.id}/${action}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    });

    return el;
  }

  // --- PINNED BAR ---
  function renderPinnedBar() {
    const bar = document.getElementById('pinned-messages-container');
    const pinnedMsgs = currentMessages.filter(m => m.is_pinned);
    
    if (pinnedMsgs.length === 0) {
      bar.style.display = 'none';
      bar.innerHTML = '';
      return;
    }

    bar.style.display = 'flex';
    bar.innerHTML = '';
    
    pinnedMsgs.forEach(msg => {
      const item = document.createElement('div');
      item.className = 'pinned-message-item';
      
      let text = msg.content_type === 'text' ? msg.content : (msg.content_type === 'image' ? '📷 Imagem' : '📄 ' + msg.content);
      
      item.innerHTML = `
        <div class="content-preview"><b>${msg.sender_name}:</b> ${text}</div>
        <button class="unpin-btn" title="Desfixar">✖</button>
      `;

      item.querySelector('.unpin-btn').addEventListener('click', async () => {
        await fetch(`/api/internal-chat/${activeChatId}/messages/${msg.id}/unpin`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      });

      // Scroll to msg
      item.querySelector('.content-preview').addEventListener('click', () => {
        const msgEl = document.querySelector(`.message[data-msg-id="${msg.id}"]`);
        if(msgEl) msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });

      bar.appendChild(item);
    });
  }

  // --- SOCKET EVENTS ---
  socket.on('receive_internal_message', (msg) => {
    if (activeChatId == msg.chat_id) {
      if (!currentMessages.find(m => m.id === msg.id)) {
        currentMessages.push(msg);
        const container = document.getElementById('chat-messages');
        const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
        container.appendChild(createMessageElement(msg));
        if (isAtBottom) container.scrollTop = container.scrollHeight;
      }
    } else {
      if (msg.sender_id !== currentUser.id) playNotificationSound();
    }
  });

  socket.on('message_pinned', (data) => {
    if (activeChatId == data.chatId) {
      const msg = currentMessages.find(m => m.id == data.messageId);
      if (msg) msg.is_pinned = 1;
      renderMessages();
    }
  });

  socket.on('message_unpinned', (data) => {
    if (activeChatId == data.chatId) {
      const msg = currentMessages.find(m => m.id == data.messageId);
      if (msg) msg.is_pinned = 0;
      renderMessages();
    }
  });

  socket.on('reaction_added', (data) => {
    if (activeChatId == data.chatId) {
      const msg = currentMessages.find(m => m.id == data.messageId);
      if (msg) {
        msg.reactions = msg.reactions || [];
        msg.reactions.push({ user_id: data.userId, userName: data.userName, reaction: data.reaction });
        renderMessages();
      }
    }
  });

  socket.on('reaction_removed', (data) => {
    if (activeChatId == data.chatId) {
      const msg = currentMessages.find(m => m.id == data.messageId);
      if (msg && msg.reactions) {
        msg.reactions = msg.reactions.filter(r => !(r.user_id == data.userId && r.reaction == data.reaction));
        renderMessages();
      }
    }
  });

  // --- ENVIAR MENSAGEM / DRAG & DROP ---
  document.getElementById('send-message-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeChatId) return;

    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    await fetch(`/api/internal-chat/${activeChatId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ content: text, content_type: 'text' })
    });
  });

  // File Upload via botão
  const fileInput = document.getElementById('file-input');
  document.getElementById('btn-attach-file').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => handleFileUpload(fileInput.files));

  // Drag & Drop
  const chatArea = document.querySelector('.chat-area');
  const dragOverlay = document.getElementById('drag-overlay');

  chatArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    dragOverlay.classList.add('active');
  });
  chatArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragOverlay.classList.remove('active');
  });
  chatArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dragOverlay.classList.remove('active');
    if(e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  });

  async function handleFileUpload(files) {
    if (!files.length || !activeChatId) return;
    const formData = new FormData();
    formData.append('file', files[0]);

    try {
      await fetch(`/api/internal-chat/${activeChatId}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      fileInput.value = '';
    } catch (err) {
      alert('Erro ao enviar arquivo.');
    }
  }

  // --- MODAL ENCAMINHAR ---
  let forwardingMsgId = null;
  const modalForward = document.getElementById('modal-forward');
  const listForward = document.getElementById('forward-list');
  const btnConfirmForward = document.getElementById('btn-confirm-forward');
  const searchForward = document.getElementById('forward-search');

  function openForwardModal(msgId) {
    forwardingMsgId = msgId;
    renderForwardList();
    modalForward.classList.add('active');
    updateForwardBtnText();
  }

  function renderForwardList(filterText = '') {
    listForward.innerHTML = '';
    const query = filterText.toLowerCase();

    allMyChats.forEach(chat => {
      const name = chat.name || '';
      if (!name.toLowerCase().includes(query)) return;

      const el = document.createElement('label');
      el.className = 'forward-item';
      
      const isGroup = chat.type === 'group';
      const idVal = isGroup ? `group_${chat.id}` : `direct_${chat.other_user_id}`;

      el.innerHTML = `
        <input type="checkbox" value="${idVal}">
        <div class="avatar" style="width:30px; height:30px; font-size:14px; margin-right:10px; ${chat.color ? `background:${chat.color};color:#000` : ''}">
          ${name.charAt(0).toUpperCase()}
        </div>
        <span class="contact-name">${name}</span>
      `;
      el.querySelector('input').addEventListener('change', updateForwardBtnText);
      listForward.appendChild(el);
    });
  }

  searchForward.addEventListener('input', (e) => renderForwardList(e.target.value));

  function updateForwardBtnText() {
    const checked = listForward.querySelectorAll('input:checked').length;
    btnConfirmForward.textContent = `Encaminhar (${checked})`;
    btnConfirmForward.disabled = checked === 0;
  }

  document.getElementById('close-forward').addEventListener('click', () => {
    modalForward.classList.remove('active');
  });

  btnConfirmForward.addEventListener('click', async () => {
    const checkboxes = listForward.querySelectorAll('input:checked');
    const targetChatIds = [];
    const targetUserIds = [];

    checkboxes.forEach(cb => {
      const [type, id] = cb.value.split('_');
      if (type === 'group') targetChatIds.push(parseInt(id));
      else targetUserIds.push(parseInt(id));
    });

    try {
      await fetch('/api/internal-chat/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ originalMessageId: forwardingMsgId, targetChatIds, targetUserIds })
      });
      modalForward.classList.remove('active');
    } catch(err) {
      console.error(err);
    }
  });


  // --- DETAILS E OUTROS MODALS (SIMPLIFICADO) ---
  document.getElementById('toggle-details-btn').addEventListener('click', () => {
    document.getElementById('sidebar-right').classList.toggle('active');
  });
  document.getElementById('close-details-btn').addEventListener('click', () => {
    document.getElementById('sidebar-right').classList.remove('active');
  });

  function renderDetailsPanel() {
    const body = document.getElementById('details-body');
    if (!currentChatInfo) return;

    if (currentChatInfo.type === 'group') {
      let html = `
        <div class="detail-avatar group-avatar" style="background-color: ${currentChatInfo.color || '#333'}">${(currentChatInfo.name || '?').charAt(0).toUpperCase()}</div>
        <h2>${currentChatInfo.name}</h2>
        <p class="text-secondary">${currentChatInfo.description || 'Sem descrição'}</p>
        <h4 style="margin-top:20px;">Membros (${currentChatMembers.length})</h4>
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
        html += `<button id="btn-open-add-member" class="btn-primary" style="margin-top: 15px;">➕ Adicionar Membro</button>`;
      }
      body.innerHTML = html;

      // Modal Add Membro
      const btnOpenAddMember = document.getElementById('btn-open-add-member');
      if (btnOpenAddMember) {
        btnOpenAddMember.addEventListener('click', async () => {
          // Fetch global users pra adicionar
          const res = await fetch(`/api/internal-chat/search/users?q=`, { headers: { 'Authorization': `Bearer ${token}` }});
          const data = await res.json();
          const select = document.getElementById('select-new-member');
          select.innerHTML = '<option value="">Selecione...</option>';
          data.users.forEach(u => {
            if (!currentChatMembers.find(m => m.id === u.id)) {
              select.innerHTML += `<option value="${u.id}">${u.name}</option>`;
            }
          });
          document.getElementById('modal-add-member').classList.add('active');
        });
      }
    } else {
      const displayName = currentChatInfo.name || 'Contato';
      body.innerHTML = `
        <div class="detail-avatar">${displayName.charAt(0).toUpperCase()}</div>
        <h2>${displayName}</h2>
        <p class="text-secondary">Chat Direto</p>
      `;
    }
  }

  // Novo grupo form (simplificado)
  document.getElementById('new-group-btn').addEventListener('click', () => {
    document.getElementById('modal-new-group').classList.add('active');
  });
  document.getElementById('close-new-group').addEventListener('click', () => {
    document.getElementById('modal-new-group').classList.remove('active');
  });
  document.getElementById('form-new-group').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('group-name').value;
    const description = document.getElementById('group-desc').value;
    const color = document.getElementById('group-color').value;

    await fetch('/api/internal-chat/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ name, description, color })
    });
    document.getElementById('modal-new-group').classList.remove('active');
    document.getElementById('form-new-group').reset();
    loadChats();
  });

  // Adicionar Membro Modal logic
  document.getElementById('close-add-member').addEventListener('click', () => {
    document.getElementById('modal-add-member').classList.remove('active');
  });
  document.getElementById('form-add-member').addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = document.getElementById('select-new-member').value;
    if(!userId || !activeChatId) return;
    await fetch(`/api/internal-chat/${activeChatId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ userId })
    });
    document.getElementById('modal-add-member').classList.remove('active');
    openChat(activeChatId, currentChatInfo.name, currentChatInfo.type, currentChatInfo.color);
  });

  // File Viewer
  const modalFileViewer = document.getElementById('modal-file-viewer');
  const fileViewerBody = document.getElementById('file-viewer-body');
  document.getElementById('close-file-viewer').addEventListener('click', () => {
    modalFileViewer.classList.remove('active');
    fileViewerBody.innerHTML = '';
  });
  window.openFileViewer = async function(url, name) {
    document.getElementById('file-viewer-title').textContent = name || 'Visualizador';
    fileViewerBody.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">Carregando...</div>';
    const btnDown = document.getElementById('download-file-btn');
    if (url) {
      btnDown.href = url; btnDown.download = name || 'arquivo'; btnDown.style.display = 'inline-block';
    } else {
      btnDown.style.display = 'none';
    }
    modalFileViewer.classList.add('active');
    const ext = name && name !== 'Imagem' ? name.split('.').pop().toLowerCase() : '';
    if (ext === 'pdf' || ext === 'txt') {
      fileViewerBody.innerHTML = `<iframe src="${url}"></iframe>`;
    } else if (ext === 'docx') {
      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        if (typeof mammoth !== 'undefined') {
          const result = await mammoth.convertToHtml({arrayBuffer: arrayBuffer});
          fileViewerBody.innerHTML = `<div class="mammoth-docx-container">${result.value}</div>`;
        } else {
          fileViewerBody.innerHTML = `<div style="padding: 20px; color: red;">Erro: Biblioteca mammoth.js não carregada.</div>`;
        }
      } catch (err) {
        fileViewerBody.innerHTML = `<div style="padding: 20px; color: red;">Erro ao carregar o documento DOCX.</div>`;
      }
    } else {
      fileViewerBody.innerHTML = `<img src="${url}" alt="${name}">`;
    }
  };

  document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.clear();
    window.location.href = '/';
  });

  loadChats();
});
