const db = require('./database');
const bcrypt = require('bcrypt');

function initDb() {
  console.log('Iniciando criação das tabelas...');

  // Tabela hierarchies
  db.prepare(`
    CREATE TABLE IF NOT EXISTS hierarchies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      level INTEGER NOT NULL, -- Valores maiores = hierarquia superior
      allow_same_level_chat BOOLEAN DEFAULT 0,
      can_manage_system BOOLEAN DEFAULT 0
    )
  `).run();

  // Tabela users
  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      hierarchy_id INTEGER,
      contact_number TEXT,
      photo_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (hierarchy_id) REFERENCES hierarchies (id)
    )
  `).run();

  // Tabela customers
  db.prepare(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_number TEXT UNIQUE NOT NULL,
      name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Tabela messages
  db.prepare(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kolmeya_id TEXT,
      customer_phone TEXT NOT NULL,
      sender_type TEXT NOT NULL, -- 'operator' ou 'customer'
      operator_id INTEGER,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'failed'
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_phone) REFERENCES customers (phone_number),
      FOREIGN KEY (operator_id) REFERENCES users (id)
    )
  `).run();

  // Tabela internal_chats
  db.prepare(`
    CREATE TABLE IF NOT EXISTS internal_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL, -- 'direct', 'group'
      name TEXT,
      description TEXT,
      photo_url TEXT,
      color TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users (id)
    )
  `).run();

  // Tabela internal_chat_members
  db.prepare(`
    CREATE TABLE IF NOT EXISTS internal_chat_members (
      chat_id INTEGER,
      user_id INTEGER,
      role TEXT DEFAULT 'member', -- 'admin', 'member'
      is_pinned BOOLEAN DEFAULT 0,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (chat_id, user_id),
      FOREIGN KEY (chat_id) REFERENCES internal_chats (id),
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `).run();

  // Tabela user_contacts
  db.prepare(`
    CREATE TABLE IF NOT EXISTS user_contacts (
      user_id INTEGER,
      contact_id INTEGER,
      is_pinned BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, contact_id),
      FOREIGN KEY (user_id) REFERENCES users (id),
      FOREIGN KEY (contact_id) REFERENCES users (id)
    )
  `).run();

  // Tabela internal_messages
  db.prepare(`
    CREATE TABLE IF NOT EXISTS internal_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      content_type TEXT DEFAULT 'text', -- 'text', 'image', 'file'
      content TEXT NOT NULL,
      file_url TEXT,
      is_pinned BOOLEAN DEFAULT 0,
      is_forwarded BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES internal_chats (id),
      FOREIGN KEY (sender_id) REFERENCES users (id)
    )
  `).run();

  // Tabela internal_message_reactions
  db.prepare(`
    CREATE TABLE IF NOT EXISTS internal_message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      reaction TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES internal_messages (id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `).run();

  // Tabela communication_requests
  db.prepare(`
    CREATE TABLE IF NOT EXISTS communication_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (requester_id) REFERENCES users (id),
      FOREIGN KEY (target_id) REFERENCES users (id)
    )
  `).run();

  // Tabela allowed_communications
  db.prepare(`
    CREATE TABLE IF NOT EXISTS allowed_communications (
      user_a_id INTEGER NOT NULL,
      user_b_id INTEGER NOT NULL,
      granted_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_a_id, user_b_id),
      FOREIGN KEY (user_a_id) REFERENCES users (id),
      FOREIGN KEY (user_b_id) REFERENCES users (id),
      FOREIGN KEY (granted_by) REFERENCES users (id)
    )
  `).run();

  // Inserir hierarquia Admin padrão e usuário Admin se não existirem
  const adminHierarchy = db.prepare('SELECT id FROM hierarchies WHERE level = 100').get();
  let adminHierarchyId;
  if (!adminHierarchy) {
    const res = db.prepare(`
      INSERT INTO hierarchies (name, level, allow_same_level_chat, can_manage_system)
      VALUES (?, ?, ?, ?)
    `).run('Administrador do Sistema', 100, 1, 1);
    adminHierarchyId = res.lastInsertRowid;
  } else {
    adminHierarchyId = adminHierarchy.id;
  }

  const adminEmail = 'admin@benhub.com';
  const existingAdmin = db.prepare('SELECT * FROM users WHERE email = ?').get(adminEmail);

  if (!existingAdmin) {
    const defaultPassword = 'admin';
    const passwordHash = bcrypt.hashSync(defaultPassword, 10);
    db.prepare(`
      INSERT INTO users (name, email, password_hash, hierarchy_id)
      VALUES (?, ?, ?, ?)
    `).run('Administrador', adminEmail, passwordHash, adminHierarchyId);
    console.log(`Usuário admin criado: ${adminEmail} / Senha: ${defaultPassword}`);
  }

  console.log('Tabelas criadas com sucesso!');
}

initDb();
