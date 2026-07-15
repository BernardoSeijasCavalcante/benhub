require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const db = require('./db/database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  }
});

// Tornando o io acessível nas rotas
app.set('io', io);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Integração do Morgan com Winston

app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

// Importar rotas
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const chatRoutes = require('./routes/chat');
const kolmeyaRoutes = require('./routes/kolmeya');
const internalChatRoutes = require('./routes/internal_chat');
const dashboardRoutes = require('./routes/dashboard');

// Usar rotas
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/webhooks/kolmeya', kolmeyaRoutes);
app.use('/api/internal-chat', internalChatRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Tratamento global de erros nas rotas
app.use(errorHandler);

const jwt = require('jsonwebtoken');

// Configuração básica do Socket.IO
io.on('connection', (socket) => {
  logger.info(`Um usuário conectou: ${socket.id}`);

  socket.on('authenticate', async (token) => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_jwt_key_here');
      
      const [rows] = await db.execute('SELECT session_version FROM users WHERE id = ?', [decoded.id]);
      const dbUser = rows[0];
      if (!dbUser || dbUser.session_version !== decoded.session_version) {
        socket.emit('force_logout');
        socket.disconnect(true);
        logger.warn(`Socket ${socket.id} rejeitado devido à sessão expirada para usuário ${decoded.id}`);
        return;
      }

      socket.join('user_' + decoded.id);
      socket.join('all_operators');
      logger.info(`Socket ${socket.id} autenticado como usuário ${decoded.id}`);
    } catch (e) {
      logger.warn(`Falha na autenticação do socket: ${e.message}`);
      socket.emit('force_logout');
      socket.disconnect(true);
    }
  });

  socket.on('disconnect', () => {
    logger.info(`Usuário desconectou: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`Servidor rodando na porta ${PORT}`);
  
  // Rotina de timeout: Expira SMS pendentes a mais de 4 minutos
  setInterval(async () => {
    try {
      const [expiredMessages] = await db.query(`
        SELECT id FROM messages 
        WHERE status = 'pending' AND timestamp < DATE_SUB(NOW(), INTERVAL 4 MINUTE)
      `);

      if (expiredMessages.length > 0) {
        for (const msg of expiredMessages) {
          await db.execute(`UPDATE messages SET status = 'failed' WHERE id = ?`, [msg.id]);
          // Emite evento para os clientes conectados para que atualizem a interface para "Erro"
          io.emit('message_status_update', { messageId: msg.id, status: 'failed' });
        }
        
        logger.info(`Timeout rotina: ${expiredMessages.length} mensagens expiradas atualizadas para 'failed'.`);
      }
    } catch (err) {
      logger.error('Erro na rotina de timeout de SMS:', err);
    }
  }, 60 * 1000); // 1 minuto
});

// Tratamento de exceções não capturadas
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
