module.exports = {
  apps: [
    {
      // Arranca via wrapper: carga el .env de la raiz y sincroniza el admin.
      name: "pinos-web",
      script: "scripts/start-web.mjs",
      cwd: __dirname,
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production", PORT: 3515, HOSTNAME: "0.0.0.0" },
      max_memory_restart: "700M",
      autorestart: true,
      time: true,
    },
    {
      name: "pinos-worker",
      script: "scripts/worker.mjs",
      cwd: __dirname,
      interpreter: "node",
      exec_mode: "fork",
      node_args: "--env-file-if-exists=.env",
      instances: 1,
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: "250M",
      time: true,
    },
  ],
};
