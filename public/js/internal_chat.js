document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('benhub_token');
  if (!token) {
    window.location.href = '/';
    return;
  }

  // Elementos UI Globais
  const currentUser = JSON.parse(localStorage.getItem('benhub_user'));
  document.getElementById('operator-name').textContent = currentUser.name;
  const operatorAvatar = document.getElementById('operator-avatar');
  if (currentUser.photo_url) {
    operatorAvatar.textContent = '';
    operatorAvatar.style.backgroundImage = `url(${currentUser.photo_url})`;
    operatorAvatar.style.backgroundSize = 'cover';
    operatorAvatar.style.backgroundPosition = 'center';
  } else {
    operatorAvatar.textContent = currentUser.name.charAt(0).toUpperCase();
  }

  const profilePhotoInput = document.getElementById('profile-photo-input');
  if (profilePhotoInput) {
    operatorAvatar.addEventListener('click', () => {
      profilePhotoInput.click();
    });
    profilePhotoInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('photo', file);
      try {
        const res = await fetch('/api/auth/upload-photo', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        });
        const data = await res.json();
        if (data.photo_url) {
          currentUser.photo_url = data.photo_url;
          localStorage.setItem('benhub_user', JSON.stringify(currentUser));
          operatorAvatar.textContent = '';
          operatorAvatar.style.backgroundImage = `url(${data.photo_url})`;
          operatorAvatar.style.backgroundSize = 'cover';
          operatorAvatar.style.backgroundPosition = 'center';
        }
      } catch (err) {
        console.error('Erro ao enviar foto:', err);
      }
    });
  }

  // Lógica de visualização expandida de fotos de perfis (avatares)
  const imageViewerModal = document.getElementById('modal-image-viewer');
  const expandedImage = document.getElementById('expanded-image');
  const closeImageViewerBtn = document.getElementById('close-image-viewer');
  
  if (closeImageViewerBtn) {
    closeImageViewerBtn.addEventListener('click', () => {
      imageViewerModal.classList.remove('active');
    });
  }

  if (imageViewerModal) {
    imageViewerModal.addEventListener('click', (e) => {
      if (e.target.id === 'modal-image-viewer' || e.target.classList.contains('modal-content')) {
        imageViewerModal.classList.remove('active');
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && imageViewerModal && imageViewerModal.classList.contains('active')) {
      imageViewerModal.classList.remove('active');
    }
  });

  document.addEventListener('click', (e) => {
    const avatarTarget = e.target.closest('.avatar, .detail-avatar');
    if (avatarTarget && avatarTarget.id !== 'operator-avatar') {
      const bgImage = avatarTarget.style.backgroundImage;
      if (bgImage && bgImage !== 'none') {
        const url = bgImage.slice(4, -1).replace(/["']/g, "");
        expandedImage.src = url;
        imageViewerModal.classList.add('active');
      }
    }
  });

  if (currentUser.role === 'admin') {
    const adminBtn = document.getElementById('admin-btn');
    adminBtn.style.display = 'block';
    adminBtn.addEventListener('click', () => window.location.href = '/admin.html');
  }

  // Socket.IO
  const socket = io();
  socket.on('connect', () => {
    socket.emit('authenticate', token);
  });

  socket.on('force_logout', () => {
    alert('Você fez login em outro dispositivo. Esta sessão foi encerrada.');
    localStorage.removeItem('benhub_token');
    localStorage.removeItem('benhub_user');
    window.location.href = '/';
  });

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

  function showNotification(title, message, chatId, chatType, color, photoUrl) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'chat-toast';
    toast.innerHTML = `
      <div class="chat-toast-header">
        <span>${title}</span>
        <button style="background:none;border:none;color:white;cursor:pointer;">✖</button>
      </div>
      <div class="chat-toast-body">${message}</div>
    `;

    toast.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      toast.remove();
    });

    toast.addEventListener('click', () => {
      toast.remove();
      const chat = allMyChats.find(c => c.id === chatId) || allMyChats.find(c => c.type === 'direct' && c.other_user_id === chatId);
      if (chat) {
        if (chat.type === 'direct' && chat.id === null) {
          startDirectChat(chat.other_user_id, chat.name);
        } else {
          openChat(chat.id, chat.name, chat.type, chat.color, chat.photo_url);
        }
      } else {
        openChat(chatId, title, chatType, color, photoUrl);
      }
    });

    container.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 5000);
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

    // Ordenar: Fixados primeiro, depois por last_message_at, depois por nome
    const sorted = [...allMyChats].sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return b.is_pinned - a.is_pinned; // 1 antes de 0
      
      const timeA = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const timeB = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      if (timeA !== timeB) return timeB - timeA; // Mais recente primeiro

      return (a.name || '').localeCompare(b.name || '');
    });

    sorted.forEach(chat => {
      const el = document.createElement('div');
      el.className = `contact-item ${activeChatId === chat.id && chat.id !== null ? 'active' : ''}`;
      
      let avatarLetter = '';
      let avatarClass = chat.type === 'group' ? 'group-avatar' : '';
      let style = chat.color ? `background-color: ${chat.color}; color: #000;` : '';
      if (chat.photo_url) {
        style += `background-image: url(${chat.photo_url}); background-size: cover; background-position: center;`;
      } else {
        avatarLetter = chat.name ? chat.name.charAt(0).toUpperCase() : '?';
      }
      const isGroup = chat.type === 'group';
      const pinIcon = chat.is_pinned ? '<span title="Fixado" style="font-size:10px; margin-left:5px;">📌</span>' : '';
      const lockIcon = (chat.type === 'direct' && chat.is_allowed === false) ? '<span title="Acesso Restrito" style="font-size:12px; margin-left:5px;">🔒</span>' : '';
      const unreadBadge = chat.unread_count > 0 ? `<div class="unread-badge">${chat.unread_count}</div>` : '';

      el.innerHTML = `
        <div class="avatar ${avatarClass}" style="${style}">${avatarLetter}</div>
        <div class="contact-info" style="flex:1; display:flex; align-items:center;">
          <div style="flex:1; overflow:hidden;">
            <div class="contact-header" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              <span class="contact-name">${(chat.name || 'Chat sem nome') + (chat.is_active === 0 ? ' (Inativo)' : '')}</span>
              ${pinIcon}${lockIcon}
            </div>
            <span class="contact-last-msg">${isGroup ? 'Grupo' : 'Contato'}</span>
          </div>
          ${unreadBadge}
        </div>
        <div class="contact-actions">
          <button class="btn-pin" title="${chat.is_pinned ? 'Desfixar' : 'Fixar'}">📌</button>
          ${!isGroup ? '<button class="btn-remove" title="Remover">🗑️</button>' : ''}
        </div>
      `;

      // Clicar para abrir chat
      el.addEventListener('click', (e) => {
        if (e.target.closest('.contact-actions')) return; // ignora se clicou nos botões
        
        if (chat.type === 'direct' && chat.is_allowed === false) {
          alert('Acesso restrito. Sua hierarquia atual não permite iniciar ou visualizar este chat direto.');
          return;
        }

        if (chat.type === 'direct' && chat.id === null) {
          startDirectChat(chat.other_user_id, chat.name);
        } else {
          openChat(chat.id, chat.name, chat.type, chat.color, chat.photo_url);
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

      // Botão Remover (Somente para contatos diretos)
      const btnRemove = el.querySelector('.btn-remove');
      if (btnRemove) {
        btnRemove.addEventListener('click', async () => {
          if (!confirm('Deseja realmente remover este contato?')) return;
          const url = `/api/internal-chat/contacts/${chat.other_user_id}`;
          
          await fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
          if (activeChatId === chat.id) closeChat();
          loadChats();
        });
      }

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
              const lockIcon = !u.is_allowed ? ' <span title="Acesso Restrito" style="font-size: 12px;">🔒</span>' : '';
              el.innerHTML = `
                <span>${u.name}${lockIcon}</span>
                <button class="btn-add-contact" style="background:var(--bg-secondary); border:1px solid var(--accent-gold); color:var(--accent-gold);">Conversar</button>
              `;
              el.querySelector('button').addEventListener('click', () => {
                if (!u.is_allowed) {
                  alert('Acesso restrito. Sua hierarquia atual não permite contatar este usuário diretamente.');
                  return;
                }
                
                searchInput.value = '';
                searchResults.style.display = 'none';
                // Trigger evento local para restaurar a lista
                searchInput.dispatchEvent(new Event('input'));
                
                if (existingContact.id === null) {
                  startDirectChat(existingContact.other_user_id, existingContact.name);
                } else {
                  openChat(existingContact.id, existingContact.name, 'direct', existingContact.color, existingContact.photo_url);
                }
              });
            } else {
              const lockIcon = !u.is_allowed ? ' <span title="Acesso Restrito" style="font-size: 12px;">🔒</span>' : '';
              el.innerHTML = `
                <span>${u.name}${lockIcon}</span>
                <button class="btn-add-contact">Adicionar</button>
              `;
              el.querySelector('button').addEventListener('click', async () => {
                if (!u.is_allowed) {
                  alert('Acesso restrito. Sua hierarquia atual não permite contatar este usuário diretamente.');
                  return;
                }
                
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
                  else openChat(newContact.id, newContact.name, 'direct', null, currentUser.photo_url); // Corrigindo user para currentUser
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
      
      if (!res.ok) {
        alert(data.error || 'Erro ao iniciar chat.');
        closeChat();
        return;
      }
      
      await loadChats();
      openChat(data.chatId, targetUserName, 'direct', null, null); // Photo will be loaded if available when list refreshes
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

  async function openChat(chatId, chatName, chatType, color = null, photoUrl = null) {
    if (activeChatId) {
      socket.emit('leave_internal_chat', activeChatId);
    }
    activeChatId = chatId;
    activeChatType = chatType;
    socket.emit('join_internal_chat', chatId);

    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('active-chat').style.display = 'flex';
    
    document.getElementById('chat-contact-name').textContent = chatName;
    document.getElementById('chat-contact-desc').textContent = chatType === 'group' ? 'Grupo' : 'Chat Direto';
    const avatar = document.getElementById('chat-avatar');
    
    if (photoUrl) {
      avatar.textContent = '';
      avatar.style.backgroundImage = `url(${photoUrl})`;
      avatar.style.backgroundSize = 'cover';
      avatar.style.backgroundPosition = 'center';
      avatar.style.backgroundColor = 'transparent';
    } else {
      avatar.style.backgroundImage = 'none';
      avatar.textContent = chatName.charAt(0).toUpperCase();
      if(color) {
        avatar.style.backgroundColor = color;
        avatar.style.color = '#000';
      } else {
        avatar.style.backgroundColor = 'var(--primary-color)';
        avatar.style.color = '#fff';
      }
    }

    // Marcar como lido
    fetch(`/api/internal-chat/${chatId}/read`, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } }).catch(e => console.error(e));
    const localChat = allMyChats.find(c => c.id === chatId);
    if (localChat) {
      localChat.unread_count = 0;
    }

    renderContactsList(); // Atualizar item ativo
    document.getElementById('chat-messages').innerHTML = '<div class="loading">Carregando mensagens...</div>';
    
    // Banner e envio de inativos
    const banner = document.getElementById('inactive-chat-banner');
    const footer = document.getElementById('chat-footer');
    if (localChat && localChat.is_active === 0) {
      if (banner) banner.style.display = 'block';
      if (footer) footer.style.display = 'none';
    } else {
      if (banner) banner.style.display = 'none';
      if (footer) footer.style.display = 'flex';
    }

    try {
      const res = await fetch(`/api/internal-chat/${chatId}/messages`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      currentChatInfo = data.chatInfo;
      currentChatMembers = data.members;
      currentMessages = data.messages;
      window.currentChatExplicitPermission = data.explicitPermission; // guardando globalmente para usar no painel
      
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
    
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'flex-end';
    wrapper.style.gap = '8px';
    wrapper.style.alignSelf = isMine ? 'flex-end' : 'flex-start';
    if (isMine) wrapper.style.flexDirection = 'row-reverse';

    let avatarHtml = '';
    if (!isMine) {
      let style = msg.sender_photo_url ? `background-image: url(${msg.sender_photo_url}); background-size: cover; background-position: center; color: transparent;` : '';
      let letter = msg.sender_photo_url ? '' : (msg.sender_name ? msg.sender_name.charAt(0).toUpperCase() : '?');
      avatarHtml = `<div class="avatar detail-avatar" style="width: 30px; height: 30px; font-size: 14px; flex-shrink: 0; cursor: pointer; ${style}" title="${msg.sender_name}">${letter}</div>`;
    }

    const el = document.createElement('div');
    el.className = `message ${isMine ? 'operator' : 'customer'}`;
    el.dataset.msgId = msg.id;
    el.style.margin = '0';
    
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
        
        // Mantém como lido
        fetch(`/api/internal-chat/${activeChatId}/read`, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } }).catch(e => console.error(e));
      }
    } else {
      if (msg.sender_id !== currentUser.id) {
        playNotificationSound();
        
        // Atualizar lista local
        let chat = allMyChats.find(c => c.id === msg.chat_id);
        if (chat) {
          chat.unread_count = (chat.unread_count || 0) + 1;
          chat.last_message_at = msg.created_at;
          renderContactsList();
          
          let preview = msg.content_type === 'text' ? msg.content : (msg.content_type === 'image' ? '📷 Imagem' : '📄 Arquivo');
          showNotification(chat.name, preview, chat.id, chat.type, chat.color, chat.photo_url);
        } else {
          // Chat não carregado, recarregar a lista toda
          loadChats().then(() => {
            chat = allMyChats.find(c => c.id === msg.chat_id);
            if (chat) {
              let preview = msg.content_type === 'text' ? msg.content : (msg.content_type === 'image' ? '📷 Imagem' : '📄 Arquivo');
              showNotification(chat.name, preview, chat.id, chat.type, chat.color, chat.photo_url);
            }
          });
        }
      }
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

  // CTRL+V Paste Event
  document.addEventListener('paste', (e) => {
    if (!activeChatId) return;
    const items = e.clipboardData.items;
    let imageFile = null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        imageFile = items[i].getAsFile();
        break;
      }
    }
    if (imageFile) {
      e.preventDefault();
      openPasteModal(imageFile);
    }
  });

  // Image Paste Modal Logic
  let fileToUpload = null;
  const modalPasteImage = document.getElementById('modal-paste-image');
  const pasteImagePreview = document.getElementById('paste-image-preview');
  const pasteImageCaption = document.getElementById('paste-image-caption');

  if (document.getElementById('close-paste-image')) {
    document.getElementById('close-paste-image').addEventListener('click', () => {
      modalPasteImage.classList.remove('active');
      fileToUpload = null;
    });
  }

  if (document.getElementById('form-paste-image')) {
    document.getElementById('form-paste-image').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!activeChatId || !fileToUpload) return;
      
      const formData = new FormData();
      formData.append('file', fileToUpload);
      if (pasteImageCaption.value.trim()) {
        formData.append('caption', pasteImageCaption.value.trim());
      }

      const btn = document.getElementById('btn-send-paste-image');
      btn.disabled = true;
      btn.textContent = 'Enviando...';

      try {
        await fetch(`/api/internal-chat/${activeChatId}/upload`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        });
        modalPasteImage.classList.remove('active');
      } catch (err) {
        alert('Erro ao enviar imagem.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Enviar';
        fileToUpload = null;
      }
    });
  }

  function openPasteModal(file) {
    fileToUpload = file;
    const url = URL.createObjectURL(file);
    pasteImagePreview.src = url;
    pasteImageCaption.value = '';
    modalPasteImage.classList.add('active');
    setTimeout(() => pasteImageCaption.focus(), 100);
  }

  async function handleFileUpload(files) {
    if (!files.length || !activeChatId) return;
    const file = files[0];
    
    if (file.type.startsWith('image/')) {
      openPasteModal(file);
      fileInput.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

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
    document.getElementById('sidebar-right').classList.toggle('hidden');
  });
  document.getElementById('close-details-btn').addEventListener('click', () => {
    document.getElementById('sidebar-right').classList.add('hidden');
  });

  function renderDetailsPanel() {
    const body = document.getElementById('details-body');
    if (!currentChatInfo) return;

    if (currentChatInfo.type === 'group') {
      let avatarStyle = currentChatInfo.photo_url 
        ? `background-image: url(${currentChatInfo.photo_url}); background-size: cover; color: transparent; border: none; cursor: pointer;`
        : `background-color: ${currentChatInfo.color || '#333'}; cursor: pointer;`;

      let adminEditHtml = isAdminOfCurrentGroup ? `
        <div class="edit-group-photo-btn" style="position: absolute; bottom: 0; right: -5px; background: var(--primary-color); border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.5);" title="Alterar foto do grupo">
          <span style="font-size: 12px; color: white;">✏️</span>
        </div>
        <input type="file" id="group-photo-input" accept="image/*" style="display: none;">
      ` : '';

      let html = `
        <div style="position: relative; display: inline-block; margin-bottom: 10px;">
          <div class="detail-avatar group-avatar" id="detail-group-avatar" style="${avatarStyle}">${(currentChatInfo.name || '?').charAt(0).toUpperCase()}</div>
          ${adminEditHtml}
        </div>
        <h2>${currentChatInfo.name}</h2>
        <p class="text-secondary">${currentChatInfo.description || 'Sem descrição'}</p>
        <h4 style="margin-top:20px;">Membros (${currentChatMembers.length})</h4>
        <div class="members-list">
      `;
      currentChatMembers.forEach(m => {
        let badge = m.role === 'admin' ? '<span style="font-size:10px; background:var(--primary-color); padding:2px 5px; border-radius:4px; margin-left:5px;">Admin</span>' : '';
        let removeBtn = (isAdminOfCurrentGroup && m.id !== currentUser.id) ? `<button class="btn-remove-member btn-icon" data-id="${m.id}" title="Remover Membro" style="color:var(--danger); font-size: 14px;">🗑️</button>` : '';
        html += `
          <div class="member-item">
            <div class="member-info">
              <div class="avatar" style="width:24px; height:24px; font-size:12px;">${m.name.charAt(0).toUpperCase()}</div>
              <span>${m.name} ${badge}</span>
            </div>
            ${removeBtn}
          </div>
        `;
      });
      html += `</div>`;
      
      // Controles do Administrador do Sistema (Inativar/Reativar)
      if (currentUser.role === 'admin') {
        if (currentChatInfo.is_active === 0) {
          html += `<button id="btn-reactivate-group" class="btn-primary" style="margin-top: 15px; background: var(--success); width: 100%;">Reativar Grupo</button>`;
        } else {
          html += `<button id="btn-inactivate-group" class="btn-primary" style="margin-top: 15px; background: var(--danger); width: 100%;">Inativar Grupo</button>`;
        }
      }
      // Adicionar Membro: deve ser admin do grupo E admin do sistema (hierarquia mais alta)
      if (isAdminOfCurrentGroup && currentUser.role === 'admin') {
        html += `<button id="btn-open-add-member" class="btn-primary" style="margin-top: 15px;">➕ Adicionar Membro</button>`;
      }
      body.innerHTML = html;

      const groupAvatar = document.getElementById('detail-group-avatar');
      if (groupAvatar && currentChatInfo.photo_url) {
        groupAvatar.addEventListener('click', () => {
          document.getElementById('expanded-image').src = currentChatInfo.photo_url;
          document.getElementById('modal-image-viewer').classList.add('active');
        });
      }

      const editGroupBtn = body.querySelector('.edit-group-photo-btn');
      const groupPhotoInput = document.getElementById('group-photo-input');
      if (editGroupBtn && groupPhotoInput) {
        editGroupBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          groupPhotoInput.click();
        });
        groupPhotoInput.addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const formData = new FormData();
          formData.append('photo', file);
          try {
            const response = await fetch(`/api/internal-chat/${activeChatId}/group/photo`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}` },
              body: formData
            });
            if (response.ok) {
              const data = await response.json();
              currentChatInfo.photo_url = data.photo_url;
              renderDetailsPanel(); // re-render details
              openChat(activeChatId, currentChatInfo.name, currentChatInfo.type, currentChatInfo.color, data.photo_url); // re-render header and messages
              loadChats(); // refresh sidebar list
            }
          } catch(err) {
            console.error('Erro ao atualizar foto do grupo', err);
          }
        });
      }

      // Inativar/Reativar Eventos
      const btnInactivate = document.getElementById('btn-inactivate-group');
      if (btnInactivate) {
        btnInactivate.addEventListener('click', async () => {
          if (!confirm('Deseja realmente inativar este grupo? Ninguém poderá enviar mensagens.')) return;
          try {
            await fetch(`/api/internal-chat/${activeChatId}/inactivate`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` } });
            loadChats();
            closeChat();
          } catch (e) { alert('Erro ao inativar grupo.'); }
        });
      }

      const btnReactivate = document.getElementById('btn-reactivate-group');
      if (btnReactivate) {
        btnReactivate.addEventListener('click', async () => {
          if (!confirm('Deseja reativar este grupo?')) return;
          try {
            await fetch(`/api/internal-chat/${activeChatId}/reactivate`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` } });
            loadChats();
            closeChat();
          } catch (e) { alert('Erro ao reativar grupo.'); }
        });
      }

      // Remover Membro
      const removeButtons = document.querySelectorAll('.btn-remove-member');
      removeButtons.forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const targetId = e.currentTarget.getAttribute('data-id');
          if (!confirm('Deseja remover este membro do grupo?')) return;
          try {
            await fetch(`/api/internal-chat/${activeChatId}/members/${targetId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
            openChat(activeChatId, currentChatInfo.name, 'group', currentChatInfo.color, currentChatInfo.photo_url);
          } catch (err) { alert('Erro ao remover membro.'); }
        });
      });

      // Modal Add Membro
      const btnOpenAddMember = document.getElementById('btn-open-add-member');
      if (btnOpenAddMember) {
        btnOpenAddMember.addEventListener('click', () => {
          document.getElementById('search-new-member').value = '';
          document.getElementById('add-member-search-results').innerHTML = '';
          document.getElementById('add-member-search-results').style.display = 'none';
          document.getElementById('modal-add-member').classList.add('active');
        });
      }
    } else {
      const displayName = currentChatInfo.name || 'Contato';
      const otherMember = currentChatMembers.find(m => m.id !== currentUser.id);
      const myMember = currentChatMembers.find(m => m.id === currentUser.id);
      
      let avatarStyle = currentChatInfo.photo_url ? `background-image: url(${currentChatInfo.photo_url}); background-size: cover; color: transparent; border: none; cursor: pointer;` : `cursor: pointer;`;
      let html = `
        <div class="detail-avatar" id="detail-direct-avatar" style="${avatarStyle}">${displayName.charAt(0).toUpperCase()}</div>
        <h2>${displayName}</h2>
        <p class="text-secondary">Chat Direto</p>
      `;

      if (otherMember && myMember && myMember.h_level > otherMember.h_level) {
        html += `<div style="margin-top: 20px; text-align: left; background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">`;
        html += `<h4 style="margin-bottom: 10px; font-size: 14px; color: var(--accent-gold);">Controle de Acesso</h4>`;
        
        if (window.currentChatExplicitPermission && (!window.currentChatExplicitPermission.expires_at || new Date(window.currentChatExplicitPermission.expires_at) > new Date())) {
          let expiresText = window.currentChatExplicitPermission.expires_at ? `Expira em: ${new Date(window.currentChatExplicitPermission.expires_at).toLocaleString('pt-BR')}` : 'Acesso Permanente';
          html += `
            <p style="font-size: 12px; color: var(--success); margin-bottom: 10px;">✅ Contato Liberado</p>
            <p style="font-size: 11px; color: #999; margin-bottom: 15px;">${expiresText}</p>
            <button id="btn-revoke-contact" class="btn-primary" style="background: var(--danger);">Revogar Acesso</button>
          `;
        } else {
          html += `
            <p style="font-size: 12px; color: #999; margin-bottom: 15px;">Usuário de hierarquia inferior. Libere o acesso para que ele possa lhe enviar mensagens.</p>
            <button id="btn-allow-contact" class="btn-primary">Liberar Acesso</button>
          `;
        }
        html += `</div>`;
      }
      
      body.innerHTML = html;

      const directAvatar = document.getElementById('detail-direct-avatar');
      if (directAvatar && currentChatInfo.photo_url) {
        directAvatar.addEventListener('click', () => {
          document.getElementById('expanded-image').src = currentChatInfo.photo_url;
          document.getElementById('modal-image-viewer').classList.add('active');
        });
      }

      const btnAllow = document.getElementById('btn-allow-contact');
      if (btnAllow) {
        btnAllow.addEventListener('click', async () => {
          const daysStr = prompt('Por quantos dias deseja liberar o contato? (ex: 1, 7, 30)');
          if (daysStr === null) return; // Cancelou
          const days = parseInt(daysStr);
          if (isNaN(days) || days <= 0) {
            alert('Por favor, insira um número válido de dias.');
            return;
          }
          try {
            await fetch('/api/internal-chat/allow-contact', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ targetId: otherMember.id, days })
            });
            openChat(activeChatId, currentChatInfo.name, currentChatInfo.type, currentChatInfo.color, currentChatInfo.photo_url);
            showNotification('Sucesso', 'Acesso liberado.', activeChatId, 'direct');
          } catch(e) { alert('Erro ao liberar contato.'); }
        });
      }

      const btnRevoke = document.getElementById('btn-revoke-contact');
      if (btnRevoke) {
        btnRevoke.addEventListener('click', async () => {
          if (!confirm('Deseja realmente revogar o acesso deste usuário?')) return;
          try {
            await fetch('/api/internal-chat/revoke-contact', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ targetId: otherMember.id })
            });
            openChat(activeChatId, currentChatInfo.name, currentChatInfo.type, currentChatInfo.color, currentChatInfo.photo_url);
            showNotification('Sucesso', 'Acesso revogado.', activeChatId, 'direct');
          } catch(e) { alert('Erro ao revogar contato.'); }
        });
      }
    }
  }

  // Novo grupo form (simplificado)
  // Só exibir botão de criar grupo e adicionar event listener se for admin do sistema
  const newGroupBtn = document.getElementById('new-group-btn');
  if (currentUser.role !== 'admin') {
    if (newGroupBtn) newGroupBtn.style.display = 'none';
  } else {
    if (newGroupBtn) {
      newGroupBtn.addEventListener('click', () => {
        document.getElementById('modal-new-group').classList.add('active');
      });
    }
  }
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

  const searchNewMemberInput = document.getElementById('search-new-member');
  const addMemberSearchResults = document.getElementById('add-member-search-results');
  let addMemberSearchTimeout;

  searchNewMemberInput.addEventListener('input', (e) => {
    clearTimeout(addMemberSearchTimeout);
    const q = e.target.value.trim().toLowerCase();

    if (!q) {
      addMemberSearchResults.style.display = 'none';
      addMemberSearchResults.innerHTML = '';
      return;
    }
    
    addMemberSearchTimeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/internal-chat/search/users?q=${encodeURIComponent(q)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        addMemberSearchResults.style.display = 'block';
        addMemberSearchResults.innerHTML = '';
        
        if (data.users.length === 0) {
          addMemberSearchResults.innerHTML = '<div style="padding:10px;color:#999;font-size:12px;">Nenhum usuário encontrado.</div>';
        } else {
          data.users.forEach(u => {
            const isMember = currentChatMembers.find(m => m.id === u.id);
            const el = document.createElement('div');
            el.className = 'search-item';
            
            if (isMember) {
              el.innerHTML = `
                <span>${u.name} <small style="color:var(--accent-gold);">(Já é membro)</small></span>
                <button class="btn-add-contact" style="background:transparent; border:none; color:#666; cursor:default;" disabled>Membro</button>
              `;
            } else {
              el.innerHTML = `
                <span>${u.name}</span>
                <button class="btn-add-contact" style="background:var(--bg-secondary); border:1px solid var(--accent-gold); color:var(--accent-gold);">Adicionar</button>
              `;
              el.querySelector('button').addEventListener('click', async () => {
                if (!activeChatId) return;
                await fetch(`/api/internal-chat/${activeChatId}/members`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                  body: JSON.stringify({ userId: u.id })
                });
                document.getElementById('modal-add-member').classList.remove('active');
                openChat(activeChatId, currentChatInfo.name, currentChatInfo.type, currentChatInfo.color, currentChatInfo.photo_url);
              });
            }
            addMemberSearchResults.appendChild(el);
          });
        }
      } catch (err) {
        console.error('Erro ao pesquisar:', err);
      }
    }, 300);
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
