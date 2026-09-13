/*
 * Copyright 2021 WPPConnect Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import winston from 'winston';

function boliviaTimestamp(): string {
  return new Date().toLocaleString('es-BO', {
    timeZone: 'America/La_Paz',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

// Use JSON logging for log files
// Here winston.format.errors() just seem to work
// because there is no winston.format.simple()
const jsonLogFileFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  winston.format.timestamp({ format: boliviaTimestamp }),
  winston.format.prettyPrint()
);

export function createLogger(options: any) {
  const log_level = options.level;
  // Create file loggers
  const logger = winston.createLogger({
    level: 'debug',
    format: jsonLogFileFormat,
  });

  // When running locally, write everything to the console
  // with proper stacktraces enabled
  if (options.logger.indexOf('console') > -1) {
    logger.add(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.errors({ stack: true }),
          winston.format.colorize(),
          winston.format.printf(({ level, message, stack }) => {
            const ts = boliviaTimestamp();
            if (stack) {
              return `${level}: [${ts}] ${message} - ${stack}`;
            }
            return `${level}: [${ts}] ${message}`;
          })
        ),
      })
    );
  }
  if (options.logger.indexOf('file') > -1) {
    logger.add(
      new winston.transports.File({
        filename: './log/app.logg',
        level: log_level,
        maxsize: 10485760,
        maxFiles: 3,
      })
    );
  }

  return logger;
}
