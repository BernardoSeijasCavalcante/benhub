const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');

// Middleware para verificar permissão do dashboard
const requireDashboardAccess = async (req, res, next) => {
  if (!req.user.hierarchy) {
    return res.status(403).json({ error: 'Acesso negado. Hierarquia não definida.' });
  }
  const [h_rows] = await db.execute('SELECT can_view_sms_dashboard, can_manage_system FROM hierarchies WHERE id = ?', [req.user.hierarchy]);
  const h = h_rows[0];
  if (h && (h.can_view_sms_dashboard || h.can_manage_system)) {
    return next();
  }
  res.status(403).json({ error: 'Acesso negado. Você não tem permissão para visualizar o dashboard.' });
};

router.use(authenticateToken, requireDashboardAccess);

// Endpoint para buscar dados do dashboard
router.get('/sms', async (req, res) => {
  try {
    let { startDate, endDate } = req.query;

    // Se não for passado data, usar a data de hoje (início e fim do dia)
    if (!startDate || !endDate) {
      const today = new Date();
      // Formato YYYY-MM-DD
      const dateString = today.toISOString().split('T')[0];
      startDate = `${dateString} 00:00:00`;
      endDate = `${dateString} 23:59:59`;
    } else {
      // Garantir o horário nas datas recebidas
      if (startDate.length === 10) startDate += ' 00:00:00';
      if (endDate.length === 10) endDate += ' 23:59:59';
    }

    // 1. Buscar grupos dos quais o usuário faz parte
    const [groups] = await db.execute(`
      SELECT c.id, c.name, c.photo_url 
      FROM internal_chats c
      JOIN internal_chat_members cm ON c.id = cm.chat_id
      WHERE c.type = 'group' AND cm.user_id = ?
    `, [req.user.id]);

    // Se o usuário não estiver em nenhum grupo, retorna vazio
    if (groups.length === 0) {
      return res.json({ groups: [], startDate, endDate });
    }

    // 2. Para cada grupo, buscar os membros e os stats de SMS
    // Como map() não suporta async direto mantendo sincronicidade, usamos Promise.all
    const resultGroups = await Promise.all(groups.map(async group => {
      const [members] = await db.execute(`
        SELECT u.id, u.name, u.photo_url
        FROM users u
        JOIN internal_chat_members cm ON u.id = cm.user_id
        WHERE cm.chat_id = ?
      `, [group.id]);

      // Calcular estatísticas para cada membro
      const membersWithStats = await Promise.all(members.map(async member => {
        const [stats] = await db.execute(`
          SELECT status, COUNT(*) as count
          FROM messages
          WHERE operator_id = ? AND timestamp >= ? AND timestamp <= ?
          GROUP BY status
        `, [member.id, startDate, endDate]);

        // Processar os resultados em um objeto
        const smsStats = { delivered: 0, failed: 0, sent: 0, pending: 0, total: 0 };
        stats.forEach(row => {
          smsStats[row.status] = row.count;
          smsStats.total += row.count;
        });

        return {
          ...member,
          stats: smsStats
        };
      }));

      return {
        ...group,
        members: membersWithStats
      };
    }));

    res.json({
      groups: resultGroups,
      startDate,
      endDate
    });

  } catch (error) {
    console.error('Erro ao buscar dados do dashboard:', error);
    res.status(500).json({ error: 'Erro ao buscar dados do dashboard.' });
  }
});

module.exports = router;
