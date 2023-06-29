// logger.js
const winston = require('winston');
const path = require('path');
const util = require('util');
const DailyRotateFile = require('winston-daily-rotate-file');

//https://github.com/winstonjs/winston/issues/1427
const enumerateErrorFormat = winston.format(info => {
    if (info.message instanceof Error) {
      info.message = Object.assign({
        message: info.message.message,
        stack: info.message.stack
      }, info.message);
    }

    if (info instanceof Error) {
      return Object.assign({
        message: info.message,
        stack: info.stack
      }, info);
    }

    return info;
});

const plsFormat = {
            transform: (info) => {
                const args = [info.message, ...(info[Symbol.for('splat')] || [])];
                info.message = args;

                const msg = args.map(arg => {
                    if (typeof arg == 'object')
                        return util.inspect(arg, {compact: true, depth: Infinity});
                    return arg;
                }).join(' ');

                info[Symbol.for('message')] = `${info[Symbol.for('level')]}: ${msg}${info.stack ? ' ' + info.stack : ''}`;

                return info;
            }
        }
const createLogger = (module) => {
    const filename = path.basename(module.filename);

    const logFormat = winston.format.printf(({ timestamp, label, level, message, splat, ...rest }) => {
        return `[${timestamp}] ${label} [${level}] ${message}`;
    });

    const logger = winston.createLogger({
        level: 'info',
        format: winston.format.combine(
            winston.format.label({ label: filename }),
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            plsFormat,
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

