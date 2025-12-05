# Shop Chat Agent – Complete Deployment & Server Setup Guide

## Overview
This guide explains how to deploy and set up the Shop Chat Agent AI project on a fresh Ubuntu server, including all steps for Node.js, Apache (LAMP), environment variables, and Shopify integration.

---

## 1. Prepare the Server
- Start with a clean Ubuntu 24.04 server.
- Make sure you have root or sudo access.

## 2. Update the System
```bash
sudo apt update && sudo apt upgrade -y
```

## 3. Install LAMP Stack
```bash
sudo apt install -y apache2 mysql-server php libapache2-mod-php
```

## 4. Install Node.js
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # Should show v20.x.x
npm --version    # Should show 10.x.x or higher
```

## 5. Install Git
```bash
sudo apt install -y git
```

## 6. Clone the Project
```bash
mkdir -p /opt/shop-chat-agent
cd /opt/shop-chat-agent
git clone https://github.com/Shopify/shop-chat-agent.git .
```

## 7. Install Project Dependencies
```bash
npm install
npm install -w extensions/chat-bubble
```

## 8. Set Up the Database
```bash
npx prisma generate
npx prisma migrate deploy
```

## 9. Create Environment File
Create a file named `.env` in `/opt/shop-chat-agent` and add:
```
SHOPIFY_API_KEY=your_shopify_api_key
SHOPIFY_API_SECRET=your_shopify_api_secret
ANTHROPIC_API_KEY=your_anthropic_api_key
SESSION_SECRET=your_random_secret
SHOPIFY_APP_URL=https://subdomain.yourdomain.com
DATABASE_URL=file:./dev.sqlite
NODE_ENV=production
```
(SESSION_SECRET:
Generate a random string for security.

Run this command on your server:
```bash
openssl rand -hex 32
```
Paste the output as your session secret.
DATABASE_URL:
For SQLite, use:

This is already set for local development.
For production with PostgreSQL/MySQL, you’ll need a different connection string.
NODE_ENV:
Set to production for live deployments.)


## 10. Build the Application
```bash
npm run build
```

## 11. Start the Application
```bash
npm start
```
*(Or use PM2 for auto-restart: `sudo npm install -g pm2` then `pm2 start npm --name "shop-chat-agent" -- start`)*

## 12. Configure Apache as a Reverse Proxy
Enable required modules:
```bash
sudo a2enmod proxy proxy_http proxy_wstunnel rewrite ssl
sudo systemctl restart apache2
```
Create a new Apache config for your subdomain:
```bash
sudo nano /etc/apache2/sites-available/shop-chat-agent.conf
```
Add this (replace with your subdomain and domain):
```
<VirtualHost *:80>
    ServerName subdomain.yourdomain.com

    ProxyPreserveHost On
    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/

    ErrorLog ${APACHE_LOG_DIR}/shop-chat-agent-error.log
    CustomLog ${APACHE_LOG_DIR}/shop-chat-agent-access.log combined
</VirtualHost>
```
Enable the site and reload Apache:
```bash
sudo a2ensite shop-chat-agent.conf
sudo systemctl reload apache2
```

## 13. Set Up Subdomain DNS
- Point your subdomain (e.g., subdomain.yourdomain.com) to your server’s IP address.

## 14. Secure with SSL (Let’s Encrypt)
```bash
sudo apt install -y certbot python3-certbot-apache
sudo certbot --apache -d subdomain.yourdomain.com
```

## 15. Final Checks
- Visit `https://subdomain.yourdomain.com` in your browser.
- The chat agent should load and work.

---

## Shopify & .env Settings Explained (Project Enviroment)
- `.env` stores secret keys and settings for your app.
- You must create a Shopify app in your Partner dashboard and copy the API key/secret into `.env`.
- Set your app’s URL and redirect URLs to match your server/subdomain.
- If you’re stuck, ask your me for help with these settings.

---

## Troubleshooting
| Issue | Solution |
|-------|----------|
| App won’t start | Check logs: `pm2 logs shop-chat-agent` |
| 502 Bad Gateway | Verify port 3000 is running: `lsof -i :3000` |
| SSL certificate error | Check expiry: `sudo certbot certificates` |
| Database connection fails | Verify `.env` DATABASE_URL is correct |
| Nginx/Apache not proxying | Test config: `sudo apache2ctl configtest` |

---

## Need Help?
If you need help, ask me.
