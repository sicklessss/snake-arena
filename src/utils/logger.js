const { LOG_LEVEL } = require('../config/constants');

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const log = {
    debug: (...args) => LOG_LEVELS[LOG_LEVEL] <= 0 && console.log('[DEBUG]', ...args),
    info: (...args) => LOG_LEVELS[LOG_LEVEL] <= 1 && console.log('[INFO]', ...args),
    warn: (...args) => LOG_LEVELS[LOG_LEVEL] <= 2 && console.warn('[WARN]', ...args),
    error: (...args) => LOG_LEVELS[LOG_LEVEL] <= 3 && console.error('[ERROR]', ...args),
    important: (...args) => console.log('🔔', ...args),
};

module.exports = log;
