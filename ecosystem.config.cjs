/**
 * PM2 конфигурация для VK бота
 * 
 * Установка PM2:
 * npm install -g pm2
 * 
 * Запуск:
 * pm2 start ecosystem.config.js
 * 
 * Другие команды:
 * pm2 logs vk-bot     - логи в реальном времени
 * pm2 restart vk-bot  - перезапуск
 * pm2 stop vk-bot     - остановка
 * pm2 delete vk-bot   - удаление
 * pm2 save            - сохранить список процессов
 * pm2 startup         - автозапуск при перезагрузке сервера
 */

module.exports = {
  apps: [
    {
      name: 'vk-bot',
      script: './scripts/long-polling.cjs',
      
      // Автоматический рестарт при сбоях
      autorestart: true,
      
      // Максимум 10 рестартов за 1 минуту
      max_restarts: 10,
      min_uptime: '10s',
      
      // Логи
      error_file: './logs/vk-bot-error.log',
      out_file: './logs/vk-bot-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Окружение
      env: {
        NODE_ENV: 'production',
      },
      
      // Таймаут для graceful shutdown
      kill_timeout: 5000,
    },
  ],
};
