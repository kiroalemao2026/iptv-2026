# 📺 Manual de Sobrevivência: Erros de Streaming e Proxy no Nexus TV

Este documento descreve a arquitetura de resiliência (Anti-Bloqueio) implementada no Nexus TV para garantir que os links de IPTV e VOD (Filmes/Séries) rodem liso, além de explicar como agir caso novos erros surjam no console ou no player.

---

## 🏗️ 1. Como a Carga de Arquivos Funciona (Listas M3U)
O carregamento de listas M3U sofre constantemente com bloqueios de IP de Data Centers (Railway). Para contornar isso, a função `carregarListaM3U` (localizada em `app.js`) tenta 4 rotas de acesso em cascata:

1. **Direto pelo Navegador:** Usa o seu IP residencial. O servidor IPTV geralmente permite acessos locais sem pestanejar.
2. **CORS Proxy Público (`corsproxy.io`):** Um servidor gigantesco e público. É o primeiro socorro caso venha um bloqueio de CORS (Mixed Content).
3. **Servidor Proxy Node.js (Nosso Servidor na Railway):** Nossa própria API `/buscar-lista`. Ele imita os cabeçalhos de grandes players de mercado se disfarçando de VLC ou Kodi.
4. **Proxy Genérico Genérico:** Rotas `/proxy` cruas se todas falharem.

Se a lista não estiver carregando, verifique o Console (`F12`). Ele mostrará exatamente qual etapa falhou e em qual obteve sucesso.

---

## 📹 2. Como a Reprodução Funciona (VOD: MP4, MKV e TS)
Filmes e séries muitas vezes hospedados em `http://` puros esbarram na política de **Mixed Content** e **SSL Inválido** dos navegadores modernos em sites `https://`. 
Além disso, muitos provedores limitam as Conexões Simultâneas por IP, banindo temporariamente nossa Railway (Erro 502/403).

A resolução ocorre dentro de `reproduzirDireto` (em `app.js`), que possui um **Fallback Chain (Fila de Tentativas)**:

1. **Proxy Node (Railway):** Tentativa padrão inteligente rodando no servidor backend (`/proxy?url=...`). Se a Railway for bloqueada por tentar demais, ela lança **502 Bad Gateway**.
2. **CORS Proxy Público 1 (`corsproxy.io`):** Assume o controle da stream do vídeo burlando a Railway e a validação HTTPS do navegador.
3. **CORS Proxy Público 2 (`api.allorigins.win`):** Substituto imediato se o `corsproxy.io` cair.
4. **Direto (Navegador):** Ouve diretamente a URL original, porém dependente da tolerância do Chrome a Mixed Content.
5. **Forçar HTTPS:** Último esforço se o provedor IPTv for HTTP, o navegador vai forçar leitura HTTPS (costuma retornar erro de SSL Inválido `ERR_CERT_AUTHORITY_INVALID` se for um site pequeno, mas precisamos tentar!).

---

## 🛠️ 3. Tira-Dúvidas: Logs Comuns e o que eles Significam

### ❌ `502 (Bad Gateway)` apontando para a Railway (`painel-cobranca...`)
**O que significa?** Nosso servidor `server.js` (hospedado na Railway) foi banido/bloqueado temporariamente pelo IPTV (`caymangu.net` por ex.) devido a muitas tentativas de reprodução rodando nele (ou múltiplos "disfarces" de User-Agents em pouco tempo).
**O que fazer?** Nada! A aplicação vai cuspir o erro 502 no console do navegador, mas **automaticamente pulará para o Proxy Público (`corsproxy`)**, salvando a reprodução.

### ❌ `ERR_CERT_AUTHORITY_INVALID` no Console
**O que significa?** O player tentou acessar o provedor nativamente forçando `https://caymangu.net`, mas como de costume no mundo de pirataria de IPTV, os Certificados SSL (`https`) deles são fajutos ou expirados, fazendo o Chrome bloquear o link pela sua segurança.
**O que fazer?** Nada, pois o código continuará procurando outras saídas no Fallback Chain antes dessa fatalidade e deve achar um Link Proxy funcional acima.

### ❌ `CORS Missing Allow Origin` ou `Blocked by CORS policy`
**O que significa?** O provedor bloqueia que outros sites peçam a agenda dentro de uma página que não seja deles próprios, ou detectam User-Agents nativos do Firefox/Chrome. 
**O que fazer?** Se isso afetar o loadout, a responsabilidade é do nosso Proxy da Railway resolvê-lo adulterando cabeçalhos para fingir ser um dispositivo Kodi.

### ❌ O streaming para do nada ("Roda um pouco e para")
**O que significa?** Trata-se do clássico esgotamento de *limite de conexões*. O Xtream Codes permite apenas 1 acesso por vez. Quando o `server.js` (mesmo IP) estiver sendo invocado para ver uma Playlist nova ENQUANTO o player no painel está rodando o M3U, ele vai detectar dupla conexão de acesso e esguela a porta cortando a Live TV/VOD.
**O que fazer?** Esteja certo que apenas uma aba da Nexus TV esteja emitindo Play para seu login por vez e jamais acesse duas telas ou carregue uma M3U pesada enquanto reproduz no play, pois os proxies de terceiros ajudam a aliviar a culpa das portas.

---

## 🛡️ Dica de Ouro de Segurança (Código Fonte `server.js`)
Se as streams pararem *totalmente* mesmo pulando o fallback para terceiros:
1. Revise se os proxies públicos gratuitos mudaram suas requisições ou bloquearam URLs multimídia.
2. Na função de `server.js`, em **"PERFIS_HEADERS"**, verifique de disfarçar novos User-Agents (exemplo: botar Roku TV, LG WebOS, Samsung Tizen) porque provedores amam caçar e banir User-Agents repetitivos tipo "VLC/3.0.0".
