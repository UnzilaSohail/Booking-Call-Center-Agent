// pm2 process file (Jira 31, 27l). Replaces typing flags by hand on every restart:
//   pm2 start ecosystem.config.cjs      first time
//   pm2 reload ecosystem.config.cjs --update-env     after every deploy (or: pm2 restart booking-backend --update-env)
//   pm2 save                           remember the list across a server reboot (and once: pm2 startup)
// Secrets and settings such as MAX_CONCURRENT_CALLS stay in the backend's .env, the single place to change them.
// Do NOT switch the backend to cluster mode / several instances (docs/CONCURRENCY.md): the live-call counter and the
// reminder, billing and calendar workers all assume ONE process.
module.exports = {
  apps: [
    {
      name: 'booking-backend',
      script: 'src/server.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      kill_timeout: 660000, // wait up to 11 minutes for live calls to finish before a restart kills the process (DRAIN_TIMEOUT_MS is 10)
      max_memory_restart: '800M',
      restart_delay: 2000,
      max_restarts: 20,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'booking-dashboard',
      script: 'npm',
      args: 'start',
      cwd: `${__dirname}/dashboard`, // run `npm ci && npm run build` here before (re)starting
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '600M',
      env: { NODE_ENV: 'production', PORT: 3002 },
    },
  ],
};
