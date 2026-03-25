// ==================== Reprodutor IPTV ====================
// Arquivo principal de JavaScript para o Reprodutor IPTV

// ==================== Estado da Aplicação ====================
const estado = {
    listas: [],
    canais: [],
    canaisCategoria: [], // canais após filtro da categoria principal
    canaisFiltrados: [],
    canalAtual: null,
    listaAtual: null,
    favoritos: new Set(),
    hls: null,
    categoriaAtiva: 'todos',
    subCategoriaAtiva: null,
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
    toastContainer: document.getElementById('toast-container'),
    subCategoriasWrapper: document.getElementById('sub-categorias'),
    subCategoriaLista: document.getElementById('sub-categorias-lista')
};

// ==================== Proxy Local ====================
// Aponta para o endpoint /proxy?url= do servidor Node.js local
const PROXY_LOCAL = '/proxy?url=';

// ==================== Inicialização ====================
document.addEventListener('DOMContentLoaded', () => {
    carregarDados();
    configurarEventos();
    aplicarConfiguracoes();
    // Inicializar slider de volume com volume padrão (100%)
    if (elementos.controleVolume) {
        elementos.controleVolume.value = 100;
    }
    if (elementos.player) {
        elementos.player.volume = 1;
        elementos.player.muted = false;
    }
    atualizarIconeVolume();
});

/* ==================== Cache Avançado (IndexedDB) ==================== */
function openDB() {
    return new Promise((resolve, reject) => {
        // Versão 3: invalida cache com URLs duplo-proxy (bug corrigido)
        const req = indexedDB.open('IPTVCacheDB', 3);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            // Apagar objectStore antigo se existir para limpar cache corrompido
            if (db.objectStoreNames.contains('cache')) {
                db.deleteObjectStore('cache');
            }
            db.createObjectStore('cache');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function setLargeCache(key, value) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('cache', 'readwrite');
            const store = tx.objectStore('cache');
            store.put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch(e) { console.warn('Falha IndexedDB salvar'); }
}
async function getLargeCache(key) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('cache', 'readonly');
            const store = tx.objectStore('cache');
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    } catch(e) { return null; }
}

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
            // Conversão vital para Navegadores: Se a lista iptv for output=ts, 
            // navegadores não conseguem renderizar nativamente sem travar/falhar. 
            // Mas output=m3u8 funciona muito bem no hls.js!
            let url = data.url;
            if (url.includes('output=ts')) {
                url = url.replace('output=ts', 'output=m3u8');
            }

            const cacheKey = 'iptv_cache_canais';
            const cacheURLKey = 'iptv_cache_url';
            const cacheTimeKey = 'iptv_cache_time';
            const CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 horas

            const cachedCanais = await getLargeCache(cacheKey);
            const cachedURL = localStorage.getItem(cacheURLKey);
            const cachedTime = localStorage.getItem(cacheTimeKey);
            const now = Date.now();

            let canais = [];

            if (cachedCanais && cachedURL === url && cachedTime && (now - parseInt(cachedTime)) < CACHE_DURATION) {
                // Usar cache gigante do IndexedDB ate 12 horas atrás
                canais = cachedCanais;
                mostrarToast('Canais carregados rapidamente da memória interna.', 'info');
            } else {
                // Baixar integralmente de novo
                mostrarToast('Sincronizando canais...', 'aviso');
                elementos.listaCanais.innerHTML = '<div class="spinner"></div><p style="text-align:center;margin-top:10px;">Baixando lista de canais da Fonte...</p>';
                
                canais = await carregarListaM3U(url);
                
                // Tenta salvar no IndexedDB
                try {
                    await setLargeCache(cacheKey, canais);
                    localStorage.setItem(cacheURLKey, url);
                    localStorage.setItem(cacheTimeKey, now.toString());
                    mostrarToast(`Foram baixados e salvos em alta capacidade ${canais.length} canais!`, 'sucesso');
                } catch (e) {
                    console.warn('Falha ao utilizar IndexedDB da maquina.', e);
                    mostrarToast(`Foram carregados ${canais.length} canais!`, 'sucesso');
                }
            }
            
            estado.canais = canais.map(c => ({
                ...c,
                favorito: estado.favoritos.has(c.id)
            }));
            estado.canaisCategoria = [...estado.canais]; // sincroniza base da categoria
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
    
    // Scroll infinito para renderizar mais canais quando chega perto do fim
    elementos.listaCanais.addEventListener('scroll', () => {
        // Se rolou até os últimos 100px
        if (elementos.listaCanais.scrollHeight - elementos.listaCanais.scrollTop <= elementos.listaCanais.clientHeight + 100) {
            renderizarCanais(true); // Faz append
        }
    });
    
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

async function carregarListaM3U(url) {
    if (!url.startsWith('http')) {
        throw new Error('URL inválida');
    }

    // 1ª tentativa: Acesso direto pelo navegador (evita bloqueio de datacenter como Railway)
    try {
        console.log('Buscando lista diretamente (browser -> provedor IPTV)...');
        const texto = await fetchComTimeout(url, 15000); // 15s timeout
        return parsearM3U(texto);
    } catch (erroDireto) {
        console.warn('Falha na busca direta (pode ser CORS):', erroDireto.message, '— tentando via corsproxy.io...');
    }
    
    // 2ª tentativa: CORS Proxy Público (Resolve bloqueios no IP do Railway usando IP de terceiros)
    try {
        console.log('Buscando lista via proxy público corsproxy.io...');
        const corsUrl = 'https://corsproxy.io/?' + encodeURIComponent(url);
        const texto = await fetchComTimeout(corsUrl, 20000);
        return parsearM3U(texto);
    } catch (erroCors) {
         console.warn('Falha no corsproxy.io:', erroCors.message, '— tentando /buscar-lista do servidor local...');
    }

    // 3ª tentativa: rota dedicada /buscar-lista com headers anti-403 no servidor local (Railway)
    try {
        console.log('Buscando lista via /buscar-lista (servidor proxy com headers)...');
        const texto = await fetchComTimeout('/buscar-lista?url=' + encodeURIComponent(url), 60000);
        return parsearM3U(texto);
    } catch (erro1) {
        console.warn('Falha /buscar-lista:', erro1.message, '— tentando /proxy genérico...');
    }

    // 4ª tentativa: proxy genérico (último fallback)
    try {
        console.log('Buscando lista via /proxy (fallback)...');
        const texto = await fetchComTimeout(PROXY_LOCAL + encodeURIComponent(url), 60000);
        return parsearM3U(texto);
    } catch (erro2) {
        console.error('Erro (todas tentativas falharam):', erro2.message);
        throw new Error('Não foi possível carregar a lista. O servidor remoto bloqueou o acesso em todas as rotas (403/500). Verifique a URL ou sua restrição de IP.');
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
                id: (idMatch && idMatch[1]) ? idMatch[1] + '_' + canais.length : gerarId(),
                nome: nomeMatch ? nomeMatch[1].trim() : 'Canal sem nome',
                logo: logoMatch ? logoMatch[1] : '',
                grupo: grupoMatch ? grupoMatch[1] : 'Outros',
                url: '',
                favorito: false
            };
        } else if (linhaTrimada && !linhaTrimada.startsWith('#') && canalAtual) {
            let urlCanal = linhaTrimada;
            // Se o servidor reescreveu o URL com /proxy?url=, extrair o URL original
            // Isso evita duplo-proxy ao reproduzir o canal
            if (urlCanal.startsWith('/proxy?url=')) {
                try { urlCanal = decodeURIComponent(urlCanal.slice('/proxy?url='.length)); } catch(e) {}
            }
            canalAtual.url = urlCanal;
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
let paginaAtualCanais = 1;
const CANAIS_POR_PAGINA = 100;

function renderizarCanais(append = false) {
    if (!append) {
        paginaAtualCanais = 1;
        elementos.listaCanais.scrollTop = 0;
    } else {
        paginaAtualCanais++;
    }

    if (estado.canaisFiltrados.length === 0) {
        elementos.listaCanais.innerHTML = '<p class="mensagem-vazia">Nenhum canal encontrado</p>';
        return;
    }
    
    const inicio = (paginaAtualCanais - 1) * CANAIS_POR_PAGINA;
    const fim = inicio + CANAIS_POR_PAGINA;
    const canaisPagina = estado.canaisFiltrados.slice(inicio, fim);

    if (append && canaisPagina.length === 0) {
        return; // Não tem mais nada para renderizar
    }

    const html = canaisPagina.map(canal => `
        <div class="canal-item ${estado.canalAtual?.id === canal.id ? 'ativo' : ''} ${canal.favorito ? 'favorito' : ''}" 
             data-id="${canal.id}"
             data-index="${estado.canaisFiltrados.indexOf(canal)}"
             onclick="selecionarCanalPorIndex(this.dataset.index)">
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

    if (append) {
        elementos.listaCanais.insertAdjacentHTML('beforeend', html);
    } else {
        elementos.listaCanais.innerHTML = html;
    }
}

function selecionarCanal(id) {
    const canal = estado.canais.find(c => c.id === id);
    if (!canal) return;
    _selecionarCanalObj(canal, id);
}

// Seleciona canal pelo índice no array canaisFiltrados (evita bug com IDs duplicados/vazios)
function selecionarCanalPorIndex(indexStr) {
    const index = parseInt(indexStr, 10);
    if (isNaN(index) || index < 0 || index >= estado.canaisFiltrados.length) return;
    const canal = estado.canaisFiltrados[index];
    if (!canal) return;
    _selecionarCanalObj(canal, canal.id);
}

function _selecionarCanalObj(canal, id) {
    estado.canalAtual = canal;
    
    // Atualizar classe ativa no DOM manualmente em vez de re-renderizar todos os 100 da tela
    const itensAntigos = elementos.listaCanais.querySelectorAll('.canal-item.ativo');
    itensAntigos.forEach(i => i.classList.remove('ativo'));
    const novoAtivo = elementos.listaCanais.querySelector(`.canal-item[data-id="${id}"]`);
    if (novoAtivo) novoAtivo.classList.add('ativo');

    
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

    // Destruir instância HLS anterior
    if (estado.hls) {
        estado.hls.destroy();
        estado.hls = null;
    }

    // Salvar volume/muted antes de clonar
    const volumeAnterior = elementos.player.volume;
    const mutadoAnterior = elementos.player.muted;

    // Recriar o player para evitar acúmulo de listeners
    const novoPlayer = elementos.player.cloneNode(true);
    elementos.player.parentNode.replaceChild(novoPlayer, elementos.player);
    elementos.player = novoPlayer;

    // Restaurar volume/muted no novo player
    elementos.player.volume = volumeAnterior;
    elementos.player.muted = mutadoAnterior;
    reconfigurarEventosPlayer();

    let urlOriginal = canal.url.trim();

    // ── Sanitização: remove wrapper /proxy?url= do cache antigo ────────────────
    // O cache pode ter URLs já proxificadas. Decodifica para obter a URL real,
    // senão a detecção de isXtreamLive/isHLS/isVOD falha e os canais ao vivo
    // não entram na cascata correta.
    while (urlOriginal.startsWith('/proxy?url=')) {
        try { urlOriginal = decodeURIComponent(urlOriginal.slice('/proxy?url='.length)); } catch(e) { break; }
    }

    // ── Normalização de URL ──────────────────────────────────────────────────
    // output=ts → output=m3u8
    if (urlOriginal.includes('output=ts')) {
        urlOriginal = urlOriginal.replace('output=ts', 'output=m3u8');
    }

    const isMp4 = /\.mp4(\?.*)?$/i.test(urlOriginal);
    const isHLS = urlOriginal.includes('.m3u8') ||
                  urlOriginal.includes('/hls/') ||
                  urlOriginal.includes('output=m3u8');
    
    // Filmes e séries Xtream (/movie/ ou /series/) são VOD — não live
    const isVOD = /\/movie\//i.test(urlOriginal) || /\/series\//i.test(urlOriginal);
    
    const isXtreamLive = !isMp4 && !isHLS && !isVOD && (
        /\.ts(\?.*)?$/.test(urlOriginal) ||
        /\/\d+$/.test(urlOriginal)
    );

    // ── VOD (filmes / séries) ────────────────────────────────────────────────
    // → reproduz direto via proxy sem cascata HLS
    if (isMp4 || isVOD) {
        reproduzirDireto(urlOriginal);
        return;
    }

    // ── Gerar cascata de tentativas ──────────────────────────────────────────
    // Cada entrada: { url, proxy, xhrProxy }
    //   url      = URL a usar como source do HLS.js
    //   proxy    = se true, envolve url no PROXY_LOCAL
    //   xhrProxy = se true, também proxia segmentos .ts via xhrSetup
    function gerarCascata(u) {
        if (!isXtreamLive) return null; // usa fluxo normal

        const urlBase = u.replace(/\.ts(\?.*)?$/, '').replace(/\.m3u8(\?.*)?$/, '');

        // Gerar URL com /live/ mantendo o porto
        let urlComLive = null;
        try {
            const parsed = new URL(urlBase);
            const partes = parsed.pathname.split('/').filter(Boolean);
            if (partes.length === 3 && !partes.includes('live')) {
                parsed.pathname = '/live/' + partes.join('/');
                urlComLive = parsed.href;
            }
        } catch(e) {}

        // Se a página está em HTTPS e o stream é HTTP, evita Mixed Content:
        // começa direto pelo proxy (browser bloquearia o HTTP antes mesmo de tentar)
        const paginaSegura = location.protocol === 'https:';
        const streamInseguro = u.startsWith('http://');
        const evitarDireto = paginaSegura && streamInseguro;

        if (evitarDireto) {
            return [
                // Só proxy — direto seria bloqueado como Mixed Content
                { url: urlBase + '.m3u8',    proxy: true, xhrProxy: true, label: 'proxy .m3u8' },
                urlComLive ?
                { url: urlComLive + '.m3u8', proxy: true, xhrProxy: true, label: 'proxy /live/.m3u8' } : null,
                // Manifesto sintético (último recurso)
                { url: '/hls-ts?url=' + encodeURIComponent(u), proxy: false, xhrProxy: true, label: 'manifesto sintético' },
            ].filter(Boolean);
        }

        return [
            // 1. Direto — browser com IP residencial, servidor pode aceitar
            { url: urlBase + '.m3u8',      proxy: false, xhrProxy: false, label: 'direto .m3u8' },
            urlComLive ?
            { url: urlComLive + '.m3u8',   proxy: false, xhrProxy: false, label: 'direto /live/.m3u8' } : null,
            // 2. Via proxy — caso tenha bloqueio CORS
            { url: urlBase + '.m3u8',      proxy: true,  xhrProxy: true,  label: 'proxy .m3u8' },
            urlComLive ?
            { url: urlComLive + '.m3u8',   proxy: true,  xhrProxy: true,  label: 'proxy /live/.m3u8' } : null,
            // 3. Manifesto sintético (último recurso)
            { url: '/hls-ts?url=' + encodeURIComponent(u),
                               proxy: false, xhrProxy: true,  label: 'manifesto sintético' },
        ].filter(Boolean);
    }

    const cascata = gerarCascata(urlOriginal);
    let indiceTentativa = 0;

    function tentarProximaUrl() {
        if (!cascata || indiceTentativa >= cascata.length) {
            console.warn('[NexusTV] ⛔ Todas as tentativas falharam. Canal bloqueado.');
            mostrarErro('Canal ao vivo indisponível no momento. Tente outro canal.');
            return;
        }

        const tentativa = cascata[indiceTentativa];
        indiceTentativa++;

        const urlSource = tentativa.proxy
            ? PROXY_LOCAL + encodeURIComponent(tentativa.url)
            : tentativa.url;

        console.log(`[NexusTV] ▶ Tentativa ${indiceTentativa} (${tentativa.label}): ${tentativa.url}`);

        if (estado.hls) { estado.hls.destroy(); estado.hls = null; }

        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            estado.hls = new Hls({
                maxBufferLength: 30, 
                maxMaxBufferLength: 60,
                maxBufferSize: 60 * 1000 * 1000,
                backBufferLength: 30,
                enableWorker: true,
                lowLatencyMode: false, 
                liveDurationInfinity: true,
                manifestLoadingTimeOut: 15000,
                manifestLoadingMaxRetry: 0,
                levelLoadingTimeOut: 15000,
                fragLoadingTimeOut: 30000,
                xhrSetup: tentativa.xhrProxy
                    ? function(xhr, url) {
                        if (url.startsWith('/proxy') || url.startsWith('/hls-ts') || url.includes('localhost')) return;
                        xhr.open('GET', PROXY_LOCAL + encodeURIComponent(url), true);
                      }
                    : undefined
            });

            estado.hls.loadSource(urlSource);
            estado.hls.attachMedia(elementos.player);

            estado.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                console.log(`[NexusTV] ✅ Funcionou! (${tentativa.label})`);
                esconderTodasTelas();
                elementos.player.muted = false;
                elementos.player.play().catch(e => {
                    console.warn('[NexusTV] Autoplay bloqueado, tentando com mudo:', e.message);
                    elementos.player.muted = true;
                    elementos.player.play().catch(() => {});
                });
                atualizarIconeVolume();
            });

            estado.hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    console.warn(`[NexusTV] ❌ (${tentativa.label}): ${data.details}`);
                    estado.hls.destroy();
                    estado.hls = null;
                    setTimeout(tentarProximaUrl, 200);
                }
            });

        } else if (elementos.player.canPlayType('application/vnd.apple.mpegurl')) {
            elementos.player.src = urlSource;
            elementos.player.addEventListener('loadedmetadata', () => {
                esconderTodasTelas(); elementos.player.play();
            }, { once: true });
            elementos.player.addEventListener('error', () => tentarProximaUrl(), { once: true });
        } else {
            reproduzirDireto(urlOriginal);
        }
    }

    const usarHls = isHLS || isXtreamLive;

    // Adicionar entrada para HLS explícito (.m3u8) na cascata se ainda não estiver lá
    if (isHLS && !isXtreamLive && cascata === null) {
        // HLS direto — no HTTPS sempre vai pelo proxy primeiro para evitar Mixed Content
        const paginaSegura = location.protocol === 'https:';
        const streamInseguro = urlOriginal.startsWith('http://');
        const evitarDireto = paginaSegura && streamInseguro;

        const hlsCascata = evitarDireto
            ? [
                { url: urlOriginal, proxy: true,  xhrProxy: true,  label: 'proxy .m3u8' },
              ]
            : [
                { url: urlOriginal, proxy: true,  xhrProxy: true,  label: 'proxy .m3u8' },
                { url: urlOriginal, proxy: false, xhrProxy: false, label: 'direto .m3u8' },
              ];
        // Usar cascata manual
        let idx = 0;
        function tentarHls() {
            if (idx >= hlsCascata.length) {
                mostrarErro('Canal indisponível ou sem sinal.');
                return;
            }
            const t = hlsCascata[idx++];
            const src = t.proxy ? PROXY_LOCAL + encodeURIComponent(t.url) : t.url;
            if (estado.hls) { estado.hls.destroy(); estado.hls = null; }
            if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                console.log(`[NexusTV] ▶ HLS (${t.label}):`, t.url);
                estado.hls = new Hls({
                    maxBufferLength: 30,
                    maxMaxBufferLength: 60,
                    maxBufferSize: 60 * 1000 * 1000,
                    backBufferLength: 30,
                    enableWorker: true,
                    manifestLoadingMaxRetry: 0,
                    xhrSetup: t.xhrProxy ? function(xhr, url) {
                        if (url.startsWith('/') || url.includes('localhost') || url.includes('127.0.0.1')) return;
                        xhr.open('GET', PROXY_LOCAL + encodeURIComponent(url), true);
                    } : undefined
                });
                estado.hls.loadSource(src);
                estado.hls.attachMedia(elementos.player);
                estado.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    console.log(`[NexusTV] ✅ HLS ok (${t.label})`);
                    esconderTodasTelas();
                    elementos.player.muted = false;
                    elementos.player.play().catch(e => {
                        console.warn('[NexusTV] Autoplay bloqueado, tentando com mudo:', e.message);
                        elementos.player.muted = true;
                        elementos.player.play().catch(() => {});
                    });
                    atualizarIconeVolume();
                });
                estado.hls.on(Hls.Events.ERROR, (event, data) => {
                    if (data.fatal) {
                        console.warn(`[NexusTV] ❌ HLS (${t.label}):`, data.details);
                        estado.hls.destroy(); estado.hls = null;
                        setTimeout(tentarHls, 200);
                    }
                });
            } else if (elementos.player.canPlayType('application/vnd.apple.mpegurl')) {
                elementos.player.src = src;
                elementos.player.addEventListener('loadedmetadata', () => { esconderTodasTelas(); elementos.player.play(); }, { once: true });
                elementos.player.addEventListener('error', () => tentarHls(), { once: true });
            } else {
                reproduzirDireto(urlOriginal);
            }
        }
        tentarHls();
        return;
    }

    if (usarHls) {
        if (isXtreamLive) {
            tentarProximaUrl(); // cascata automática de 5 tentativas
            return;
        }

        // ── HLS.js para .m3u8 explícito (VOD, streams normais) ──────────────
        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            const urlProxy = PROXY_LOCAL + encodeURIComponent(urlOriginal);
            console.log('[NexusTV] ▶ HLS direto:', urlOriginal);

            estado.hls = new Hls({
                maxBufferLength: 30,
                maxMaxBufferLength: 60,
                maxBufferSize: 60 * 1000 * 1000,
                backBufferLength: 30,
                enableWorker: true,
                xhrSetup: function(xhr, url) {
                    if (url.startsWith('/') || url.includes('localhost') || url.includes('127.0.0.1')) return;
                    xhr.open('GET', PROXY_LOCAL + encodeURIComponent(url), true);
                }
            });

            estado.hls.loadSource(urlProxy);
            estado.hls.attachMedia(elementos.player);

            estado.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                esconderTodasTelas();
                elementos.player.muted = false;
                elementos.player.play().catch(e => {
                    console.warn('[NexusTV] Autoplay bloqueado, tentando com mudo:', e.message);
                    elementos.player.muted = true;
                    elementos.player.play().catch(() => {});
                });
                atualizarIconeVolume();
            });

            let tentativas = 0;
            estado.hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    tentativas++;
                    if (tentativas > 3) {
                        mostrarErro('Canal indisponível ou sem sinal.');
                        return;
                    }
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            setTimeout(() => estado.hls && estado.hls.startLoad(), 1200);
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            estado.hls.recoverMediaError();
                            break;
                        default:
                            mostrarErro('Erro ao reproduzir o canal.');
                    }
                }
            });

        // ── Safari HLS nativo ────────────────────────────────────────────────
        } else if (elementos.player.canPlayType('application/vnd.apple.mpegurl')) {
            const urlProxy = PROXY_LOCAL + encodeURIComponent(urlOriginal);
            elementos.player.src = urlProxy;
            elementos.player.addEventListener('loadedmetadata', () => {
                esconderTodasTelas();
                elementos.player.play();
            }, { once: true });
            elementos.player.addEventListener('error', () => {
                mostrarErro('Erro ao reproduzir no Safari.');
            }, { once: true });
        } else {
            reproduzirDireto(urlOriginal);
        }

    // ── MP4 / Direto ─────────────────────────────────────────────────────────
    } else {
        reproduzirDireto(urlOriginal);
    }
}

// Garante que uma URL seja envolvida pelo proxy SEM duplicar
function proxyUrl(url) {
    // Se já é uma URL de proxy local, não encapsula de novo
    if (url.startsWith('/proxy?url=') || url.startsWith('/hls-ts?')) {
        return url;
    }
    return PROXY_LOCAL + encodeURIComponent(url);
}

// Reproduz VOD (filmes/series) com cascata: HLS.js → player nativo
function reproduzirVOD(url) {
    const urlProxy = proxyUrl(url);
    console.log('[NexusTV] 🎬 VOD via proxy:', url);

    // Tentativa 1: HLS.js (muitos VOD Xtream são HLS disfarçado)
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        if (estado.hls) { estado.hls.destroy(); estado.hls = null; }
        estado.hls = new Hls({
            maxBufferLength: 30,
            maxMaxBufferLength: 120,
            maxBufferSize: 60 * 1000 * 1000,
            backBufferLength: 30,
            enableWorker: true,
            manifestLoadingMaxRetry: 1,
            xhrSetup: function(xhr, xhrUrl) {
                if (xhrUrl.startsWith('/') || xhrUrl.includes('localhost') || xhrUrl.includes('127.0.0.1')) return;
                xhr.open('GET', PROXY_LOCAL + encodeURIComponent(xhrUrl), true);
            }
        });
        estado.hls.loadSource(urlProxy);
        estado.hls.attachMedia(elementos.player);

        estado.hls.on(Hls.Events.MANIFEST_PARSED, () => {
            console.log('[NexusTV] ✅ VOD HLS ok');
            esconderTodasTelas();
            elementos.player.muted = false;
            elementos.player.play().catch(e => {
                elementos.player.muted = true;
                elementos.player.play().catch(() => {});
            });
            atualizarIconeVolume();
        });

        estado.hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                console.warn('[NexusTV] ❌ VOD HLS falhou, tentando player nativo:', data.details);
                estado.hls.destroy();
                estado.hls = null;
                // Fallback: player nativo
                reproduzirDireto(url);
            }
        });
        return;
    }

    // Sem HLS.js: vai direto para player nativo
    reproduzirDireto(url);
}

// Reproduz uma URL diretamente via proxy (MP4, TS como último recurso, etc.)
function reproduzirDireto(url) {
    const urlProxy = proxyUrl(url);
    const urlHttps = url.startsWith('http://') ? url.replace('http://', 'https://').replace(/:80\//, '/').replace(/:80$/, '') : url;
    
    // Fila de tentativas para reprodução direta (o erro 502 no Railway será contornado pela tentativa Direta)
    const tentativas = [
        { src: urlProxy, label: 'Proxy Interno (Railway)' },
        { src: 'https://corsproxy.io/?' + encodeURIComponent(url), label: 'CORS Proxy Público 1' },
        { src: 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url), label: 'CORS Proxy Público 2' },
        { src: url, label: 'Direto Original (Navegador)' }
    ];
    
    // Se era http, injetamos uma tentativa forçada de HTTPS no final (em caso de bloqueio Mixed Content e 403 do Provider)
    if (url !== urlHttps) {
        tentativas.push({ src: urlHttps, label: 'Direto Forçado HTTPS' });
    }

    let indice = 0;

    function tentarProximo() {
        if (indice >= tentativas.length) {
            console.error('[NexusTV] Erro: Todas as rotas de reprodução falharam para a midia.', url);
            mostrarErro('Canal/Filme incompatível ou bloqueado pelo servidor. Tente outro canal.');
            return;
        }

        const atual = tentativas[indice];
        console.log(`[NexusTV] 📹 Tentando reproduzir (${indice+1}/${tentativas.length}): ${atual.label}`);
        
        elementos.player.src = atual.src;
        elementos.player.load();

        const aoFalhar = (e) => {
            console.warn(`[NexusTV] ⚠️ Falhou tentativa direta [${atual.label}]`);
            limparListeners();
            indice++;
            tentarProximo();
        };

        const aoSucesso = () => {
            console.log(`[NexusTV] ✅ Reprodução iniciada via [${atual.label}]`);
            esconderTodasTelas();
            limparListeners();
            elementos.player.play().catch(() => {});
        };

        function limparListeners() {
            elementos.player.removeEventListener('error', aoFalhar);
            elementos.player.removeEventListener('loadedmetadata', aoSucesso);
        }

        elementos.player.addEventListener('error', aoFalhar, { once: true });
        elementos.player.addEventListener('loadedmetadata', aoSucesso, { once: true });
    }

    tentarProximo();
}

// Reconfigura eventos do player após clonar o elemento
function reconfigurarEventosPlayer() {
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
        // Silencioso aqui — tratado no reproduzirCanal
    });
}

function filtrarCanais() {
    const termo = elementos.buscaCanal.value.toLowerCase();
    // Busca dentro da categoria/subcategoria ativa (não do total de canais)
    const base = estado.canaisCategoria.length > 0 ? estado.canaisCategoria : estado.canais;
    estado.canaisFiltrados = base.filter(canal =>
        canal.nome.toLowerCase().includes(termo) ||
        canal.grupo.toLowerCase().includes(termo)
    );
    renderizarCanais();
}

// Retorna a categoria principal de um canal baseado no grupo e URL
function obterCategoriaCanal(canal) {
    const grupo = canal.grupo.toLowerCase();
    const url   = (canal.url || '').toLowerCase();
    if (/\/movie\//i.test(url) || /filme|filmes|movie|movies|cinema|lанçament|lancament|comédia|comedia|ção|acao|drama|terror|horror|thriller|suspense|aventura|romance|docum|biogr/i.test(grupo)) return 'filmes';
    if (/\/series?\//i.test(url) || /série|serie|temporada|season|episód|episod|novela/i.test(grupo)) return 'series';
    if (/esporte|sport|futebol|basquete|tênes|tenis|vôlei|volei|nba|ufc|formula|f1|olimp|natac|swim/i.test(grupo)) return 'esportes';
    if (/infant|kids|criança|crianc|cartoon|disney|animac|animaç/i.test(grupo)) return 'infantil';
    return 'canais';
}

function filtrarPorCategoria(categoria) {
    estado.categoriaAtiva = categoria;
    estado.subCategoriaAtiva = null;

    // Esconde sub-categorias por padrão
    elementos.subCategoriasWrapper.classList.add('oculto');

    if (categoria === 'todos') {
        estado.canaisCategoria = [...estado.canais];
    } else {
        estado.canaisCategoria = estado.canais.filter(c => obterCategoriaCanal(c) === categoria);
    }

    estado.canaisFiltrados = [...estado.canaisCategoria];
    renderizarCanais();

    // Mostrar sub-categorias para Filmes e Séries
    if (categoria === 'filmes' || categoria === 'series') {
        mostrarSubCategorias(estado.canaisCategoria);
    }
}

function mostrarSubCategorias(canaisDaCategoria) {
    // Contar ocorrências de cada grupo
    const contagem = {};
    canaisDaCategoria.forEach(c => {
        contagem[c.grupo] = (contagem[c.grupo] || 0) + 1;
    });

    // Ordenar por quantidade (mais canais primeiro)
    const grupos = Object.entries(contagem)
        .sort((a, b) => b[1] - a[1])
        .map(([g]) => g);

    if (grupos.length === 0) return;

    // Renderizar botões
    elementos.subCategoriaLista.innerHTML = [
        // Botão "Todos" da subcategoria
        `<button class="sub-cat-btn ativo" data-grupo="__todos__" onclick="filtrarPorSubCategoria('__todos__', this)">
            <i class="fas fa-th-large"></i> Todos (${canaisDaCategoria.length})
        </button>`,
        ...grupos.map(g =>
            `<button class="sub-cat-btn" data-grupo="${g.replace(/"/g,'&quot;')}" onclick="filtrarPorSubCategoria('${g.replace(/'/g,"\\'")}', this)">
                ${g} <span style="opacity:.55;font-size:.68rem">(${contagem[g]})</span>
            </button>`
        )
    ].join('');

    elementos.subCategoriasWrapper.classList.remove('oculto');
}

function filtrarPorSubCategoria(grupo, btn) {
    estado.subCategoriaAtiva = grupo === '__todos__' ? null : grupo;

    // Atualizar classe ativo nos botões
    elementos.subCategoriaLista.querySelectorAll('.sub-cat-btn').forEach(b => b.classList.remove('ativo'));
    btn.classList.add('ativo');

    if (grupo === '__todos__') {
        estado.canaisFiltrados = [...estado.canaisCategoria];
    } else {
        estado.canaisFiltrados = estado.canaisCategoria.filter(c => c.grupo === grupo);
    }

    renderizarCanais();
    // Limpar busca ao mudar subcategoria
    elementos.buscaCanal.value = '';
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
    // Se desmutou e volume estava em 0, restaurar para 100%
    if (!elementos.player.muted && elementos.player.volume === 0) {
        elementos.player.volume = 1;
    }
    elementos.controleVolume.value = elementos.player.muted ? 0 : Math.round(elementos.player.volume * 100);
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
    
    const indiceAtual = estado.canaisFiltrados.indexOf(estado.canalAtual);
    const proximoIndice = (indiceAtual + 1) % estado.canaisFiltrados.length;
    const prox = estado.canaisFiltrados[proximoIndice];
    
    _selecionarCanalObj(prox, prox.id);
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