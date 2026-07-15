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
    // Buscar id da hierarquia "Operador"
    const [hierarchies] = await db.execute('SELECT id FROM hierarchies WHERE name = ?', ['Operador']);
    
    if (hierarchies.length === 0) {
       console.log('Hierarquia "Operador" não encontrada. Rode o seed principal primeiro.');
       process.exit(1);
    }
    const operatorHierarchyId = hierarchies[0].id;

    for (let i = 0; i < operators.length; i++) {
      const name = operators[i];
      // Gera um email fictício baseado no nome (primeiro.ultimo@benhub.com)
      const parts = name.split(' ');
      const first = parts[0].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const last = parts.length > 1 ? parts[parts.length - 1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : '';
      const email = last ? `${first}.${last}${i}@benhub.com` : `${first}${i}@benhub.com`;

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
    }

    console.log('Todos os operadores foram inseridos com sucesso!');
  } catch (error) {
    console.error('Erro ao inserir operadores:', error);
  } finally {
    process.exit();
  }
}

seedOperators();
