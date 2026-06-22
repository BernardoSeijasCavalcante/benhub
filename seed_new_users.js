const sqlite3 = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

const db = sqlite3(path.join(__dirname, 'src/db/benhub.db'));

// Função para remover acentos
function removeAccents(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Função para gerar email (nome.sobrenome@benconsig.com)
function generateEmail(fullName) {
  const parts = removeAccents(fullName).trim().toLowerCase().split(/\s+/);
  if (parts.length === 1) return `${parts[0]}@benconsig.com`;
  return `${parts[0]}.${parts[parts.length - 1]}@benconsig.com`;
}

// Função para gerar senha baseada no nome (ex: Nome@1234)
function generatePassword(fullName) {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0];
  const capitalized = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
  const randomNum = Math.floor(1000 + Math.random() * 9000); // 4 dígitos
  return `${capitalized}@${randomNum}`;
}

const operators = [
  "Isabelly Araujo",
  "Gabriel Lima de Araujo",
  "Yasmin Ferreira",
  "Nicolly Batista Gil Costa",
  "Heloisa Ferreira Brito",
  "Stephanny Marlene",
  "Israel Fernando",
  "Renato Mariano",
  "Kaio Santana Silva",
  "Nicollas Porto da Silva",
  "Lorena Katy Ribeiro Paulo",
  "Ana Elisa Silva Coutinho",
  "Joyce dos Santos Costa",
  "Yasmim Vitoria da Costa Xavier",
  "Kethelyn Heloise Ferreira de Souza",
  "Kauane Vitoria da Silva Monteiro",
  "Maria Eduarda de Mello"
];

const supervisors = [
  "Gabriel Nascimento da Silva",
  "Diego Jimenez Ribeiro",
  "Matheus Ribeiro Ferreira da Silva"
];

const admins = [
  "Robson Paulino Junior"
];

console.log("Iniciando a criação de usuários...\n");
console.log("--- CREDENCIAIS GERADAS ---");

const insertUser = db.prepare(`
  INSERT INTO users (name, email, password_hash, hierarchy_id, contact_number, created_at)
  VALUES (?, ?, ?, ?, '', CURRENT_TIMESTAMP)
`);

function createUser(name, hierarchyId) {
  const email = generateEmail(name);
  const rawPassword = generatePassword(name);
  const hashedPassword = bcrypt.hashSync(rawPassword, 10);
  
  try {
    insertUser.run(name, email, hashedPassword, hierarchyId);
    console.log(`Nome: ${name.padEnd(35)} | Email: ${email.padEnd(30)} | Senha: ${rawPassword}`);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed: users.email')) {
      // Tentar com um email diferente adicionando um número
      const altEmail = email.replace('@', '1@');
      try {
        insertUser.run(name, altEmail, hashedPassword, hierarchyId);
        console.log(`Nome: ${name.padEnd(35)} | Email: ${altEmail.padEnd(30)} | Senha: ${rawPassword}`);
      } catch (err2) {
        console.error(`Erro ao criar ${name}:`, err2.message);
      }
    } else {
      console.error(`Erro ao criar ${name}:`, err.message);
    }
  }
}

// Garantir que as hierarquias existam
const getOrCreateHierarchy = (name, level, canManage) => {
  let h = db.prepare('SELECT id FROM hierarchies WHERE name = ?').get(name);
  if (!h) {
    const res = db.prepare('INSERT INTO hierarchies (name, level, allow_same_level_chat, can_manage_system) VALUES (?, ?, ?, ?)').run(name, level, 1, canManage);
    return res.lastInsertRowid;
  }
  return h.id;
};

const adminId = getOrCreateHierarchy('Administrador do Sistema', 100, 1);
const supervisorId = getOrCreateHierarchy('Supervisor', 50, 0);
const operatorId = getOrCreateHierarchy('Operador Padrão', 10, 0);

operators.forEach(name => createUser(name, operatorId));
supervisors.forEach(name => createUser(name, supervisorId));
admins.forEach(name => createUser(name, adminId));

console.log("\nProcesso concluído com sucesso.");
