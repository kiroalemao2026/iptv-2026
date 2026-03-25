const http = require('http');
const https = require('https');
const url = require('url');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// ============================================================
// BANCO DE DADOS SQLite
// ============================================================
const DB_PATH = process.env.DB_PATH || './nexus.db';
const db = new Database(DB_PATH);

// Criar tabelas se não existirem
db.exec(`
    CREATE TABLE IF NOT EXISTS senhas (
        codigo TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        criada INTEGER NOT NULL,
        expira INTEGER NOT NULL,
        ativa INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS config (
        chave TEXT PRIMARY KEY,
        valor TEXT NOT NULL
    );
`);

// Migrar config.json → SQLite (se existir)
if (fs.existsSync('./config.json')) {
    try {
        const cfg = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
        const upsert = db.prepare('INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)');
        if (cfg.url)      upsert.run('url', cfg.url);
        if (cfg.whatsapp) upsert.run('whatsapp', cfg.whatsapp);
        fs.renameSync('./config.json', './config.json.bak');
        console.log('[DB] config.json migrado para SQLite.');
    } catch(e) { console.warn('[DB] Falha ao migrar config.json:', e.message); }
}

// Migrar senhas.json → SQLite (se existir)
if (fs.existsSync('./senhas.json')) {
    try {
        const senhas = JSON.parse(fs.readFileSync('./senhas.json', 'utf8'));
        const ins = db.prepare('INSERT OR IGNORE INTO senhas (codigo,nome,criada,expira,ativa) VALUES (?,?,?,?,?)');
        const migrar = db.transaction(() => {
            for (const [codigo, info] of Object.entries(senhas)) {
                ins.run(codigo, info.nome, info.criada, info.expira, info.ativa ? 1 : 0);
            }
        });
        migrar();
        fs.renameSync('./senhas.json', './senhas.json.bak');
        console.log('[DB] senhas.json migrado para SQLite.');
    } catch(e) { console.warn('[DB] Falha ao migrar senhas.json:', e.message); }
}

// Mapeamento de chaves de config para variáveis de ambiente
const ENV_CONFIG = {
    'url':       'IPTV_URL',
    'whatsapp':  'IPTV_WHATSAPP',
};

// Helpers de config
function getConfig(chave) {
    const row = db.prepare('SELECT valor FROM config WHERE chave = ?').get(chave);
    if (row && row.valor) return row.valor;
    // Fallback: variável de ambiente (Railway persiste entre deploys)
    const envKey = ENV_CONFIG[chave];
    return envKey && process.env[envKey] ? process.env[envKey] : '';
}
function setConfig(chave, valor) {
    db.prepare('INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)').run(chave, valor);
}

// Repopular DB com env vars no startup (resolve perda de dados após deploy no Railway)
(function sincronizarEnvVarsParaDB() {
    for (const [chave, envKey] of Object.entries(ENV_CONFIG)) {
        const envVal = process.env[envKey];
        if (!envVal) continue;
        const existente = db.prepare('SELECT valor FROM config WHERE chave = ?').get(chave);
        if (!existente || !existente.valor) {
            db.prepare('INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)').run(chave, envVal);
            console.log(`[Config] '${chave}' restaurado da env var ${envKey}`);
        }
    }
})();

// Helpers de senhas
function gerarSenha6Digitos() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function limparSenhasExpiradas() {
    db.prepare('DELETE FROM senhas WHERE expira < ?').run(Date.now());
}

// ============================================================

const httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const httpAgent  = new http.Agent({ keepAlive: true });
const PORT = process.env.PORT || 3000;

const mimeTypes = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.apk': 'application/vnd.android.package-archive',
    '.exe': 'application/x-msdownload'
};

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // ============================================================
    // API: Gerar nova senha (Admin)
    // ============================================================
    if (req.url === '/api/gerar-senha' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (data.senha_admin !== '1234') {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Senha de admin incorreta!' }));
                    return;
                }

                limparSenhasExpiradas();
                const novaSenha = gerarSenha6Digitos();
                const dias = parseInt(data.dias) || 30;
                const agora = Date.now();
                const expira = agora + dias * 24 * 60 * 60 * 1000;

                db.prepare('INSERT OR REPLACE INTO senhas (codigo,nome,criada,expira,ativa) VALUES (?,?,?,?,1)')
                  .run(novaSenha, data.nome_cliente || 'Cliente', agora, expira);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, senha: novaSenha, dias }));
            } catch(e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Dados inválidos.' }));
            }
        });
        return;
    }

    // ============================================================
    // API: Listar todas as senhas (Admin)
    // ============================================================
    if (req.url === '/api/listar-senhas' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (data.senha_admin !== '1234') {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Senha de admin incorreta!' }));
                    return;
                }
                limparSenhasExpiradas();
                const agora = Date.now();
                const rows = db.prepare('SELECT * FROM senhas ORDER BY criada DESC').all();
                const lista = rows.map(r => ({
                    codigo: r.codigo,
                    nome: r.nome,
                    criada: r.criada,
                    expira: r.expira,
                    ativa: r.ativa === 1,
                    expirada: r.expira < agora
                }));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ senhas: lista }));
            } catch(e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Dados inválidos.' }));
            }
        });
        return;
    }

    // ============================================================
    // API: Bloquear senha - desativa sem excluir
    // POST /api/bloquear-senha  { senha_admin, codigo }
    // ============================================================
    if (req.url === '/api/bloquear-senha' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (data.senha_admin !== '1234') {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Senha de admin incorreta!' }));
                    return;
                }
                const result = db.prepare('UPDATE senhas SET ativa = 0 WHERE codigo = ?').run(data.codigo);
                if (result.changes === 0) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Senha nao encontrada.' }));
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch(e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Dados invalidos.' }));
            }
        });
        return;
    }

    // ============================================================
    // API: Desbloquear senha - reativa acesso
    // POST /api/desbloquear-senha  { senha_admin, codigo }
    // ============================================================
    if (req.url === '/api/desbloquear-senha' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (data.senha_admin !== '1234') {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Senha de admin incorreta!' }));
                    return;
                }
                const result = db.prepare('UPDATE senhas SET ativa = 1 WHERE codigo = ?').run(data.codigo);
                if (result.changes === 0) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Senha nao encontrada.' }));
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch(e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Dados invalidos.' }));
            }
        });
        return;
    }

    // ============================================================
    // API: Excluir senha definitivamente
    // POST /api/excluir-senha (alias: /api/revogar-senha)
    // ============================================================
    if ((req.url === '/api/excluir-senha' || req.url === '/api/revogar-senha') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (data.senha_admin !== '1234') {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Senha de admin incorreta!' }));
                    return;
                }
                const result = db.prepare('DELETE FROM senhas WHERE codigo = ?').run(data.codigo);
                if (result.changes === 0) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Senha nao encontrada.' }));
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch(e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Dados invalidos.' }));
            }
        });
        return;
    }

    // ============================================================
    // API: Validar senha do cliente (público)
    // ============================================================
    if (req.url === '/api/validar-senha' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const agora = Date.now();
                const info = db.prepare('SELECT * FROM senhas WHERE codigo = ?').get(data.codigo);

                if (!info) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Senha inválida ou expirada.' }));
                    return;
                }
                if (!info.ativa) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Acesso revogado pelo administrador.' }));
                    return;
                }
                if (info.expira && info.expira < agora) {
                    // Limpa do banco automaticamente
                    db.prepare('DELETE FROM senhas WHERE codigo = ?').run(data.codigo);
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Sua senha expirou. Entre em contato com o suporte.' }));
                    return;
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, nome: info.nome }));
            } catch(e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Dados inválidos.' }));
            }
        });
        return;
    }

    // ============================================================
    // API Pública - URL da lista e WhatsApp
    // ============================================================
    if (req.url === '/api/public-config' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: getConfig('url'), whatsapp: getConfig('whatsapp') }));
        return;
    }

    // ============================================================
    // API Admin - Salvar configurações
    // ============================================================
    if (req.url === '/api/admin-config' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (data.senha !== '1234') {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Senha incorreta!' }));
                    return;
                }
                if (data.url      !== undefined) setConfig('url', data.url);
                if (data.whatsapp !== undefined) setConfig('whatsapp', data.whatsapp);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch(e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Erro nos dados enviados.' }));
            }
        });
        return;
    }

    // ============================================================
    // Buscar Lista M3U (rota dedicada com headers anti-403)
    // GET /buscar-lista?url=...
    // ============================================================
    if (req.url.startsWith('/buscar-lista?')) {
        try {
        const parsedUrl = url.parse(req.url, true);
        let targetUrl = parsedUrl.query.url;

        if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'URL não fornecida' }));
            return;
        }

        // Decodifica se veio codificado duplo
        try { targetUrl = decodeURIComponent(targetUrl); } catch(e) {}

        console.log(`[BuscarLista] -> ${targetUrl}`);

        // Pool de User-Agents realistas para rotação
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        ];
        const ua = userAgents[Math.floor(Math.random() * userAgents.length)];

        let targetOrigin = '';
        try { const p = new URL(targetUrl); targetOrigin = p.origin; } catch(e) {}

        const isHttps = targetUrl.startsWith('https');
        const protocol = isHttps ? https : http;

        const reqOptions = {
            agent: isHttps ? httpsAgent : httpAgent,
            headers: {
                'User-Agent': ua,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept-Encoding': 'identity',
                'Connection': 'keep-alive',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'DNT': '1',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                ...(targetOrigin ? { 'Referer': targetOrigin + '/' } : {}),
            },
            timeout: 30000
        };

        function tentarBuscarLista(urlAlvo, tentativas) {
            if (tentativas > 5) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Muitos redirecionamentos' }));
                return;
            }

            const isHttpsAlvo = urlAlvo.startsWith('https');
            const proto = isHttpsAlvo ? https : http;

            const reqAlvo = proto.get(urlAlvo, { ...reqOptions, agent: isHttpsAlvo ? httpsAgent : httpAgent }, (proxyRes) => {
                // Seguir redirects
                if ([301, 302, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
                    let novaUrl = proxyRes.headers.location;
                    if (novaUrl.startsWith('/')) {
                        try { const p = new URL(urlAlvo); novaUrl = p.origin + novaUrl; } catch(e) {}
                    }
                    console.log(`[BuscarLista] Redirect ${proxyRes.statusCode} -> ${novaUrl}`);
                    proxyRes.resume();
                    tentarBuscarLista(novaUrl, tentativas + 1);
                    return;
                }

                if (proxyRes.statusCode !== 200) {
                    console.error(`[BuscarLista] Erro HTTP ${proxyRes.statusCode} | URL: ${urlAlvo}`);
                    proxyRes.resume();
                    res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ error: `Servidor remoto retornou ${proxyRes.statusCode}` }));
                    return;
                }

                let body = '';
                proxyRes.setEncoding('utf8');
                proxyRes.on('data', chunk => { body += chunk; });
                proxyRes.on('end', () => {
                    console.log(`[BuscarLista] OK - ${body.length} bytes de ${urlAlvo}`);
                    res.writeHead(200, {
                        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                        'Cache-Control': 'no-cache'
                    });
                    res.end(body);
                });
                proxyRes.on('error', (err) => {
                    console.error('[BuscarLista] Erro lendo resposta:', err.message);
                    if (!res.headersSent) { res.writeHead(500); res.end('Erro ao ler resposta'); }
                });
            });

            reqAlvo.on('error', (err) => {
                console.error(`[BuscarLista] Erro de conexão: ${err.message} | URL: ${urlAlvo}`);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            });

            reqAlvo.on('timeout', () => {
                reqAlvo.destroy();
                console.error('[BuscarLista] Timeout | URL:', urlAlvo);
                if (!res.headersSent) {
                    res.writeHead(504, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ error: 'Timeout ao buscar lista' }));
                }
            });
        }

        tentarBuscarLista(targetUrl, 0);
        } catch(errGlobal) {
            console.error('[BuscarLista] Erro inesperado:', errGlobal.message);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ error: 'Erro interno no servidor: ' + errGlobal.message }));
            }
        }
        return;
    }

    // ============================================================
    // Proxy
    // ============================================================
    if (req.url.startsWith('/proxy?')) {
        const parsedUrl = url.parse(req.url, true);
        let targetUrl = parsedUrl.query.url;

        if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'URL não fornecida' }));
            return;
        }

        while (targetUrl.startsWith('/proxy?url=')) {
            try { targetUrl = decodeURIComponent(targetUrl.slice('/proxy?url='.length)); } catch(e) { break; }
        }

        console.log(`[Proxy] -> ${targetUrl}`);

        // Perfis de headers para tentar em caso de 403/401 (simula clientes IPTV legítimos)
        const PERFIS_HEADERS = [
            // Perfil 0: Browser Chrome padrão
            {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
                'Accept-Encoding': 'identity',
                'Connection': 'keep-alive',
                'Cache-Control': 'no-cache',
            },
            // Perfil 1: VLC Media Player
            {
                'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
                'Accept': '*/*',
                'Accept-Encoding': 'identity',
                'Connection': 'keep-alive',
                'Icy-MetaData': '1',
            },
            // Perfil 2: IPTV Smarters / Android player
            {
                'User-Agent': 'okhttp/4.9.0',
                'Accept': '*/*',
                'Accept-Encoding': 'identity',
                'Connection': 'keep-alive',
            },
            // Perfil 3: Kodi
            {
                'User-Agent': 'Kodi/20.2 (Windows NT 10.0; WOW64) App_Bitness/64 Version/20.2-Git:20230812-5b4d2df8bd',
                'Accept': '*/*',
                'Accept-Encoding': 'identity',
                'Connection': 'keep-alive',
            },
            // Perfil 4: TiviMate
            {
                'User-Agent': 'TiviMate/4.7.0',
                'Accept': '*/*',
                'Accept-Encoding': 'identity',
                'Connection': 'keep-alive',
            },
        ];

        function fazerRequisicao(targetUrl, tentativas, perfilIdx) {
            perfilIdx = perfilIdx || 0;

            if (tentativas > 8) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Servidor bloqueou o acesso (403/502 após múltiplas tentativas)' }));
                return;
            }

            const isHttps = targetUrl.startsWith('https');
            const protocol = isHttps ? https : http;
            const isLiveStream = targetUrl.endsWith('.ts') || /\/\d+(\.ts)?$/.test(targetUrl.split('?')[0]);

            let targetOrigin = '';
            try { const p = new URL(targetUrl); targetOrigin = p.origin; } catch(e) {}

            const perfilHeaders = PERFIS_HEADERS[perfilIdx % PERFIS_HEADERS.length];

            const reqOptions = {
                agent: isHttps ? httpsAgent : httpAgent,
                headers: {
                    ...perfilHeaders,
                    ...(req.headers['range'] ? { 'Range': req.headers['range'] } : {})
                },
                timeout: isLiveStream ? 15000 : 10000
            };

            const proxyReq = protocol.get(targetUrl, reqOptions, (proxyRes) => {
                if ([301, 302, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
                    let novaUrl = proxyRes.headers.location;
                    if (novaUrl.startsWith('/')) {
                        try { const p = new URL(targetUrl); novaUrl = p.origin + novaUrl; } catch(e) {}
                    }
                    console.log(`[Proxy] Redirect ${proxyRes.statusCode} -> ${novaUrl}`);
                    proxyRes.resume();
                    fazerRequisicao(novaUrl, tentativas + 1, perfilIdx);
                    return;
                }

                // 403 / 401 → tentar próximo perfil de headers (simula cliente IPTV diferente)
                if ((proxyRes.statusCode === 403 || proxyRes.statusCode === 401) && perfilIdx < PERFIS_HEADERS.length - 1) {
                    proxyRes.resume();
                    const proximoPerfil = perfilIdx + 1;
                    console.warn(`[Proxy] ${proxyRes.statusCode} com perfil ${perfilIdx} → tentando perfil ${proximoPerfil} (UA: ${PERFIS_HEADERS[proximoPerfil]['User-Agent'].split('/')[0]})`);
                    setTimeout(() => fazerRequisicao(targetUrl, tentativas + 1, proximoPerfil), 300);
                    return;
                }

                // 403 persistente: tentar versão HTTPS da URL HTTP (alguns servidores exigem)
                if (proxyRes.statusCode === 403 && targetUrl.startsWith('http://') && perfilIdx >= PERFIS_HEADERS.length - 1) {
                    proxyRes.resume();
                    // Remove porta 80 explícita (incompatível com HTTPS)
                    const urlHttps = targetUrl.replace('http://', 'https://').replace(/:80\//, '/').replace(/:80$/, '');
                    console.warn(`[Proxy] 403 persistente → tentando HTTPS: ${urlHttps}`);
                    setTimeout(() => fazerRequisicao(urlHttps, tentativas + 1, 0), 300);
                    return;
                }

                console.log(`[Proxy] Resposta: ${proxyRes.statusCode} | Content-Type: ${proxyRes.headers['content-type']} | URL: ${targetUrl}`);

                let contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
                if (targetUrl.includes('.m3u8') || targetUrl.includes('output=m3u8')) {
                    contentType = 'application/vnd.apple.mpegurl';
                } else if (targetUrl.includes('.m3u') || targetUrl.includes('get.php') || contentType.includes('text/plain') || contentType.includes('audio/x-mpegurl')) {
                    contentType = 'application/vnd.apple.mpegurl';
                } else if (targetUrl.endsWith('.ts') || targetUrl.includes('/ts/') || targetUrl.includes('output=ts')) {
                    contentType = 'video/mp2t';
                } else if (targetUrl.endsWith('.mp4')) {
                    contentType = 'video/mp4';
                }

                const headers = { ...proxyRes.headers };
                delete headers['content-security-policy'];
                delete headers['x-frame-options'];
                delete headers['content-length'];
                delete headers['transfer-encoding'];
                delete headers['strict-transport-security'];
                delete headers['x-content-type-options'];

                const isManifest = contentType.includes('mpegurl') || targetUrl.includes('.m3u8') || targetUrl.includes('output=m3u8');

                if (isManifest) {
                    let baseUrl = '';
                    try {
                        const parsed = new URL(targetUrl);
                        const pathParts = parsed.pathname.split('/');
                        pathParts.pop();
                        baseUrl = parsed.origin + pathParts.join('/') + '/';
                    } catch(e) { baseUrl = ''; }

                    let body = '';
                    proxyRes.setEncoding('utf8');
                    proxyRes.on('data', chunk => { body += chunk; });
                    proxyRes.on('end', () => {
                        const linhasOriginais = body.split('\n');
                        const linhasReescritas = linhasOriginais.map(linha => {
                            const l = linha.trim();
                            if (!l || l.startsWith('#')) return linha;
                            let urlAbsoluta = l;
                            if (l.startsWith('http://') || l.startsWith('https://')) {
                                urlAbsoluta = l;
                            } else if (l.startsWith('/')) {
                                try { const p = new URL(targetUrl); urlAbsoluta = p.origin + l; } catch(e) {}
                            } else if (baseUrl) {
                                urlAbsoluta = baseUrl + l;
                            }
                            return '/proxy?url=' + encodeURIComponent(urlAbsoluta);
                        });
                        const manifesto = linhasReescritas.join('\n');
                        const manifestoBuffer = Buffer.from(manifesto, 'utf8');
                        console.log(`[Proxy] Manifesto reescrito (${linhasOriginais.length} linhas) | Base: ${baseUrl}`);
                        res.writeHead(proxyRes.statusCode, {
                            ...headers,
                            'Content-Type': contentType,
                            'Content-Length': manifestoBuffer.length,
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Headers': '*',
                            'Cache-Control': 'no-cache'
                        });
                        res.end(manifestoBuffer);
                    });
                    proxyRes.on('error', (err) => {
                        console.error('[Proxy] Erro lendo manifesto:', err.message);
                        if (!res.headersSent) { res.writeHead(500); res.end('Erro ao ler manifesto'); }
                    });
                } else {
                    res.writeHead(proxyRes.statusCode, {
                        ...headers,
                        'Content-Type': contentType,
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                        'Cache-Control': 'no-cache'
                    });
                    proxyRes.pipe(res);
                }
            });

            proxyReq.on('error', (err) => {
                console.error(`[Proxy] Erro conexão (perfil ${perfilIdx}): ${err.message} | URL: ${targetUrl}`);
                if (res.headersSent) return; // resposta já enviada, ignorar

                // Se ainda há perfis para tentar, usar próximo
                if (perfilIdx < PERFIS_HEADERS.length - 1) {
                    const proximoPerfil = perfilIdx + 1;
                    console.warn(`[Proxy] Tentando perfil ${proximoPerfil} após erro de conexão`);
                    setTimeout(() => fazerRequisicao(targetUrl, tentativas + 1, proximoPerfil), 300);
                    return;
                }

                // Esgotou perfis: retornar erro
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message, code: err.code }));
            });

            proxyReq.on('timeout', () => {
                proxyReq.destroy();
                console.error(`[Proxy] Timeout (perfil ${perfilIdx}) | URL: ${targetUrl}`);
                if (res.headersSent) return;

                // Timeout: tentar próximo perfil
                if (perfilIdx < PERFIS_HEADERS.length - 1) {
                    const proximoPerfil = perfilIdx + 1;
                    console.warn(`[Proxy] Tentando perfil ${proximoPerfil} após timeout`);
                    setTimeout(() => fazerRequisicao(targetUrl, tentativas + 1, proximoPerfil), 300);
                    return;
                }

                res.writeHead(504, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Timeout após múltiplas tentativas' }));
            });
        }

        fazerRequisicao(targetUrl, 0, 0);
        return;
    }

    // ============================================================
    // Manifesto HLS sintético para streams TS ao vivo
    // ============================================================
    if (req.url.startsWith('/hls-ts?')) {
        const parsedUrl = url.parse(req.url, true);
        const tsUrl = parsedUrl.query.url;
        if (!tsUrl) { res.writeHead(400); res.end('URL não fornecida'); return; }
        const encodedUrl = encodeURIComponent(tsUrl);
        const manifest = [
            '#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:86400',
            '#EXT-X-MEDIA-SEQUENCE:0', '#EXTINF:86400.0,', `/proxy?url=${encodedUrl}`
        ].join('\n');
        console.log(`[HLS-TS] Manifesto sintético para: ${tsUrl}`);
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.end(manifest);
        return;
    }

    // ============================================================
    // Arquivos estáticos
    // ============================================================
    let filePath = '.' + req.url;
    if (filePath === './') filePath = './index.html';

    const extname  = String(path.extname(filePath)).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') { res.writeHead(404); res.end('Arquivo não encontrado'); }
            else { res.writeHead(500); res.end('Erro interno: ' + error.code); }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.timeout = 0;
server.keepAliveTimeout = 65000;
server.headersTimeout  = 66000;

// ============================================================
// Proteção global: impede que o servidor caia por erros inesperados
// ============================================================
process.on('uncaughtException', (err) => {
    console.error('[GLOBAL] Erro não capturado (servidor continua):', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('[GLOBAL] Promise rejeitada (servidor continua):', reason);
});

server.listen(PORT, () => {
    console.log('');
    console.log('========================================');
    console.log('  Nexus TV - Servidor Railway/Local');
    console.log('  Banco de dados: SQLite (nexus.db)');
    console.log('========================================');
    console.log('');
    console.log(`  Abra no navegador: http://localhost:${PORT}`);
    console.log(`  Painel Admin:      http://localhost:${PORT}/admin.html`);
    console.log('');
});
