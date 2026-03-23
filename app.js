// ==================== Reprodutor IPTV ====================
// Arquivo principal de JavaScript para o Reprodutor IPTV

// ==================== Estado da Aplicação ====================
const estado = {
    listas: [],
    canais: [],
    canaisFiltrados: [],
    canalAtual: null,
    listaAtual: null,
    favoritos: new Set(),
    hls: null,
    config: {
        autoPlay: true,
        continuar: false,
        buffer: 3,
        tema: 'escuro'
    }
};

// ==================== Referências DOM ====================
const elementos = {
    // Listas
    listaContainer: document.getElementById('listas-iptv'),
    listaCanais: document.getElementById('lista-canais'),
    buscaCanal: document.getElementById('busca-canal'),
    categorias: document.getElementById('categorias'),
    
    // Player
    player: document.getElementById('player-video'),
    telaEspera: document.getElementById('tela-espera'),
    telaCarregando: document.getElementById('tela-carregando'),
    telaErro: document.getElementById('tela-erro'),
    mensagemErro: document.getElementById('mensagem-erro'),
    
    // Info Canal
    logoCanal: document.getElementById('logo-canal'),
    nomeCanalAtual: document.getElementById('nome-canal-atual'),
    grupoCanalAtual: document.getElementById('grupo-canal-atual'),
    btnFavorito: document.getElementById('btn-favorito'),
    
    // Controles
    btnPausar: document.getElementById('btn-pausar'),
    iconePlay: document.getElementById('icone-play'),
    btnVoltar10: document.getElementById('btn-voltar-10'),
    btnAvancar10: document.getElementById('btn-avancar-10'),
    btnSom: document.getElementById('btn-som'),
    iconeVolume: document.getElementById('icone-volume'),
    controleVolume: document.getElementById('controle-volume'),
    btnProximoCanal: document.getElementById('btn-proximo-canal'),
    btnTelaCheia: document.getElementById('btn-tela-cheia'),
    btnScreenshot: document.getElementById('btn-screenshot'),
    
    // Modais
    modalAdicionarLista: document.getElementById('modal-adicionar-lista'),
    modalConfiguracoes: document.getElementById('modal-configuracoes'),
    
    // Botões Cabeçalho
    btnAdicionarLista: document.getElementById('btn-adicionar-lista'),
    btnConfiguracoes: document.getElementById('btn-configuracoes'),
    
    // Modal Lista
    formAdicionarLista: document.getElementById('form-adicionar-lista'),
    nomeLista: document.getElementById('nome-lista'),
    urlLista: document.getElementById('url-lista'),
    urlEpg: document.getElementById('url-epg'),
    listaFavorita: document.getElementById('lista-favorita'),
    fecharModalLista: document.getElementById('fechar-modal-lista'),
    btnCancelarLista: document.getElementById('btn-cancelar-lista'),
    btnSalvarLista: document.getElementById('btn-salvar-lista'),
    
    // Modal Config
    fecharModalConfig: document.getElementById('fechar-modal-config'),
    btnSalvarConfig: document.getElementById('btn-salvar-config'),
    btnLimparDados: document.getElementById('btn-limpar-dados'),
    configAutoPlay: document.getElementById('config-auto-play'),
    configContinuar: document.getElementById('config-continuar'),
    configBuffer: document.getElementById('config-buffer'),
    configTema: document.getElementById('config-tema'),
    
    // Outros
    btnTentarNovamente: document.getElementById('btn-tentar-novamente'),
    toastContainer: document.getElementById('toast-container')
};

// ==================== Inicialização ====================
document.addEventListener('DOMContentLoaded', () => {
    carregarDados();
    configurarEventos();
    aplicarConfiguracoes();
});

// ==================== Funções de Dados ====================
async function carregarDados() {
    // Carregar favoritos locais do usuário
    const favoritosSalvos = localStorage.getItem('canaisFavoritos');
    if (favoritosSalvos) {
        estado.favoritos = new Set(JSON.parse(favoritosSalvos));
    }
    
    // Carregar configurações visuais
    const configSalvas = localStorage.getItem('configIPTV');
    if (configSalvas) {
        estado.config = { ...estado.config, ...JSON.parse(configSalvas) };
    }
    
    try {
        const response = await fetch('/api/public-config');
        const data = await response.json();
        
        if (data.url) {
            const url = data.url;
            const cacheKey = 'iptv_cache_canais';
            const cacheURLKey = 'iptv_cache_url';
            const cacheTimeKey = 'iptv_cache_time';
            const CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 horas

            const cachedCanais = localStorage.getItem(cacheKey);
            const cachedURL = localStorage.getItem(cacheURLKey);
            const cachedTime = localStorage.getItem(cacheTimeKey);
            const now = Date.now();

            let canais = [];

            if (cachedCanais && cachedURL === url && cachedTime && (now - parseInt(cachedTime)) < CACHE_DURATION) {
                // Usar cache de ate 12 horas atrás
                canais = JSON.parse(cachedCanais);
            } else {
                // Baixar integralmente de novo
                mostrarToast('Sincronizando canais...', 'aviso');
                elementos.listaCanais.innerHTML = '<div class="spinner"></div><p style="text-align:center;margin-top:10px;">Baixando lista de canais da Fonte...</p>';
                
                canais = await carregarListaM3U(url);
                
                // Tenta salvar localmente
                try {
                    localStorage.setItem(cacheKey, JSON.stringify(canais));
                    localStorage.setItem(cacheURLKey, url);
                    localStorage.setItem(cacheTimeKey, now.toString());
                    mostrarToast(`Foram baixados e salvos ${canais.length} canais com sucesso!`, 'sucesso');
                } catch (e) {
                    console.warn('A lista é muito grande e não coube no cache do seu navegador local.');
                    mostrarToast(`Foram carregados ${canais.length} canais!`, 'sucesso');
                }
            }
            
            estado.canais = canais.map(c => ({
                ...c,
                favorito: estado.favoritos.has(c.id)
            }));
            estado.canaisFiltrados = [...estado.canais];
            
            renderizarCanais();
        } else {
            elementos.listaCanais.innerHTML = '<p class="mensagem-vazia">O administrador ainda não cadastrou a lista IPTV oficial.</p>';
        }
    } catch (e) {
        elementos.listaCanais.innerHTML = '<p class="mensagem-vazia erro">Erro ao conectar com o servidor para buscar a lista.</p>';
        console.error("Erro no load:", e);
    }
}

function salvarDados() {
    localStorage.setItem('canaisFavoritos', JSON.stringify([...estado.favoritos]));
    localStorage.setItem('configIPTV', JSON.stringify(estado.config));
}

// ==================== Configurações ====================
function aplicarConfiguracoes() {
    elementos.configAutoPlay.checked = estado.config.autoPlay;
    elementos.configContinuar.checked = estado.config.continuar;
    elementos.configBuffer.value = estado.config.buffer;
    elementos.configTema.value = estado.config.tema;
    
    // Aplicar tema
    if (estado.config.tema === 'claro') {
        document.body.classList.add('tema-claro');
    }
}

// ==================== Eventos ====================
function configurarEventos() {
    // Botões cabeçalho
    elementos.btnAdicionarLista.addEventListener('click', () => abrirModal(elementos.modalAdicionarLista));
    elementos.btnConfiguracoes.addEventListener('click', () => abrirModal(elementos.modalConfiguracoes));
    
    // Modal Lista
    elementos.fecharModalLista.addEventListener('click', () => fecharModal(elementos.modalAdicionarLista));
    elementos.btnCancelarLista.addEventListener('click', () => fecharModal(elementos.modalAdicionarLista));
    elementos.formAdicionarLista.addEventListener('submit', adicionarLista);
    
    // Modal Config
    elementos.fecharModalConfig.addEventListener('click', () => fecharModal(elementos.modalConfiguracoes));
    elementos.btnSalvarConfig.addEventListener('click', salvarConfiguracoes);
    elementos.btnLimparDados.addEventListener('click', limparTodosDados);
    
    // Fechar modais clicando fora
    [elementos.modalAdicionarLista, elementos.modalConfiguracoes].forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) fecharModal(modal);
        });
    });
    
    // Busca
    elementos.buscaCanal.addEventListener('input', filtrarCanais);
    
    // Categorias
    elementos.categorias.addEventListener('click', (e) => {
        const botao = e.target.closest('.categoria-botao');
        if (botao) {
            document.querySelectorAll('.categoria-botao').forEach(b => b.classList.remove('ativo'));
            botao.classList.add('ativo');
            filtrarPorCategoria(botao.dataset.categoria);
        }
    });
    
    // Controles do player
    elementos.btnPausar.addEventListener('click', togglePausa);
    elementos.btnVoltar10.addEventListener('click', () => avoltarAvancar(-10));
    elementos.btnAvancar10.addEventListener('click', () => avoltarAvancar(10));
    elementos.btnSom.addEventListener('click', toggleSom);
    elementos.controleVolume.addEventListener('input', alterarVolume);
    elementos.btnProximoCanal.addEventListener('click', proximoCanal);
    elementos.btnTelaCheia.addEventListener('click', toggleTelaCheia);
    elementos.btnScreenshot.addEventListener('click', capturarTela);
    elementos.btnFavorito.addEventListener('click', toggleFavoritoAtual);
    elementos.btnTentarNovamente.addEventListener('click', () => {
        if (estado.canalAtual) {
            reproduzirCanal(estado.canalAtual);
        }
    });
    
    // Eventos do player de vídeo
    elementos.player.addEventListener('play', () => {
        elementos.iconePlay.className = 'fas fa-pause';
    });
    
    elementos.player.addEventListener('pause', () => {
        elementos.iconePlay.className = 'fas fa-play';
    });
    
    elementos.player.addEventListener('waiting', () => {
        mostrarTela(elementos.telaCarregando);
    });
    
    elementos.player.addEventListener('playing', () => {
        esconderTodasTelas();
    });
    
    elementos.player.addEventListener('error', () => {
        mostrarErro('Erro ao reproduzir o vídeo. Verifique a conexão.');
    });
    
    // Teclas de atalho
    document.addEventListener('keydown', manipularTeclas);
}

// ==================== Gerenciamento de Listas ====================
async function adicionarLista(e) {
    e.preventDefault();
    
    const nome = elementos.nomeLista.value.trim();
    const url = elementos.urlLista.value.trim();
    const urlEpg = elementos.urlEpg.value.trim();
    const favorita = elementos.listaFavorita.checked;
    const arquivoInput = document.getElementById('arquivo-m3u');
    const arquivo = arquivoInput?.files[0];
    
    if (!nome) {
        mostrarToast('Digite um nome para a lista', 'erro');
        return;
    }
    
    if (!url && !arquivo) {
        mostrarToast('Insira uma URL ou faça upload de um arquivo M3U', 'erro');
        return;
    }
    
    try {
        mostrarToast('Carregando lista...', 'aviso');
        
        const lista = {
            id: gerarId(),
            nome,
            url: url || 'Arquivo local',
            urlEpg,
            favorita,
            canais: [],
            dataCriacao: new Date().toISOString()
        };
        
        let canais;
        
        if (arquivo) {
            // Carregar do arquivo local
            const conteudo = await lerArquivo(arquivo);
            canais = carregarM3UDeArquivo(conteudo);
            lista.tipo = 'arquivo';
        } else {
            // Carregar da URL
            canais = await carregarListaM3U(url);
        }
        
        lista.canais = canais;
        
        estado.listas.push(lista);
        salvarDados();
        renderizarListas();
        
        fecharModal(elementos.modalAdicionarLista);
        elementos.formAdicionarLista.reset();
        
        mostrarToast(`Lista "${nome}" adicionada com ${canais.length} canais!`, 'sucesso');
        
        // Selecionar a nova lista
        selecionarLista(lista.id);
        
    } catch (erro) {
        console.error('Erro ao adicionar lista:', erro);
        mostrarToast(erro.message || 'Erro ao carregar a lista', 'erro');
    }
}

function lerArquivo(arquivo) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
        reader.readAsText(arquivo);
    });
}

// Proxy local (servidor node.js)
const PROXY_LOCAL = '/proxy?url=';

async function carregarListaM3U(url) {
    if (!url.startsWith('http')) {
        throw new Error('URL inválida');
    }

    try {
        console.log('Buscando lista via proxy local...');
        const texto = await fetchComTimeout(PROXY_LOCAL + encodeURIComponent(url), 60000);
        return parsearM3U(texto);
    } catch (erro) {
        console.error('Erro:', erro.message);
        throw new Error('Não foi possível carregar a lista. Verifique se o servidor node está rodando.');
    }
}

async function fetchComTimeout(url, timeoutMs = 30000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'Accept': '*/*' }
        });
        
        clearTimeout(timeout);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const texto = await response.text();
        
        if (!texto.includes('#EXTINF') && !texto.includes('#EXTM3U')) {
            throw new Error('Resposta não contém M3U válido');
        }
        
        return texto;
        
    } catch (erro) {
        clearTimeout(timeout);
        if (erro.name === 'AbortError') {
            throw new Error('Tempo esgotado. Servidor demorou para responder.');
        }
        throw erro;
    }
}

function parsearM3U(texto) {
    const canais = [];
    const linhas = texto.split('\n');
    let canalAtual = null;
    
    for (const linha of linhas) {
        const linhaTrimada = linha.trim();
        
        if (linhaTrimada.startsWith('#EXTINF:')) {
            const nomeMatch = linhaTrimada.match(/,(.+)$/);
            const logoMatch = linhaTrimada.match(/tvg-logo="([^"]*)"/);
            const grupoMatch = linhaTrimada.match(/group-title="([^"]*)"/);
            const idMatch = linhaTrimada.match(/tvg-id="([^"]*)"/);
            
            canalAtual = {
                id: idMatch ? idMatch[1] : gerarId(),
                nome: nomeMatch ? nomeMatch[1].trim() : 'Canal sem nome',
                logo: logoMatch ? logoMatch[1] : '',
                grupo: grupoMatch ? grupoMatch[1] : 'Outros',
                url: '',
                favorito: false
            };
        } else if (linhaTrimada && !linhaTrimada.startsWith('#') && canalAtual) {
            canalAtual.url = linhaTrimada;
            canais.push(canalAtual);
            canalAtual = null;
        }
    }
    
    if (canais.length === 0) {
        throw new Error('Nenhum canal encontrado no arquivo M3U');
    }
    
    return canais;
}

// Carregar M3U de arquivo local
function carregarM3UDeArquivo(conteudo) {
    return parsearM3U(conteudo);
}

function gerarCanaisExemplo() {
    return [
        { id: '1', nome: 'Globo', logo: '', grupo: 'Rede Globo', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', favorito: false },
        { id: '2', nome: 'SBT', logo: '', grupo: 'Rede SBT', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', favorito: false },
        { id: '3', nome: 'Record TV', logo: '', grupo: 'Rede Record', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', favorito: false },
        { id: '4', nome: 'Band', logo: '', grupo: 'Rede Bandeirantes', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', favorito: false },
        { id: '5', nome: 'TV Cultura', logo: '', grupo: 'TV Cultura', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', favorito: false },
        { id: '6', nome: 'ESPN Brasil', logo: '', grupo: 'Esportes', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', favorito: false },
        { id: '7', nome: 'SporTV', logo: '', grupo: 'Esportes', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', favorito: false },
        { id: '8', nome: 'Premiere', logo: '', grupo: 'Esportes', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', favorito: false },
        { id: '9', nome: 'Telecine', logo: '', grupo: 'Filmes', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', favorito: false },
        { id: '10', nome: 'HBO', logo: '', grupo: 'Filmes', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', favorito: false },
        { id: '11', nome: 'Discovery Channel', logo: '', grupo: 'Documentários', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', favorito: false },
        { id: '12', nome: 'National Geographic', logo: '', grupo: 'Documentários', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', favorito: false },
        { id: '13', nome: 'Cartoon Network', logo: '', grupo: 'Infantil', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', favorito: false },
        { id: '14', nome: 'Disney Channel', logo: '', grupo: 'Infantil', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', favorito: false },
        { id: '15', nome: 'Globo News', logo: '', grupo: 'Notícias', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', favorito: false },
        { id: '16', nome: 'CNN Brasil', logo: '', grupo: 'Notícias', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', favorito: false },
        { id: '17', nome: 'Band News', logo: '', grupo: 'Notícias', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', favorito: false },
        { id: '18', nome: 'Multishow', logo: '', grupo: 'Música', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', favorito: false },
        { id: '19', nome: 'MTV', logo: '', grupo: 'Música', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', favorito: false },
        { id: '20', nome: 'VH1', logo: '', grupo: 'Música', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', favorito: false }
    ];
}

function renderizarListas() {
    if (estado.listas.length === 0) {
        elementos.listaContainer.innerHTML = '<p class="mensagem-vazia">Nenhuma lista adicionada</p>';
        return;
    }
    
    elementos.listaContainer.innerHTML = estado.listas.map(lista => `
        <div class="lista-iptv-item ${estado.listaAtual?.id === lista.id ? 'ativo' : ''}" data-id="${lista.id}">
            <div class="info-lista" onclick="selecionarLista('${lista.id}')">
                <span class="nome-lista">
                    ${lista.favorita ? '<i class="fas fa-star" style="color: var(--cor-aviso);"></i>' : ''}
                    ${lista.nome}
                </span>
                <span class="quantidade-canais">${lista.canais.length} canais</span>
            </div>
            <div class="acoes-lista">
                <button onclick="atualizarLista('${lista.id}')" title="Atualizar">
                    <i class="fas fa-sync-alt"></i>
                </button>
                <button class="remover" onclick="removerLista('${lista.id}')" title="Remover">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

function selecionarLista(id) {
    const lista = estado.listas.find(l => l.id === id);
    if (!lista) return;
    
    estado.listaAtual = lista;
    estado.canais = lista.canais.map(c => ({
        ...c,
        favorito: estado.favoritos.has(c.id)
    }));
    estado.canaisFiltrados = [...estado.canais];
    
    localStorage.setItem('ultimaLista', id);
    
    renderizarListas();
    renderizarCanais();
    filtrarCanais();
    
    mostrarToast(`Lista "${lista.nome}" selecionada`, 'sucesso');
}

async function atualizarLista(id) {
    const lista = estado.listas.find(l => l.id === id);
    if (!lista) return;
    
    try {
        mostrarToast('Atualizando lista...', 'aviso');
        
        const canais = await carregarListaM3U(lista.url);
        lista.canais = canais;
        
        salvarDados();
        
        if (estado.listaAtual?.id === id) {
            estado.canais = canais.map(c => ({
                ...c,
                favorito: estado.favoritos.has(c.id)
            }));
            estado.canaisFiltrados = [...estado.canais];
            renderizarCanais();
        }
        
        renderizarListas();
        mostrarToast('Lista atualizada com sucesso!', 'sucesso');
        
    } catch (erro) {
        mostrarToast('Erro ao atualizar lista', 'erro');
    }
}

function removerLista(id) {
    if (!confirm('Tem certeza que deseja remover esta lista?')) return;
    
    estado.listas = estado.listas.filter(l => l.id !== id);
    
    if (estado.listaAtual?.id === id) {
        estado.listaAtual = null;
        estado.canais = [];
        estado.canaisFiltrados = [];
        renderizarCanais();
    }
    
    salvarDados();
    renderizarListas();
    mostrarToast('Lista removida', 'sucesso');
}

// ==================== Gerenciamento de Canais ====================
function renderizarCanais() {
    if (estado.canaisFiltrados.length === 0) {
        elementos.listaCanais.innerHTML = '<p class="mensagem-vazia">Nenhum canal encontrado</p>';
        return;
    }
    
    elementos.listaCanais.innerHTML = estado.canaisFiltrados.map(canal => `
        <div class="canal-item ${estado.canalAtual?.id === canal.id ? 'ativo' : ''} ${canal.favorito ? 'favorito' : ''}" 
             data-id="${canal.id}"
             onclick="selecionarCanal('${canal.id}')">
            <div class="canal-logo">
                ${canal.logo 
                    ? `<img src="${canal.logo}" alt="${canal.nome}" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-tv\\'></i>'">` 
                    : '<i class="fas fa-tv"></i>'}
            </div>
            <div class="canal-info">
                <div class="canal-nome">${canal.nome}</div>
                <div class="canal-grupo">${canal.grupo}</div>
            </div>
            <div class="canal-indicadores">
                ${canal.favorito ? '<span class="indicador"><i class="fas fa-heart" style="color: var(--cor-perigo);"></i></span>' : ''}
            </div>
        </div>
    `).join('');
}

function selecionarCanal(id) {
    const canal = estado.canais.find(c => c.id === id);
    if (!canal) return;
    
    estado.canalAtual = canal;
    renderizarCanais();
    
    // Atualizar info
    elementos.nomeCanalAtual.textContent = canal.nome;
    elementos.grupoCanalAtual.textContent = canal.grupo;
    
    // Atualizar logo
    if (canal.logo) {
        elementos.logoCanal.innerHTML = `<img src="${canal.logo}" alt="${canal.nome}">`;
    } else {
        elementos.logoCanal.innerHTML = '<i class="fas fa-tv"></i>';
    }
    
    // Atualizar botão favorito
    atualizarBotaoFavorito();
    
    // Reproduzir
    if (estado.config.autoPlay) {
        reproduzirCanal(canal);
    }
}

function reproduzirCanal(canal) {
    if (!canal || !canal.url) {
        mostrarErro('URL do canal não disponível');
        return;
    }
    
    mostrarTela(elementos.telaCarregando);
    esconderTela(elementos.telaEspera);
    esconderTela(elementos.telaErro);
    
    // Destruir instância HLS anterior se existir
    if (estado.hls) {
        estado.hls.destroy();
        estado.hls = null;
    }
    
    const url = canal.url;
    
    // Verificar se é HLS
    if (url.includes('.m3u8')) {
        if (Hls.isSupported()) {
            estado.hls = new Hls({
                maxBufferLength: estado.config.buffer,
                maxMaxBufferLength: estado.config.buffer * 2
            });
            
            estado.hls.loadSource(url);
            estado.hls.attachMedia(elementos.player);
            
            estado.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                esconderTodasTelas();
                elementos.player.play().catch(() => {
                    // Autoplay bloqueado
                });
            });
            
            estado.hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            estado.hls.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            estado.hls.recoverMediaError();
                            break;
                        default:
                            mostrarErro('Erro ao reproduzir o canal');
                            break;
                    }
                }
            });
        } else if (elementos.player.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari nativo
            elementos.player.src = url;
            elementos.player.addEventListener('loadedmetadata', () => {
                esconderTodasTelas();
                elementos.player.play();
            });
        } else {
            mostrarErro('Seu navegador não suporta HLS');
        }
    } else {
        // Outros formatos (MP4, etc.)
        elementos.player.src = url;
        elementos.player.addEventListener('loadedmetadata', () => {
            esconderTodasTelas();
            elementos.player.play();
        }, { once: true });
    }
}

function filtrarCanais() {
    const termo = elementos.buscaCanal.value.toLowerCase();
    
    estado.canaisFiltrados = estado.canais.filter(canal => 
        canal.nome.toLowerCase().includes(termo) ||
        canal.grupo.toLowerCase().includes(termo)
    );
    
    renderizarCanais();
}

function filtrarPorCategoria(categoria) {
    if (categoria === 'todos') {
        estado.canaisFiltrados = [...estado.canais];
    } else {
        const categoriasMap = {
            'canais': ['Rede Globo', 'Rede SBT', 'Rede Record', 'Rede Bandeirantes', 'TV Cultura', 'Notícias'],
            'filmes': ['Filmes', 'Telecine', 'HBO'],
            'series': ['Séries', 'Netflix', 'Amazon'],
            'esportes': ['Esportes', 'ESPN', 'SporTV', 'Premiere'],
            'infantil': ['Infantil', 'Cartoon', 'Disney']
        };
        
        const grupos = categoriasMap[categoria] || [];
        
        estado.canaisFiltrados = estado.canais.filter(canal =>
            grupos.some(g => canal.grupo.toLowerCase().includes(g.toLowerCase()))
        );
    }
    
    renderizarCanais();
}

// ==================== Controles do Player ====================
function togglePausa() {
    if (elementos.player.paused) {
        elementos.player.play();
    } else {
        elementos.player.pause();
    }
}

function avoltarAvancar(segundos) {
    elementos.player.currentTime += segundos;
}

function toggleSom() {
    elementos.player.muted = !elementos.player.muted;
    atualizarIconeVolume();
}

function alterarVolume() {
    elementos.player.volume = elementos.controleVolume.value / 100;
    elementos.player.muted = false;
    atualizarIconeVolume();
}

function atualizarIconeVolume() {
    const volume = elementos.player.volume;
    const mutado = elementos.player.muted;
    
    if (mutado || volume === 0) {
        elementos.iconeVolume.className = 'fas fa-volume-mute';
    } else if (volume < 0.5) {
        elementos.iconeVolume.className = 'fas fa-volume-down';
    } else {
        elementos.iconeVolume.className = 'fas fa-volume-up';
    }
}

function proximoCanal() {
    if (!estado.canalAtual || estado.canaisFiltrados.length === 0) return;
    
    const indiceAtual = estado.canaisFiltrados.findIndex(c => c.id === estado.canalAtual.id);
    const proximoIndice = (indiceAtual + 1) % estado.canaisFiltrados.length;
    const proximoCanal = estado.canaisFiltrados[proximoIndice];
    
    selecionarCanal(proximoCanal.id);
}

function toggleTelaCheia() {
    const container = document.querySelector('.player-container');
    
    if (!document.fullscreenElement) {
        container.requestFullscreen().catch(err => {
            console.error('Erro ao entrar em tela cheia:', err);
        });
    } else {
        document.exitFullscreen();
    }
}

function capturarTela() {
    const video = elementos.player;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const link = document.createElement('a');
    link.download = `captura-${estado.canalAtual?.nome || 'video'}-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    
    mostrarToast('Captura de tela salva!', 'sucesso');
}

// ==================== Favoritos ====================
function toggleFavoritoAtual() {
    if (!estado.canalAtual) return;
    
    const id = estado.canalAtual.id;
    
    if (estado.favoritos.has(id)) {
        estado.favoritos.delete(id);
        estado.canalAtual.favorito = false;
    } else {
        estado.favoritos.add(id);
        estado.canalAtual.favorito = true;
    }
    
    // Atualizar na lista de canais
    const canalNaLista = estado.canais.find(c => c.id === id);
    if (canalNaLista) {
        canalNaLista.favorito = estado.favoritos.has(id);
    }
    
    atualizarBotaoFavorito();
    renderizarCanais();
    salvarDados();
}

function atualizarBotaoFavorito() {
    if (!estado.canalAtual) return;
    
    const icone = elementos.btnFavorito.querySelector('i');
    
    if (estado.favoritos.has(estado.canalAtual.id)) {
        icone.className = 'fas fa-heart';
        elementos.btnFavorito.classList.add('favorito-ativo');
    } else {
        icone.className = 'far fa-heart';
        elementos.btnFavorito.classList.remove('favorito-ativo');
    }
}

// ==================== Modais ====================
function abrirModal(modal) {
    modal.classList.remove('oculto');
    document.body.style.overflow = 'hidden';
}

function fecharModal(modal) {
    modal.classList.add('oculto');
    document.body.style.overflow = '';
}

// ==================== Configurações ====================
function salvarConfiguracoes() {
    estado.config = {
        autoPlay: elementos.configAutoPlay.checked,
        continuar: elementos.configContinuar.checked,
        buffer: parseInt(elementos.configBuffer.value),
        tema: elementos.configTema.value
    };
    
    salvarDados();
    fecharModal(elementos.modalConfiguracoes);
    mostrarToast('Configurações salvas!', 'sucesso');
}

function limparTodosDados() {
    if (!confirm('Tem certeza que deseja limpar todos os dados? Esta ação não pode ser desfeita.')) {
        return;
    }
    
    localStorage.clear();
    
    estado.listas = [];
    estado.canais = [];
    estado.canaisFiltrados = [];
    estado.canalAtual = null;
    estado.listaAtual = null;
    estado.favoritos = new Set();
    
    renderizarListas();
    renderizarCanais();
    
    fecharModal(elementos.modalConfiguracoes);
    mostrarToast('Todos os dados foram limpos', 'sucesso');
}

// ==================== Utilitários ====================
function gerarId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function mostrarTela(tela) {
    tela.classList.remove('oculto');
}

function esconderTela(tela) {
    tela.classList.add('oculto');
}

function esconderTodasTelas() {
    [elementos.telaEspera, elementos.telaCarregando, elementos.telaErro].forEach(tela => {
        tela.classList.add('oculto');
    });
}

function mostrarErro(mensagem) {
    esconderTodasTelas();
    elementos.mensagemErro.textContent = mensagem;
    mostrarTela(elementos.telaErro);
}

function mostrarToast(mensagem, tipo = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;
    
    const icones = {
        sucesso: 'fa-check-circle',
        erro: 'fa-exclamation-circle',
        aviso: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    toast.innerHTML = `
        <i class="fas ${icones[tipo] || icones.info}"></i>
        <span>${mensagem}</span>
    `;
    
    elementos.toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function manipularTeclas(e) {
    // Ignorar se estiver digitando em um input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    switch (e.key.toLowerCase()) {
        case ' ':
            e.preventDefault();
            togglePausa();
            break;
        case 'arrowleft':
            e.preventDefault();
            avoltarAvancar(-10);
            break;
        case 'arrowright':
            e.preventDefault();
            avoltarAvancar(10);
            break;
        case 'arrowup':
            e.preventDefault();
            elementos.controleVolume.value = Math.min(100, parseInt(elementos.controleVolume.value) + 5);
            alterarVolume();
            break;
        case 'arrowdown':
            e.preventDefault();
            elementos.controleVolume.value = Math.max(0, parseInt(elementos.controleVolume.value) - 5);
            alterarVolume();
            break;
        case 'm':
            toggleSom();
            break;
        case 'f':
            toggleTelaCheia();
            break;
        case 'n':
            proximoCanal();
            break;
    }
}

// Expor funções globais para onclick
window.selecionarLista = selecionarLista;
window.selecionarCanal = selecionarCanal;
window.removerLista = removerLista;
window.atualizarLista = atualizarLista;