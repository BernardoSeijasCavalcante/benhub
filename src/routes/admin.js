const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Todas as rotas de admin requerem autenticação e privilégios de admin (can_manage_system = 1)
router.use(authenticateToken, async (req, res, next) => {
  if (req.user.hierarchy) {
    const [h_rows] = await db.execute('SELECT can_manage_system FROM hierarchies WHERE id = ?', [req.user.hierarchy]);
    const h = h_rows[0];
    if (h && h.can_manage_system) {
      return next();
    }
  }
  // Fallback to old behavior just in case
  if (req.user.role === 'admin') return next();
  
  res.status(403).json({ error: 'Acesso negado. Privilégios de administrador necessários.' });
});

// ==========================================
// HIERARQUIAS
// ==========================================

// Listar hierarquias
router.get('/hierarchies', async (req, res) => {
  const [hierarchies] = await db.execute('SELECT * FROM hierarchies ORDER BY level DESC');
  res.json(hierarchies);
});

// Criar hierarquia
router.post('/hierarchies', async (req, res) => {
  const { name, level, allow_same_level_chat, can_manage_system, can_view_sms_dashboard } = req.body;
  if (!name || level === undefined) {
    return res.status(400).json({ error: 'Nome e level são obrigatórios.' });
  }

  try {
    const [result] = await db.execute(`
      INSERT INTO hierarchies (name, level, allow_same_level_chat, can_manage_system, can_view_sms_dashboard)
      VALUES (?, ?, ?, ?, ?)
    `, [name, level, allow_same_level_chat ? 1 : 0, can_manage_system ? 1 : 0, can_view_sms_dashboard ? 1 : 0]);
    res.status(201).json({ id: result.insertId, name, level, allow_same_level_chat, can_manage_system, can_view_sms_dashboard });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar hierarquia.' });
  }
});

// Atualizar hierarquia
router.put('/hierarchies/:id', async (req, res) => {
  const { id } = req.params;
  const { name, level, allow_same_level_chat, can_manage_system, can_view_sms_dashboard } = req.body;

  try {
    await db.execute(`
      UPDATE hierarchies
      SET name = ?, level = ?, allow_same_level_chat = ?, can_manage_system = ?, can_view_sms_dashboard = ?
      WHERE id = ?
    `, [name, level, allow_same_level_chat ? 1 : 0, can_manage_system ? 1 : 0, can_view_sms_dashboard ? 1 : 0, id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar hierarquia.' });
  }
});

// Deletar hierarquia
router.delete('/hierarchies/:id', async (req, res) => {
  const { id } = req.params;
  
  const [inUse_rows] = await db.execute('SELECT 1 FROM users WHERE hierarchy_id = ?', [id]);
  const inUse = inUse_rows[0];
  if (inUse) {
    return res.status(400).json({ error: 'Não é possível deletar hierarquia em uso por usuários.' });
  }

  try {
    await db.execute('DELETE FROM hierarchies WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar hierarquia.' });
  }
});

// ==========================================
// USUÁRIOS
// ==========================================

// Listar usuários
router.get('/users', async (req, res) => {
  const [users] = await db.execute(`
    SELECT u.id, u.name, u.email, u.hierarchy_id, h.name as hierarchy_name, u.contact_number, u.is_active, u.created_at 
    FROM users u
    LEFT JOIN hierarchies h ON u.hierarchy_id = h.id
  `);
  res.json(users);
});

// Criar novo usuário
router.post('/users', async (req, res) => {
  const { name, email, password, hierarchyId, contactNumber } = req.body;

  if (!name || !email || !password || !hierarchyId) {
    return res.status(400).json({ error: 'Nome, email, senha e hierarchyId são obrigatórios.' });
  }

  const [existingUser_rows] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
  const existingUser = existingUser_rows[0];
  if (existingUser) {
    return res.status(400).json({ error: 'E-mail já está em uso.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);

  try {
    const [result] = await db.execute(`
      INSERT INTO users (name, email, password_hash, hierarchy_id, contact_number)
      VALUES (?, ?, ?, ?, ?)
    `, [name, email, passwordHash, hierarchyId, contactNumber]);

    res.status(201).json({ id: result.insertId, name, email, hierarchyId, contactNumber });
  } catch (error) {
    console.error('Error in POST /users:', error);
    res.status(500).json({ error: 'Erro ao criar usuário.' });
  }
});

// Atualizar usuário (senha ou dados)
router.put('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { name, email, password, hierarchyId, contactNumber } = req.body;

  let query = 'UPDATE users SET name = ?, email = ?, hierarchy_id = ?, contact_number = ?';
  const params = [name, email, hierarchyId, contactNumber];

  if (password) {
    const passwordHash = bcrypt.hashSync(password, 10);
    query += ', password_hash = ?';
    params.push(passwordHash);
  }

  query += ' WHERE id = ?';
  params.push(id);

  try {
    await db.execute(query, params);
    res.json({ success: true });
  } catch (error) {
    console.error('Error in PUT /users/:id:', error);
    res.status(500).json({ error: 'Erro ao atualizar usuário.' });
  }
});

// Desativar operador
router.delete('/users/:id', async (req, res) => {
  const { id } = req.params;

  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ error: 'Você não pode inativar a si mesmo.' });
  }

  try {
    await db.execute('UPDATE users SET is_active = 0, session_version = session_version + 1 WHERE id = ?', [id]);
    
    // Remover de grupos e chats
    await db.execute('DELETE FROM internal_chat_members WHERE user_id = ?', [id]);

    const io = req.app.get('io');
    if (io) {
      io.to('user_' + id).emit('force_logout');
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error inactivating user:', error);
    res.status(500).json({ error: 'Erro ao inativar usuário.' });
  }
});

// Reativar operador
router.patch('/users/:id/reactivate', async (req, res) => {
  const { id } = req.params;

  try {
    await db.execute('UPDATE users SET is_active = 1 WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error reactivating user:', error);
    res.status(500).json({ error: 'Erro ao reativar usuário.' });
  }
});

module.exports = router;
