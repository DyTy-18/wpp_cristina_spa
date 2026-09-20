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
      logger?.info(`[SessionStart] Lock viejo de Chromium eliminado: ${filePath}`);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        logger?.warn(
          `[SessionStart] No se pudo eliminar ${filePath}: ${err}`
        );
      }
    }
  }
}

// Último intento fallido por sesión — evita que un pedido de "iniciar
// sesión" que llega justo después de una falla dispare otro create() en
// paralelo (dos QR generándose a la vez), y de paso frena el machaque de
// reintentos que puede hacer que WhatsApp bloquee temporalmente la
// vinculación de ese número por demasiados intentos seguidos.
const lastFailureAt: Record<string, number> = {};
const RETRY_COOLDOWN_MS = 30_000;

export default class CreateSessionUtil {
  startChatWootClient(client: any) {
    if (client.config.chatWoot && !client._chatWootClient)
      client._chatWootClient = new chatWootClient(
        client.config.chatWoot,
        client.session
      );
    return client._chatWootClient;
  }

  async createSessionUtil(
    req: any,
    clientsArray: any,
    session: string,
    res?: any
  ) {
    try {
      let client = this.getClient(session) as any;
      if (client.status != null && client.status !== 'CLOSED') return;

      const lastFailure = lastFailureAt[session];
      if (lastFailure && Date.now() - lastFailure < RETRY_COOLDOWN_MS) {
        const secondsLeft = Math.ceil(
          (RETRY_COOLDOWN_MS - (Date.now() - lastFailure)) / 1000
        );
        req.logger?.warn(
          `[SessionStart] Cooldown activo para "${session}" — esperando ${secondsLeft}s antes de reintentar (evita generar QR en bucle).`
        );
        return;
      }

      client.status = 'INITIALIZING';
      client.config = req.body;

      const tokenStore = new Factory();
      const myTokenStore = tokenStore.createTokenStory(client);
      const tokenData = await myTokenStore.getToken(session);

      // we need this to update phone in config every time session starts, so we can ask for code for it again.
      myTokenStore.setToken(session, tokenData ?? {});

      this.startChatWootClient(client);

      if (req.serverOptions.customUserDataDir) {
        const userDataDir = req.serverOptions.customUserDataDir + session;
        clearStaleBrowserLock(userDataDir, req.logger);
        req.serverOptions.createOptions.puppeteerOptions = {
          userDataDir,
        };
      }

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
              this.exportPhoneCode(req, client.config.phone, code, client, res);
            },
            catchQR: (
              base64Qr: any,
              asciiQR: any,
              attempt: any,
              urlCode: string
            ) => {
              this.exportQR(req, base64Qr, urlCode, client, res);
            },
            onLoadingScreen: (percent: string, message: string) => {
              req.logger.info(`[${session}] ${percent}% - ${message}`);
            },
            statusFind: (statusFind: StatusFind) => {
              try {
                eventEmitter.emit(
                  `status-${client.session}`,
                  client,
                  statusFind
                );
                if (
                  statusFind === StatusFind.autocloseCalled ||
                  statusFind === StatusFind.disconnectedMobile
                ) {
                  client.status = 'CLOSED';
                  client.qrcode = null;
                  client.close();
                  clientsArray[session] = undefined;
                  lastFailureAt[session] = Date.now();
                }
                callWebHook(client, req, 'status-find', {
                  status: statusFind,
                  session: client.session,
                });
                req.logger.info(statusFind + '\n\n');
              } catch (error) {}
            },
          }
        )
      );

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
      // Cualquier falla acá (timeout, browser que no lanza, etc.) debe
      // liberar la sesión — si se queda en "INITIALIZING", el guard del
      // principio de esta función bloquea todo reintento futuro hasta que
      // se reinicie el proceso entero.
      const client = this.getClient(session) as any;
      client.status = 'CLOSED';
      lastFailureAt[session] = Date.now();
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
      Object.assign(client, { status: 'CONNECTED', qrcode: null });

      req.logger.info(`Started Session: ${client.session}`);
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
