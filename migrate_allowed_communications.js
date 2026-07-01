const db = require('./src/db/database');

try {
  // Add expires_at column to allowed_communications
  db.prepare('ALTER TABLE allowed_communications ADD COLUMN expires_at DATETIME').run();
  console.log('Coluna expires_at adicionada com sucesso à tabela allowed_communications.');
} catch (e) {
  console.log('A coluna expires_at já existe ou ocorreu um erro:', e.message);
}

console.log('Migração concluída.');
