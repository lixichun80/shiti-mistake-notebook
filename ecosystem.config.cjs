// 密钥一律不写在这里。DeepSeek API Key 存放于同目录的 .dev.vars（权限 600），
// 由 wrangler 的 --env-file 在启动时加载。本文件只保留非敏感的进程运行参数。
//
// 应用通过 `wrangler dev --local` 运行：Miniflare 在本地模拟 D1 与 R2，
// 数据持久化在 /opt/shiti-mistake-notebook/.wrangler/state，不需要 Cloudflare 账号。
module.exports = {
  apps: [{
    name: 'shiti-notebook',
    script: '/root/.nvm/versions/node/v24.18.0/bin/node',
    interpreter: 'none',
    args: [
      '--import', './scripts/sites-env.mjs',
      './node_modules/wrangler/bin/wrangler.js', 'dev',
      '--config', 'dist/server/wrangler.json',
      '--local',
      '--persist-to', '.wrangler/state',
      '--ip', '127.0.0.1',
      '--port', '3105',
      '--inspector-port', '0',
      '--env-file', '/opt/shiti-mistake-notebook/.dev.vars',
    ].join(' '),
    cwd: '/opt/shiti-mistake-notebook',
    env: {
      NODE_ENV: 'production',
      TZ: 'Asia/Shanghai',
      PATH: '/root/.nvm/versions/node/v24.18.0/bin:' + process.env.PATH,
    },
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '1G',
  }],
};
