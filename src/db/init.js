const bcrypt = require('bcrypt');

async function initDb(db) {
  console.log('Iniciando verificação/criação das tabelas no MySQL...');

  try {
    // Tabela hierarchies
    await db.query(`
      CREATE TABLE IF NOT EXISTS hierarchies (
        id INTEGER PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        level INTEGER NOT NULL,
        allow_same_level_chat BOOLEAN DEFAULT 0,
        can_manage_system BOOLEAN DEFAULT 0,
        can_view_sms_dashboard BOOLEAN DEFAULT 0
      )
    `);

    // Tabela users
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        hierarchy_id INTEGER,
        contact_number VARCHAR(50),
        photo_url TEXT,
        session_version INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (hierarchy_id) REFERENCES hierarchies (id)
      )
    `);

    // Tabela customers
    await db.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTO_INCREMENT,
        phone_number VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabela messages
    await db.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTO_INCREMENT,
        kolmeya_id VARCHAR(255),
        customer_phone VARCHAR(50) NOT NULL,
        sender_type VARCHAR(50) NOT NULL,
        operator_id INTEGER,
        content TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_phone) REFERENCES customers (phone_number),
        FOREIGN KEY (operator_id) REFERENCES users (id)
      )
    `);

    // Tabela internal_chats
    await db.query(`
      CREATE TABLE IF NOT EXISTS internal_chats (
        id INTEGER PRIMARY KEY AUTO_INCREMENT,
        type VARCHAR(50) NOT NULL,
        name VARCHAR(255),
        description TEXT,
        photo_url TEXT,
        color VARCHAR(50),
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_message_at DATETIME,
        is_active BOOLEAN DEFAULT 1,
        FOREIGN KEY (created_by) REFERENCES users (id)
      )
    `);

    // Tabela internal_chat_members
    await db.query(`
      CREATE TABLE IF NOT EXISTS internal_chat_members (
        chat_id INTEGER,
        user_id INTEGER,
        role VARCHAR(50) DEFAULT 'member',
        is_pinned BOOLEAN DEFAULT 0,
        is_hidden BOOLEAN DEFAULT 0,
        unread_count INTEGER DEFAULT 0,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chat_id, user_id),
        FOREIGN KEY (chat_id) REFERENCES internal_chats (id),
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);

    // Tabela user_contacts
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_contacts (
        user_id INTEGER,
        contact_id INTEGER,
        is_pinned BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, contact_id),
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (contact_id) REFERENCES users (id)
      )
    `);

    // Tabela internal_messages
    await db.query(`
      CREATE TABLE IF NOT EXISTS internal_messages (
        id INTEGER PRIMARY KEY AUTO_INCREMENT,
        chat_id INTEGER NOT NULL,
        sender_id INTEGER NOT NULL,
        content_type VARCHAR(50) DEFAULT 'text',
        content TEXT NOT NULL,
        file_url TEXT,
        is_pinned BOOLEAN DEFAULT 0,
        is_forwarded BOOLEAN DEFAULT 0,
        is_deleted BOOLEAN DEFAULT 0,
        is_edited BOOLEAN DEFAULT 0,
        updated_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chat_id) REFERENCES internal_chats (id),
        FOREIGN KEY (sender_id) REFERENCES users (id)
      )
    `);

    // Tabela internal_message_reactions
    await db.query(`
      CREATE TABLE IF NOT EXISTS internal_message_reactions (
        id INTEGER PRIMARY KEY AUTO_INCREMENT,
        message_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        reaction VARCHAR(50) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (message_id) REFERENCES internal_messages (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )
    `);

    // Tabela communication_requests
    await db.query(`
      CREATE TABLE IF NOT EXISTS communication_requests (
        id INTEGER PRIMARY KEY AUTO_INCREMENT,
        requester_id INTEGER NOT NULL,
        target_id INTEGER NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (requester_id) REFERENCES users (id),
        FOREIGN KEY (target_id) REFERENCES users (id)
      )
    `);

    // Tabela allowed_communications
    await db.query(`
      CREATE TABLE IF NOT EXISTS allowed_communications (
        user_a_id INTEGER NOT NULL,
        user_b_id INTEGER NOT NULL,
        granted_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        PRIMARY KEY (user_a_id, user_b_id),
        FOREIGN KEY (user_a_id) REFERENCES users (id),
        FOREIGN KEY (user_b_id) REFERENCES users (id),
        FOREIGN KEY (granted_by) REFERENCES users (id)
      )
    `);

    // Adicionar is_hidden se não existir
    try {
      await db.query('ALTER TABLE internal_chat_members ADD COLUMN is_hidden BOOLEAN DEFAULT 0');
    } catch (e) {
      // Ignore se a coluna já existir
    }

    // Adicionar colunas de deleção/edição em internal_messages se não existirem
    try {
      await db.query('ALTER TABLE internal_messages ADD COLUMN is_deleted BOOLEAN DEFAULT 0');
    } catch (e) {}
    try {
      await db.query('ALTER TABLE internal_messages ADD COLUMN is_edited BOOLEAN DEFAULT 0');
    } catch (e) {}
    try {
      await db.query('ALTER TABLE internal_messages ADD COLUMN updated_at DATETIME');
    } catch (e) {}

    // Inserir hierarquia Admin padrão e usuário Admin se não existirem
    const [hierarchies] = await db.query('SELECT id FROM hierarchies WHERE level = 100');
    let adminHierarchyId;
    if (hierarchies.length === 0) {
      const [res] = await db.execute(`
        INSERT INTO hierarchies (name, level, allow_same_level_chat, can_manage_system, can_view_sms_dashboard)
        VALUES (?, ?, ?, ?, ?)
      `, ['Administrador do Sistema', 100, 1, 1, 1]);
      adminHierarchyId = res.insertId;
    } else {
      adminHierarchyId = hierarchies[0].id;
    }

    const adminEmail = 'admin@benhub.com';
    const [users] = await db.execute('SELECT * FROM users WHERE email = ?', [adminEmail]);

    if (users.length === 0) {
      const defaultPassword = 'admin';
      const passwordHash = bcrypt.hashSync(defaultPassword, 10);
      await db.execute(`
        INSERT INTO users (name, email, password_hash, hierarchy_id)
        VALUES (?, ?, ?, ?)
      `, ['Administrador', adminEmail, passwordHash, adminHierarchyId]);
      console.log(`Usuário admin criado: ${adminEmail} / Senha: ${defaultPassword}`);
    }

    console.log('Tabelas verificadas/criadas com sucesso no MySQL!');
  } catch (error) {
    console.error('Erro ao inicializar tabelas:', error);
  }
}

module.exports = initDb;
