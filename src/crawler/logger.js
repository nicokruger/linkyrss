// logger.js
const winston = require('winston');
const path = require('path');
const DailyRotateFile = require('winston-daily-rotate-file');

const createLogger = (module) => {
    const filename = path.basename(module.filename);

    const logFormat = winston.format.printf(({ level, message, timestamp, label }) => {
        return `[${timestamp}] ${label} [${level}] ${message}`;
    });

    const logger = winston.createLogger({
        level: 'info',
        format: winston.format.combine(
            winston.format.label({ label: filename }),
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            logFormat
        ),
        transports: [
            new winston.transports.Console(),
            new DailyRotateFile({
                filename: 'logs/%DATE%.log',
                datePattern: 'YYYY-MM-DD',
                zippedArchive: true,
                maxSize: '20m',
                maxFiles: '7d' // keep logs for 7 days
            })
        ],
    });

    return logger;
}

module.exports = createLogger;

