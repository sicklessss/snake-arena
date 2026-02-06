module.exports = {
  apps: [
    // --- Game Servers (Arenas) ---
    {
      name: "Arena-1",
      script: "./server.js",
      env: { PORT: 3000 }
    },
    {
      name: "Arena-2",
      script: "./server.js",
      env: { PORT: 3001 }
    },
    {
      name: "Arena-3",
      script: "./server.js",
      env: { PORT: 3002 }
    },
    {
      name: "Arena-4",
      script: "./server.js",
      env: { PORT: 3003 }
    },
    {
      name: "Arena-5",
      script: "./server.js",
      env: { PORT: 3004 }
    }
  ]
};
