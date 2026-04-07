#!/bin/bash

# =============================================================
# SCRIPT DE ATUALIZAÇÃO AUTOMÁTICA (GIT -> VPS)
# NEXUS TV - 064 IPTV
# =============================================================

echo "================================================="
echo "   INICIANDO ATUALIZAÇÃO DO SISTEMA NEXUS TV     "
echo "================================================="

# 1. Puxando as últimas alterações do GitHub
echo "[+] Sincronizando com o repositório GitHub..."
git pull origin main

# 2. Instalando novas dependências se houver
if [ -f "package.json" ]; then
    echo "[+] Verificando novas dependências (npm install)..."
    npm install --omit=dev
fi

# 3. Reiniciando o serviço no PM2
echo "[+] Reiniciando o servidor IPTV no PM2..."
# Tenta encontrar o processo por nome ou reinicia tudo
pm2 restart nexus || pm2 restart server || pm2 restart all

echo "================================================="
echo "        ATUALIZAÇÃO CONCLUÍDA COM SUCESSO!       "
echo "================================================="
pm2 status
