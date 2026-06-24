const db = require('./src/db/database');

console.log('Iniciando migração de notificações...');

try {
  // Add last_message_at to internal_chats
  db.prepare('ALTER TABLE internal_chats ADD COLUMN last_message_at DATETIME').run();
  console.log('Coluna last_message_at adicionada com sucesso na tabela internal_chats.');
} catch (e) {
  console.log('A coluna last_message_at já existe ou ocorreu erro:', e.message);
}

try {
  // Add unread_count to internal_chat_members
  db.prepare('ALTER TABLE internal_chat_members ADD COLUMN unread_count INTEGER DEFAULT 0').run();
  console.log('Coluna unread_count adicionada com sucesso na tabela internal_chat_members.');
} catch (e) {
  console.log('A coluna unread_count já existe ou ocorreu erro:', e.message);
}

// Opcional: Para evitar problemas de ordenação nos chats existentes, 
// podemos setar last_message_at para created_at na tabela internal_chats se estiver null.
try {
  const result = db.prepare('UPDATE internal_chats SET last_message_at = created_at WHERE last_message_at IS NULL').run();
  console.log(`Atualizados ${result.changes} chats com last_message_at inicial.`);
} catch (e) {
  console.log('Erro ao atualizar last_message_at:', e.message);
}

console.log('Migração concluída.');
