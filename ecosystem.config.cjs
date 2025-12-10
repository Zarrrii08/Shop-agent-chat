module.exports = {
  apps: [
    {
      name: "shop-chat-agent",
      script: "npm",
      args: "start",
      cwd: "/opt/Shop-agent-chat",
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: 3000
      },
      env_production: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: 3000
      }
    }
  ]
};
