Aqui está a estrutura em Markdown (`.md`) pronta para ser utilizada como documentação oficial do seu projeto. Ela contempla a arquitetura do protótipo monolítico, a interface estilo WhatsApp, o CRUD de usuários e os detalhes exatos de como interagir com a API da Kolmeya.

---

```markdown
# Documentação do Projeto: Sistema de Atendimento via SMS (Estilo WhatsApp)

## 1. Visão Geral
Este documento detalha a arquitetura, a interface e a integração do protótipo de um sistema de atendimento ao cliente via SMS. O sistema possui uma interface inspirada no WhatsApp Web, permitindo que operadores conversem com clientes em tempo real, utilizando a API da Kolmeya como gateway de envio e recebimento de mensagens. 

O projeto será construído em uma arquitetura monolítica para rápida prototipação e validação em produção, utilizando tecnologias básicas e um banco de dados SQLite.

---

## 2. Pilha Tecnológica (Tech Stack)
* **Backend & Frontend (Monolito):** Framework web básico (ex: Node.js com Express e EJS/HTML puro, ou Python com Flask/FastAPI e Jinja).
* **Banco de Dados:** SQLite (armazenamento local, leve e ideal para o protótipo).
* **Integração:** API REST (Kolmeya) e Webhooks.
* **Infraestrutura de Desenvolvimento:** O sistema será conteinerizado utilizando Docker. Para receber os *webhooks* da Kolmeya no ambiente de testes, a porta do contêiner será exposta publicamente através de um túnel do Cloudflare (Cloudflare Tunnels).

---

## 3. Gestão de Usuários e Controle de Acesso (CRUD)

O sistema exige autenticação e diferenciação de níveis de acesso para garantir a segurança da operação.

### 3.1. Papéis de Usuário
* **Administrador (Admin):** Possui acesso total. É o único perfil com permissão para acessar o painel de "Gestão de Equipe", onde pode realizar o CRUD completo:
    * **Create:** Criar novas contas de operadores (definindo e-mail e senha inicial).
    * **Read:** Listar todos os operadores ativos.
    * **Update:** Redefinir senhas ou alterar dados dos operadores.
    * **Delete:** Desativar contas de operadores.
* **Operador:** Usuário padrão. Tem acesso apenas à interface de chat para interagir com os clientes, visualizar o histórico de mensagens e responder chamados.

### 3.2. Fluxo de Login
* Tela inicial solicitando E-mail e Senha.
* Sessão gerenciada por *cookies* ou *JWT* simples, validando a rota de chat e protegendo a rota administrativa contra acessos indevidos.

---

## 4. Interface do Operador (Estilo WhatsApp)

A interface deve ser focada em produtividade, dividida em um *layout* de três colunas ou painéis principais:

1.  **Painel Lateral Esquerdo (Lista de Contatos/Chats):**
    * Barra de busca de clientes (por nome ou número).
    * Lista de conversas ativas ordenadas pela mensagem mais recente.
    * Indicadores visuais para novas mensagens (não lidas) ou falhas de envio (ex: ícone de erro se o SMS não foi entregue).
2.  **Painel Central (Janela de Chat):**
    * Cabeçalho com o nome/número do cliente e o status atual da conexão.
    * Área principal exibindo o histórico de mensagens em balões (mensagens do operador à direita, respostas do cliente à esquerda).
    * Status de leitura em tempo real nos balões do operador (Enviando, Enviado, Entregue, Falha).
    * Campo de texto na parte inferior para digitar e enviar a nova mensagem.
3.  **Painel Lateral Direito (Detalhes do Cliente) - Opcional/Retrátil:**
    * Informações de cadastro do cliente (telefone, nome, notas operacionais).

---

## 5. Integração com a API Kolmeya

A comunicação com os clientes ocorre por baixo dos panos via Kolmeya. O sistema backend fará o meio de campo entre a interface do operador e a API.

### 5.1. Enviando Mensagens (Operador -> Cliente)
Quando o operador clica em "Enviar" na interface, o backend realiza uma requisição POST para a Kolmeya.

* **Endpoint:** `POST /v1/sms/store`
* **Autenticação:** Bearer Token no cabeçalho `Authorization`.
* **Payload:** Deve incluir o `sms_api_id`, a `webhook_url` da nossa aplicação (o túnel do Cloudflare durante o desenvolvimento) e o array de `messages` contendo o número e o texto.

```json
{
  "sms_api_id": 1,
  "webhook_url": "[https://seu-tunel-cloudflare.trycloudflare.com/api/webhooks/kolmeya](https://seu-tunel-cloudflare.trycloudflare.com/api/webhooks/kolmeya)",
  "reference": "chat-interno-123",
  "messages": [
    {
      "phone": 11999999999,
      "message": "Olá! Como posso ajudar você hoje?"
    }
  ]
}

```

### 5.2. Recebendo Webhooks (Kolmeya -> Nosso Sistema)

O backend deve possuir uma rota `POST /api/webhooks/kolmeya` para escutar ativamente as atualizações da Kolmeya, atualizando o banco de dados SQLite e, consequentemente, a tela do operador.

**A) Confirmação de Status (Recibos de Entrega):**
Quando um SMS muda de status, a Kolmeya envia um JSON contendo o `id` da requisição e um array de `messages` com o respectivo `status_code`.

* O sistema deve interceptar códigos como `3` (entregue) ou `4` (não entregue).
* O SQLite é atualizado, e a interface do operador muda o ícone da mensagem (ex: de um relógio para um check duplo).

**B) Respostas do Cliente (Mensagens Recebidas):**
Quando o cliente responde o SMS, a Kolmeya faz um POST no mesmo webhook enviando um objeto que contém o array `reply`.

* O JSON conterá o `reply` (texto da resposta enviada pelo cliente), o `received_at` (data e hora), e os dados da `message` original, incluindo o `phone` (número que enviou a resposta).
* O backend salva essa nova mensagem no SQLite vinculada ao número do cliente.
* A tela do operador é atualizada, fazendo o balão de mensagem do cliente aparecer do lado esquerdo do chat.

---

## 6. Estrutura Básica do Banco de Dados (SQLite)

O banco relacional terá, no mínimo, as seguintes tabelas principais:

* **`users` (Operadores/Admins):** `id`, `name`, `email`, `password_hash`, `role` (admin/operator), `created_at`.
* **`customers` (Clientes):** `id`, `phone_number` (único, chave principal para conversas), `name`, `created_at`.
* **`messages` (Histórico de Chat):** `id`, `kolmeya_id` (para rastrear status via webhook), `customer_phone`, `sender_type` (operator/customer), `content`, `status` (pending, sent, delivered, failed), `timestamp`.

```

```