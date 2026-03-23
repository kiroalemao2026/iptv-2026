const http = require('http');
const https = require('https');
const url = require('url');
const path = require('path');
const fs = require('fs');


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

            const protocol = targetUrl.startsWith('https') ? https : http;

            const isLiveStream = targetUrl.endsWith('.ts') ||
                /\/\d+(\\.ts)?$/.test(targetUrl.split('?')[0]);

            const reqOptions = {
                headers: {
                    // Headers completos de navegador Chrome real para evitar bloqueios
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                },
                timeout: isLiveStream ? 60000 : 30000
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

                res.writeHead(proxyRes.statusCode, {
                    ...headers,
                    'Content-Type': contentType,
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                    'Cache-Control': 'no-cache'
                });

                proxyRes.pipe(res);
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

server.listen(PORT, () => {
    console.log('');
    console.log('========================================');
    console.log('  Nexus TV - Servidor Local');
    console.log('========================================');
    console.log('');
    console.log(`  Abra no navegador: http://localhost:${PORT}`);
    console.log('');
    console.log('  Pressione Ctrl+C para parar');
    console.log('');
});