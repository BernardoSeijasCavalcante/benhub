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
        // Salvar token e usuário no localStorage
        localStorage.setItem('benhub_token', data.token);
        localStorage.setItem('benhub_user', JSON.stringify(data.user));
        
        // Verifica se o usuário não tem telefone
        if (!data.user.contact_number) {
          showPhoneModal();
        } else {
          redirectUser(data.user.role);
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

  // --- Phone Modal Logic ---
  const phoneModal = document.getElementById('phone-modal');
  const phoneForm = document.getElementById('phone-form');
  const phoneInput = document.getElementById('phone-input');
  const phoneErrorMsg = document.getElementById('phone-error-message');
  const phoneBtn = document.getElementById('phone-btn');
  const phoneBtnText = phoneBtn ? phoneBtn.querySelector('span') : null;
  const phoneLoader = phoneBtn ? phoneBtn.querySelector('.loader') : null;

  function redirectUser(role) {
    window.location.href = '/sms_dispatch.html';
  }

  function showPhoneModal() {
    phoneModal.style.display = 'flex';
  }

  if (phoneInput) {
    phoneInput.addEventListener('input', function (e) {
      let x = e.target.value.replace(/\D/g, '').match(/(\d{0,2})(\d{0,5})(\d{0,4})/);
      e.target.value = !x[2] ? x[1] : '(' + x[1] + ') ' + x[2] + (x[3] ? '-' + x[3] : '');
    });
  }

  if (phoneForm) {
    phoneForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = phoneInput.value;
      if (phone.length < 14) {
        showPhoneError('Por favor, insira um número válido.');
        return;
      }

      phoneErrorMsg.classList.remove('visible');
      phoneErrorMsg.textContent = '';
      phoneBtnText.style.display = 'none';
      phoneLoader.style.display = 'block';
      phoneBtn.disabled = true;

      try {
        const token = localStorage.getItem('benhub_token');
        const res = await fetch('/api/auth/update-phone', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({ contact_number: phone })
        });

        if (res.ok) {
          const userStr = localStorage.getItem('benhub_user');
          if (userStr) {
            const user = JSON.parse(userStr);
            user.contact_number = phone;
            localStorage.setItem('benhub_user', JSON.stringify(user));
            redirectUser(user.role);
          } else {
            redirectUser();
          }
        } else {
          const data = await res.json();
          showPhoneError(data.error || 'Erro ao salvar telefone.');
        }
      } catch (err) {
        showPhoneError('Erro de conexão com o servidor.');
      } finally {
        phoneBtnText.style.display = 'block';
        phoneLoader.style.display = 'none';
        phoneBtn.disabled = false;
      }
    });
  }

  function showPhoneError(msg) {
    phoneErrorMsg.textContent = msg;
    phoneErrorMsg.classList.add('visible');
    phoneForm.style.animation = 'shake 0.5s';
    setTimeout(() => {
      phoneForm.style.animation = '';
    }, 500);
  }
});
