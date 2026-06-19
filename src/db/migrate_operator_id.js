const db = require('./database');

console.log('Running migration...');
try {
  db.prepare('ALTER TABLE messages ADD COLUMN operator_id INTEGER REFERENCES users(id)').run();
  console.log('Migration successful: operator_id column added to messages table.');
} catch (e) {
  if (e.message.includes('duplicate column name')) {
    console.log('Migration already applied (column exists).');
  } else {
    console.error('Migration failed:', e);
  }
}
