#!/bin/bash
DOMAIN="tv064.shop"
IP="187.127.10.60"

echo "============================================="
echo "   CONFIGURANDO DOMÍNIO $DOMAIN NO NGINX     "
echo "============================================="

# 1. Instalar Nginx
echo "[+] Instalando o Nginx..."
sudo apt install nginx -y

# 2. Criar arquivo de configuração do proxy reverso
echo "[+] Criando regras de direcionamento da porta 80 para a 3000..."
cat > /etc/nginx/sites-available/$DOMAIN <<EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        
        # Para repassar os IPs reais dos clientes (necessário para logs/bans do admin)
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
EOF

# 3. Ativar a configuração
echo "[+] Ativando o site..."
sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# 4. Testar e reiniciar
sudo nginx -t
sudo systemctl restart nginx

echo "============================================="
echo " DOMÍNIO CONFIGURADO COM SUCESSO NO SERVIDOR "
echo "============================================="
echo "Agora você pode acessar http://$DOMAIN    "
echo "Aguarde de 5 a 20 minutos para a alteração do DNS (que você fez no painel da Hostinger) se espalhar pela internet."
