const db = require('./database');
const bcrypt = require('bcrypt');

function seedDb() {
  console.log('Iniciando o processo de seeding (populando o banco)...');

  const defaultPassword = '123';
  const passwordHash = bcrypt.hashSync(defaultPassword, 10);

  // 1. Criar Hierarquias
  console.log('Criando hierarquias...');
  const hierarchies = [
    { name: 'Operador', level: 10, allow_same_level_chat: 0, can_manage_system: 0 },
    { name: 'Supervisor', level: 20, allow_same_level_chat: 1, can_manage_system: 0 },
    { name: 'Gerente', level: 30, allow_same_level_chat: 1, can_manage_system: 1 }
  ];

  const hierarchyIds = {};
  hierarchies.forEach(h => {
    const existing = db.prepare('SELECT id FROM hierarchies WHERE name = ?').get(h.name);
    if (!existing) {
      const res = db.prepare(`
        INSERT INTO hierarchies (name, level, allow_same_level_chat, can_manage_system)
        VALUES (?, ?, ?, ?)
      `).run(h.name, h.level, h.allow_same_level_chat, h.can_manage_system);
      hierarchyIds[h.name] = res.lastInsertRowid;
    } else {
      hierarchyIds[h.name] = existing.id;
    }
  });

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
  usersToInsert.forEach(u => {
    // Checa se existe para evitar duplicação (caso rode várias vezes)
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(u.email);
    if (!exists) {
      const result = db.prepare(`
        INSERT INTO users (name, email, password_hash, hierarchy_id)
        VALUES (?, ?, ?, ?)
      `).run(u.name, u.email, passwordHash, hierarchyIds[u.hierarchy_name]);
      userIds.push(result.lastInsertRowid);
    } else {
      userIds.push(exists.id);
    }
  });

  // Garante que o Admin existe e o colocamos no array pra interagir também
  const adminIdRow = db.prepare("SELECT id FROM users WHERE email = 'admin@benhub.com'").get();
  if (adminIdRow) {
    userIds.push(adminIdRow.id);
  }

  // 3. Popular a lista de contatos (user_contacts)
  console.log('Populando listas de contatos (user_contacts)...');
  userIds.forEach(userId => {
    userIds.forEach(contactId => {
      if (userId !== contactId) {
        // Vamos adicionar aleatoriamente 50% de chance para estarem na lista um do outro
        if (Math.random() > 0.5) {
          try {
            db.prepare('INSERT OR IGNORE INTO user_contacts (user_id, contact_id, is_pinned) VALUES (?, ?, ?)').run(userId, contactId, Math.random() > 0.8 ? 1 : 0);
          } catch (e) {} // ignora unique constraint error
        }
      }
    });
  });

  // 4. Criar Grupos
  console.log('Criando grupos...');
  const groups = [
    { name: 'Vendas & Marketing', desc: 'Equipe de estratégias', color: '#ff6b6b', members: userIds.slice(0, 4) },
    { name: 'Suporte Técnico', desc: 'Resolução de problemas de clientes', color: '#4ecdc4', members: [userIds[1], userIds[3], userIds[4]] }
  ];

  const groupChatIds = [];

  groups.forEach(g => {
    const creator = g.members[0];
    const result = db.prepare(`
      INSERT INTO internal_chats (type, name, description, color, created_by)
      VALUES ('group', ?, ?, ?, ?)
    `).run(g.name, g.desc, g.color, creator);
    const chatId = result.lastInsertRowid;
    groupChatIds.push(chatId);

    // Adicionar Membros
    g.members.forEach((memberId, idx) => {
      db.prepare(`
        INSERT INTO internal_chat_members (chat_id, user_id, role, is_pinned)
        VALUES (?, ?, ?, ?)
      `).run(chatId, memberId, idx === 0 ? 'admin' : 'member', Math.random() > 0.7 ? 1 : 0);
    });
  });

  // 5. Criar Chats Diretos
  console.log('Criando chats diretos...');
  const directChats = [];
  // João (userIds[0]) e Maria (userIds[1])
  const dResult1 = db.prepare("INSERT INTO internal_chats (type, created_by) VALUES ('direct', ?)").run(userIds[0]);
  const dChat1 = dResult1.lastInsertRowid;
  db.prepare("INSERT INTO internal_chat_members (chat_id, user_id) VALUES (?, ?)").run(dChat1, userIds[0]);
  db.prepare("INSERT INTO internal_chat_members (chat_id, user_id) VALUES (?, ?)").run(dChat1, userIds[1]);
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

  messagesData.forEach(msg => {
    const result = db.prepare(`
      INSERT INTO internal_messages (chat_id, sender_id, content_type, content, is_pinned)
      VALUES (?, ?, 'text', ?, ?)
    `).run(msg.chat_id, msg.sender_id, msg.content, msg.is_pinned);
    
    const msgId = result.lastInsertRowid;

    // Adiciona reações aleatórias
    if (Math.random() > 0.3) {
      const reactionCount = Math.floor(Math.random() * 3) + 1; // 1 a 3 reações
      for (let i=0; i<reactionCount; i++) {
        const randomUser = userIds[Math.floor(Math.random() * userIds.length)];
        const randomEmoji = possibleReactions[Math.floor(Math.random() * possibleReactions.length)];
        try {
          db.prepare('INSERT INTO internal_message_reactions (message_id, user_id, reaction) VALUES (?, ?, ?)').run(msgId, randomUser, randomEmoji);
        } catch (e) {} // ignora erro se já existir mesma reação pelo usuário
      }
    }
  });

  console.log('Seeding concluído com sucesso!');
  console.log('Você pode logar com: joao@benhub.com | Senha: 123');
}

seedDb();
