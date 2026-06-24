const db = require('./src/db/database');

try {
  db.prepare('ALTER TABLE users ADD COLUMN session_version INTEGER DEFAULT 0').run();
  console.log('Coluna session_version adicionada com sucesso.');
} catch (e) {
  console.log('A coluna session_version já existe ou ocorreu erro:', e.message);
}

// Inicializa session_version para usuários existentes, caso não seja 0 (apenas para garantir)
db.prepare('UPDATE users SET session_version = 0 WHERE session_version IS NULL').run();

console.log('Migração de sessões concluída.');
