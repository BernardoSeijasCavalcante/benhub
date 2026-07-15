const db = require('./database');

async function updateRoles() {
  try {
    console.log('Buscando IDs das hierarquias...');
    const [supervisorRows] = await db.execute('SELECT id FROM hierarchies WHERE name = ?', ['Supervisor']);
    const [gerenteRows] = await db.execute('SELECT id FROM hierarchies WHERE name = ?', ['Gerente']);
    
    if (supervisorRows.length === 0 || gerenteRows.length === 0) {
      console.log('Erro: Hierarquias não encontradas.');
      process.exit(1);
    }

    const supervisorId = supervisorRows[0].id;
    const adminId = gerenteRows[0].id; // Usaremos 'Gerente' que tem permissão de gestão

    // Usuários a atualizar (baseado nos emails gerados pelo seed anterior)
    const updates = [
      { email: 'pre-labore.jr@benconsig.com', roleId: adminId, roleName: 'Administrador (Gerente)' },
      { email: 'gabriel.nascimento@benconsig.com', roleId: supervisorId, roleName: 'Supervisor' },
      { email: 'diego.jimenez@benconsig.com', roleId: supervisorId, roleName: 'Supervisor' },
      { email: 'karol.fortes@benconsig.com', roleId: supervisorId, roleName: 'Supervisor' },
      { email: 'alas.silva@benconsig.com', roleId: supervisorId, roleName: 'Supervisor' } // Alas Cardoso da Silva
    ];

    console.log('Atualizando os cargos...');

    for (const u of updates) {
      const [result] = await db.execute('UPDATE users SET hierarchy_id = ? WHERE email = ?', [u.roleId, u.email]);
      if (result.affectedRows > 0) {
        console.log(`Cargo de ${u.email} atualizado para ${u.roleName}.`);
      } else {
        console.log(`Aviso: Usuário ${u.email} não encontrado no banco.`);
      }
    }

    console.log('Atualização concluída com sucesso!');
  } catch (error) {
    console.error('Erro ao atualizar cargos:', error);
  } finally {
    process.exit();
  }
}

updateRoles();
