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
import bcrypt from 'bcrypt';
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { listCitaOutcomes } from '../util/citaOutcomesLog';
import { listRequestLog } from '../util/requestLog';
import { listSentMessages } from '../util/sentMessagesLog';

/**
 * POST /api/admin/login
 *
 * Login del panel de administración. Valida usuario/contraseña contra
 * ADMIN_USERNAME / ADMIN_PASSWORD_HASH y devuelve un JWT de corta duración.
 */
export async function login(req: Request, res: Response) {
  const { username, password } = req.body as {
    username?: string;
    password?: string;
  };

  const {
    jwtSecret,
    username: adminUsername,
    passwordHash,
  } = req.serverOptions.admin;

  if (!jwtSecret || !adminUsername || !passwordHash) {
    req.logger.error(
      '[Admin] Panel de administración mal configurado — faltan JWT_SECRET, ADMIN_USERNAME o ADMIN_PASSWORD_HASH.'
    );
    return res.status(500).json({
      status: 'error',
      message: 'El panel de administración no está configurado en el servidor.',
    });
  }

  if (!username || !password) {
    return res.status(400).json({
      status: 'error',
      message: 'usuario y password son obligatorios.',
    });
  }

  const validUser = username === adminUsername;
  const validPassword = await bcrypt.compare(password, passwordHash);

  if (!validUser || !validPassword) {
    return res.status(401).json({
      status: 'error',
      message: 'Usuario o contraseña incorrectos.',
    });
  }

  const token = jwt.sign({ sub: username }, jwtSecret, { expiresIn: '12h' });

  return res.status(200).json({ status: 'success', token });
}

/**
 * GET /api/admin/requests
 *
 * Lista las últimas peticiones HTTP recibidas por el servidor (actividad
 * reciente), para mostrarlas en el panel de administración.
 */
export function listRequests(_req: Request, res: Response) {
  const requests = listRequestLog();
  return res.status(200).json({
    status: 'success',
    total: requests.length,
    requests,
  });
}

/**
 * GET /api/admin/citas/sent-messages
 *
 * Historial de mensajes de citas ya enviados (inmediatos y recordatorios
 * despachados por el scheduler) — distinto de los recordatorios que aún
 * están pendientes de enviarse.
 */
export function listSentMessagesHandler(_req: Request, res: Response) {
  const messages = listSentMessages();
  return res.status(200).json({
    status: 'success',
    total: messages.length,
    messages,
  });
}

/**
 * GET /api/admin/citas/outcomes
 *
 * Qué respondió cada cliente (confirmó, canceló, o pidió reagendar). La
 * conversación en sí se borra de memoria en cuanto termina — este es el
 * único rastro que queda de esa decisión en el panel.
 */
export function listCitaOutcomesHandler(_req: Request, res: Response) {
  const outcomes = listCitaOutcomes();
  return res.status(200).json({
    status: 'success',
    total: outcomes.length,
    outcomes,
  });
}
