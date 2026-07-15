const db = require('./database');
const bcrypt = require('bcrypt');

async function seedOperators() {
  console.log('Iniciando o processo de seeding para os operadores...');

  const defaultPassword = '123';
  const passwordHash = bcrypt.hashSync(defaultPassword, 10);

  const operators = [
    'Isabelly Araujo Rodrigues',
    'Yasmin ferreira de jesus',
    'Nicoly Batista Gil Costa',
    'Nathaly Nasciemento Santos Lima',
    'Gustavo Henrique Silva',
    'Ruan Carlos Ramos',
    'Helloá Rodrigues Cardozo',
    'Pedro Henrique de Souza Trindade',
    'Stephanny Marlene',
    'Yasmin Vitoria da Costa Xavier',
    'Kaio Santana',
    'Manuela Vieira Pantaleão',
    'Maria Eduarda de Mello',
    'Leticia Cabral Nascimento',
    'Isabelly Vitoria de Sousa Morais',
    'Pietro Rodrigues',
    'Renato Mariano de Jesus',
    'Jamily Barbosa Mello',
    'Israel Fernando da Silva',
    'Guilherme Henrique Rodrigues Silva',
    'Isabelly Vitoria dos Santos',
    'Beatriz Alves Henrique',
    'Giovana Santos Soares',
    'Isis Meirele de Andrade',
    'Bryan Vinicius Gonçalves da Silva',
    'Vitor Augusto da Costa Bodinar',
    'Walber Victor Martins da Nóbrega Couto',
    'Maryna Pereira Petelin',
    'Karol Fernanda Fortes',
    'Diego Jimenez',
    'Gabriel Nascimento',
    'Bernardo Sejas Cavalcante',
    'João Victor',
    'Alas Cardoso da Silva',
    'Pre-Labore Robson Paulino Jr',
    'Ohlisari - Terceirizada Serviço de Limpeza'
  ];

  try {
    // 1. Apagar os usuários antigos do seed anterior
    console.log('Verificando e apagando usuários da versão anterior (com números e @benhub.com)...');
    
    const oldEmailsToDelete = [];
    for (let i = 0; i < operators.length; i++) {
      const name = operators[i];
      const parts = name.split(' ');
      const first = parts[0].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const last = parts.length > 1 ? parts[parts.length - 1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : '';
      const oldEmail = last ? `${first}.${last}${i}@benhub.com` : `${first}${i}@benhub.com`;
      oldEmailsToDelete.push(oldEmail);
    }

    if (oldEmailsToDelete.length > 0) {
       const placeholders = oldEmailsToDelete.map(() => '?').join(',');
       try {
         const [deleteResult] = await db.execute(`DELETE FROM users WHERE email IN (${placeholders})`, oldEmailsToDelete);
         console.log(`Foram apagados ${deleteResult.affectedRows} usuários antigos.`);
       } catch (err) {
         console.error('Erro ao apagar usuários antigos, ignorando...', err.message);
       }
    }

    // Buscar id da hierarquia "Operador"
    const [hierarchies] = await db.execute('SELECT id FROM hierarchies WHERE name = ?', ['Operador']);
    
    if (hierarchies.length === 0) {
       console.log('Hierarquia "Operador" não encontrada. Rode o seed principal primeiro.');
       process.exit(1);
    }
    const operatorHierarchyId = hierarchies[0].id;

    console.log('Inserindo operadores com o novo formato (@benconsig.com e sem números)...');

    for (let i = 0; i < operators.length; i++) {
      const name = operators[i];
      const parts = name.split(' ');
      const first = parts[0].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const last = parts.length > 1 ? parts[parts.length - 1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : '';
      
      // Novo formato: sem número, usando @benconsig.com
      const email = last ? `${first}.${last}@benconsig.com` : `${first}@benconsig.com`;

      try {
        const [exists_rows] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (exists_rows.length === 0) {
          await db.execute(`
            INSERT INTO users (name, email, password_hash, hierarchy_id)
            VALUES (?, ?, ?, ?)
          `, [name, email, passwordHash, operatorHierarchyId]);
          console.log(`Operador inserido: ${name} (${email})`);
        } else {
          console.log(`Operador já existente: ${name} (${email})`);
        }
      } catch (err) {
        console.error(`Erro ao inserir o operador ${name}:`, err.message);
      }
    }

    console.log('Todos os operadores foram inseridos/atualizados com sucesso!');
  } catch (error) {
    console.error('Erro fatal ao processar operadores:', error);
  } finally {
    process.exit();
  }
}

seedOperators();
