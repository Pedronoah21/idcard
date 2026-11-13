# Estúdio de Crachás (idcard)

Editor de carteirinhas e crachás estudantis com login, no estilo CardPresso/CardFlex.
No ar em **https://cedcci.com.br/cracha** (o PhotoDesk repassa esse endereço para este serviço).

## O que faz
- Modelos com frente e verso, fundo por imagem, foto do aluno, textos com campos (`{nome}`, `{turma}`…), QR Code e código de barras reais.
- Cadastro de alunos compartilhado, importação de planilha CSV e de fotos em lote (arquivo com o nome da matrícula).
- Exportação em PNG (300/600 dpi) e PDF em lote: impressora de cartão PVC (CR80) ou A4 com marcas de corte.
- Login com e-mail e senha; administradores criam, desativam e trocam a senha dos usuários.
- Tudo salvo no servidor (PostgreSQL/Neon), inclusive fotos e imagens.

## Rodar localmente
```bash
cp .env.example .env   # preencha DATABASE_URL, SESSION_SECRET, ADMIN_*
npm install
npm run dev            # http://localhost:3000/cracha
```

## Estrutura
- `src/server.js` — servidor Express: login, sessões, API de modelos, alunos, imagens e usuários
- `src/db.js` — tabelas e limpeza de imagens sem uso
- `src/pages.js` — tela de login
- `public/editor.html` — o editor (canvas); `public/vendor/` — bibliotecas de QR Code, código de barras e PDF

Desenvolvido por Apoena Dev.
