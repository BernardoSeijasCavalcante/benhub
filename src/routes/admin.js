const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Todas as rotas de admin requerem autenticação e privilégios de admin
router.use(authenticateToken, requireAdmin);

// Listar operadores
router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, name, email, role, contact_number, created_at FROM users').all();
  res.json(users);
});

// Criar novo operador
router.post('/users', (req, res) => {
  const { name, email, password, role, contactNumber } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Nome, email e senha são obrigatórios.' });
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existingUser) {
    return res.status(400).json({ error: 'E-mail já está em uso.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const userRole = role === 'admin' ? 'admin' : 'operator';

  try {
    const result = db.prepare(`
      INSERT INTO users (name, email, password_hash, role, contact_number)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, email, passwordHash, userRole, contactNumber);

    res.status(201).json({ id: result.lastInsertRowid, name, email, role: userRole, contactNumber });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar usuário.' });
  }
});

// Atualizar usuário (senha ou dados)
router.put('/users/:id', (req, res) => {
  const { id } = req.params;
  const { name, email, password, role, contactNumber } = req.body;

  let query = 'UPDATE users SET name = ?, email = ?, role = ?, contact_number = ?';
  const params = [name, email, role, contactNumber];

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
