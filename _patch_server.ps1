$file = ".\server.js"
$content = Get-Content $file -Raw -Encoding UTF8

$old = @'
    // ============================================================
    // API: Revogar uma senha (Admin)
    // ============================================================
    if (req.url === '/api/revogar-senha' && req.method === 'POST') {
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
'@

$new = @'
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
'@

# Find and replace using line numbers instead (more reliable)
$lines = Get-Content $file -Encoding UTF8
$newLines = $lines[0..161] + $new.Split("`n") + $lines[191..$lines.Length]
$newLines | Set-Content $file -Encoding UTF8
Write-Host "Patch aplicado com sucesso!"
