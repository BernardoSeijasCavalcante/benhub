const db = require('./src/db/database');

try {
  db.prepare('ALTER TABLE users ADD COLUMN hierarchy_id INTEGER').run();
  console.log('Coluna hierarchy_id adicionada com sucesso.');
} catch (e) {
  console.log('A coluna hierarchy_id já existe ou ocorreu erro:', e.message);
}

// Associar admins à hierarquia de admin
const adminHierarchy = db.prepare('SELECT id FROM hierarchies WHERE can_manage_system = 1 LIMIT 1').get();
if (adminHierarchy) {
  const result = db.prepare("UPDATE users SET hierarchy_id = ? WHERE role = 'admin' AND hierarchy_id IS NULL").run(adminHierarchy.id);
  console.log(`Atualizados ${result.changes} usuários admin para hierarchy_id = ${adminHierarchy.id}`);
} else {
  // Criar hierarquia admin se não existir
  const res = db.prepare('INSERT INTO hierarchies (name, level, allow_same_level_chat, can_manage_system) VALUES (?, ?, ?, ?)').run('Administrador do Sistema', 100, 1, 1);
  db.prepare("UPDATE users SET hierarchy_id = ? WHERE role = 'admin' AND hierarchy_id IS NULL").run(res.lastInsertRowid);
  console.log('Criada nova hierarquia de admin e associada.');
}

// Associar operadores à hierarquia base
const opHierarchy = db.prepare('SELECT id FROM hierarchies WHERE can_manage_system = 0 LIMIT 1').get();
if (opHierarchy) {
  const result = db.prepare("UPDATE users SET hierarchy_id = ? WHERE role = 'operator' AND hierarchy_id IS NULL").run(opHierarchy.id);
  console.log(`Atualizados ${result.changes} usuários operador para hierarchy_id = ${opHierarchy.id}`);
} else {
  // Criar hierarquia operador se não existir
  const res = db.prepare('INSERT INTO hierarchies (name, level, allow_same_level_chat, can_manage_system) VALUES (?, ?, ?, ?)').run('Operador Padrão', 10, 0, 0);
  db.prepare("UPDATE users SET hierarchy_id = ? WHERE role = 'operator' AND hierarchy_id IS NULL").run(res.lastInsertRowid);
  console.log('Criada nova hierarquia de operador e associada.');
}

console.log('Migração concluída.');
