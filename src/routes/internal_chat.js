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
async function checkGroupAdmin(req, res, next) {
  const { chatId } = req.params;
  const userId = req.user.id;
  const [member_rows] = await db.execute('SELECT role FROM internal_chat_members WHERE chat_id = ? AND user_id = ?', [chatId, userId]);
  const member = member_rows[0];
  
  if (!member || member.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores do grupo podem realizar esta ação.' });
  }
  next();
}

// Middleware para verificar se o usuário é administrador do sistema
async function checkSystemAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores do sistema podem inativar/reativar grupos.' });
  }
}

// Middleware para verificar se o usuário pertence à hierarquia mais alta
async function checkHighestHierarchy(req, res, next) {
  const userId = req.user.id;
  const [userRow_rows] = await db.execute('SELECT h.level FROM users u JOIN hierarchies h ON u.hierarchy_id = h.id WHERE u.id = ?', [userId]);
  const userRow = userRow_rows[0];
  const [maxRow_rows] = await db.execute('SELECT MAX(level) as maxLevel FROM hierarchies');
  const maxRow = maxRow_rows[0];

  if (!userRow || userRow.level < maxRow.maxLevel) {
    return res.status(403).json({ error: 'Acesso negado. Apenas usuários da hierarquia mais alta podem realizar esta ação.' });
  }
  next();
}

// Middleware/Helper auxiliar para checar permissão de chat direto
async function checkCommunicationPermission(userId, targetUserId) {
  if (userId === targetUserId) return true; // Pode falar consigo mesmo
  
  const [currentUser_rows] = await db.execute('SELECT u.*, h.level as h_level, h.allow_same_level_chat FROM users u LEFT JOIN hierarchies h ON u.hierarchy_id = h.id WHERE u.id = ?', [userId]);
  const currentUser = currentUser_rows[0];
  const [targetUser_rows] = await db.execute('SELECT u.*, h.level as h_level FROM users u LEFT JOIN hierarchies h ON u.hierarchy_id = h.id WHERE u.id = ?', [targetUserId]);
  const targetUser = targetUser_rows[0];

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
    const [nextLevelRow_rows] = await db.execute('SELECT MIN(level) as nextLevel FROM hierarchies WHERE level > ?', [currentUser.h_level]);
    const nextLevelRow = nextLevelRow_rows[0];
    if (nextLevelRow && nextLevelRow.nextLevel !== null && targetUser.h_level === nextLevelRow.nextLevel) {
      allowed = true;
    }
  }

  // Verifica permissão explícita (solicitada e aprovada ou proativa)
  if (!allowed) {
    const [explicitPerm_rows] = await db.execute(`
      SELECT 1 FROM allowed_communications 
      WHERE ((user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?))
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `, [userId, targetUserId, targetUserId, userId]);
    if (explicitPerm_rows.length > 0) allowed = true;
  }

  return allowed;
}

// 1. Listar chats do usuário
router.get('/chats', async (req, res) => {
  const userId = req.user.id;

  const [chats] = await db.execute(`
    SELECT 
      c.id, c.type, c.name, c.description, c.photo_url, c.color, 
      c.created_by, c.created_at, c.last_message_at, c.is_active,
      m.role, m.is_pinned, m.unread_count
    FROM internal_chats c
    JOIN internal_chat_members m ON c.id = m.chat_id
    WHERE m.user_id = ? AND m.is_hidden = 0
    ORDER BY m.is_pinned DESC, c.last_message_at DESC, c.created_at DESC
  `, [userId]);

  // Processar chats para incluir nomes e fotos no caso de directs
  const processedChats = await Promise.all(chats.map(async chat => {
    if (chat.type === 'group') return chat;

    // É direct, pegar o outro membro
    const [otherMember_rows] = await db.execute(`
      SELECT u.id as other_user_id, u.name, u.photo_url
      FROM internal_chat_members m
      JOIN users u ON m.user_id = u.id
      WHERE m.chat_id = ? AND m.user_id != ?
    `, [chat.id, userId]);
    const otherMember = otherMember_rows[0];

    if (otherMember) {
      chat.name = otherMember.name;
      chat.photo_url = otherMember.photo_url;
      chat.other_user_id = otherMember.other_user_id;
      chat.is_allowed = await checkCommunicationPermission(userId, otherMember.other_user_id);
    }
    return chat;
  }));

  // Pegar a lista de contatos do usuário (user_contacts)
  const [contacts] = await db.execute(`
    SELECT uc.contact_id as other_user_id, uc.is_pinned, u.name, u.photo_url
    FROM user_contacts uc
    JOIN users u ON uc.contact_id = u.id
    WHERE uc.user_id = ?
  `, [userId]);

  const newContacts = [];
  for (const contact of contacts) {
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
        is_allowed: await checkCommunicationPermission(userId, contact.other_user_id),
        unread_count: 0,
        last_message_at: null,
        is_active: 1
      });
    }
  }

  const allChats = [...processedChats, ...newContacts];

  res.json({ chats: allChats });
});

// 2. Criar um novo grupo
router.post('/groups', checkHighestHierarchy, async (req, res) => {
  const { name, description, color, photo_url } = req.body;
  const userId = req.user.id;

  if (!name) return res.status(400).json({ error: 'Nome do grupo é obrigatório.' });

  const [result] = await db.execute(`
    INSERT INTO internal_chats (type, name, description, color, photo_url, created_by)
    VALUES ('group', ?, ?, ?, ?, ?)
  `, [name, description || null, color || null, photo_url || null, userId]);

  const chatId = result.insertId;

  // Criador se torna admin do grupo
  await db.execute(`
    INSERT INTO internal_chat_members (chat_id, user_id, role)
    VALUES (?, ?, 'admin')
  `, [chatId, userId]);

  res.json({ success: true, chatId });
});

// Remover membro de um chat (apenas Admin do grupo ou do sistema)
router.delete('/:chatId/members/:targetUserId', async (req, res) => {
  const { chatId, targetUserId } = req.params;
  const userId = req.user.id;
  
  // Verifica se o usuário atual é admin do grupo ou do sistema
  if (req.user.role !== 'admin') {
    const [member_rows] = await db.execute('SELECT role FROM internal_chat_members WHERE chat_id = ? AND user_id = ?', [chatId, userId]);
    const member = member_rows[0];
    if (!member || member.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem remover membros.' });
    }
  }
  
  await db.execute('DELETE FROM internal_chat_members WHERE chat_id = ? AND user_id = ?', [chatId, targetUserId]);
  res.json({ success: true });
});

// Inativar Grupo (Apenas Admin do Sistema)
router.patch('/:chatId/inactivate', checkSystemAdmin, async (req, res) => {
  const { chatId } = req.params;
  await db.execute("UPDATE internal_chats SET is_active = 0 WHERE id = ? AND type = 'group'", [chatId]);
  res.json({ success: true });
});

// Reativar Grupo (Apenas Admin do Sistema)
router.patch('/:chatId/reactivate', checkSystemAdmin, async (req, res) => {
  const { chatId } = req.params;
  await db.execute("UPDATE internal_chats SET is_active = 1 WHERE id = ? AND type = 'group'", [chatId]);
  res.json({ success: true });
});

// 3. Atualizar atributos do grupo (apenas admin)
router.put('/:chatId/group', checkGroupAdmin, async (req, res) => {
  const { chatId } = req.params;
  const { name, description, color, photo_url } = req.body;

  await db.execute(`
    UPDATE internal_chats 
    SET name = ?, description = ?, color = ?, photo_url = ?
    WHERE id = ? AND type = 'group'
  `, [name, description, color, photo_url, chatId]);

  res.json({ success: true });
});

// 3.5. Atualizar foto do grupo (apenas admin)
router.post('/:chatId/group/photo', checkGroupAdmin, upload.single('photo'), async (req, res) => {
  const { chatId } = req.params;

  if (!req.file) {
    return res.status(400).json({ error: 'Nenhuma imagem recebida.' });
  }

  const fileUrl = '/uploads/' + req.file.filename;

  await db.execute(`
    UPDATE internal_chats 
    SET photo_url = ?
    WHERE id = ? AND type = 'group'
  `, [fileUrl, chatId]);

  res.json({ success: true, photo_url: fileUrl });
});

// 4. Adicionar membro ao grupo (apenas hierarquia mais alta e admin)
router.post('/:chatId/members', checkHighestHierarchy, checkGroupAdmin, async (req, res) => {
  const { chatId } = req.params;
  const { userId } = req.body;

  if (!userId) return res.status(400).json({ error: 'ID do usuário obrigatório.' });

  const [exists_rows] = await db.execute('SELECT 1 FROM internal_chat_members WHERE chat_id = ? AND user_id = ?', [chatId, userId]);
  const exists = exists_rows[0];
  if (exists) return res.status(400).json({ error: 'Usuário já está no grupo.' });

  await db.execute(`
    INSERT INTO internal_chat_members (chat_id, user_id, role)
    VALUES (?, ?, 'member')
  `, [chatId, userId]);

  res.json({ success: true });
});

// 5. Atualizar role de um membro (apenas admin)
router.put('/:chatId/members/:targetUserId/role', checkGroupAdmin, async (req, res) => {
  const { chatId, targetUserId } = req.params;
  const { role } = req.body;

  if (!['admin', 'member'].includes(role)) {
    return res.status(400).json({ error: 'Role inválida.' });
  }

  await db.execute(`
    UPDATE internal_chat_members 
    SET role = ?
    WHERE chat_id = ? AND user_id = ?
  `, [role, chatId, targetUserId]);

  res.json({ success: true });
});

// Helper: Obter ou criar chat direto
router.post('/direct', async (req, res) => {
  const { targetUserId } = req.body;
  const userId = req.user.id;

  if (!targetUserId) return res.status(400).json({ error: 'targetUserId obrigatório.' });

  // === VALIDAÇÃO DE HIERARQUIA ===
  const allowed = await checkCommunicationPermission(userId, targetUserId);

  if (!allowed) {
    return res.status(403).json({ error: 'Comunicação restrita pela hierarquia. Solicite acesso.' });
  }
  // ===============================

  const [existingChat_rows] = await db.execute(`
    SELECT m1.chat_id
    FROM internal_chat_members m1
    JOIN internal_chat_members m2 ON m1.chat_id = m2.chat_id
    JOIN internal_chats c ON c.id = m1.chat_id
    WHERE c.type = 'direct' AND m1.user_id = ? AND m2.user_id = ?
  `, [userId, targetUserId]);
  const existingChat = existingChat_rows[0];

  if (existingChat) {
    return res.json({ chatId: existingChat.chat_id });
  }

  const [result] = await db.execute(`INSERT INTO internal_chats (type, created_by) VALUES ('direct', ?)`, [userId]);
  const chatId = result.insertId;

  await db.execute(`INSERT INTO internal_chat_members (chat_id, user_id) VALUES (?, ?)`, [chatId, userId]);
  await db.execute(`INSERT INTO internal_chat_members (chat_id, user_id) VALUES (?, ?)`, [chatId, targetUserId]);

  res.json({ chatId });
});

// 5.5. Marcar chat como lido
router.put('/:chatId/read', async (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.id;
  await db.execute('UPDATE internal_chat_members SET unread_count = 0 WHERE chat_id = ? AND user_id = ?', [chatId, userId]);
  res.json({ success: true });
});

// 6. Obter histórico de mensagens de um chat
router.get('/:chatId/messages', async (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.id;

  const [isMember_rows] = await db.execute('SELECT 1 FROM internal_chat_members WHERE chat_id = ? AND user_id = ?', [chatId, userId]);
  const isMember = isMember_rows[0];
  if (!isMember) return res.status(403).json({ error: 'Acesso negado ao chat.' });

  const [messages] = await db.execute(`
    SELECT m.*, u.name as sender_name, u.photo_url as sender_photo_url
    FROM internal_messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.chat_id = ? 
    ORDER BY m.created_at ASC
  `, [chatId]);

  // Adicionar reações para as mensagens
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const [reactions] = await db.execute(`
      SELECT r.id, r.user_id, r.reaction, u.name as userName
      FROM internal_message_reactions r
      JOIN users u ON r.user_id = u.id
      WHERE r.message_id = ?
    `, [msg.id]);
    msg.reactions = reactions;
  }

  const [chatInfo_rows] = await db.execute('SELECT * FROM internal_chats WHERE id = ?', [chatId]);
  const chatInfo = chatInfo_rows[0];
  const [members] = await db.execute(`
    SELECT u.id, u.name, u.photo_url, m.role, h.level as h_level
    FROM internal_chat_members m
    JOIN users u ON m.user_id = u.id
    LEFT JOIN hierarchies h ON u.hierarchy_id = h.id
    WHERE m.chat_id = ?
  `, [chatId]);

  let explicitPermission = null;
  if (chatInfo && chatInfo.type === 'direct' && members.length === 2) {
    const otherMember = members.find(m => m.id !== userId);
    if (otherMember) {
      const [ep_rows] = await db.execute(`
        SELECT * FROM allowed_communications 
        WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?)
      `, [userId, otherMember.id, otherMember.id, userId]);
      explicitPermission = ep_rows[0];
    }
  }

  res.json({ messages, chatInfo, members, explicitPermission });
});

// 7. Enviar nova mensagem
router.post('/:chatId/messages', async (req, res) => {
  const { chatId } = req.params;
  const { content_type, content, file_url, is_forwarded } = req.body;
  const userId = req.user.id;

  const [isMember_rows] = await db.execute('SELECT 1 FROM internal_chat_members WHERE chat_id = ? AND user_id = ?', [chatId, userId]);
  const isMember = isMember_rows[0];
  if (!isMember) return res.status(403).json({ error: 'Acesso negado ao chat.' });

  // Bloquear se o chat estiver inativo
  const [chatInfo_rows] = await db.execute('SELECT is_active FROM internal_chats WHERE id = ?', [chatId]);
  const chatInfo = chatInfo_rows[0];
  if (chatInfo && chatInfo.is_active === 0) {
    return res.status(403).json({ error: 'Este chat foi inativado. Envio de mensagens bloqueado.' });
  }

  const forwarded = is_forwarded ? 1 : 0;
  
  const [result] = await db.execute(`
    INSERT INTO internal_messages (chat_id, sender_id, content_type, content, file_url, is_forwarded)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [chatId, userId, content_type || 'text', content || '', file_url || null, forwarded]);

  // Update last_message_at and unread_count
  await db.execute('UPDATE internal_chats SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?', [chatId]);
  await db.execute('UPDATE internal_chat_members SET unread_count = unread_count + 1, is_hidden = 0 WHERE chat_id = ? AND user_id != ?', [chatId, userId]);
  await db.execute('UPDATE internal_chat_members SET is_hidden = 0 WHERE chat_id = ? AND user_id = ?', [chatId, userId]);

  const messageId = result.insertId;
  const [newMessage_rows] = await db.execute(`
    SELECT m.*, u.name as sender_name, u.photo_url as sender_photo_url
    FROM internal_messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.id = ?
  `, [messageId]);
  const newMessage = newMessage_rows[0];
  newMessage.reactions = [];

  const io = req.app.get('io');
  if (io) {
    const [members] = await db.execute('SELECT user_id FROM internal_chat_members WHERE chat_id = ?', [chatId]);
    members.forEach(m => {
      io.to('user_' + m.user_id).emit('receive_internal_message', newMessage);
    });
  }

  res.json({ success: true, message: newMessage });
});

// 8. Upload de arquivo e enviar como mensagem
router.post('/:chatId/upload', upload.single('file'), async (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.id;

  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo recebido.' });
  }

  const [isMember_rows] = await db.execute('SELECT 1 FROM internal_chat_members WHERE chat_id = ? AND user_id = ?', [chatId, userId]);
  const isMember = isMember_rows[0];
  if (!isMember) return res.status(403).json({ error: 'Acesso negado ao chat.' });

  // Bloquear se o chat estiver inativo
  const [chatInfo_rows] = await db.execute('SELECT is_active FROM internal_chats WHERE id = ?', [chatId]);
  const chatInfo = chatInfo_rows[0];
  if (chatInfo && chatInfo.is_active === 0) {
    return res.status(403).json({ error: 'Este chat foi inativado. Envio de anexos bloqueado.' });
  }

  const fileUrl = '/uploads/' + req.file.filename;
  
  let contentType = 'file';
  let contentToSave = req.file.originalname;

  if (req.file.mimetype.startsWith('image/')) {
    contentType = 'image';
    contentToSave = req.body.caption || '';
  }

  const [result] = await db.execute(`
    INSERT INTO internal_messages (chat_id, sender_id, content_type, content, file_url)
    VALUES (?, ?, ?, ?, ?)
  `, [chatId, userId, contentType, contentToSave, fileUrl]);

  // Update last_message_at and unread_count
  await db.execute('UPDATE internal_chats SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?', [chatId]);
  await db.execute('UPDATE internal_chat_members SET unread_count = unread_count + 1, is_hidden = 0 WHERE chat_id = ? AND user_id != ?', [chatId, userId]);
  await db.execute('UPDATE internal_chat_members SET is_hidden = 0 WHERE chat_id = ? AND user_id = ?', [chatId, userId]);

  const messageId = result.insertId;
  const [newMessage_rows] = await db.execute(`
    SELECT m.*, u.name as sender_name, u.photo_url as sender_photo_url
    FROM internal_messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.id = ?
  `, [messageId]);
  const newMessage = newMessage_rows[0];
  newMessage.reactions = [];

  const io = req.app.get('io');
  if (io) {
    const [members] = await db.execute('SELECT user_id FROM internal_chat_members WHERE chat_id = ?', [chatId]);
    members.forEach(m => {
      io.to('user_' + m.user_id).emit('receive_internal_message', newMessage);
    });
  }

  res.json({ success: true, message: newMessage });
});

// --- NOVAS ROTAS WHATSAPP ---

// Pesquisa global de usuários com verificação de hierarquia
router.get('/search/users', async (req, res) => {
  const { q } = req.query;
  const userId = req.user.id;
  
  if (!q) return res.json({ users: [] });

  const [users] = await db.execute(`
    SELECT u.id, u.name, h.level as h_level, h.name as hierarchy_name, u.photo_url 
    FROM users u
    LEFT JOIN hierarchies h ON u.hierarchy_id = h.id
    WHERE u.id != ? AND u.name LIKE ? AND u.is_active = 1
    LIMIT 20
  `, [userId, `%${q}%`]);
  
  // Mapeia adicionando flag requires_request / is_allowed
  const mappedUsers = await Promise.all(users.map(async targetUser => {
    const allowed = await checkCommunicationPermission(userId, targetUser.id);

    return {
      id: targetUser.id,
      name: targetUser.name,
      photo_url: targetUser.photo_url,
      hierarchy: targetUser.hierarchy_name,
      requires_request: !allowed,
      is_allowed: allowed
    };
  }));

  res.json({ users: mappedUsers });
});

// Adicionar contato à lista pessoal
router.post('/contacts', async (req, res) => {
  const { contactId } = req.body;
  const userId = req.user.id;

  if (!contactId || contactId === userId) return res.status(400).json({ error: 'Contato inválido.' });

  const [exists_rows] = await db.execute('SELECT 1 FROM user_contacts WHERE user_id = ? AND contact_id = ?', [userId, contactId]);
  const exists = exists_rows[0];
  if (!exists) {
    await db.execute('INSERT INTO user_contacts (user_id, contact_id) VALUES (?, ?)', [userId, contactId]);
  }

  res.json({ success: true });
});

// Remover contato da lista pessoal e ocultar chat
router.delete('/contacts/:contactId', async (req, res) => {
  const { contactId } = req.params;
  const userId = req.user.id;

  await db.execute('DELETE FROM user_contacts WHERE user_id = ? AND contact_id = ?', [userId, contactId]);

  // Ocultar chat direto
  const [existingChat_rows] = await db.execute(`
    SELECT m1.chat_id
    FROM internal_chat_members m1
    JOIN internal_chat_members m2 ON m1.chat_id = m2.chat_id
    JOIN internal_chats c ON c.id = m1.chat_id
    WHERE c.type = 'direct' AND m1.user_id = ? AND m2.user_id = ?
  `, [userId, contactId]);

  if (existingChat_rows.length > 0) {
    const chatId = existingChat_rows[0].chat_id;
    await db.execute('UPDATE internal_chat_members SET is_hidden = 1 WHERE chat_id = ? AND user_id = ?', [chatId, userId]);
  }

  res.json({ success: true });
});

// Fixar/Desfixar contato (Lista pessoal)
router.put('/contacts/:contactId/pin', async (req, res) => {
  const { contactId } = req.params;
  const userId = req.user.id;
  await db.execute('UPDATE user_contacts SET is_pinned = 1 WHERE user_id = ? AND contact_id = ?', [userId, contactId]);
  res.json({ success: true });
});
router.put('/contacts/:contactId/unpin', async (req, res) => {
  const { contactId } = req.params;
  const userId = req.user.id;
  await db.execute('UPDATE user_contacts SET is_pinned = 0 WHERE user_id = ? AND contact_id = ?', [userId, contactId]);
  res.json({ success: true });
});

// Fixar/Desfixar grupo
router.put('/groups/:chatId/pin', async (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.id;
  await db.execute('UPDATE internal_chat_members SET is_pinned = 1 WHERE user_id = ? AND chat_id = ?', [userId, chatId]);
  res.json({ success: true });
});
router.put('/groups/:chatId/unpin', async (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.id;
  await db.execute('UPDATE internal_chat_members SET is_pinned = 0 WHERE user_id = ? AND chat_id = ?', [userId, chatId]);
  res.json({ success: true });
});

// Fixar/Desfixar mensagem
router.put('/:chatId/messages/:messageId/pin', async (req, res) => {
  const { chatId, messageId } = req.params;
  const userId = req.user.id;
  
  const [isMember_rows] = await db.execute('SELECT 1 FROM internal_chat_members WHERE chat_id = ? AND user_id = ?', [chatId, userId]);
  const isMember = isMember_rows[0];
  if (!isMember) return res.status(403).json({ error: 'Acesso negado.' });

  await db.execute('UPDATE internal_messages SET is_pinned = 1 WHERE id = ? AND chat_id = ?', [messageId, chatId]);
  
  const io = req.app.get('io');
  if (io) {
    const [members] = await db.execute('SELECT user_id FROM internal_chat_members WHERE chat_id = ?', [chatId]);
    members.forEach(m => {
      io.to('user_' + m.user_id).emit('message_pinned', { chatId, messageId });
    });
  }

  res.json({ success: true });
});
router.put('/:chatId/messages/:messageId/unpin', async (req, res) => {
  const { chatId, messageId } = req.params;
  
  await db.execute('UPDATE internal_messages SET is_pinned = 0 WHERE id = ? AND chat_id = ?', [messageId, chatId]);
  
  const io = req.app.get('io');
  if (io) {
    const [members] = await db.execute('SELECT user_id FROM internal_chat_members WHERE chat_id = ?', [chatId]);
    members.forEach(m => {
      io.to('user_' + m.user_id).emit('message_unpinned', { chatId, messageId });
    });
  }

  res.json({ success: true });
});

// Reações
router.post('/:chatId/messages/:messageId/reactions', async (req, res) => {
  const { chatId, messageId } = req.params;
  const { reaction } = req.body;
  const userId = req.user.id;

  const [exists_rows] = await db.execute('SELECT 1 FROM internal_message_reactions WHERE message_id = ? AND user_id = ? AND reaction = ?', [messageId, userId, reaction]);
  const exists = exists_rows[0];
  if (!exists) {
    await db.execute('INSERT INTO internal_message_reactions (message_id, user_id, reaction) VALUES (?, ?, ?)', [messageId, userId, reaction]);
  }

  const io = req.app.get('io');
  if (io) {
    const [members] = await db.execute('SELECT user_id FROM internal_chat_members WHERE chat_id = ?', [chatId]);
    members.forEach(m => {
      io.to('user_' + m.user_id).emit('reaction_added', { chatId, messageId, userId, reaction, userName: req.user.name });
    });
  }

  res.json({ success: true });
});

router.delete('/:chatId/messages/:messageId/reactions', async (req, res) => {
  const { chatId, messageId } = req.params;
  const { reaction } = req.body;
  const userId = req.user.id;

  await db.execute('DELETE FROM internal_message_reactions WHERE message_id = ? AND user_id = ? AND reaction = ?', [messageId, userId, reaction]);

  const io = req.app.get('io');
  if (io) {
    const [members] = await db.execute('SELECT user_id FROM internal_chat_members WHERE chat_id = ?', [chatId]);
    members.forEach(m => {
      io.to('user_' + m.user_id).emit('reaction_removed', { chatId, messageId, userId, reaction });
    });
  }

  res.json({ success: true });
});

// Encaminhar mensagens (batch)
router.post('/forward', async (req, res) => {
  const { originalMessageId, targetChatIds, targetUserIds } = req.body;
  const userId = req.user.id;

  const [originalMsg_rows] = await db.execute('SELECT * FROM internal_messages WHERE id = ?', [originalMessageId]);
  const originalMsg = originalMsg_rows[0];
  if (!originalMsg) return res.status(404).json({ error: 'Mensagem não encontrada.' });

  const io = req.app.get('io');
  let successCount = 0;

  // Encaminhar para chats existentes
  if (targetChatIds && Array.isArray(targetChatIds)) {
    for (const chatId of targetChatIds) {
      const [isMember_rows] = await db.execute('SELECT 1 FROM internal_chat_members WHERE chat_id = ? AND user_id = ?', [chatId, userId]);
      const isMember = isMember_rows[0];
      if (isMember) {
        const [result] = await db.execute(`
          INSERT INTO internal_messages (chat_id, sender_id, content_type, content, file_url, is_forwarded)
          VALUES (?, ?, ?, ?, ?, 1)
        `, [chatId, userId, originalMsg.content_type, originalMsg.content, originalMsg.file_url]);
        
        // Update last_message_at and unread_count
        await db.execute('UPDATE internal_chats SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?', [chatId]);
        await db.execute('UPDATE internal_chat_members SET unread_count = unread_count + 1, is_hidden = 0 WHERE chat_id = ? AND user_id != ?', [chatId, userId]);
        await db.execute('UPDATE internal_chat_members SET is_hidden = 0 WHERE chat_id = ? AND user_id = ?', [chatId, userId]);

        const [newMessage_rows] = await db.execute(`
          SELECT m.*, u.name as sender_name, u.photo_url as sender_photo_url
          FROM internal_messages m
          JOIN users u ON m.sender_id = u.id
          WHERE m.id = ?
        `, [result.insertId]);
        const newMessage = newMessage_rows[0];
        newMessage.reactions = [];

        if (io) {
          const [members] = await db.execute('SELECT user_id FROM internal_chat_members WHERE chat_id = ?', [chatId]);
          members.forEach(m => io.to('user_' + m.user_id).emit('receive_internal_message', newMessage));
        }
        successCount++;
      }
    }
  }

  // Encaminhar para contatos sem chat (cria o chat direto primeiro)
  if (targetUserIds && Array.isArray(targetUserIds)) {
    for (const targetId of targetUserIds) {
      const [existingChat_rows] = await db.execute(`
        SELECT m1.chat_id
        FROM internal_chat_members m1
        JOIN internal_chat_members m2 ON m1.chat_id = m2.chat_id
        JOIN internal_chats c ON c.id = m1.chat_id
        WHERE c.type = 'direct' AND m1.user_id = ? AND m2.user_id = ?
      `, [userId, targetId]);
      const existingChat = existingChat_rows[0];

      let chatId;
      if (existingChat) {
        chatId = existingChat.chat_id;
      } else {
        const [cResult] = await db.execute(`INSERT INTO internal_chats (type, created_by) VALUES ('direct', ?)`, [userId]);
        chatId = cResult.insertId;
        await db.execute(`INSERT INTO internal_chat_members (chat_id, user_id) VALUES (?, ?)`, [chatId, userId]);
        await db.execute(`INSERT INTO internal_chat_members (chat_id, user_id) VALUES (?, ?)`, [chatId, targetId]);
      }

      const [result] = await db.execute(`
        INSERT INTO internal_messages (chat_id, sender_id, content_type, content, file_url, is_forwarded)
        VALUES (?, ?, ?, ?, ?, 1)
      `, [chatId, userId, originalMsg.content_type, originalMsg.content, originalMsg.file_url]);
      
      // Update last_message_at and unread_count
      await db.execute('UPDATE internal_chats SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?', [chatId]);
      await db.execute('UPDATE internal_chat_members SET unread_count = unread_count + 1, is_hidden = 0 WHERE chat_id = ? AND user_id != ?', [chatId, userId]);
      await db.execute('UPDATE internal_chat_members SET is_hidden = 0 WHERE chat_id = ? AND user_id = ?', [chatId, userId]);

      const [newMessage_rows] = await db.execute(`
        SELECT m.*, u.name as sender_name, u.photo_url as sender_photo_url
        FROM internal_messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `, [result.insertId]);
      const newMessage = newMessage_rows[0];
      newMessage.reactions = [];

      if (io) {
        const [members] = await db.execute('SELECT user_id FROM internal_chat_members WHERE chat_id = ?', [chatId]);
        members.forEach(m => io.to('user_' + m.user_id).emit('receive_internal_message', newMessage));
      }
      successCount++;
    }
  }

  res.json({ success: true, forwardedTo: successCount });
});

// --- SOLICITAÇÕES DE COMUNICAÇÃO ---

// Criar solicitação
router.post('/requests', async (req, res) => {
  const { targetId } = req.body;
  const userId = req.user.id;

  if (!targetId || targetId === userId) return res.status(400).json({ error: 'Usuário alvo inválido.' });

  // Verifica se já tem pending
  const [pending_rows] = await db.execute('SELECT 1 FROM communication_requests WHERE requester_id = ? AND target_id = ? AND status = "pending"', [userId, targetId]);
  const pending = pending_rows[0];
  if (pending) return res.status(400).json({ error: 'Já existe uma solicitação pendente para este usuário.' });

  // Verifica se já é permitido
  const [explicitPerm_rows] = await db.execute('SELECT 1 FROM allowed_communications WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?)', [userId, targetId, targetId, userId]);
  const explicitPerm = explicitPerm_rows[0];
  if (explicitPerm) return res.status(400).json({ error: 'Comunicação já está liberada.' });

  await db.execute('INSERT INTO communication_requests (requester_id, target_id) VALUES (?, ?)', [userId, targetId]);

  // Aqui você pode emitir um socket event para notificar o targetUser
  const io = req.app.get('io');
  if (io) io.to('user_' + targetId).emit('new_communication_request', { fromId: userId });

  res.json({ success: true, message: 'Solicitação enviada.' });
});

// Listar solicitações pendentes (recebidas)
router.get('/requests/pending', async (req, res) => {
  const userId = req.user.id;
  const [requests] = await db.execute(`
    SELECT cr.id, cr.requester_id, u.name as requester_name, cr.created_at
    FROM communication_requests cr
    JOIN users u ON cr.requester_id = u.id
    WHERE cr.target_id = ? AND cr.status = 'pending'
  `, [userId]);
  res.json(requests);
});

// Aprovar solicitação
router.post('/requests/:id/approve', async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const [request_rows] = await db.execute('SELECT * FROM communication_requests WHERE id = ? AND target_id = ? AND status = "pending"', [id, userId]);
  const request = request_rows[0];
  if (!request) return res.status(404).json({ error: 'Solicitação não encontrada ou já respondida.' });

  await db.execute('UPDATE communication_requests SET status = "approved" WHERE id = ?', [id]);
  
  // Concede acesso permanente
  await db.execute('INSERT INTO allowed_communications (user_a_id, user_b_id, granted_by) VALUES (?, ?, ?)', [userId, request.requester_id, userId]);

  res.json({ success: true });
});

// Rejeitar solicitação
router.post('/requests/:id/reject', async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  await db.execute('UPDATE communication_requests SET status = "rejected" WHERE id = ? AND target_id = ? AND status = "pending"', [id, userId]);
  res.json({ success: true });
});

module.exports = router;
