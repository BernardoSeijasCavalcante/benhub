const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const kolmeyaService = require('../services/kolmeyaService');
const logger = require('../utils/logger');

router.use(authenticateToken);

// Lista os últimos disparos realizados (Log)
router.get('/recent', (req, res) => {
  const { role, id: userId } = req.user;
  const filterOperatorId = req.query.operator_id;

  let query = `
    SELECT m.id, m.customer_phone, c.name as customer_name, m.content, m.status, m.timestamp, m.operator_id
    FROM messages m
    LEFT JOIN customers c ON m.customer_phone = c.phone_number
    WHERE m.sender_type = 'operator'
  `;
  const params = [];

  if (role === 'operator') {
    query += ` AND m.operator_id = ?`;
    params.push(userId);
  } else if (role === 'admin' && filterOperatorId) {
    query += ` AND m.operator_id = ?`;
    params.push(filterOperatorId);
  }

  query += ` ORDER BY m.timestamp DESC LIMIT 50`;

  const messages = db.prepare(query).all(...params);
  res.json(messages);
});

// Enviar nova mensagem (Disparo Único com template)
router.post('/send', async (req, res) => {
  const { phone, clientName } = req.body;
  const operatorName = req.user.name;
  const operatorContact = req.user.contact_number || '00000000000'; // Fallback se não configurado

  if (!phone || !clientName) {
    return res.status(400).json({ error: 'Telefone e Nome do Cliente são obrigatórios.' });
  }

  // Templates
  const templates = [
    `Olá {{cliente}}! Sou o(a) {{operador}}, consultor(a) comercial da BenConsig! Venha me contatar por Whatsapp: https://wa.me/{{contato}}`,
    `Oi {{cliente}}, tudo bem? Aqui é o(a) {{operador}}, da BenConsig. Estou à disposição no Whatsapp: https://wa.me/{{contato}}`,
    `Olá {{cliente}}, meu nome é {{operador}} e sou consultor(a) na BenConsig. Me chame no Whatsapp para conversarmos: https://wa.me/{{contato}}`,
    `Bom dia/boa tarde, {{cliente}}! Sou {{operador}}, da equipe BenConsig. Aguardo seu contato no Whatsapp: https://wa.me/{{contato}}`
  ];

  // Escolhe template aleatório
  const randomTemplate = templates[Math.floor(Math.random() * templates.length)];
  
  // Substitui as variáveis
  const messageContent = randomTemplate
    .replace('{{cliente}}', clientName)
    .replace('{{operador}}', operatorName)
    .replace('{{contato}}', operatorContact);

  // Garantir que o cliente existe
  const existingCustomer = db.prepare('SELECT * FROM customers WHERE phone_number = ?').get(phone);
  if (!existingCustomer) {
    db.prepare('INSERT INTO customers (phone_number, name) VALUES (?, ?)').run(phone, clientName);
  } else {
    // Atualiza nome se necessário
    db.prepare('UPDATE customers SET name = ? WHERE phone_number = ?').run(clientName, phone);
  }

  try {
    // 1. Salvar no banco como pending
    const result = db.prepare(`
      INSERT INTO messages (customer_phone, sender_type, operator_id, content, status)
      VALUES (?, 'operator', ?, ?, 'pending')
    `).run(phone, req.user.id, messageContent);
    
    const messageId = result.lastInsertRowid;

    // 2. Enviar para a Kolmeya API
    const kolmeyaResponse = await kolmeyaService.sendSMS(phone, messageContent, messageId);

    let finalStatus = 'pending';
    let kolmeyaId = null;

    if (kolmeyaResponse && !kolmeyaResponse.mock) {
      if (kolmeyaResponse.valids && kolmeyaResponse.valids.length > 0) {
        kolmeyaId = kolmeyaResponse.id; 
      } else if (
        (kolmeyaResponse.invalids && kolmeyaResponse.invalids.length > 0) ||
        (kolmeyaResponse.blacklist && kolmeyaResponse.blacklist.length > 0) ||
        (kolmeyaResponse.not_disturb && kolmeyaResponse.not_disturb.length > 0) ||
        (kolmeyaResponse.duplicates && kolmeyaResponse.duplicates.length > 0)
      ) {
        finalStatus = 'failed';
      }
    }

    if (kolmeyaId || finalStatus === 'failed') {
      db.prepare('UPDATE messages SET kolmeya_id = ?, status = ? WHERE id = ?')
        .run(kolmeyaId, finalStatus, messageId);
    }
    
    res.json({ success: true, messageId, status: finalStatus, sentContent: messageContent });

  } catch (error) {
    logger.error('Erro ao enviar mensagem:', error);
    res.status(500).json({ error: 'Falha ao enviar mensagem.' });
  }
});

module.exports = router;
