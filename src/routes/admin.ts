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
import { Router } from 'express';

import * as AdminController from '../controller/adminController';
import * as CitasController from '../controller/citasController';
import * as SessionController from '../controller/sessionController';
import adminAuth from '../middleware/adminAuth';

const adminRoutes: Router = Router();

// Login del panel — público
adminRoutes.post('/login', AdminController.login);

// Actividad reciente del servidor
adminRoutes.get('/requests', adminAuth, AdminController.listRequests);

// Sesión de WhatsApp (siempre sobre WPP_ADMIN_SESSION)
adminRoutes.get(
  '/session/status',
  adminAuth,
  SessionController.getSessionState
);
adminRoutes.post('/session/start', adminAuth, SessionController.startSession);
adminRoutes.post('/session/close', adminAuth, SessionController.closeSession);

// Citas
adminRoutes.post(
  '/citas/send-reminder',
  adminAuth,
  CitasController.sendCitaReminder
);
adminRoutes.get(
  '/citas/scheduled-reminders',
  adminAuth,
  CitasController.getScheduledReminders
);
adminRoutes.delete(
  '/citas/scheduled-reminders/:reminderId',
  adminAuth,
  CitasController.cancelScheduledReminder
);
adminRoutes.post(
  '/citas/scheduled-reminders/:reminderId/send-now',
  adminAuth,
  CitasController.sendReminderNow
);
adminRoutes.get(
  '/citas/active-conversations',
  adminAuth,
  CitasController.getActiveConversations
);
adminRoutes.get(
  '/citas/sent-messages',
  adminAuth,
  AdminController.listSentMessagesHandler
);
adminRoutes.get(
  '/citas/outcomes',
  adminAuth,
  AdminController.listCitaOutcomesHandler
);

export default adminRoutes;
