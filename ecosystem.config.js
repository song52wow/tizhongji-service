{
  "apps": [
    {
      "name": "tizhongji-api",
      "script": "dist/server.js",
      "instances": 1,
      "exec_mode": "cluster",
      "wait_ready": true,
      "listen_timeout": 10000,
      "kill_timeout": 5000,
      "env": {
        "NODE_ENV": "production",
        "PORT": "3000"
      },
      "env_production": {
        "NODE_ENV": "production",
        "PORT": "3000",
        "AUTH_SECRET": "${AUTH_SECRET}",
        "ALLOWED_ORIGINS": "${ALLOWED_ORIGINS}",
        "LOG_LEVEL": "info",
        "RATE_LIMIT_WINDOW_MS": "60000",
        "RATE_LIMIT_MAX": "100",
        "DB_PATH": "./notifications.db"
      },
      "error_file": "./logs/error.log",
      "out_file": "./logs/out.log",
      "time": true,
      "max_memory_restart": "512M",
      "restart_delay": 1000
    }
  ]
}
