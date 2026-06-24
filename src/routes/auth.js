const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../../public/uploads/'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (!user) {
    return res.status(401).json({ error: 'Credenciais inválidas.' });
  }

  const validPassword = bcrypt.compareSync(password, user.password_hash);

  if (!validPassword) {
    return res.status(401).json({ error: 'Credenciais inválidas.' });
  }

  const hierarchy = db.prepare('SELECT can_manage_system FROM hierarchies WHERE id = ?').get(user.hierarchy_id);
  const computedRole = (hierarchy && hierarchy.can_manage_system === 1) ? 'admin' : 'operator';

  db.prepare('UPDATE users SET session_version = COALESCE(session_version, 0) + 1 WHERE id = ?').run(user.id);
  const updatedUser = db.prepare('SELECT session_version FROM users WHERE id = ?').get(user.id);
  const newSessionVersion = updatedUser.session_version;

  const io = req.app.get('io');
  if (io) {
    io.to('user_' + user.id).emit('force_logout');
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: computedRole, hierarchy: user.hierarchy_id, name: user.name, contact_number: user.contact_number, photo_url: user.photo_url, session_version: newSessionVersion },
    process.env.JWT_SECRET || 'super_secret_jwt_key_here',
    { expiresIn: '24h' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: computedRole,
      contact_number: user.contact_number,
      photo_url: user.photo_url
    }
  });
});

router.post('/upload-photo', authenticateToken, upload.single('photo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  }
  const photoUrl = '/uploads/' + req.file.filename;
  db.prepare('UPDATE users SET photo_url = ? WHERE id = ?').run(photoUrl, req.user.id);
  res.json({ photo_url: photoUrl });
});

router.get('/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
