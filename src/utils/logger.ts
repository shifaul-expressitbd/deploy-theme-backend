import chalk from "chalk";
import { TransformableInfo } from "logform";
import { createLogger, format, Logger, transports } from "winston";

// Extend the Logger interface
interface ExtendedLogger extends Logger {
  success: (message: string, meta?: any) => void;
}

const logLevels = {
  error: 0,
  warn: 1,
  success: 2,
  info: 3,
  debug: 4
};

const logColors = {
  error: chalk.red,
  warn: chalk.yellow,
  success: chalk.green,
  info: chalk.cyan,
  debug: chalk.magenta,
  timestamp: chalk.gray
};

const consoleFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.printf((info: TransformableInfo) => {
    const { timestamp, level, message, ...meta } = info;
    const color = logColors[level as keyof typeof logColors] || chalk.white;
    
    let logMessage = `${logColors.timestamp(`[${timestamp}]`)} `;
    logMessage += `${color(`[${level.toUpperCase()}]`)} `;
    logMessage += `${chalk.white(`[${process.pid}]`)} ${message}`;
    
    if (Object.keys(meta).length > 0) {
      logMessage += `\n${JSON.stringify(meta, null, 2)}`;
    }
    
    return logMessage;
  })
);

const fileFormat = format.combine(
  format.timestamp(),
  format.json()
);

const logger: ExtendedLogger = createLogger({
  levels: logLevels,
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  transports: [
    new transports.Console({
      format: consoleFormat
    }),
    new transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: fileFormat,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3
    }),
    new transports.File({
      filename: 'logs/combined.log',
      format: fileFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5
    })
  ],
  exceptionHandlers: [
    new transports.File({ 
      filename: 'logs/exceptions.log',
      format: fileFormat
    })
  ]
}) as ExtendedLogger;

// Add custom 'success' method
logger.success = (message: string, meta?: any) => {
  logger.log('success', message, meta);
};

export default logger;