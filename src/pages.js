const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loginPage({ base, appName, error, email }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Entrar · ${esc(appName)}</title>
<link rel="icon" href="${base}/static/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&family=Figtree:wght@400;500;600;700&display=swap">
<style>
:root{--bg:#eceff2;--surface:#fff;--line:#d6dce2;--fg:#16202a;--muted:#5a6876;--accent:#1d6b58;--accent-ink:#fff;--accent-soft:#dbeee8;--danger:#b3261e;--danger-soft:#fbe9e7;
  --f-display:"Bricolage Grotesque","Figtree",system-ui,sans-serif;--f-body:"Figtree",system-ui,-apple-system,"Segoe UI",sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#10151a;--surface:#182029;--line:#2b3642;--fg:#e5ebf0;--muted:#94a2af;--accent:#4cb596;--accent-ink:#05241b;--accent-soft:#163b31;--danger:#ff8a80;--danger-soft:#3a1715;color-scheme:dark}}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 var(--f-body);display:grid;place-items:center;padding:24px max(16px,env(safe-area-inset-right,0px)) 24px max(16px,env(safe-area-inset-left,0px))}
.wrap{width:100%;max-width:400px;display:flex;flex-direction:column;gap:18px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:28px 26px;display:flex;flex-direction:column;gap:16px}
.mark{display:flex;align-items:center;gap:10px}
.mark strong{font-family:var(--f-display);font-size:20px;letter-spacing:-.01em}
h1{font-family:var(--f-display);font-size:28px;margin:0;line-height:1.1;text-wrap:balance}
p{margin:0;color:var(--muted)}
label{display:flex;flex-direction:column;gap:5px;font-weight:600;font-size:13px}
input{font:inherit;color:inherit;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button{font:inherit;font-weight:700;border:0;border-radius:8px;padding:11px;background:var(--accent);color:var(--accent-ink);cursor:pointer}
.err{background:var(--danger-soft);color:var(--danger);border-radius:8px;padding:9px 12px;font-weight:600;font-size:14px}
.foot{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:12px}
.credit{display:inline-flex;align-items:center;gap:6px;opacity:.75}
.credit img{height:16px;width:auto}
.partner img{height:30px;width:auto}
@media (prefers-color-scheme:dark){.credit img{filter:brightness(0) invert(.85)}}
</style>
</head>
<body>
<main class="wrap">
  <form class="card" method="post" action="${base}/login" autocomplete="on">
    <div class="mark">
      <svg width="28" height="28" viewBox="0 0 26 26" aria-hidden="true"><rect x="1.5" y="5" width="23" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4.5" y="8.5" width="6" height="8" rx="1" fill="var(--accent)"/><path d="M13 10h8M13 13h6M13 16h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      <strong>${esc(appName)}</strong>
    </div>
    <div>
      <h1>Entrar</h1>
      <p>Carteirinhas e crachás do Centro Educacional Doce Começo.</p>
    </div>
    ${error ? `<div class="err" role="alert">${esc(error)}</div>` : ''}
    <label for="email">E-mail<input id="email" name="email" type="email" required autofocus autocomplete="username" value="${esc(email)}"></label>
    <label for="password">Senha<input id="password" name="password" type="password" required autocomplete="current-password"></label>
    <button type="submit">Entrar</button>
  </form>
  <div class="foot">
    <span class="partner"><img src="${base}/static/img/logo-doce-comeco.png" alt="Centro Educacional Doce Começo — Concept Integrado"></span>
    <span class="credit">Desenvolvido por <img src="${base}/static/img/apoena-dev.png" alt="Apoena Dev"></span>
  </div>
</main>
</body>
</html>`;
}

module.exports = { loginPage };
