const db = require('./src/db/database');

(async () => {
  const groups = [
    "DEPARTAMENTO - T.I",
    "LIDERANÇA COMERCIAL",
    "SOLICITAÇÕES DE DEMANDAS - T.I",
    "SOLICITAÇÕES DE DEMANDAS - R.H",
    "SOLICITAÇÕES DE DEMANDAS - DIGITAL",
    "SOLICITAÇÕES DE DEMANDAS - OPERACIONAL",
    "EQUIPE DIEGO - TIME COMERCIAL",
    "EQUIPE GABRIEL - TIME COMERCIAL",
    "EQUIPE RECEPTIVO - TIME COMERCIAL"
  ];

  console.log("Iniciando a criação de grupos BenConsig...\n");

  try {
    // Get a creator. Finding the first user in the DB to set as created_by.
    const [creator_rows] = await db.execute('SELECT id FROM users ORDER BY id ASC LIMIT 1');
    let creator = creator_rows[0];
    let creatorId = creator ? creator.id : null;

    if (!creatorId) {
      console.log("Aviso: Nenhum usuário encontrado no banco. Os grupos serão criados sem um 'created_by'.");
    }

    // Some vibrant colors for the groups
    const colors = [
      '#4CAF50', '#2196F3', '#FF9800', '#F44336', '#9C27B0', 
      '#3F51B5', '#00BCD4', '#009688', '#E91E63'
    ];

    for (let index = 0; index < groups.length; index++) {
      const groupName = groups[index];
      const color = colors[index % colors.length];

      const [existingRows] = await db.execute(
        "SELECT id FROM internal_chats WHERE name = ? AND type = 'group'",
        [groupName]
      );

      if (existingRows.length === 0) {
        try {
          const [res] = await db.execute(
            "INSERT INTO internal_chats (type, name, description, color, created_by) VALUES ('group', ?, ?, ?, ?)",
            [groupName, `Grupo ${groupName}`, color, creatorId]
          );
          
          const insertId = res.insertId;
          console.log(`Grupo criado com sucesso: ${groupName} (ID: ${insertId})`);
          
          // If we have a creator, add them as an admin member of the group
          if (creatorId) {
            try {
              await db.execute(
                "INSERT INTO internal_chat_members (chat_id, user_id, role, is_pinned) VALUES (?, ?, 'admin', 0)",
                [insertId, creatorId]
              );
            } catch (e) {
              console.error(`Erro ao adicionar membro ao grupo ${groupName}:`, e.message);
            }
          }
        } catch (err) {
          console.error(`Erro ao criar o grupo ${groupName}:`, err.message);
        }
      } else {
        console.log(`O grupo já existe e foi ignorado: ${groupName} (ID: ${existingRows[0].id})`);
      }
    }

    console.log("\nProcesso de seeding de grupos concluído.");
  } catch (error) {
    console.error("Erro geral no seeding:", error);
  } finally {
    process.exit();
  }
})();