import type { TransformableInfo } from "logform";
import { createLogger, format, transports } from "winston";

const logger = createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  format: format.combine(
    format.timestamp(),
    format.colorize(),
    format.metadata(),
    format.printf((info: TransformableInfo) => {
      const meta =
        info.metadata && Object.keys(info.metadata).length ? `\n${JSON.stringify(info.metadata, null, 2)}` : "";
      return `${info.timestamp} [${info.level}] [${process.pid}] ${info.message}${meta}`;
    })
  ),
  transports: [
    new transports.Console(),
    new transports.File({
      filename: "logs/error.log",
      level: "error",
      format: format.uncolorize(),
    }),
    new transports.File({
      filename: "logs/combined.log",
      format: format.uncolorize(),
    }),
  ],
});

export default logger;
