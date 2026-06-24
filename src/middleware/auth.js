const jwt = require('jsonwebtoken');
const db = require('../db/database');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET || 'super_secret_jwt_key_here', (err, user) => {
    if (err) return res.sendStatus(403);
    
    // Validar session_version
    const dbUser = db.prepare('SELECT session_version FROM users WHERE id = ?').get(user.id);
    if (!dbUser || dbUser.session_version !== user.session_version) {
      return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
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
