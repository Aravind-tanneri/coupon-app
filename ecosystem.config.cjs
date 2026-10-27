module.exports = {
  apps: [
    {
      name: "campus-mess-api",
      cwd: "./backend",
      script: "dist/server.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        PROCESS_ROLE: "web",
      },
    },
    {
      name: "campus-mess-worker",
      cwd: "./backend",
      script: "dist/worker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        PROCESS_ROLE: "worker",
      },
    },
  ],
};
