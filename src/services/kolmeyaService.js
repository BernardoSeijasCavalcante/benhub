const axios = require('axios');
const logger = require('../utils/logger');

async function sendSMS(phone, messageText, internalMessageId) {
  const apiUrl = process.env.KOLMEYA_API_URL || 'https://kolmeya.com.br/api/v1';
  const apiToken = process.env.KOLMEYA_API_TOKEN;
  const webhookUrl = process.env.KOLMEYA_WEBHOOK_URL;
  const smsApiId = process.env.KOLMEYA_SMS_API_ID || 1;

  if (!apiToken || apiToken === 'your_kolmeya_token_here') {
    logger.warn('[MOCK] Kolmeya API Token não configurado. Simulando envio.');
    return { mock: true, success: true };
  }

  // Sanitizar telefone e adicionar código do país se necessário
  let cleanPhone = String(phone).replace(/\D/g, '');
  if (cleanPhone.length === 10 || cleanPhone.length === 11) {
    cleanPhone = '55' + cleanPhone;
  }

  const payload = {
    webhook_url: webhookUrl,
    reference: `msg-${internalMessageId}`, // Referência interna para rastrear
    messages: [
      {
        phone: parseInt(cleanPhone, 10),
        message: messageText
      }
    ]
  };

  try {
    const response = await axios.post(`${apiUrl}/sms/store`, payload, {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    logger.error('Erro na API da Kolmeya:', error.response?.data || error.message);
    throw error;
  }
}

module.exports = {
  sendSMS
};
