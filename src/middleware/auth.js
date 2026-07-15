const jwt = require('jsonwebtoken');
const db = require('../db/database');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET || 'super_secret_jwt_key_here', async (err, user) => {
    if (err) return res.sendStatus(403);
    
    // Validar session_version e is_active
    const [dbUser_rows] = await db.execute('SELECT session_version, is_active FROM users WHERE id = ?', [user.id]);
  const dbUser = dbUser_rows[0];
    if (!dbUser || dbUser.is_active === 0 || dbUser.session_version !== user.session_version) {
      return res.status(401).json({ error: 'Sessão expirada ou usuário inativo. Faça login novamente.' });
    }

    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.sendStatus(403);
  }
}

module.exports = { authenticateToken, requireAdmin };
