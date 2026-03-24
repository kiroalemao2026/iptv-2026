const http = require('http');
const https = require('https');
const url = require('url');
const path = require('path');
const fs = require('fs');

// Agente HTTPS que ignora erros de certificado SSL dos provedores de stream
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true
});
const httpAgent = new http.Agent({ keepAlive: true });


const PORT = process.env.PORT || 3000;

const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Proxy endpoint
    if (req.url.startsWith('/proxy?')) {
        const parsedUrl = url.parse(req.url, true);
        const targetUrl = parsedUrl.query.url;

        if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'URL não fornecida' }));
            return;
        }

        console.log(`[Proxy] -> ${targetUrl}`);

        function fazerRequisicao(targetUrl, tentativas) {
            if (tentativas > 5) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Muitos redirecionamentos' }));
                return;
            }

            const isHttps = targetUrl.startsWith('https');
            const protocol = isHttps ? https : http;

            const isLiveStream = targetUrl.endsWith('.ts') ||
                /\/\d+(\.ts)?$/.test(targetUrl.split('?')[0]);

            const reqOptions = {
                agent: isHttps ? httpsAgent : httpAgent,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': '*/*',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
                    'Accept-Encoding': 'identity',
                    'Connection': 'keep-alive',
                    'Cache-Control': 'no-cache',
                    ...(req.headers['range'] ? { 'Range': req.headers['range'] } : {})
                },
                // CRÍTICO: 8s para Railway não fazer 502 (Railway timeout ~10-15s)
                // Streams ao vivo recebem mais tempo pois a conexão já está estabelecida
                timeout: isLiveStream ? 15000 : 8000
            };

            const proxyReq = protocol.get(targetUrl, reqOptions, (proxyRes) => {
                // Seguir redirecionamentos (301, 302, 307, 308)
                if ([301, 302, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
                    let novaUrl = proxyRes.headers.location;
                    // Se for relativo, construir URL absoluta
                    if (novaUrl.startsWith('/')) {
                        try {
                            const parsed = new URL(targetUrl);
                            novaUrl = parsed.origin + novaUrl;
                        } catch(e) {}
                    }
                    console.log(`[Proxy] Redirect ${proxyRes.statusCode} -> ${novaUrl}`);
                    proxyRes.resume(); // Descartar body do redirect
                    fazerRequisicao(novaUrl, tentativas + 1);
                    return;
                }

                // Log detalhado do que o servidor remoto respondeu
                console.log(`[Proxy] Resposta: ${proxyRes.statusCode} | Content-Type: ${proxyRes.headers['content-type']} | URL: ${targetUrl}`);

                // Definir Content-Type correto para HLS
                let contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
                if (targetUrl.includes('.m3u8') || targetUrl.includes('output=m3u8')) {
                    contentType = 'application/vnd.apple.mpegurl';
                } else if (targetUrl.includes('.m3u') || targetUrl.includes('get.php') || contentType.includes('text/plain') || contentType.includes('audio/x-mpegurl')) {
                    // Lista M3U genérica (ex: links tipo /get.php?username=...&type=m3u)
                    contentType = 'application/vnd.apple.mpegurl';
                } else if (targetUrl.endsWith('.ts') || targetUrl.includes('/ts/') || targetUrl.includes('output=ts')) {
                    contentType = 'video/mp2t';
                } else if (targetUrl.endsWith('.mp4')) {
                    contentType = 'video/mp4';
                }

                // Remover headers problemáticos
                const headers = { ...proxyRes.headers };
                delete headers['content-security-policy'];
                delete headers['x-frame-options'];
                delete headers['content-length']; // Evita truncamento em conteúdo dinâmico
                delete headers['transfer-encoding'];
                delete headers['strict-transport-security'];
                delete headers['x-content-type-options'];

                // Para manifesto HLS: ler body e reescrever URLs dos segmentos
                const isManifest = contentType.includes('mpegurl') ||
                    targetUrl.includes('.m3u8') || targetUrl.includes('output=m3u8');

                if (isManifest) {
                    // Calcular base URL para resolver caminhos relativos
                    let baseUrl = '';
                    try {
                        const parsed = new URL(targetUrl);
                        // base = origem + caminho sem o último segmento
                        const pathParts = parsed.pathname.split('/');
                        pathParts.pop(); // remove o último elemento (ex: stream.m3u8)
                        baseUrl = parsed.origin + pathParts.join('/') + '/';
                    } catch(e) {
                        baseUrl = '';
                    }

                    let body = '';
                    proxyRes.setEncoding('utf8');
                    proxyRes.on('data', chunk => { body += chunk; });
                    proxyRes.on('end', () => {
                        // Reescrever cada linha não-comentário que seja uma URL
                        const linhasOriginais = body.split('\n');
                        const linhasReescritas = linhasOriginais.map(linha => {
                            const l = linha.trim();
                            if (!l || l.startsWith('#')) return linha; // comentário/tag HLS

                            let urlAbsoluta = l;
                            if (l.startsWith('http://') || l.startsWith('https://')) {
                                // Já é absoluta
                                urlAbsoluta = l;
                            } else if (l.startsWith('/')) {
                                // Relativa ao origin
                                try {
                                    const parsed = new URL(targetUrl);
                                    urlAbsoluta = parsed.origin + l;
                                } catch(e) { urlAbsoluta = l; }
                            } else if (baseUrl) {
                                // Relativa ao diretório
                                urlAbsoluta = baseUrl + l;
                            }

                            return '/proxy?url=' + encodeURIComponent(urlAbsoluta);
                        });

                        const manifesto = linhasReescritas.join('\n');
                        const manifestoBuffer = Buffer.from(manifesto, 'utf8');
                        console.log(`[Proxy] 📋 Manifesto reescrito (${linhasOriginais.length} linhas) | Base: ${baseUrl}`);

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
                        if (!res.headersSent) {
                            res.writeHead(500);
                            res.end('Erro ao ler manifesto');
                        }
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
                console.error(`[Proxy] Erro: ${err.message} | Código: ${err.code} | URL: ${targetUrl}`);

                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message, code: err.code }));
                }
            });

            proxyReq.on('timeout', () => {
                proxyReq.destroy();
                console.error('[Proxy] Timeout | URL:', targetUrl);
                if (!res.headersSent) {
                    res.writeHead(504, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Timeout' }));
                }
            });
        }

        fazerRequisicao(targetUrl, 0);
        return;
    }

    // Manifesto HLS sintético para streams TS ao vivo
    // Cria uma "playlist" HLS que aponta o TS como único segmento infinito
    if (req.url.startsWith('/hls-ts?')) {
        const parsedUrl = url.parse(req.url, true);
        const tsUrl = parsedUrl.query.url;

        if (!tsUrl) {
            res.writeHead(400);
            res.end('URL não fornecida');
            return;
        }

        const encodedUrl = encodeURIComponent(tsUrl);
        // Manifesto HLS com segmento "infinito" apontando para o TS via proxy
        const manifest = [
            '#EXTM3U',
            '#EXT-X-VERSION:3',
            '#EXT-X-TARGETDURATION:86400',
            '#EXT-X-MEDIA-SEQUENCE:0',
            '#EXTINF:86400.0,',
            `/proxy?url=${encodedUrl}`
        ].join('\n');

        console.log(`[HLS-TS] Manifesto sintético para: ${tsUrl}`);
        res.writeHead(200, {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache'
        });
        res.end(manifest);
        return;
    }

    // API Pública - Retorna a URL da lista IPTV configurada pelo admin
    if (req.url === '/api/public-config' && req.method === 'GET') {
        let configData = { url: '' };
        if (fs.existsSync('./config.json')) {
            configData = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: configData.url || '' }));
        return;
    }

    // API Admin - Salva a URL nova
    if (req.url === '/api/admin-config' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                // Senha do painel admin (exemplo simples: admin123)
                if (data.senha !== '1234') {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Senha incorreta!' }));
                    return;
                }
                fs.writeFileSync('./config.json', JSON.stringify({ url: data.url }), 'utf8');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Erro nos dados enviados.' }));
            }
        });
        return;
    }

    // Servir arquivos estáticos
    let filePath = '.' + req.url;
    if (filePath === './') filePath = './index.html';

    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404);
                res.end('Arquivo não encontrado');
            } else {
                res.writeHead(500);
                res.end('Erro interno: ' + error.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// Aumentar timeout do servidor para evitar 502 no Railway durante streams longos
server.timeout = 0;           // sem timeout de socket (Railway controla)
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

server.listen(PORT, () => {
    console.log('');
    console.log('========================================');
    console.log('  Nexus TV - Servidor Railway/Local');
    console.log('========================================');
    console.log('');
    console.log(`  Abra no navegador: http://localhost:${PORT}`);
    console.log('');
    console.log('  Pressione Ctrl+C para parar');
    console.log('');
});