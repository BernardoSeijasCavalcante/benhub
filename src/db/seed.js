const db = require('./database');
const bcrypt = require('bcrypt');

async function seedDb() {
  console.log('Iniciando o processo de seeding (populando o banco)...');

  const defaultPassword = '123';
  const passwordHash = bcrypt.hashSync(defaultPassword, 10);

  try {
    // 1. Criar Hierarquias
    console.log('Criando hierarquias...');
    const hierarchies = [
      { name: 'Operador', level: 10, allow_same_level_chat: 0, can_manage_system: 0 },
      { name: 'Supervisor', level: 20, allow_same_level_chat: 1, can_manage_system: 0 },
      { name: 'Gerente', level: 30, allow_same_level_chat: 1, can_manage_system: 1 }
    ];

    const hierarchyIds = {};
    for (const h of hierarchies) {
      const [existing_rows] = await db.execute('SELECT id FROM hierarchies WHERE name = ?', [h.name]);
      if (existing_rows.length === 0) {
        const [res] = await db.execute(`
          INSERT INTO hierarchies (name, level, allow_same_level_chat, can_manage_system)
          VALUES (?, ?, ?, ?)
        `, [h.name, h.level, h.allow_same_level_chat, h.can_manage_system]);
        hierarchyIds[h.name] = res.insertId;
      } else {
        hierarchyIds[h.name] = existing_rows[0].id;
      }
    }

    // 2. Criar Usuários
    console.log('Criando usuários...');
    const usersToInsert = [
      { name: 'João Silva', email: 'joao@benhub.com', hierarchy_name: 'Operador' },
      { name: 'Maria Souza', email: 'maria@benhub.com', hierarchy_name: 'Operador' },
      { name: 'Carlos Oliveira', email: 'carlos@benhub.com', hierarchy_name: 'Supervisor' },
      { name: 'Ana Costa', email: 'ana@benhub.com', hierarchy_name: 'Gerente' },
      { name: 'Roberto Mendes', email: 'roberto@benhub.com', hierarchy_name: 'Operador' }
    ];

    const userIds = [];
    for (const u of usersToInsert) {
      const [exists_rows] = await db.execute('SELECT id FROM users WHERE email = ?', [u.email]);
      if (exists_rows.length === 0) {
        const [result] = await db.execute(`
          INSERT INTO users (name, email, password_hash, hierarchy_id)
          VALUES (?, ?, ?, ?)
        `, [u.name, u.email, passwordHash, hierarchyIds[u.hierarchy_name]]);
        userIds.push(result.insertId);
      } else {
        userIds.push(exists_rows[0].id);
      }
    }

    // Garante que o Admin existe e o colocamos no array pra interagir também
    const [adminIdRow_rows] = await db.execute("SELECT id FROM users WHERE email = 'admin@benhub.com'");
    if (adminIdRow_rows.length > 0) {
      userIds.push(adminIdRow_rows[0].id);
    }

    // 3. Popular a lista de contatos (user_contacts)
    console.log('Populando listas de contatos (user_contacts)...');
    for (const userId of userIds) {
      for (const contactId of userIds) {
        if (userId !== contactId && Math.random() > 0.5) {
          try {
            await db.execute('INSERT IGNORE INTO user_contacts (user_id, contact_id, is_pinned) VALUES (?, ?, ?)', [userId, contactId, Math.random() > 0.8 ? 1 : 0]);
          } catch (e) {}
        }
      }
    }

    // 4. Criar Grupos
    console.log('Criando grupos...');
    const groups = [
      { name: 'Vendas & Marketing', desc: 'Equipe de estratégias', color: '#ff6b6b', members: userIds.slice(0, 4) },
      { name: 'Suporte Técnico', desc: 'Resolução de problemas de clientes', color: '#4ecdc4', members: [userIds[1], userIds[3], userIds[4]] }
    ];

    const groupChatIds = [];

    for (const g of groups) {
      const creator = g.members[0];
      const [result] = await db.execute(`
        INSERT INTO internal_chats (type, name, description, color, created_by)
        VALUES ('group', ?, ?, ?, ?)
      `, [g.name, g.desc, g.color, creator]);
      const chatId = result.insertId;
      groupChatIds.push(chatId);

      // Adicionar Membros
      for (let idx = 0; idx < g.members.length; idx++) {
        const memberId = g.members[idx];
        await db.execute(`
          INSERT INTO internal_chat_members (chat_id, user_id, role, is_pinned)
          VALUES (?, ?, ?, ?)
        `, [chatId, memberId, idx === 0 ? 'admin' : 'member', Math.random() > 0.7 ? 1 : 0]);
      }
    }

    // 5. Criar Chats Diretos
    console.log('Criando chats diretos...');
    const directChats = [];
    const [dResult1] = await db.execute("INSERT INTO internal_chats (type, created_by) VALUES ('direct', ?)", [userIds[0]]);
    const dChat1 = dResult1.insertId;
    await db.execute("INSERT INTO internal_chat_members (chat_id, user_id) VALUES (?, ?)", [dChat1, userIds[0]]);
    await db.execute("INSERT INTO internal_chat_members (chat_id, user_id) VALUES (?, ?)", [dChat1, userIds[1]]);
    directChats.push(dChat1);

    // 6. Inserir Mensagens e Reações
    console.log('Inserindo mensagens e reações...');
    const messagesData = [
      { chat_id: groupChatIds[0], sender_id: userIds[0], content: 'Bem-vindos ao grupo de Vendas!', is_pinned: 1 },
      { chat_id: groupChatIds[0], sender_id: userIds[1], content: 'Olá pessoal, vamos bater as metas!', is_pinned: 0 },
      { chat_id: groupChatIds[0], sender_id: userIds[2], content: 'Fechado.', is_pinned: 0 },
      { chat_id: groupChatIds[1], sender_id: userIds[3], content: 'Alguém pode ajudar com o chamado #1203?', is_pinned: 0 },
      { chat_id: groupChatIds[1], sender_id: userIds[4], content: 'Estou olhando isso agora mesmo.', is_pinned: 0 },
      { chat_id: directChats[0], sender_id: userIds[0], content: 'Maria, conseguiu ver aquele relatório?', is_pinned: 0 },
      { chat_id: directChats[0], sender_id: userIds[1], content: 'Sim, te envio daqui a pouco.', is_pinned: 0 }
    ];

    const possibleReactions = ['👍', '❤️', '😂', '😮', '😢'];

    for (const msg of messagesData) {
      const [result] = await db.execute(`
        INSERT INTO internal_messages (chat_id, sender_id, content_type, content, is_pinned)
        VALUES (?, ?, 'text', ?, ?)
      `, [msg.chat_id, msg.sender_id, msg.content, msg.is_pinned]);
      
      const msgId = result.insertId;

      if (Math.random() > 0.3) {
        const reactionCount = Math.floor(Math.random() * 3) + 1;
        for (let i = 0; i < reactionCount; i++) {
          const randomUser = userIds[Math.floor(Math.random() * userIds.length)];
          const randomEmoji = possibleReactions[Math.floor(Math.random() * possibleReactions.length)];
          try {
            await db.execute('INSERT IGNORE INTO internal_message_reactions (message_id, user_id, reaction) VALUES (?, ?, ?)', [msgId, randomUser, randomEmoji]);
          } catch (e) {}
        }
      }
    }

    console.log('Seeding concluído com sucesso!');
    console.log('Você pode logar com: joao@benhub.com | Senha: 123');

  } catch (err) {
    console.error('Erro durante o seeding:', err);
  } finally {
    process.exit();
  }
}

seedDb();
