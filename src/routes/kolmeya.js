const express = require('express');
const router = express.Router();
const db = require('../db/database');
const logger = require('../utils/logger');

router.post('/', (req, res) => {
  const io = req.app.get('io');
  const rawBody = req.body;
  const data = rawBody.payload || rawBody;

  logger.info('Webhook Kolmeya Recebido:', { payload: rawBody });

  try {
    // Caso A: Confirmação de Status (Recibos de Entrega)
    if (data.id && Array.isArray(data.messages) && data.messages[0]?.status_code) {
      // Como o Kolmeya retorna o 'reference' que passamos? Supondo que retorne na mensagem ou no root.
      // Se tivermos a ref: `msg-${internalMessageId}`
      // O plan.md diz: "A Kolmeya envia um JSON contendo o id da requisição e um array de messages com o respectivo status_code."
      
      const statusCode = parseInt(data.messages[0].status_code);
      let newStatus = 'sent';
      if (statusCode === 3) newStatus = 'delivered';
      if (statusCode === 4) newStatus = 'failed';

      if (data.reference && data.reference.startsWith('msg-')) {
        const messageId = parseInt(data.reference.replace('msg-', ''));
        
        if (!isNaN(messageId)) {
          // Atualiza status diretamente pelo ID da mensagem
          db.prepare('UPDATE messages SET status = ? WHERE id = ?').run(newStatus, messageId);
          
          // Notificar via Socket.IO
          io.emit('message_status_update', { messageId, status: newStatus });
        }
      }
    }

    // Respostas do cliente são ignoradas no disparo único
    if (data.reply && data.message && data.message.phone) {
      logger.info(`Resposta de cliente ignorada: ${data.message.phone} ${data.reply}`);
    }

    res.sendStatus(200);
  } catch (error) {
    logger.error('Erro processando webhook:', error);
    res.sendStatus(500);
  }
});

module.exports = router;
