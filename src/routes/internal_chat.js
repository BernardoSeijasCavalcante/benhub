const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

// Configuração do Multer para upload local
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../../public/uploads/'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

router.use(authenticateToken);

// Middleware auxiliar para checar se usuário é admin do grupo
function checkGroupAdmin(req, res, next) {
  const { chatId } = req.params;
  const userId = req.user.id;
  const member = db.prepare('SELECT role FROM internal_chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
  
  if (!member || member.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores do grupo podem realizar esta ação.' });
  }
  next();
}

// Middleware para verificar se o usuário pertence à hierarquia mais alta
function checkHighestHierarchy(req, res, next) {
  const userId = req.user.id;
  const userRow = db.prepare('SELECT h.level FROM users u JOIN hierarchies h ON u.hierarchy_id = h.id WHERE u.id = ?').get(userId);
  const maxRow = db.prepare('SELECT MAX(level) as maxLevel FROM hierarchies').get();

  if (!userRow || userRow.level < maxRow.maxLevel) {
    return res.status(403).json({ error: 'Acesso negado. Apenas usuários da hierarquia mais alta podem realizar esta ação.' });
  }
  next();
}

// Middleware/Helper auxiliar para checar permissão de chat direto
function checkCommunicationPermission(userId, targetUserId) {
  if (userId === targetUserId) return true; // Pode falar consigo mesmo
  
  const currentUser = db.prepare('SELECT u.*, h.level as h_level, h.allow_same_level_chat FROM users u LEFT JOIN hierarchies h ON u.hierarchy_id = h.id WHERE u.id = ?').get(userId);
  const targetUser = db.prepare('SELECT u.*, h.level as h_level FROM users u LEFT JOIN hierarchies h ON u.hierarchy_id = h.id WHERE u.id = ?').get(targetUserId);

  if (!currentUser || !targetUser) return false;

  let allowed = false;
  
  // Regra 1: Superiores podem falar com inferiores
  if (currentUser.h_level > targetUser.h_level) {
    allowed = true;
  } 
  // Regra 2: Mesmo nível
  else if (currentUser.h_level === targetUser.h_level) {
    if (currentUser.allow_same_level_chat) allowed = true;
  } 
  // Regra 3: Nível imediatamente superior
  else {
    const nextLevelRow = db.prepare('SELECT MIN(level) as nextLevel FROM hierarchies WHERE level > ?').get(currentUser.h_level);
    if (nextLevelRow && nextLevelRow.nextLevel !== null && targetUser.h_level === nextLevelRow.nextLevel) {
      allowed = true;
    }
  }

  // Verifica permissão explícita (solicitada e aprovada ou proativa)
  if (!allowed) {
    const explicitPerm = db.prepare(`
      SELECT 1 FROM allowed_communications 
      WHERE ((user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?))
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `).get(userId, targetUserId, targetUserId, userId);
    if (explicitPerm) allowed = true;
  }

  return allowed;
}

// 1. Listar todos os chats (directs e groups)
router.get('/chats', (req, res) => {
  const userId = req.user.id;

  // Pegar todos os chats (grupos e diretos) onde o usuário é membro
  const activeChats = db.prepare(`
    SELECT c.*, m.is_pinned, m.unread_count 
    FROM internal_chats c
    JOIN internal_chat_members m ON c.id = m.chat_id
    WHERE m.user_id = ?
  `).all(userId);

  // Processar chats para incluir nomes e fotos no caso de directs
  const processedChats = activeChats.map(chat => {
    if (chat.type === 'group') return chat;

    // É direct, pegar o outro membro
    const otherMember = db.prepare(`
      SELECT u.id as other_user_id, u.name, u.photo_url
      FROM internal_chat_members m
      JOIN users u ON m.user_id = u.id
      WHERE m.chat_id = ? AND m.user_id != ?
    `).get(chat.id, userId);

    if (otherMember) {
      chat.name = otherMember.name;
      chat.photo_url = otherMember.photo_url;
      chat.other_user_id = otherMember.other_user_id;
      chat.is_allowed = checkCommunicationPermission(userId, otherMember.other_user_id);
    }
    return chat;
  });

  // Pegar a lista de contatos do usuário (user_contacts)
  const contacts = db.prepare(`
    SELECT uc.contact_id as other_user_id, uc.is_pinned, u.name, u.photo_url
    FROM user_contacts uc
    JOIN users u ON uc.contact_id = u.id
    WHERE uc.user_id = ?
  `).all(userId);

  const newContacts = [];
  contacts.forEach(contact => {
    // Verifica se já não existe na processedChats
    const exists = processedChats.find(c => c.type === 'direct' && c.other_user_id === contact.other_user_id);
    if (!exists) {
      newContacts.push({
        id: null,
        type: 'direct',
        name: contact.name,
        other_user_id: contact.other_user_id,
        is_pinned: contact.is_pinned,
        photo_url: contact.photo_url,
        is_allowed: checkCommunicationPermission(userId, contact.other_user_id),
        unread_count: 0,
        last_message_at: null
      });
    }
  });

  const allChats = [...processedChats, ...newContacts];

  res.json({ chats: allChats });
});

// 2. Criar um novo grupo
router.post('/groups', checkHighestHierarchy, (req, res) => {
  const { name, description, color, photo_url } = req.body;
  const userId = req.user.id;

  if (!name) return res.status(400).json({ error: 'Nome do grupo é obrigatório.' });

  const result = db.prepare(`
    INSERT INTO internal_chats (type, name, description, color, photo_url, created_by)
    VALUES ('group', ?, ?, ?, ?, ?)
  `).run(name, description || null, color || null, photo_url || null, userId);

  const chatId = result.lastInsertRowid;

  // Criador se torna admin do grupo
  db.prepare(`
    INSERT INTO internal_chat_members (chat_id, user_id, role)
    VALUES (?, ?, 'admin')
  `).run(chatId, userId);

  res.json({ success: true, chatId });
});

// Sair ou remover de um chat
router.delete('/:chatId/leave', (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.id;
  
  db.prepare('DELETE FROM internal_chat_members WHERE chat_id = ? AND user_id = ?').run(chatId, userId);
  res.json({ success: true });
});

// 3. Atualizar atributos do grupo (apenas admin)
router.put('/:chatId/group', checkGroupAdmin, (req, res) => {
  const { chatId } = req.params;
  const { name, description, color, photo_url } = req.body;

  db.prepare(`
    UPDATE internal_chats 
    SET name = ?, description = ?, color = ?, photo_url = ?
    WHERE id = ? AND type = 'group'
  `).run(name, description, color, photo_url, chatId);

  res.json({ success: true });
});

// 4. Adicionar membro ao grupo (apenas hierarquia mais alta e admin)
router.post('/:chatId/members', checkHighestHierarchy, checkGroupAdmin, (req, res) => {
  const { chatId } = req.params;
  const { userId } = req.body;

  if (!userId) return res.status(400).json({ error: 'ID do usuário obrigatório.' });

  const exists = db.prepare('SELECT 1 FROM internal_chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
  if (exists) return res.status(400).json({ error: 'Usuário já está no grupo.' });

  db.prepare(`
    INSERT INTO internal_chat_members (chat_id, user_id, role)
    VALUES (?, ?, 'member')
  `).run(chatId, userId);

  res.json({ success: true });
});

// 5. Atualizar role de um membro (apenas admin)
router.put('/:chatId/members/:targetUserId/role', checkGroupAdmin, (req, res) => {
  const { chatId, targetUserId } = req.params;
  const { role } = req.body;

  if (!['admin', 'member'].includes(role)) {
    return res.status(400).json({ error: 'Role inválida.' });
  }

  db.prepare(`
    UPDATE internal_chat_members 
    SET role = ?
    WHERE chat_id = ? AND user_id = ?
  `).run(role, chatId, targetUserId);

  res.json({ success: true });
});

// Helper: Obter ou criar chat direto
router.post('/direct', (req, res) => {
  const { targetUserId } = req.body;
  const userId = req.user.id;

  if (!targetUserId) return res.status(400).json({ error: 'targetUserId obrigatório.' });

  // === VALIDAÇÃO DE HIERARQUIA ===
  const allowed = checkCommunicationPermission(userId, targetUserId);

  if (!allowed) {
    return res.status(403).json({ error: 'Comunicação restrita pela hierarquia. Solicite acesso.' });
  }
  // ===============================

  const existingChat = db.prepare(`
    SELECT m1.chat_id
    FROM internal_chat_members m1
    JOIN internal_chat_members m2 ON m1.chat_id = m2.chat_id
    JOIN internal_chats c ON c.id = m1.chat_id
    WHERE c.type = 'direct' AND m1.user_id = ? AND m2.user_id = ?
  `).get(userId, targetUserId);

  if (existingChat) {
    return res.json({ chatId: existingChat.chat_id });
  }

  const result = db.prepare(`INSERT INTO internal_chats (type, created_by) VALUES ('direct', ?)`).run(userId);
  const chatId = result.lastInsertRowid;

  db.prepare(`INSERT INTO internal_chat_members (chat_id, user_id) VALUES (?, ?)`).run(chatId, userId);
  db.prepare(`INSERT INTO internal_chat_members (chat_id, user_id) VALUES (?, ?)`).run(chatId, targetUserId);

  res.json({ chatId });
});

// 5.5. Marcar chat como lido
router.put('/:chatId/read', (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.id;
  db.prepare('UPDATE internal_chat_members SET unread_count = 0 WHERE chat_id = ? AND user_id = ?').run(chatId, userId);
  res.json({ success: true });
});

// 6. Obter histórico de mensagens de um chat
router.get('/:chatId/messages', (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.id;

  const isMember = db.prepare('SELECT 1 FROM internal_chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
  if (!isMember) return res.status(403).json({ error: 'Acesso negado ao chat.' });

  const messages = db.prepare(`
    SELECT m.*, u.name as sender_name, u.photo_url as sender_photo_url
    FROM internal_messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.chat_id = ? 
    ORDER BY m.created_at ASC
  `).all(chatId);

  // Adicionar reações para as mensagens
  messages.forEach(msg => {
    const reactions = db.prepare(`
      SELECT r.id, r.user_id, r.reaction, u.name as userName
      FROM internal_message_reactions r
      JOIN users u ON r.user_id = u.id
      WHERE r.message_id = ?
    `).all(msg.id);
    msg.reactions = reactions;
  });

  const chatInfo = db.prepare('SELECT * FROM internal_chats WHERE id = ?').get(chatId);
  const members = db.prepare(`
    SELECT u.id, u.name, u.photo_url, m.role, h.level as h_level
    FROM internal_chat_members m
    JOIN users u ON m.user_id = u.id
    LEFT JOIN hierarchies h ON u.hierarchy_id = h.id
    WHERE m.chat_id = ?
  `).all(chatId);

  let explicitPermission = null;
  if (chatInfo && chatInfo.type === 'direct' && members.length === 2) {
    const otherMember = members.find(m => m.id !== userId);
    if (otherMember) {
      explicitPermission = db.prepare(`
        SELECT * FROM allowed_communications 
        WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?)
      `).get(userId, otherMember.id, otherMember.id, userId);
    }
  }

  res.json({ messages, chatInfo, members, explicitPermission });
});

// 7. Enviar mensagem
router.post('/:chatId/messages', (req, res) => {
  const { chatId } = req.params;
  const { content_type, content, file_url, is_forwarded } = req.body;
  const userId = req.user.id;

  const isMember = db.prepare('SELECT 1 FROM internal_chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
  if (!isMember) return res.status(403).json({ error: 'Acesso negado ao chat.' });

  const forwarded = is_forwarded ? 1 : 0;
  
  const result = db.prepare(`
    INSERT INTO internal_messages (chat_id, sender_id, content_type, content, file_url, is_forwarded)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(chatId, userId, content_type || 'text', content || '', file_url || null, forwarded);

  // Update last_message_at and unread_count
  db.prepare('UPDATE internal_chats SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?').run(chatId);
  db.prepare('UPDATE internal_chat_members SET unread_count = unread_count + 1 WHERE chat_id = ? AND user_id != ?').run(chatId, userId);

  const messageId = result.lastInsertRowid;
  const newMessage = db.prepare(`
    SELECT m.*, u.name as sender_name, u.photo_url as sender_photo_url
    FROM internal_messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.id = ?
  `).get(messageId);
  newMessage.reactions = [];

  const io = req.app.get('io');
  if (io) {
    const members = db.prepare('SELECT user_id FROM internal_chat_members WHERE chat_id = ?').all(chatId);
    members.forEach(m => {
      io.to('user_' + m.user_id).emit('receive_internal_message', newMessage);
    });
  }

  res.json({ success: true, message: newMessage });
});

// 8. Upload de arquivo e enviar como mensagem
router.post('/:chatId/upload', upload.single('file'), (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.id;

  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo recebido.' });
  }

  const isMember = db.prepare('SELECT 1 FROM internal_chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
  if (!isMember) return res.status(403).json({ error: 'Acesso negado ao chat.' });

  const fileUrl = '/uploads/' + req.file.filename;
  
  let contentType = 'file';
  if (req.file.mimetype.startsWith('image/')) {
    contentType = 'image';
  }

  const result = db.prepare(`
    INSERT INTO internal_messages (chat_id, sender_id, content_type, content, file_url)
    VALUES (?, ?, ?, ?, ?)
  `).run(chatId, userId, contentType, req.file.originalname, fileUrl);

  // Update last_message_at and unread_count
  db.prepare('UPDATE internal_chats SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?').run(chatId);
  db.prepare('UPDATE internal_chat_members SET unread_count = unread_count + 1 WHERE chat_id = ? AND user_id != ?').run(chatId, userId);

  const messageId = result.lastInsertRowid;
  const newMessage = db.prepare(`
    SELECT m.*, u.name as sender_name, u.photo_url as sender_photo_url
    FROM internal_messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.id = ?
  `).get(messageId);
  newMessage.reactions = [];

  const io = req.app.get('io');
  if (io) {
    const members = db.prepare('SELECT user_id FROM internal_chat_members WHERE chat_id = ?').all(chatId);
    members.forEach(m => {
      io.to('user_' + m.user_id).emit('receive_internal_message', newMessage);
    });
  }

  res.json({ success: true, message: newMessage });
});

// --- NOVAS ROTAS WHATSAPP ---

// Pesquisa global de usuários com verificação de hierarquia
router.get('/search/users', (req, res) => {
  const { q } = req.query;
  const userId = req.user.id;
  
  if (!q) return res.json({ users: [] });

  const users = db.prepare(`
    SELECT u.id, u.name, h.level as h_level, h.name as hierarchy_name, u.photo_url 
    FROM users u
    LEFT JOIN hierarchies h ON u.hierarchy_id = h.id
    WHERE u.id != ? AND u.name LIKE ?
    LIMIT 20
  `).all(userId, `%${q}%`);
  
  // Mapeia adicionando flag requires_request / is_allowed
  const mappedUsers = users.map(targetUser => {
    const allowed = checkCommunicationPermission(userId, targetUser.id);

    return {
      id: targetUser.id,
      name: targetUser.name,
      photo_url: targetUser.photo_url,
      hierarchy: targetUser.hierarchy_name,
      requires_request: !allowed,
      is_allowed: allowed
    };
  });

  res.json({ users: mappedUsers });
});

// Adicionar contato à lista pessoal
router.post('/contacts', (req, res) => {
  const { contactId } = req.body;
  const userId = req.user.id;

  if (!contactId || contactId === userId) return res.status(400).json({ error: 'Contato inválido.' });

  const exists = db.prepare('SELECT 1 FROM user_contacts WHERE user_id = ? AND contact_id = ?').get(userId, contactId);
  if (!exists) {
    db.prepare('INSERT INTO user_contacts (user_id, contact_id) VALUES (?, ?)').run(userId, contactId);
  }

  res.json({ success: true });
});

// Remover contato da lista pessoal
router.delete('/contacts/:contactId', (req, res) => {
  const { contactId } = req.params;
  const userId = req.user.id;

  db.prepare('DELETE FROM user_contacts WHERE user_id = ? AND contact_id = ?').run(userId, contactId);
  res.json({ success: true });
});

// Fixar/Desfixar contato (Lista pessoal)
router.put('/contacts/:contactId/pin', (req, res) => {
  const { contactId } = req.params;
  const userId = req.user.id;
  db.prepare('UPDATE user_contacts SET is_pinned = 1 WHERE user_id = ? AND contact_id = ?').run(userId, contactId);
  res.json({ success: true });
});
router.put('/contacts/:contactId/unpin', (req, res) => {
  const { contactId } = req.params;
  const userId = req.user.id;
  db.prepare('UPDATE user_contacts SET is_pinned = 0 WHERE user_id = ? AND contact_id = ?').run(userId, contactId);
  res.json({ success: true });
});

// Fixar/Desfixar grupo
router.put('/groups/:chatId/pin', (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.id;
  db.prepare('UPDATE internal_chat_members SET is_pinned = 1 WHERE user_id = ? AND chat_id = ?').run(userId, chatId);
  res.json({ success: true });
});
router.put('/groups/:chatId/unpin', (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.id;
  db.prepare('UPDATE internal_chat_members SET is_pinned = 0 WHERE user_id = ? AND chat_id = ?').run(userId, chatId);
  res.json({ success: true });
});

// Fixar/Desfixar mensagem
router.put('/:chatId/messages/:messageId/pin', (req, res) => {
  const { chatId, messageId } = req.params;
  const userId = req.user.id;
  
  const isMember = db.prepare('SELECT 1 FROM internal_chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
  if (!isMember) return res.status(403).json({ error: 'Acesso negado.' });

  db.prepare('UPDATE internal_messages SET is_pinned = 1 WHERE id = ? AND chat_id = ?').run(messageId, chatId);
  
  const io = req.app.get('io');
  if (io) {
    const members = db.prepare('SELECT user_id FROM internal_chat_members WHERE chat_id = ?').all(chatId);
    members.forEach(m => {
      io.to('user_' + m.user_id).emit('message_pinned', { chatId, messageId });
    });
  }

  res.json({ success: true });
});
router.put('/:chatId/messages/:messageId/unpin', (req, res) => {
  const { chatId, messageId } = req.params;
  
  db.prepare('UPDATE internal_messages SET is_pinned = 0 WHERE id = ? AND chat_id = ?').run(messageId, chatId);
  
  const io = req.app.get('io');
  if (io) {
    const members = db.prepare('SELECT user_id FROM internal_chat_members WHERE chat_id = ?').all(chatId);
    members.forEach(m => {
      io.to('user_' + m.user_id).emit('message_unpinned', { chatId, messageId });
    });
  }

  res.json({ success: true });
});

// Reações
router.post('/:chatId/messages/:messageId/reactions', (req, res) => {
  const { chatId, messageId } = req.params;
  const { reaction } = req.body;
  const userId = req.user.id;

  const exists = db.prepare('SELECT 1 FROM internal_message_reactions WHERE message_id = ? AND user_id = ? AND reaction = ?').get(messageId, userId, reaction);
  if (!exists) {
    db.prepare('INSERT INTO internal_message_reactions (message_id, user_id, reaction) VALUES (?, ?, ?)').run(messageId, userId, reaction);
  }

  const io = req.app.get('io');
  if (io) {
    const members = db.prepare('SELECT user_id FROM internal_chat_members WHERE chat_id = ?').all(chatId);
    members.forEach(m => {
      io.to('user_' + m.user_id).emit('reaction_added', { chatId, messageId, userId, reaction, userName: req.user.name });
    });
  }

  res.json({ success: true });
});

router.delete('/:chatId/messages/:messageId/reactions', (req, res) => {
  const { chatId, messageId } = req.params;
  const { reaction } = req.body;
  const userId = req.user.id;

  db.prepare('DELETE FROM internal_message_reactions WHERE message_id = ? AND user_id = ? AND reaction = ?').run(messageId, userId, reaction);

  const io = req.app.get('io');
  if (io) {
    const members = db.prepare('SELECT user_id FROM internal_chat_members WHERE chat_id = ?').all(chatId);
    members.forEach(m => {
      io.to('user_' + m.user_id).emit('reaction_removed', { chatId, messageId, userId, reaction });
    });
  }

  res.json({ success: true });
});

// Encaminhar mensagens (batch)
router.post('/forward', (req, res) => {
  const { originalMessageId, targetChatIds, targetUserIds } = req.body;
  const userId = req.user.id;

  const originalMsg = db.prepare('SELECT * FROM internal_messages WHERE id = ?').get(originalMessageId);
  if (!originalMsg) return res.status(404).json({ error: 'Mensagem não encontrada.' });

  const io = req.app.get('io');
  let successCount = 0;

  // Encaminhar para chats existentes
  if (targetChatIds && Array.isArray(targetChatIds)) {
    targetChatIds.forEach(chatId => {
      const isMember = db.prepare('SELECT 1 FROM internal_chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
      if (isMember) {
        const result = db.prepare(`
          INSERT INTO internal_messages (chat_id, sender_id, content_type, content, file_url, is_forwarded)
          VALUES (?, ?, ?, ?, ?, 1)
        `).run(chatId, userId, originalMsg.content_type, originalMsg.content, originalMsg.file_url);
        
        // Update last_message_at and unread_count
        db.prepare('UPDATE internal_chats SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?').run(chatId);
        db.prepare('UPDATE internal_chat_members SET unread_count = unread_count + 1 WHERE chat_id = ? AND user_id != ?').run(chatId, userId);

        const newMessage = db.prepare(`
          SELECT m.*, u.name as sender_name, u.photo_url as sender_photo_url
          FROM internal_messages m
          JOIN users u ON m.sender_id = u.id
          WHERE m.id = ?
        `).get(result.lastInsertRowid);
        newMessage.reactions = [];

        if (io) {
          const members = db.prepare('SELECT user_id FROM internal_chat_members WHERE chat_id = ?').all(chatId);
          members.forEach(m => io.to('user_' + m.user_id).emit('receive_internal_message', newMessage));
        }
        successCount++;
      }
    });
  }

  // Encaminhar para contatos sem chat (cria o chat direto primeiro)
  if (targetUserIds && Array.isArray(targetUserIds)) {
    targetUserIds.forEach(targetId => {
      const existingChat = db.prepare(`
        SELECT m1.chat_id
        FROM internal_chat_members m1
        JOIN internal_chat_members m2 ON m1.chat_id = m2.chat_id
        JOIN internal_chats c ON c.id = m1.chat_id
        WHERE c.type = 'direct' AND m1.user_id = ? AND m2.user_id = ?
      `).get(userId, targetId);

      let chatId;
      if (existingChat) {
        chatId = existingChat.chat_id;
      } else {
        const cResult = db.prepare(`INSERT INTO internal_chats (type, created_by) VALUES ('direct', ?)`).run(userId);
        chatId = cResult.lastInsertRowid;
        db.prepare(`INSERT INTO internal_chat_members (chat_id, user_id) VALUES (?, ?)`).run(chatId, userId);
        db.prepare(`INSERT INTO internal_chat_members (chat_id, user_id) VALUES (?, ?)`).run(chatId, targetId);
      }

      const result = db.prepare(`
        INSERT INTO internal_messages (chat_id, sender_id, content_type, content, file_url, is_forwarded)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(chatId, userId, originalMsg.content_type, originalMsg.content, originalMsg.file_url);
      
      // Update last_message_at and unread_count
      db.prepare('UPDATE internal_chats SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?').run(chatId);
      db.prepare('UPDATE internal_chat_members SET unread_count = unread_count + 1 WHERE chat_id = ? AND user_id != ?').run(chatId, userId);

      const newMessage = db.prepare(`
        SELECT m.*, u.name as sender_name, u.photo_url as sender_photo_url
        FROM internal_messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `).get(result.lastInsertRowid);
      newMessage.reactions = [];

      if (io) {
        const members = db.prepare('SELECT user_id FROM internal_chat_members WHERE chat_id = ?').all(chatId);
        members.forEach(m => io.to('user_' + m.user_id).emit('receive_internal_message', newMessage));
      }
      successCount++;
    });
  }

  res.json({ success: true, forwardedTo: successCount });
});

// --- SOLICITAÇÕES DE COMUNICAÇÃO ---

// Criar solicitação
router.post('/requests', (req, res) => {
  const { targetId } = req.body;
  const userId = req.user.id;

  if (!targetId || targetId === userId) return res.status(400).json({ error: 'Usuário alvo inválido.' });

  // Verifica se já tem pending
  const pending = db.prepare('SELECT 1 FROM communication_requests WHERE requester_id = ? AND target_id = ? AND status = "pending"').get(userId, targetId);
  if (pending) return res.status(400).json({ error: 'Já existe uma solicitação pendente para este usuário.' });

  // Verifica se já é permitido
  const explicitPerm = db.prepare('SELECT 1 FROM allowed_communications WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?)').get(userId, targetId, targetId, userId);
  if (explicitPerm) return res.status(400).json({ error: 'Comunicação já está liberada.' });

  db.prepare('INSERT INTO communication_requests (requester_id, target_id) VALUES (?, ?)').run(userId, targetId);

  // Aqui você pode emitir um socket event para notificar o targetUser
  const io = req.app.get('io');
  if (io) io.to('user_' + targetId).emit('new_communication_request', { fromId: userId });

  res.json({ success: true, message: 'Solicitação enviada.' });
});

// Listar solicitações pendentes (recebidas)
router.get('/requests/pending', (req, res) => {
  const userId = req.user.id;
  const requests = db.prepare(`
    SELECT cr.id, cr.requester_id, u.name as requester_name, cr.created_at
    FROM communication_requests cr
    JOIN users u ON cr.requester_id = u.id
    WHERE cr.target_id = ? AND cr.status = 'pending'
  `).all(userId);
  res.json(requests);
});

// Aprovar solicitação
router.post('/requests/:id/approve', (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const request = db.prepare('SELECT * FROM communication_requests WHERE id = ? AND target_id = ? AND status = "pending"').get(id, userId);
  if (!request) return res.status(404).json({ error: 'Solicitação não encontrada.' });

  // Atualiza status
  db.prepare('UPDATE communication_requests SET status = "approved" WHERE id = ?').run(id);

  // Insere permissão
  db.prepare('INSERT OR IGNORE INTO allowed_communications (user_a_id, user_b_id, granted_by) VALUES (?, ?, ?)').run(request.requester_id, userId, userId);

  // Notificar quem pediu
  const io = req.app.get('io');
  if (io) io.to('user_' + request.requester_id).emit('communication_request_approved', { targetId: userId, targetName: req.user.name });

  res.json({ success: true });
});

// Rejeitar solicitação
router.post('/requests/:id/reject', (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const request = db.prepare('SELECT * FROM communication_requests WHERE id = ? AND target_id = ? AND status = "pending"').get(id, userId);
  if (!request) return res.status(404).json({ error: 'Solicitação não encontrada.' });

  db.prepare('UPDATE communication_requests SET status = "rejected" WHERE id = ?').run(id);

  res.json({ success: true });
});

// Liberação proativa por usuário superior (Botão "Liberar Contato" sem request)
router.post('/allow-contact', (req, res) => {
  const { targetId, days } = req.body;
  const userId = req.user.id;

  const currentUser = db.prepare('SELECT h.level FROM users u LEFT JOIN hierarchies h ON u.hierarchy_id = h.id WHERE u.id = ?').get(userId);
  const targetUser = db.prepare('SELECT h.level FROM users u LEFT JOIN hierarchies h ON u.hierarchy_id = h.id WHERE u.id = ?').get(targetId);

  // Opcional: checar se currentUser > targetUser para liberar, ou permitir que qualquer um que queira libere o acesso a si mesmo
  if (!currentUser || !targetUser || currentUser.level < targetUser.level) {
    return res.status(403).json({ error: 'Somente níveis superiores podem liberar contato ativamente.' });
  }

  let expiresAt = null;
  if (days && !isNaN(parseInt(days))) {
    // Calcula datetime: CURRENT_TIMESTAMP + days
    expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + parseInt(days));
    expiresAt = expiresAt.toISOString().replace('T', ' ').substring(0, 19); // YYYY-MM-DD HH:MM:SS
  }

  // Primeiro remove se já existe para atualizar
  db.prepare('DELETE FROM allowed_communications WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?)').run(userId, targetId, targetId, userId);

  db.prepare('INSERT INTO allowed_communications (user_a_id, user_b_id, granted_by, expires_at) VALUES (?, ?, ?, ?)').run(userId, targetId, userId, expiresAt);
  
  res.json({ success: true });
});

// Revogar liberação proativa
router.post('/revoke-contact', (req, res) => {
  const { targetId } = req.body;
  const userId = req.user.id;

  const currentUser = db.prepare('SELECT h.level FROM users u LEFT JOIN hierarchies h ON u.hierarchy_id = h.id WHERE u.id = ?').get(userId);
  const targetUser = db.prepare('SELECT h.level FROM users u LEFT JOIN hierarchies h ON u.hierarchy_id = h.id WHERE u.id = ?').get(targetId);

  if (!currentUser || !targetUser || currentUser.level < targetUser.level) {
    return res.status(403).json({ error: 'Somente níveis superiores podem revogar contato ativamente.' });
  }

  db.prepare('DELETE FROM allowed_communications WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?)').run(userId, targetId, targetId, userId);
  
  res.json({ success: true });
});

module.exports = router;
