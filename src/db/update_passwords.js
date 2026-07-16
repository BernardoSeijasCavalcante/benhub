const db = require('./database');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// Função para gerar uma senha aleatória simples (letras e números)
function generateRandomPassword(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

async function updatePasswords() {
  console.log('Iniciando a atualização de senhas para todos os usuários...');
  console.log('--------------------------------------------------');
  
  try {
    // Busca todos os usuários
    const [users] = await db.execute('SELECT id, name, email FROM users');
    
    if (users.length === 0) {
      console.log('Nenhum usuário encontrado no sistema.');
      return;
    }

    // Prepara para imprimir como uma tabela para facilitar a leitura
    console.log(String('NOME').padEnd(40) + ' | ' + String('EMAIL').padEnd(45) + ' | ' + 'NOVA SENHA');
    console.log('-'.repeat(105));

    for (const user of users) {
      const newPassword = generateRandomPassword(8);
      const passwordHash = bcrypt.hashSync(newPassword, 10);

      // Atualiza no banco
      await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, user.id]);

      // Imprime no console (ajustando o tamanho para alinhar as colunas)
      const nameStr = user.name.length > 38 ? user.name.substring(0, 35) + '...' : user.name;
      const emailStr = user.email.length > 43 ? user.email.substring(0, 40) + '...' : user.email;
      
      console.log(
        String(nameStr).padEnd(40) + ' | ' + 
        String(emailStr).padEnd(45) + ' | ' + 
        newPassword
      );
    }

    console.log('--------------------------------------------------');
    console.log(`Sucesso! Senhas atualizadas para ${users.length} usuários.`);

  } catch (error) {
    console.error('Erro ao atualizar as senhas:', error);
  } finally {
    process.exit();
  }
}

updatePasswords();
