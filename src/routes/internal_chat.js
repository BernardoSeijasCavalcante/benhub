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

// 1. Listar todos os chats (directs e groups) do usuário logado e os usuários disponíveis para chat direto
router.get('/chats', (req, res) => {
  const userId = req.user.id;

  // Pegar todos os chats onde o usuário é membro
  const chats = db.prepare(`
    SELECT c.* 
    FROM internal_chats c
    JOIN internal_chat_members m ON c.id = m.chat_id
    WHERE m.user_id = ?
  `).all(userId);

  // Para chats diretos, descobrir quem é o outro participante para exibir o nome correto
  const processedChats = chats.map(chat => {
    if (chat.type === 'direct') {
      const otherMember = db.prepare(`
        SELECT u.id, u.name 
        FROM internal_chat_members m
        JOIN users u ON m.user_id = u.id
        WHERE m.chat_id = ? AND m.user_id != ?
      `).get(chat.id, userId);
      
      if (otherMember) {
        chat.name = otherMember.name;
        chat.other_user_id = otherMember.id;
      }
    }
    return chat;
  });

  // Usuários para iniciar novas conversas diretas
  const users = db.prepare('SELECT id, name FROM users WHERE id != ?').all(userId);

  res.json({ chats: processedChats, users });
});

// 2. Criar um novo grupo
router.post('/groups', (req, res) => {
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

// 4. Adicionar membro ao grupo (apenas admin)
router.post('/:chatId/members', checkGroupAdmin, (req, res) => {
  const { chatId } = req.params;
  const { userId } = req.body;

  if (!userId) return res.status(400).json({ error: 'ID do usuário obrigatório.' });

  // Checa se o usuário já está no grupo
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

  // Checar se já existe
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

  // Criar novo chat direto
  const result = db.prepare(`INSERT INTO internal_chats (type, created_by) VALUES ('direct', ?)`).run(userId);
  const chatId = result.lastInsertRowid;

  db.prepare(`INSERT INTO internal_chat_members (chat_id, user_id) VALUES (?, ?)`).run(chatId, userId);
  db.prepare(`INSERT INTO internal_chat_members (chat_id, user_id) VALUES (?, ?)`).run(chatId, targetUserId);

  res.json({ chatId });
});

// 6. Obter histórico de mensagens de um chat
router.get('/:chatId/messages', (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.id;

  // Verificar se o usuário pertence a este chat
  const isMember = db.prepare('SELECT 1 FROM internal_chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
  if (!isMember) return res.status(403).json({ error: 'Acesso negado ao chat.' });

  const messages = db.prepare(`
    SELECT m.*, u.name as sender_name 
    FROM internal_messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.chat_id = ? 
    ORDER BY m.created_at ASC
  `).all(chatId);

  // Também retornar os membros do chat e informações (para gerenciar grupo)
  const chatInfo = db.prepare('SELECT * FROM internal_chats WHERE id = ?').get(chatId);
  const members = db.prepare(`
    SELECT u.id, u.name, m.role 
    FROM internal_chat_members m
    JOIN users u ON m.user_id = u.id
    WHERE m.chat_id = ?
  `).all(chatId);

  res.json({ messages, chatInfo, members });
});

// 7. Enviar mensagem
router.post('/:chatId/messages', (req, res) => {
  const { chatId } = req.params;
  const { content_type, content, file_url } = req.body;
  const userId = req.user.id;

  const isMember = db.prepare('SELECT 1 FROM internal_chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
  if (!isMember) return res.status(403).json({ error: 'Acesso negado ao chat.' });

  const result = db.prepare(`
    INSERT INTO internal_messages (chat_id, sender_id, content_type, content, file_url)
    VALUES (?, ?, ?, ?, ?)
  `).run(chatId, userId, content_type || 'text', content || '', file_url || null);

  const messageId = result.lastInsertRowid;
  const newMessage = db.prepare(`
    SELECT m.*, u.name as sender_name 
    FROM internal_messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.id = ?
  `).get(messageId);

  // Emitir evento Socket.IO
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
  if (!isMember) {
    return res.status(403).json({ error: 'Acesso negado ao chat.' });
  }

  const fileUrl = '/uploads/' + req.file.filename;
  
  // Determinar content_type
  let contentType = 'file';
  if (req.file.mimetype.startsWith('image/')) {
    contentType = 'image';
  }

  const result = db.prepare(`
    INSERT INTO internal_messages (chat_id, sender_id, content_type, content, file_url)
    VALUES (?, ?, ?, ?, ?)
  `).run(chatId, userId, contentType, req.file.originalname, fileUrl);

  const messageId = result.lastInsertRowid;
  const newMessage = db.prepare(`
    SELECT m.*, u.name as sender_name 
    FROM internal_messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.id = ?
  `).get(messageId);

  // Emitir evento Socket.IO
  const io = req.app.get('io');
  if (io) {
    const members = db.prepare('SELECT user_id FROM internal_chat_members WHERE chat_id = ?').all(chatId);
    members.forEach(m => {
      io.to('user_' + m.user_id).emit('receive_internal_message', newMessage);
    });
  }

  res.json({ success: true, message: newMessage });
});

module.exports = router;
