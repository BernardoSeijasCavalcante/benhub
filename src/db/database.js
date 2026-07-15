const mysql = require('mysql2/promise');
require('dotenv').config();

// Configurações do banco de dados (ler do ambiente ou padrões)
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3307,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'benhub',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Primeiro garantimos que o banco existe
async function initConnection() {
  try {
    // Conecta sem o banco selecionado
    const connection = await mysql.createConnection({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
    });
    
    // Cria o banco caso não exista
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\``);
    await connection.end();
    
    console.log(`Database '${dbConfig.database}' verificado/criado com sucesso.`);
  } catch (error) {
    console.error('Erro ao verificar/criar banco de dados:', error);
  }
}

// Exporta um pool de conexões focado no banco selecionado
const pool = mysql.createPool(dbConfig);

// Chama a inicialização das tabelas após verificar o banco
initConnection().then(() => {
  const initDb = require('./init');
  initDb(pool);
});

module.exports = pool;
