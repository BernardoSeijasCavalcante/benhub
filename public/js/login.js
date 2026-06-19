document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const errorMsg = document.getElementById('error-message');
  const loginBtn = document.getElementById('login-btn');
  const btnText = loginBtn.querySelector('span');
  const loader = loginBtn.querySelector('.loader');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    // Reset UI
    errorMsg.classList.remove('visible');
    errorMsg.textContent = '';
    btnText.style.display = 'none';
    loader.style.display = 'block';
    loginBtn.disabled = true;

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.ok) {
        // Salvar token e redirecionar
        localStorage.setItem('benhub_token', data.token);
        localStorage.setItem('benhub_user', JSON.stringify(data.user));
        
        // Redirecionamento baseado na role
        if (data.user.role === 'admin') {
          // Podemos mandar para o chat ou painel admin. Vamos pro chat por padrão e ele navega pro admin se quiser, ou vai pro admin direto se houver um botão.
          // Para simplificar: admin tem acesso ao chat também.
          window.location.href = '/sms_dispatch.html';
        } else {
          window.location.href = '/sms_dispatch.html';
        }
      } else {
        showError(data.error || 'Falha ao fazer login');
      }
    } catch (err) {
      showError('Erro de conexão com o servidor.');
    } finally {
      // Restore UI
      btnText.style.display = 'block';
      loader.style.display = 'none';
      loginBtn.disabled = false;
    }
  });

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.add('visible');
    // Shake effect
    loginForm.style.animation = 'shake 0.5s';
    setTimeout(() => {
      loginForm.style.animation = '';
    }, 500);
  }

  // Inject shake animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
      20%, 40%, 60%, 80% { transform: translateX(5px); }
    }
  `;
  document.head.appendChild(style);
});
