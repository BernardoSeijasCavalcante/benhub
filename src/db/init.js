const db = require('./database');
const bcrypt = require('bcrypt');

function initDb() {
  console.log('Iniciando criação das tabelas...');

  // Tabela users
  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'operator',
      contact_number TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (chat_id, user_id),
      FOREIGN KEY (chat_id) REFERENCES internal_chats (id),
      FOREIGN KEY (user_id) REFERENCES users (id)
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES internal_chats (id),
      FOREIGN KEY (sender_id) REFERENCES users (id)
    )
  `).run();

  // Inserir usuário Admin padrão se não existir
  const adminEmail = 'admin@benhub.com';
  const existingAdmin = db.prepare('SELECT * FROM users WHERE email = ?').get(adminEmail);

  if (!existingAdmin) {
    const defaultPassword = 'admin';
    const passwordHash = bcrypt.hashSync(defaultPassword, 10);
    db.prepare(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES (?, ?, ?, ?)
    `).run('Administrador', adminEmail, passwordHash, 'admin');
    console.log(`Usuário admin criado: ${adminEmail} / Senha: ${defaultPassword}`);
  }

  console.log('Tabelas criadas com sucesso!');
}

initDb();
