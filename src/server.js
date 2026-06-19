require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');

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

// Usar rotas
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/webhooks/kolmeya', kolmeyaRoutes);
app.use('/api/internal-chat', internalChatRoutes);

// Tratamento global de erros nas rotas
app.use(errorHandler);

const jwt = require('jsonwebtoken');

// Configuração básica do Socket.IO
io.on('connection', (socket) => {
  logger.info(`Um usuário conectou: ${socket.id}`);

  socket.on('authenticate', (token) => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_jwt_key_here');
      socket.join('user_' + decoded.id);
      socket.join('all_operators');
      logger.info(`Socket ${socket.id} autenticado como usuário ${decoded.id}`);
    } catch (e) {
      logger.warn(`Falha na autenticação do socket: ${e.message}`);
    }
  });

  socket.on('disconnect', () => {
    logger.info(`Usuário desconectou: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`Servidor rodando na porta ${PORT}`);
});

// Tratamento de exceções não capturadas
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
