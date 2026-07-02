type Level = 'debug' | 'info' | 'warn' | 'error';

const emit = (level: Level, message: string, ...args: unknown[]) => {
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}`;
    switch (level) {
        case 'error':
            console.error(line, ...args);
            break;
        case 'warn':
            console.warn(line, ...args);
            break;
        default:
            console.log(line, ...args);
    }
};

export const logger = {
    debug: (message: string, ...args: unknown[]) => emit('debug', message, ...args),
    info: (message: string, ...args: unknown[]) => emit('info', message, ...args),
    warn: (message: string, ...args: unknown[]) => emit('warn', message, ...args),
    error: (message: string, ...args: unknown[]) => emit('error', message, ...args),
};
