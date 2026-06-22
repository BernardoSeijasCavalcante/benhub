const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Todas as rotas de admin requerem autenticação e privilégios de admin (can_manage_system = 1)
router.use(authenticateToken, (req, res, next) => {
  if (req.user.hierarchy) {
    const h = db.prepare('SELECT can_manage_system FROM hierarchies WHERE id = ?').get(req.user.hierarchy);
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
router.get('/hierarchies', (req, res) => {
  const hierarchies = db.prepare('SELECT * FROM hierarchies ORDER BY level DESC').all();
  res.json(hierarchies);
});

// Criar hierarquia
router.post('/hierarchies', (req, res) => {
  const { name, level, allow_same_level_chat, can_manage_system } = req.body;
  if (!name || level === undefined) {
    return res.status(400).json({ error: 'Nome e level são obrigatórios.' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO hierarchies (name, level, allow_same_level_chat, can_manage_system)
      VALUES (?, ?, ?, ?)
    `).run(name, level, allow_same_level_chat ? 1 : 0, can_manage_system ? 1 : 0);
    res.status(201).json({ id: result.lastInsertRowid, name, level, allow_same_level_chat, can_manage_system });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar hierarquia.' });
  }
});

// Atualizar hierarquia
router.put('/hierarchies/:id', (req, res) => {
  const { id } = req.params;
  const { name, level, allow_same_level_chat, can_manage_system } = req.body;

  try {
    db.prepare(`
      UPDATE hierarchies
      SET name = ?, level = ?, allow_same_level_chat = ?, can_manage_system = ?
      WHERE id = ?
    `).run(name, level, allow_same_level_chat ? 1 : 0, can_manage_system ? 1 : 0, id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar hierarquia.' });
  }
});

// Deletar hierarquia
router.delete('/hierarchies/:id', (req, res) => {
  const { id } = req.params;
  
  const inUse = db.prepare('SELECT 1 FROM users WHERE hierarchy_id = ?').get(id);
  if (inUse) {
    return res.status(400).json({ error: 'Não é possível deletar hierarquia em uso por usuários.' });
  }

  try {
    db.prepare('DELETE FROM hierarchies WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar hierarquia.' });
  }
});

// ==========================================
// USUÁRIOS
// ==========================================

// Listar usuários
router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.hierarchy_id, h.name as hierarchy_name, u.contact_number, u.created_at 
    FROM users u
    LEFT JOIN hierarchies h ON u.hierarchy_id = h.id
  `).all();
  res.json(users);
});

// Criar novo usuário
router.post('/users', (req, res) => {
  const { name, email, password, hierarchyId, contactNumber } = req.body;

  if (!name || !email || !password || !hierarchyId) {
    return res.status(400).json({ error: 'Nome, email, senha e hierarchyId são obrigatórios.' });
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existingUser) {
    return res.status(400).json({ error: 'E-mail já está em uso.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);

  try {
    const result = db.prepare(`
      INSERT INTO users (name, email, password_hash, hierarchy_id, contact_number)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, email, passwordHash, hierarchyId, contactNumber);

    res.status(201).json({ id: result.lastInsertRowid, name, email, hierarchyId, contactNumber });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar usuário.' });
  }
});

// Atualizar usuário (senha ou dados)
router.put('/users/:id', (req, res) => {
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
    db.prepare(query).run(...params);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar usuário.' });
  }
});

// Deletar (desativar) operador - no nosso caso, deletar do banco
router.delete('/users/:id', (req, res) => {
  const { id } = req.params;

  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ error: 'Você não pode deletar a si mesmo.' });
  }

  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar usuário.' });
  }
});

module.exports = router;
