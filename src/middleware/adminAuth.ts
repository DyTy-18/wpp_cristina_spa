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
import jwt from 'jsonwebtoken';

import { clientsArray } from '../util/sessionUtil';

/**
 * Autentica al panel de administración vía JWT (login humano, distinto del
 * esquema de token por sesión usado por Laravel en `middleware/auth.ts`).
 *
 * Al validar el token, resuelve `req.session`/`req.client` apuntando siempre
 * a la sesión de WhatsApp fija configurada en WPP_ADMIN_SESSION, para poder
 * reutilizar sin cambios los controllers existentes (SessionController,
 * CitasController).
 */
const adminAuth = (req: Request, res: Response, next: NextFunction): any => {
  const { authorization } = req.headers;
  const { jwtSecret, session } = req.serverOptions.admin;

  if (!authorization) {
    return res.status(401).json({
      status: 'error',
      message:
        'Token no informado. Envía el header Authorization: Bearer <token>.',
    });
  }

  const token = authorization.split(' ')[1];
  if (!token) {
    return res.status(401).json({
      status: 'error',
      message:
        'Token no informado. Envía el header Authorization: Bearer <token>.',
    });
  }

  try {
    jwt.verify(token, jwtSecret);
    req.session = session;
    req.client = clientsArray[session];
    next();
  } catch (error) {
    return res.status(401).json({
      status: 'error',
      message: 'Token inválido o expirado.',
    });
  }
};

export default adminAuth;
