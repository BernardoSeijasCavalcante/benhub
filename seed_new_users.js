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
  "ISABELLY ARAUJO",
  "GABRIEL LIMA DE ARAUJO",
  "YASMIN FERREIRA",
  "NICOLLY BATISTA GIL COSTA",
  "HELOISA FERREIRA BRITO",
  "STEPHANNY MARLENE",
  "ISRAEL FERNANDO",
  "RENATO MARIANO",
  "KAIO SANTANA SILVA",
  "NICOLLAS PORTO DA SILVA",
  "LORENA KATY RIBEIRO PAULO",
  "ANA ELISA SILVA COUTINHO",
  "JOYCE DOS SANTOS COSTA",
  "YASMIM VITORIA DA COSTA XAVIER",
  "KETHELYN HELOISE FERREIRA DE SOUZA",
  "KAUANE VITORIA DA SILVA MONTEIRO",
  "MARIA EDUARDA DE MELLO"
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
  INSERT INTO users (name, email, password_hash, role, hierarchy_id, contact_number, created_at)
  VALUES (?, ?, ?, ?, ?, '', CURRENT_TIMESTAMP)
`);

function createUser(name, hierarchyId, role) {
  const email = generateEmail(name);
  const rawPassword = generatePassword(name);
  const hashedPassword = bcrypt.hashSync(rawPassword, 10);
  
  try {
    insertUser.run(name, email, hashedPassword, role, hierarchyId);
    console.log(`Nome: ${name.padEnd(35)} | Email: ${email.padEnd(30)} | Senha: ${rawPassword}`);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed: users.email')) {
      // Tentar com um email diferente adicionando um número
      const altEmail = email.replace('@', '1@');
      try {
        insertUser.run(name, altEmail, hashedPassword, role, hierarchyId);
        console.log(`Nome: ${name.padEnd(35)} | Email: ${altEmail.padEnd(30)} | Senha: ${rawPassword}`);
      } catch (err2) {
        console.error(`Erro ao criar ${name}:`, err2.message);
      }
    } else {
      console.error(`Erro ao criar ${name}:`, err.message);
    }
  }
}

// IDs das hierarquias baseados na tabela: 
// 1 = Administrador, 2 = Operador, 3 = Supervisor
operators.forEach(name => createUser(name, 2, 'user'));
supervisors.forEach(name => createUser(name, 3, 'user'));
admins.forEach(name => createUser(name, 1, 'admin'));

console.log("\nProcesso concluído com sucesso.");
