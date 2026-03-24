$file = ".\admin.html"
$content = Get-Content $file -Raw -Encoding UTF8

# ---- 1. Substituir as linhas dos botoes na funcao renderizarSenhas ----
$oldBtns = @'
            const badge = s.expirada
                ? '<span class="badge badge-exp">Expirada</span>'
                : `<span class="badge badge-ok">✓ ${diasRestantes}d restantes</span>`;

            const nomeEsc = s.nome.replace(/"/g, '&quot;');
            return `<tr>
                <td class="codigo-cell">${s.codigo}</td>
                <td>${s.nome}</td>
                <td>${criada}</td>
                <td>${expira}</td>
                <td>${badge}</td>
                <td>
                    <button class="btn btn-danger btn-revogar"
                        data-codigo="${s.codigo}"
                        data-nome="${nomeEsc}">
                        <i class="fas fa-trash"></i> Revogar
                    </button>
                </td>
            </tr>`;
        }).join('');
'@

$newBtns = @'
            let badge = '';
            if (s.expirada) {
                badge = '<span class="badge badge-exp">Expirada</span>';
            } else if (!s.ativa) {
                badge = '<span class="badge badge-block">⛔ Bloqueada</span>';
            } else {
                badge = `<span class="badge badge-ok">✓ ${diasRestantes}d restantes</span>`;
            }

            const nomeEsc = s.nome.replace(/"/g, '&quot;');
            const btnBloquear = s.ativa
                ? `<button class="btn btn-warn btn-bloquear" data-codigo="${s.codigo}" data-nome="${nomeEsc}" title="Bloquear acesso"><i class="fas fa-lock"></i></button>`
                : `<button class="btn btn-success btn-desbloquear" data-codigo="${s.codigo}" data-nome="${nomeEsc}" title="Desbloquear acesso"><i class="fas fa-lock-open"></i></button>`;

            return `<tr class="${!s.ativa ? 'row-bloqueada' : s.expirada ? 'row-expirada' : ''}">
                <td class="codigo-cell">${s.codigo}</td>
                <td>${s.nome}</td>
                <td>${criada}</td>
                <td>${expira}</td>
                <td>${badge}</td>
                <td style="display:flex;gap:6px;">
                    ${btnBloquear}
                    <button class="btn btn-danger btn-excluir" data-codigo="${s.codigo}" data-nome="${nomeEsc}" title="Excluir permanentemente"><i class="fas fa-trash"></i></button>
                </td>
            </tr>`;
        }).join('');
'@

$content = $content.Replace($oldBtns, $newBtns)

# ---- 2. Substituir listeners e funcoes de acao ----
$oldActions = @'
        // Adicionar listener nos botões Revogar via event delegation
        container.querySelectorAll('.btn-revogar').forEach(btn => {
            btn.addEventListener('click', () => {
                const codigo = btn.dataset.codigo;
                const nome = btn.dataset.nome;
                confirmarRevogacao(codigo, nome);
            });
        });
    }

    // Modal customizado de confirmação (substitui o confirm() nativo)
    function confirmarRevogacao(codigo, nome) {
        // Remove qualquer modal anterior
        const anterior = document.getElementById('modal-confirmacao');
        if (anterior) anterior.remove();

        const overlay = document.createElement('div');
        overlay.id = 'modal-confirmacao';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-box">
                <div class="modal-icon"><i class="fas fa-exclamation-triangle"></i></div>
                <h3>Revogar Acesso</h3>
                <p>Deseja revogar a senha <strong>${codigo}</strong> de <strong>${nome}</strong>?<br>O cliente perderá o acesso imediatamente.</p>
                <div class="modal-btns">
                    <button class="modal-btn-cancel" id="modal-cancelar">Cancelar</button>
                    <button class="modal-btn-confirm" id="modal-confirmar"><i class="fas fa-trash"></i> Revogar</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);

        document.getElementById('modal-cancelar').onclick = () => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

        document.getElementById('modal-confirmar').onclick = async () => {
            overlay.remove();
            await executarRevogacao(codigo);
        };
    }

    async function executarRevogacao(codigo) {
        try {
            const res = await fetch('/api/revogar-senha', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ senha_admin: SENHA_ADMIN, codigo })
            });
            const data = await res.json();
            if (data.success) {
                toast('Senha revogada com sucesso.', 'ok');
                carregarSenhas();
            } else {
                toast(data.error || 'Erro ao revogar.', 'err');
            }
        } catch(e) {
            toast('Erro ao revogar senha.', 'err');
        }
    }
'@

$newActions = @'
        // Listeners: bloquear
        container.querySelectorAll('.btn-bloquear').forEach(btn => {
            btn.addEventListener('click', () => abrirModal(btn.dataset.codigo, btn.dataset.nome, 'bloquear'));
        });
        // Listeners: desbloquear
        container.querySelectorAll('.btn-desbloquear').forEach(btn => {
            btn.addEventListener('click', () => abrirModal(btn.dataset.codigo, btn.dataset.nome, 'desbloquear'));
        });
        // Listeners: excluir
        container.querySelectorAll('.btn-excluir').forEach(btn => {
            btn.addEventListener('click', () => abrirModal(btn.dataset.codigo, btn.dataset.nome, 'excluir'));
        });
    }

    // Modal customizado universal
    function abrirModal(codigo, nome, acao) {
        const anterior = document.getElementById('modal-confirmacao');
        if (anterior) anterior.remove();

        const cfg = {
            bloquear:     { icon: 'fa-lock',            cor: '#ff8c00', titulo: 'Bloquear Acesso',  msg: `Bloquear a senha <strong>${codigo}</strong> de <strong>${nome}</strong>?<br>O cliente perderá o acesso imediatamente.`, btnTxt: '<i class="fas fa-lock"></i> Bloquear',       btnCls: 'modal-btn-warn' },
            desbloquear:  { icon: 'fa-lock-open',       cor: '#2ecc71', titulo: 'Desbloquear',      msg: `Reativar o acesso de <strong>${nome}</strong> (${codigo})?`,                                                           btnTxt: '<i class="fas fa-lock-open"></i> Desbloquear', btnCls: 'modal-btn-ok' },
            excluir:      { icon: 'fa-trash',           cor: '#e74c3c', titulo: 'Excluir Senha',    msg: `Excluir permanentemente a senha <strong>${codigo}</strong> de <strong>${nome}</strong>?<br>Esta ação não pode ser desfeita.`, btnTxt: '<i class="fas fa-trash"></i> Excluir',       btnCls: 'modal-btn-confirm' }
        }[acao];

        const overlay = document.createElement('div');
        overlay.id = 'modal-confirmacao';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-box">
                <div class="modal-icon" style="color:${cfg.cor}"><i class="fas ${cfg.icon}"></i></div>
                <h3>${cfg.titulo}</h3>
                <p>${cfg.msg}</p>
                <div class="modal-btns">
                    <button class="modal-btn-cancel" id="modal-cancelar">Cancelar</button>
                    <button class="${cfg.btnCls}" id="modal-confirmar">${cfg.btnTxt}</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        document.getElementById('modal-cancelar').onclick = () => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        document.getElementById('modal-confirmar').onclick = async () => {
            overlay.remove();
            await executarAcao(acao, codigo);
        };
    }

    async function executarAcao(acao, codigo) {
        const endpoints = {
            bloquear:    '/api/bloquear-senha',
            desbloquear: '/api/desbloquear-senha',
            excluir:     '/api/excluir-senha'
        };
        const msgs = {
            bloquear:    'Acesso bloqueado!',
            desbloquear: 'Acesso desbloqueado!',
            excluir:     'Senha excluida permanentemente.'
        };
        try {
            const res = await fetch(endpoints[acao], {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ senha_admin: SENHA_ADMIN, codigo })
            });
            const data = await res.json();
            if (data.success) {
                toast(msgs[acao], 'ok');
                carregarSenhas();
            } else {
                toast(data.error || 'Erro ao executar acao.', 'err');
            }
        } catch(e) {
            toast('Erro de conexao.', 'err');
        }
    }
'@

$content = $content.Replace($oldActions, $newActions)

# ---- 3. Adicionar estilos para badge-block, row-bloqueada, btn-warn, btn-success ----
$oldStyle = '.badge-ok { background: rgba(46,204,113,0.15); color: #2ecc71; border: 1px solid rgba(46,204,113,0.3); }'
$newStyle = '.badge-ok { background: rgba(46,204,113,0.15); color: #2ecc71; border: 1px solid rgba(46,204,113,0.3); }
        .badge-block { background: rgba(231,76,60,0.15); color: #e74c3c; border: 1px solid rgba(231,76,60,0.3); }
        .row-bloqueada td { opacity: 0.6; }
        .btn-warn { background: rgba(255,140,0,0.15); color: #ff8c00; border: 1px solid rgba(255,140,0,0.3); padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; transition: all 0.2s; }
        .btn-warn:hover { background: rgba(255,140,0,0.3); }
        .btn-success { background: rgba(46,204,113,0.15); color: #2ecc71; border: 1px solid rgba(46,204,113,0.3); padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; transition: all 0.2s; }
        .btn-success:hover { background: rgba(46,204,113,0.3); }
        .modal-btn-warn { background: linear-gradient(135deg,#ff8c00,#e67e22); color: #fff; border: none; padding: 10px 24px; border-radius: 8px; font-weight: 700; cursor: pointer; }
        .modal-btn-ok { background: linear-gradient(135deg,#2ecc71,#27ae60); color: #fff; border: none; padding: 10px 24px; border-radius: 8px; font-weight: 700; cursor: pointer; }'

$content = $content.Replace($oldStyle, $newStyle)

[System.IO.File]::WriteAllText((Resolve-Path $file), $content, [System.Text.Encoding]::UTF8)
Write-Host "admin.html atualizado!"
