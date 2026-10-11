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
import { create, SocketState, StatusFind } from '@wppconnect-team/wppconnect';
import { Request } from 'express';
import fs from 'fs';
import path from 'path';

import config from '../config';
import { download } from '../controller/sessionController';
import { WhatsAppServer } from '../types/WhatsAppServer';
import chatWootClient from './chatWootClient';
import { handleIncomingMessage } from './citasConversation';
import { autoDownload, callWebHook, startHelper } from './functions';
import { clientsArray, eventEmitter } from './sessionUtil';
import Factory from './tokenStore/factory';

/**
 * Si el proceso se reinició sin que Chromium cerrara bien (crash, kill,
 * redeploy), estos archivos quedan del proceso anterior y el browser nuevo
 * se niega a lanzar con "profile appears to be in use by another Chromium
 * process". Como solo corre un proceso de wppconnect-server por contenedor,
 * cualquier lock que quede al arrancar es de una ejecución muerta — es
 * seguro borrarlo antes de lanzar un browser nuevo.
 */
function clearStaleBrowserLock(userDataDir: string, logger?: any): void {
  for (const file of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const filePath = path.join(userDataDir, file);
    try {
      // Estos son symlinks cuyo destino casi siempre ya no existe (apuntan a
      // un PID/socket de un proceso muerto) — fs.existsSync sigue el link y
      // devuelve false para un symlink roto, así que nunca detectaba nada
      // para borrar. Hay que intentar unlink directo, sin chequear antes.
      fs.unlinkSync(filePath);
      logger?.info(
        `[SessionStart] Lock viejo de Chromium eliminado: ${filePath}`
      );
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        logger?.warn(`[SessionStart] No se pudo eliminar ${filePath}: ${err}`);
      }
    }
  }
}

/**
 * Mata los procesos de Chromium que usan este userDataDir. Hace falta cuando
 * create() de wppconnect se queda colgado: todavía no nos devolvió el cliente,
 * así que no hay `client.close()` para llamar, y el browser queda huérfano
 * (sigue logueado/mostrando QR, pero ninguna request puede usarlo).
 * Solo funciona en Linux (/proc) — en otros SO no hace nada.
 */
function killBrowserForUserDataDir(
  userDataDir: string | null,
  logger?: any
): void {
  if (!userDataDir || !fs.existsSync('/proc')) return;
  const target = path.resolve(userDataDir);
  for (const pid of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue;
    try {
      const args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
      const usesDir = args.some(
        (arg) =>
          arg.startsWith('--user-data-dir=') &&
          path.resolve(arg.slice('--user-data-dir='.length)) === target
      );
      if (usesDir) {
        process.kill(Number(pid), 'SIGKILL');
        logger?.warn(`[Session] Chromium terminado (pid ${pid})`);
      }
    } catch (err) {
      // El proceso pudo haber terminado mientras recorríamos /proc.
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function userDataDirFor(session: string): string | null {
  return config.customUserDataDir ? config.customUserDataDir + session : null;
}

/*
 * Ciclo de vida de una sesión (lo que ve el panel en `status`):
 *
 *   CLOSED ──start──▶ INITIALIZING ──▶ QRCODE ──escaneo──▶ SYNCING ──▶ CONNECTED
 *     ▲                                  │                    │            │
 *     └──────── resetSession() ◀─────────┴── timeouts ────────┴── unlink ──┘
 *
 * Toda salida hacia CLOSED pasa por resetSession(): invalida el intento en
 * curso (generación), cierra/mata el Chromium y, si el número se desvinculó,
 * borra el perfil para que el próximo QR sirva para cualquier número.
 */

// Cada llamada a create() recibe un número de generación. Cualquier callback
// (QR, statusFind, timers) o resolución tardía de un intento viejo se descarta
// comparando contra este valor — así un browser abandonado nunca vuelve a
// mandar QRs al panel ni pisa el estado del intento nuevo.
const sessionGeneration: Record<string, number> = {};
const sessionTimers: Record<string, NodeJS.Timeout[]> = {};

// Sin escaneo en este tiempo, el QR se da por vencido y se cierra el browser
// (antes podía quedar mostrando QR durante horas).
const QR_TIMEOUT_MS = 5 * 60_000;
// WhatsApp Web refresca el QR cada 20-60s mientras nadie lo escanea. Si deja
// de llegar uno nuevo por este tiempo, es que lo escanearon.
const QR_SCANNED_GAP_MS = 2 * 60_000;
// Después de escanear, la sincronización inicial puede tardar varios minutos.
const SYNC_TIMEOUT_MS = 10 * 60_000;
// Una vez que WhatsApp Web está en el chat, create() termina en segundos.
// Si pasa este tiempo sin que termine, wppconnect quedó trabado en waitForLogin.
const INCHAT_WATCHDOG_MS = 90_000;
// Reinicios automáticos (browser caído, create() trabado): como mucho uno
// cada este tiempo, para no entrar en bucle.
const AUTO_RESTART_MIN_GAP_MS = 3 * 60_000;
const lastAutoRestartAt: Record<string, number> = {};
const lastConnectedNumber: Record<string, string> = {};

// Último intento fallido por sesión — evita que un pedido automático de
// "iniciar sesión" (Laravel, start-all) que llega justo después de una falla
// dispare QR en bucle, que puede hacer que WhatsApp bloquee temporalmente la
// vinculación del número. Los inicios manuales desde el panel lo saltean.
const lastFailureAt: Record<string, number> = {};
const RETRY_COOLDOWN_MS = 30_000;

export type CloseReason =
  | 'MANUAL'
  | 'LOGOUT'
  | 'UNLINKED'
  | 'QR_EXPIRED'
  | 'SYNC_TIMEOUT'
  | 'BROWSER_CLOSED'
  | 'START_FAILED';

/**
 * Lleva la sesión a CLOSED de forma segura, sin importar en qué estado esté
 * (incluso si create() nunca terminó). `wipeAuth` borra el perfil de Chromium:
 * se usa cuando el número se desvinculó o se pidió cambiar de número.
 */
export async function resetSession(
  session: string,
  opts: { reason: CloseReason; wipeAuth?: boolean; logger?: any }
): Promise<void> {
  const previous = resetInProgress[session];
  const run = (async () => {
    await previous;
    await doResetSession(session, opts);
  })();
  resetInProgress[session] = run;
  try {
    await run;
  } finally {
    if (resetInProgress[session] === run) delete resetInProgress[session];
  }
}

// Un reset en curso (sobre todo el borrado del perfil) debe terminar antes de
// lanzar un Chromium nuevo sobre esa misma carpeta.
const resetInProgress: Record<string, Promise<void> | undefined> = {};

async function doResetSession(
  session: string,
  opts: { reason: CloseReason; wipeAuth?: boolean; logger?: any }
): Promise<void> {
  const { reason, wipeAuth = false, logger } = opts;
  sessionGeneration[session] = (sessionGeneration[session] ?? 0) + 1;
  for (const timer of sessionTimers[session] ?? []) clearTimeout(timer);
  sessionTimers[session] = [];

  const current: any = (clientsArray as any)[session];
  (clientsArray as any)[session] = {
    status: 'CLOSED',
    session,
    closedReason: reason,
    closedAt: Date.now(),
  };

  if (current && typeof current.close === 'function') {
    await withTimeout(
      current.close().catch(() => null),
      10_000
    );
  }
  const userDataDir = userDataDirFor(session);
  killBrowserForUserDataDir(userDataDir, logger);

  if (wipeAuth && userDataDir) {
    // Chromium recién muerto puede tardar un instante en soltar archivos.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await fs.promises
      .rm(userDataDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 500,
      })
      .catch((err) =>
        logger?.error(`[Session] No se pudo borrar ${userDataDir}: ${err}`)
      );
  }
  logger?.info(
    `[Session] "${session}" cerrada (${reason}${
      wipeAuth ? ', login borrado' : ''
    })`
  );
}

export default class CreateSessionUtil {
  startChatWootClient(client: any) {
    if (client.config.chatWoot && !client._chatWootClient)
      client._chatWootClient = new chatWootClient(
        client.config.chatWoot,
        client.session
      );
    return client._chatWootClient;
  }

  /** Reinicio automático con freno anti-bucle. */
  private autoRestart(req: any, session: string) {
    const last = lastAutoRestartAt[session] ?? 0;
    if (Date.now() - last < AUTO_RESTART_MIN_GAP_MS) {
      req.logger.error(
        `[Session] "${session}" falló de nuevo poco después de un reinicio automático — queda cerrada, reconectar desde el panel.`
      );
      return;
    }
    lastAutoRestartAt[session] = Date.now();
    delete lastFailureAt[session];
    setTimeout(() => this.createSessionUtil(req, clientsArray, session), 3000);
  }

  async createSessionUtil(
    req: any,
    clientsArray: any,
    session: string,
    res?: any
  ) {
    let generation = 0;
    try {
      await resetInProgress[session];
      let client = this.getClient(session) as any;
      if (client.status != null && client.status !== 'CLOSED') return;

      const lastFailure = lastFailureAt[session];
      if (
        !req.manualStart &&
        lastFailure &&
        Date.now() - lastFailure < RETRY_COOLDOWN_MS
      ) {
        const secondsLeft = Math.ceil(
          (RETRY_COOLDOWN_MS - (Date.now() - lastFailure)) / 1000
        );
        req.logger?.warn(
          `[SessionStart] Cooldown activo para "${session}" — esperando ${secondsLeft}s antes de reintentar (evita generar QR en bucle).`
        );
        return;
      }

      generation = (sessionGeneration[session] ?? 0) + 1;
      sessionGeneration[session] = generation;
      const isCurrent = () => sessionGeneration[session] === generation;
      const timers: NodeJS.Timeout[] = (sessionTimers[session] = []);

      Object.assign(client, {
        status: 'INITIALIZING',
        config: req.body,
        qrcode: null,
        urlcode: null,
        closedReason: null,
        connectedNumber: null,
      });

      const tokenStore = new Factory();
      const myTokenStore = tokenStore.createTokenStory(client);
      const tokenData = await myTokenStore.getToken(session);

      // we need this to update phone in config every time session starts, so we can ask for code for it again.
      myTokenStore.setToken(session, tokenData ?? {});

      this.startChatWootClient(client);

      const userDataDir = userDataDirFor(session);
      let created = false;
      let firstQrAt = 0;
      let lastQrAt = 0;
      let inChatWatchdogArmed = false;

      if (userDataDir) {
        // Un Chromium de un intento anterior que sobrevivió usaría el mismo
        // perfil — se mata antes de lanzar uno nuevo.
        killBrowserForUserDataDir(userDataDir, req.logger);
        clearStaleBrowserLock(userDataDir, req.logger);
        req.serverOptions.createOptions.puppeteerOptions = {
          userDataDir,
        };
      }

      const markSyncing = () => {
        if (created || client.status === 'SYNCING') return;
        Object.assign(client, {
          status: 'SYNCING',
          qrcode: null,
          urlcode: null,
        });
        req.io.emit('session-syncing', { session });
        req.logger.info(`[Session] "${session}" QR escaneado, sincronizando…`);
        timers.push(
          setTimeout(() => {
            if (created || !isCurrent()) return;
            req.logger.warn(
              `[Session] "${session}" lleva ${
                SYNC_TIMEOUT_MS / 60_000
              } min sincronizando sin terminar — reiniciando.`
            );
            resetSession(session, {
              reason: 'SYNC_TIMEOUT',
              logger: req.logger,
            }).then(() => this.autoRestart(req, session));
          }, SYNC_TIMEOUT_MS)
        );
      };

      // Vigila el QR: vencido si nadie lo escanea, o pasa a SYNCING cuando
      // deja de refrescarse (señal de que lo escanearon) aunque wppconnect no
      // avise — en el bug original nunca llegaba "qrReadSuccess".
      timers.push(
        setInterval(() => {
          if (!isCurrent() || created || client.status !== 'QRCODE') return;
          const now = Date.now();
          if (now - lastQrAt > QR_SCANNED_GAP_MS) {
            markSyncing();
          } else if (now - firstQrAt > QR_TIMEOUT_MS) {
            req.logger.warn(
              `[Session] "${session}" QR sin escanear por ${
                QR_TIMEOUT_MS / 60_000
              } min — se cierra.`
            );
            resetSession(session, {
              reason: 'QR_EXPIRED',
              logger: req.logger,
            });
          }
        }, 15_000)
      );

      const wppClient = await create(
        Object.assign(
          {},
          { tokenStore: myTokenStore },
          client.config.proxy
            ? {
                proxy: {
                  url: client.config.proxy?.url,
                  username: client.config.proxy?.username,
                  password: client.config.proxy?.password,
                },
              }
            : {},
          req.serverOptions.createOptions,
          {
            session: session,
            phoneNumber: client.config.phone ?? null,
            // Los vencimientos (QR y sincronización) los manejan los timers
            // de arriba. El deviceSyncTimeout de wppconnect (3 min) cortaba
            // sincronizaciones legítimas: en producción tardan ~5 min.
            autoClose: 0,
            deviceSyncTimeout: 0,
            deviceName:
              client.config.phone == undefined // bug when using phone code this shouldn't be passed (https://github.com/wppconnect-team/wppconnect-server/issues/1687#issuecomment-2099357874)
                ? client.config?.deviceName ||
                  req.serverOptions.deviceName ||
                  'WppConnect'
                : undefined,
            poweredBy:
              client.config.phone == undefined // bug when using phone code this shouldn't be passed (https://github.com/wppconnect-team/wppconnect-server/issues/1687#issuecomment-2099357874)
                ? client.config?.poweredBy ||
                  req.serverOptions.poweredBy ||
                  'WPPConnect-Server'
                : undefined,
            catchLinkCode: (code: string) => {
              if (!isCurrent()) return;
              this.exportPhoneCode(req, client.config.phone, code, client, res);
            },
            catchQR: (
              base64Qr: any,
              asciiQR: any,
              attempt: any,
              urlCode: string
            ) => {
              if (!isCurrent()) return;
              const now = Date.now();
              if (!firstQrAt || client.status !== 'QRCODE') firstQrAt = now;
              lastQrAt = now;
              this.exportQR(req, base64Qr, urlCode, client, res);
            },
            onLoadingScreen: (percent: string, message: string) => {
              req.logger.info(`[${session}] ${percent}% - ${message}`);
            },
            statusFind: (statusFind: StatusFind) => {
              if (!isCurrent()) return;
              try {
                eventEmitter.emit(
                  `status-${client.session}`,
                  client,
                  statusFind
                );
                req.logger.info(statusFind + '\n\n');
                callWebHook(client, req, 'status-find', {
                  status: statusFind,
                  session: client.session,
                });

                if (
                  statusFind === StatusFind.disconnectedMobile &&
                  !created &&
                  client.status !== 'SYNCING'
                ) {
                  // Falso positivo de wppconnect: su vigilante arranca con
                  // `connected = null` y, al ver la primera página de QR
                  // (todavía sin registrar), lo reporta como "Session
                  // Unpaired". Si nunca se llegó a vincular en este intento,
                  // no hay nada que desvincular: se sigue esperando el QR.
                  req.logger.info(
                    `[Session] "${session}" aviso de desvinculación ignorado (todavía no estaba vinculada).`
                  );
                  return;
                }
                if (statusFind === StatusFind.disconnectedMobile) {
                  // El número se desvinculó (desde el teléfono, o WhatsApp lo
                  // sacó). El perfil guardado ya no sirve: se borra para que
                  // el próximo "Conectar" muestre un QR limpio para cualquier
                  // número.
                  resetSession(session, {
                    reason: 'UNLINKED',
                    wipeAuth: true,
                    logger: req.logger,
                  });
                  req.io.emit('whatsapp-status', false);
                  return;
                }
                if (
                  statusFind === StatusFind.browserClose ||
                  statusFind === StatusFind.autocloseCalled
                ) {
                  const wasConnected = created;
                  resetSession(session, {
                    reason: 'BROWSER_CLOSED',
                    logger: req.logger,
                  }).then(() => {
                    // Si estaba funcionando, el login sigue guardado:
                    // reiniciar lo recupera sin QR.
                    if (wasConnected) this.autoRestart(req, session);
                  });
                  return;
                }
                if (statusFind === StatusFind.qrReadSuccess) {
                  markSyncing();
                }
                if (statusFind === StatusFind.inChat && !created) {
                  markSyncing();
                  if (!inChatWatchdogArmed) {
                    inChatWatchdogArmed = true;
                    timers.push(
                      setTimeout(() => {
                        if (created || !isCurrent()) return;
                        req.logger.warn(
                          `[Session] "${session}" está en el chat pero create() no terminó en ${
                            INCHAT_WATCHDOG_MS / 1000
                          }s — reiniciando el navegador (el login guardado se reutiliza, no pide QR).`
                        );
                        resetSession(session, {
                          reason: 'SYNC_TIMEOUT',
                          logger: req.logger,
                        }).then(() => this.autoRestart(req, session));
                      }, INCHAT_WATCHDOG_MS)
                    );
                  }
                }
              } catch (error) {
                req.logger.error(error);
              }
            },
          }
        )
      );

      if (!isCurrent()) {
        // Este intento fue abandonado (timeout, cerrar, cambiar número).
        wppClient.close().catch(() => null);
        return;
      }
      created = true;
      for (const timer of timers) clearTimeout(timer);
      timers.length = 0;

      client = clientsArray[session] = Object.assign(wppClient, client);
      await this.start(req, client);

      if (req.serverOptions.webhook.onParticipantsChanged) {
        await this.onParticipantsChanged(req, client);
      }

      if (req.serverOptions.webhook.onReactionMessage) {
        await this.onReactionMessage(client, req);
      }

      if (req.serverOptions.webhook.onRevokedMessage) {
        await this.onRevokedMessage(client, req);
      }

      if (req.serverOptions.webhook.onPollResponse) {
        await this.onPollResponse(client, req);
      }
      if (req.serverOptions.webhook.onLabelUpdated) {
        await this.onLabelUpdated(client, req);
      }
    } catch (e) {
      req.logger.error(e);
      // Un intento abandonado que falla tarde no debe tocar el intento nuevo.
      if (!generation || sessionGeneration[session] !== generation) return;
      lastFailureAt[session] = Date.now();
      await resetSession(session, {
        reason: 'START_FAILED',
        logger: req.logger,
      });
    }
  }

  async opendata(req: Request, session: string, res?: any) {
    await this.createSessionUtil(req, clientsArray, session, res);
  }

  exportPhoneCode(
    req: any,
    phone: any,
    phoneCode: any,
    client: WhatsAppServer,
    res?: any
  ) {
    eventEmitter.emit(`phoneCode-${client.session}`, phoneCode, client);

    Object.assign(client, {
      status: 'PHONECODE',
      phoneCode: phoneCode,
      phone: phone,
    });

    req.io.emit('phoneCode', {
      data: phoneCode,
      phone: phone,
      session: client.session,
    });

    callWebHook(client, req, 'phoneCode', {
      phoneCode: phoneCode,
      phone: phone,
      session: client.session,
    });

    if (res && !res._headerSent)
      res.status(200).json({
        status: 'phoneCode',
        phone: phone,
        phoneCode: phoneCode,
        session: client.session,
      });
  }

  exportQR(
    req: any,
    qrCode: any,
    urlCode: any,
    client: WhatsAppServer,
    res?: any
  ) {
    eventEmitter.emit(`qrcode-${client.session}`, qrCode, urlCode, client);
    Object.assign(client, {
      status: 'QRCODE',
      qrcode: qrCode,
      urlcode: urlCode,
    });

    qrCode = qrCode.replace('data:image/png;base64,', '');
    const imageBuffer = Buffer.from(qrCode, 'base64');

    req.io.emit('qrCode', {
      data: 'data:image/png;base64,' + imageBuffer.toString('base64'),
      session: client.session,
    });

    callWebHook(client, req, 'qrcode', {
      qrcode: qrCode,
      urlcode: urlCode,
      session: client.session,
    });
    if (res && !res._headerSent)
      res.status(200).json({
        status: 'qrcode',
        qrcode: qrCode,
        urlcode: urlCode,
        session: client.session,
      });
  }

  async onParticipantsChanged(req: any, client: any) {
    await client.isConnected();
    await client.onParticipantsChanged((message: any) => {
      callWebHook(client, req, 'onparticipantschanged', message);
    });
  }

  async start(req: Request, client: WhatsAppServer) {
    try {
      await client.isConnected();
      const wid = await withTimeout(client.getWid(), 10_000).catch(() => null);
      const connectedNumber = wid ? String(wid).split('@')[0] : null;
      Object.assign(client, {
        status: 'CONNECTED',
        qrcode: null,
        urlcode: null,
        connectedNumber,
      });

      req.logger.info(
        `Started Session: ${client.session} (número ${connectedNumber ?? '?'})`
      );
      const previousNumber = lastConnectedNumber[client.session];
      if (
        connectedNumber &&
        previousNumber &&
        previousNumber !== connectedNumber
      )
        req.logger.warn(
          `[Session] "${client.session}" cambió de número: ${previousNumber} → ${connectedNumber}`
        );
      if (connectedNumber)
        lastConnectedNumber[client.session] = connectedNumber;
      //callWebHook(client, req, 'session-logged', { status: 'CONNECTED'});
      req.io.emit('session-logged', { status: true, session: client.session });
      startHelper(client, req);
    } catch (error) {
      req.logger.error(error);
      req.io.emit('session-error', client.session);
    }

    await this.checkStateSession(client, req);
    await this.listenMessages(client, req);

    if (req.serverOptions.webhook.listenAcks) {
      await this.listenAcks(client, req);
    }

    if (req.serverOptions.webhook.onPresenceChanged) {
      await this.onPresenceChanged(client, req);
    }
  }

  async checkStateSession(client: WhatsAppServer, req: Request) {
    await client.onStateChange((state) => {
      req.logger.info(`State Change ${state}: ${client.session}`);
      const conflits = [SocketState.CONFLICT];

      if (conflits.includes(state)) {
        client.useHere();
      }
    });
  }

  async listenMessages(client: WhatsAppServer, req: Request) {
    await client.onMessage(async (message: any) => {
      eventEmitter.emit(`mensagem-${client.session}`, client, message);
      callWebHook(client, req, 'onmessage', message);
      if (message.type === 'location')
        client.onLiveLocation(message.sender.id, (location) => {
          callWebHook(client, req, 'location', location);
        });

      // Procesar respuestas de confirmación de citas
      await handleIncomingMessage(
        client,
        message,
        req.serverOptions.citasApiUrl || '',
        req.serverOptions.citasApiToken || '',
        req.logger
      );
    });

    await client.onAnyMessage(async (message: any) => {
      message.session = client.session;

      if (message.type === 'sticker') {
        download(message, client, req.logger);
      }

      if (
        req.serverOptions?.websocket?.autoDownload ||
        (req.serverOptions?.webhook?.autoDownload && message.fromMe == false)
      ) {
        await autoDownload(client, req, message);
      }

      req.io.emit('received-message', { response: message });
      if (req.serverOptions.webhook.onSelfMessage && message.fromMe)
        callWebHook(client, req, 'onselfmessage', message);
    });

    await client.onIncomingCall(async (call) => {
      req.io.emit('incomingcall', call);
      callWebHook(client, req, 'incomingcall', call);
    });
  }

  async listenAcks(client: WhatsAppServer, req: Request) {
    await client.onAck(async (ack) => {
      req.io.emit('onack', ack);
      callWebHook(client, req, 'onack', ack);
    });
  }

  async onPresenceChanged(client: WhatsAppServer, req: Request) {
    await client.onPresenceChanged(async (presenceChangedEvent) => {
      req.io.emit('onpresencechanged', presenceChangedEvent);
      callWebHook(client, req, 'onpresencechanged', presenceChangedEvent);
    });
  }

  async onReactionMessage(client: WhatsAppServer, req: Request) {
    await client.isConnected();
    await client.onReactionMessage(async (reaction: any) => {
      req.io.emit('onreactionmessage', reaction);
      callWebHook(client, req, 'onreactionmessage', reaction);
    });
  }

  async onRevokedMessage(client: WhatsAppServer, req: Request) {
    await client.isConnected();
    await client.onRevokedMessage(async (response: any) => {
      req.io.emit('onrevokedmessage', response);
      callWebHook(client, req, 'onrevokedmessage', response);
    });
  }
  async onPollResponse(client: WhatsAppServer, req: Request) {
    await client.isConnected();
    await client.onPollResponse(async (response: any) => {
      req.io.emit('onpollresponse', response);
      callWebHook(client, req, 'onpollresponse', response);
    });
  }
  async onLabelUpdated(client: WhatsAppServer, req: Request) {
    await client.isConnected();
    await client.onUpdateLabel(async (response: any) => {
      req.io.emit('onupdatelabel', response);
      callWebHook(client, req, 'onupdatelabel', response);
    });
  }

  encodeFunction(data: any, webhook: any) {
    data.webhook = webhook;
    return JSON.stringify(data);
  }

  decodeFunction(text: any, client: any) {
    const object = JSON.parse(text);
    if (object.webhook && !client.webhook) client.webhook = object.webhook;
    delete object.webhook;
    return object;
  }

  getClient(session: any) {
    let client = clientsArray[session];

    if (!client)
      client = clientsArray[session] = {
        status: null,
        session: session,
      } as any;
    return client;
  }
}
