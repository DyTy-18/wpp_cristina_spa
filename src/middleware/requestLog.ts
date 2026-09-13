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
import { NextFunction, Request, Response } from 'express';

import { recordRequest } from '../util/requestLog';

const IGNORED_PREFIXES = [
  '/healthz',
  '/unhealthy',
  '/metrics',
  '/api-docs',
  '/files',
  '/admin', // archivos estáticos del panel — no es "actividad" del negocio
];

/**
 * Registra cada request HTTP (método, ruta, status, duración) en un buffer en
 * memoria para que el panel de administración pueda mostrar actividad reciente.
 */
export default function requestLog(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (IGNORED_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    return next();
  }

  // El propio panel de administración hace polling constante (GET) a sus
  // endpoints de lectura — no es "actividad" interesante, solo ruido.
  // Las acciones (POST/DELETE, ej. login o cancelar un recordatorio) sí quedan.
  if (req.method === 'GET' && req.path.startsWith('/api/admin')) {
    return next();
  }

  const start = Date.now();
  const secretKey = req.serverOptions?.secretKey;

  res.on('finish', () => {
    let path = req.originalUrl;
    if (secretKey) {
      path = path.split(secretKey).join('[REDACTED]');
    }

    recordRequest({
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  });

  next();
}
