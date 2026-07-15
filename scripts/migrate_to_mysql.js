require('dotenv').config();
const Database = require('better-sqlite3');
const mysql = require('mysql2/promise');
const path = require('path');

async function migrate() {
    const sqlitePath = path.join(__dirname, '..', 'src', 'db', 'benhub.db');
    console.log(`Conectando ao banco SQLite: ${sqlitePath}`);
    const sqliteDb = new Database(sqlitePath, { fileMustExist: true });

    console.log(`Conectando ao banco MySQL em ${process.env.DB_HOST}:${process.env.DB_PORT}...`);
    const mysqlConn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'benhub',
        charset: 'utf8mb4'
    });

    const validUsersStmt = sqliteDb.prepare(`
        SELECT id FROM users WHERE id IN (
            SELECT sender_id FROM internal_messages
        ) OR id IN (
            SELECT operator_id FROM messages
        ) OR id IN (
            SELECT user_id FROM internal_chat_members
        )
    `);
    const validUsersRows = validUsersStmt.all();
    const validUsers = new Set(validUsersRows.map(row => row.id));
    console.log(`Foram encontrados ${validUsers.size} usuários válidos para migração.`);
    const validUsersStr = validUsers.size > 0 ? Array.from(validUsers).join(',') : '0';

    async function migrateTable(tableName, fetchQuery, mysqlTableName = null, transformRow = null) {
        mysqlTableName = mysqlTableName || tableName;
        console.log(`Migrando a tabela '${tableName}'...`);

        const rows = sqliteDb.prepare(fetchQuery).all();
        if (rows.length === 0) {
            console.log(`Nenhum registro para migrar na tabela ${tableName}.`);
            return;
        }

        const columns = Object.keys(rows[0]);
        const colsStr = columns.join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        const insertQuery = `INSERT IGNORE INTO ${mysqlTableName} (${colsStr}) VALUES (${placeholders})`;

        let count = 0;
        await mysqlConn.beginTransaction();
        try {
            for (let row of rows) {
                if (transformRow) {
                    row = transformRow(row);
                }
                const values = columns.map(col => row[col]);
                await mysqlConn.execute(insertQuery, values);
                count++;
            }
            await mysqlConn.commit();
            console.log(`${count} registros migrados para a tabela '${mysqlTableName}'.`);
        } catch (error) {
            await mysqlConn.rollback();
            throw error;
        }
    }

    try {
        await migrateTable('hierarchies', 'SELECT * FROM hierarchies');
        await migrateTable('customers', 'SELECT * FROM customers');
        await migrateTable('users', `SELECT * FROM users WHERE id IN (${validUsersStr})`);
        
        const transformChat = (row) => {
            if (!validUsers.has(row.created_by)) {
                row.created_by = null;
            }
            return row;
        };
        await migrateTable('internal_chats', 'SELECT * FROM internal_chats', null, transformChat);
        
        await migrateTable('messages', 'SELECT * FROM messages');
        await migrateTable('internal_chat_members', 'SELECT * FROM internal_chat_members');
        await migrateTable('internal_messages', 'SELECT * FROM internal_messages');
        
        await migrateTable('user_contacts', `SELECT * FROM user_contacts WHERE user_id IN (${validUsersStr}) AND contact_id IN (${validUsersStr})`);
        await migrateTable('internal_message_reactions', `SELECT * FROM internal_message_reactions WHERE user_id IN (${validUsersStr})`);
        await migrateTable('communication_requests', `SELECT * FROM communication_requests WHERE requester_id IN (${validUsersStr}) AND target_id IN (${validUsersStr})`);
        await migrateTable('allowed_communications', `SELECT * FROM allowed_communications WHERE user_a_id IN (${validUsersStr}) AND user_b_id IN (${validUsersStr}) AND granted_by IN (${validUsersStr})`);
        
        console.log('\nMigração concluída com sucesso!');
    } catch (e) {
        console.error(`\nErro durante a migração: ${e.message}`);
    } finally {
        sqliteDb.close();
        await mysqlConn.end();
    }
}

migrate();
