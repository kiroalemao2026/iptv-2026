# Reprodutor IPTV

Reprodutor de lista IPTV em português com interface moderna.

## Como Usar

### Método 1: Com Servidor Local (Recomendado para URLs)

1. Tenha Node.js instalado (baixe em nodejs.org)
2. Dê dois cliques em `iniciar.bat` ou execute no terminal:
   ```
   node server.js
   ```
3. Abra o navegador em: `http://localhost:3000`
4. Adicione sua lista IPTV por URL

### Método 2: Arquivo Local (Sem servidor)

1. Abra `index.html` diretamente no navegador
2. Clique em "Adicionar Lista"
3. Faça upload do arquivo `.m3u` ou `.m3u8`

## Funcionalidades

- Reprodução de canais ao vivo
- Suporte a listas M3U/M3U8
- Categorias (Canais, Filmes, Séries, Esportes, Infantil)
- Busca de canais
- Sistema de favoritos
- Tela cheia
- Captura de tela
- Atalhos de teclado

## Atalhos de Teclado

| Tecla | Ação |
|-------|------|
| Espaço | Pausar/Reproduzir |
| ← → | Voltar/Avançar 10s |
| ↑ ↓ | Volume |
| M | Silenciar |
| F | Tela cheia |
| N | Próximo canal |

## Arquivos

- `index.html` - Interface principal
- `estilos.css` - Estilos CSS
- `app.js` - Lógica do aplicativo
- `server.js` - Servidor proxy local
- `iniciar.bat` - Iniciador para Windows
