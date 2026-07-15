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

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
  }

  const [user_rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
  const user = user_rows[0];

  if (!user) {
    return res.status(401).json({ error: 'Credenciais inválidas.' });
  }

  if (user.is_active === 0) {
    return res.status(403).json({ error: 'Usuário inativo. Acesso negado.' });
  }

  const validPassword = bcrypt.compareSync(password, user.password_hash);

  if (!validPassword) {
    return res.status(401).json({ error: 'Credenciais inválidas.' });
  }

  const [hierarchy_rows] = await db.execute('SELECT can_manage_system, can_view_sms_dashboard FROM hierarchies WHERE id = ?', [user.hierarchy_id]);
  const hierarchy = hierarchy_rows[0];
  const computedRole = (hierarchy && hierarchy.can_manage_system === 1) ? 'admin' : 'operator';
  const canViewDashboard = (hierarchy && hierarchy.can_view_sms_dashboard === 1) ? true : false;

  await db.execute('UPDATE users SET session_version = COALESCE(session_version, 0) + 1 WHERE id = ?', [user.id]);
  const [updatedUser_rows] = await db.execute('SELECT session_version FROM users WHERE id = ?', [user.id]);
  const updatedUser = updatedUser_rows[0];
  const newSessionVersion = updatedUser.session_version;

  const io = req.app.get('io');
  if (io) {
    io.to('user_' + user.id).emit('force_logout');
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: computedRole, hierarchy: user.hierarchy_id, name: user.name, contact_number: user.contact_number, photo_url: user.photo_url, session_version: newSessionVersion, can_view_sms_dashboard: canViewDashboard },
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

router.post('/upload-photo', authenticateToken, upload.single('photo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  }
  const photoUrl = '/uploads/' + req.file.filename;
  await db.execute('UPDATE users SET photo_url = ? WHERE id = ?', [photoUrl, req.user.id]);
  res.json({ photo_url: photoUrl });
});

router.get('/me', authenticateToken, async (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
