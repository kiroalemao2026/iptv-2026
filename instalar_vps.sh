#!/bin/bash

echo "============================================="
echo "        INICIANDO CONFIGURAÇÃO DA VPS        "
echo "               NEXUS TV E BOTS               "
echo "============================================="

# 1. Atualizando pacotes
echo "[+] Atualizando o sistema..."
sudo apt update && sudo apt upgrade -y

# 2. Instalando Node.js (Versão 20 LTS = mais estável)
echo "[+] Instalando Node.js 20 LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Instalando ferramentas de compilação (necessárias para alguns bots como canvas, bcrypt e bibliotecas do sqlite3)
echo "[+] Instalando ferramentas base..."
sudo apt install build-essential python3 make g++ -y

# 4. Configurando o PM2 para gerenciar os processos e não deixá-los cair
echo "[+] Instalando PM2..."
sudo npm install pm2 -g

# 5. Configurando o Firewall básico (UFW)
echo "[+] Configurando portas no Firewall..."
# Se não estiver ativado, ativa depois
sudo ufw allow 22/tcp   # SSH (NÃO PODE FALTAR SE NÃO VOCÊ PERDE ACESSO!)
sudo ufw allow 80/tcp   # Porta padrão da Web HTTP
sudo ufw allow 443/tcp  # Porta padrão da Web HTTPS
sudo ufw allow 3000/tcp # Porta padrão do Node.js (se for usar sem proxy reverso)

# 6. Dando permissão e salvando startup do PM2
echo "[+] Configurando PM2 para iniciar com a máquina..."
pm2 startup ubuntu -u root --hp /root
pm2 save

echo "============================================="
echo "   CONFIGURAÇÃO BASE CONCLUÍDA COM SUCESSO!  "
echo "============================================="
echo ""
echo "Versão do Node instalada:"
node -v
echo ""
echo "Agora você já pode rodar: npm install na pasta do seu projeto"
echo "E depois iniciar tudo usando: pm2 start server.js --name nexus"
