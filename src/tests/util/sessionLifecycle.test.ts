/*
 * Ciclo de vida de la sesión de WhatsApp (createSessionUtil) con wppconnect
 * simulado: QR, escaneo, sincronización, desvinculación, vencimientos y
 * cambio de número. No lanza Chromium.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
// No los toca el reloj falso de jest: para esperar I/O real del disco.
import realTimers from 'timers';

const USER_DATA_ROOT = path.join(os.tmpdir(), 'wpp-lifecycle-test');

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    customUserDataDir: require('path').join(
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('os').tmpdir(),
      'wpp-lifecycle-test/'
    ),
  },
}));
jest.mock('../../controller/sessionController', () => ({
  download: jest.fn(),
}));
jest.mock('../../util/functions', () => ({
  callWebHook: jest.fn(),
  autoDownload: jest.fn(),
  startHelper: jest.fn(),
}));
jest.mock('../../util/chatWootClient', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../../util/citasConversation', () => ({
  handleIncomingMessage: jest.fn(),
}));
jest.mock('../../util/tokenStore/factory', () => ({
  __esModule: true,
  default: class {
    createTokenStory() {
      return { getToken: async () => ({}), setToken: async () => true };
    }
  },
}));

interface FakeAttempt {
  options: any;
  resolve: (client: any) => void;
  reject: (err: any) => void;
}
const attempts: FakeAttempt[] = [];

jest.mock('@wppconnect-team/wppconnect', () => ({
  StatusFind: {
    autocloseCalled: 'autocloseCalled',
    browserClose: 'browserClose',
    disconnectedMobile: 'disconnectedMobile',
    inChat: 'inChat',
    qrReadSuccess: 'qrReadSuccess',
  },
  SocketState: { CONFLICT: 'CONFLICT' },
  create: jest.fn(
    (options: any) =>
      new Promise((resolve, reject) => {
        attempts.push({ options, resolve, reject });
      })
  ),
}));

// eslint-disable-next-line import/first
import CreateSessionUtil, { resetSession } from '../../util/createSessionUtil';
// eslint-disable-next-line import/first
import { clientsArray } from '../../util/sessionUtil';

const SESSION = 'citas';
const QR = 'data:image/png;base64,AAAA';

function fakeWppClient(number: string) {
  const noop = jest.fn(async () => undefined);
  return {
    close: jest.fn(async () => true),
    logout: jest.fn(async () => true),
    isConnected: jest.fn(async () => true),
    getWid: jest.fn(async () => `${number}@c.us`),
    onStateChange: noop,
    onMessage: noop,
    onAnyMessage: noop,
    onIncomingCall: noop,
    onAck: noop,
    onPresenceChanged: noop,
    onParticipantsChanged: noop,
    onReactionMessage: noop,
    onRevokedMessage: noop,
    onPollResponse: noop,
    onUpdateLabel: noop,
  };
}

function fakeReq(extra: any = {}) {
  return {
    body: {},
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    io: { emit: jest.fn() },
    serverOptions: { createOptions: {}, webhook: {} },
    ...extra,
  };
}

const current = () => (clientsArray as any)[SESSION];
const last = () => attempts[attempts.length - 1];
// Avanza el reloj falso y deja correr I/O real (fs.rm del perfil).
async function tick(ms: number) {
  await jest.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    await jest.advanceTimersByTimeAsync(0);
  }
}

/** Espera (con I/O real) a que el perfil de Chromium quede borrado. */
async function profileWiped(): Promise<boolean> {
  const dir = path.join(USER_DATA_ROOT, SESSION);
  for (let i = 0; i < 200 && fs.existsSync(dir); i++) {
    await new Promise((resolve) => realTimers.setTimeout(resolve, 10));
    await tick(100);
  }
  return !fs.existsSync(dir);
}

/** Mientras nadie escanea, WhatsApp Web refresca el QR cada 20 s. */
async function showQrFor(ms: number) {
  for (let t = 0; t < ms; t += 20_000) {
    last().options.catchQR(QR, '', 1, 'url-code');
    await tick(20_000);
  }
}

async function start(req = fakeReq()) {
  new CreateSessionUtil().opendata(req as any, SESSION);
  await tick(0);
  return req;
}

// Cada test arranca una hora después del anterior: el freno anti-bucle de
// reinicios automáticos guarda estado entre tests.
let clock = Date.now();
beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  clock += 60 * 60_000;
  jest.setSystemTime(clock);
  attempts.length = 0;
  await resetSession(SESSION, { reason: 'MANUAL' });
  delete (clientsArray as any)[SESSION];
  fs.mkdirSync(path.join(USER_DATA_ROOT, SESSION), { recursive: true });
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

afterAll(() => fs.rmSync(USER_DATA_ROOT, { recursive: true, force: true }));

describe('Ciclo de vida de la sesión', () => {
  it('QR → escaneo → SYNCING (sin QR viejo) → CONNECTED con número', async () => {
    await start();
    expect(current().status).toBe('INITIALIZING');
    expect(last().options.autoClose).toBe(0);
    expect(last().options.deviceSyncTimeout).toBe(0);

    await showQrFor(60_000);
    expect(current().status).toBe('QRCODE');
    expect(current().urlcode).toBe('url-code');

    // Escanean: el QR deja de refrescarse y wppconnect no avisa nada (como
    // en producción). Pasado el umbral, el panel deja de mostrar el QR.
    await tick(2 * 60_000 + 15_000);
    expect(current().status).toBe('SYNCING');
    expect(current().urlcode).toBeNull();

    last().resolve(fakeWppClient('59170000001'));
    await tick(0);
    expect(current().status).toBe('CONNECTED');
    expect(current().connectedNumber).toBe('59170000001');
  });

  it('qrReadSuccess pasa a SYNCING al instante', async () => {
    await start();
    await showQrFor(20_000);
    last().options.statusFind('qrReadSuccess');
    expect(current().status).toBe('SYNCING');
  });

  it('QR sin escanear vence a los 5 min y cierra el browser', async () => {
    const req = await start();
    await showQrFor(5 * 60_000 + 20_000);
    expect(current().status).toBe('CLOSED');
    expect(current().closedReason).toBe('QR_EXPIRED');

    // El browser abandonado ya no puede mandar QRs al panel.
    req.io.emit.mockClear();
    attempts[0].options.catchQR(QR, '', 99, 'stale');
    expect(current().status).toBe('CLOSED');
    expect(req.io.emit).not.toHaveBeenCalled();
  });

  it('inChat pero create() trabado → reinicia solo y descarta el intento viejo', async () => {
    await start();
    await showQrFor(20_000);
    last().options.statusFind('inChat');
    expect(current().status).toBe('SYNCING');

    await tick(90_000 + 3_000 + 1);
    expect(attempts).toHaveLength(2);
    expect(current().status).toBe('INITIALIZING');

    // El create() viejo resuelve tarde: se cierra y no pisa la sesión nueva.
    const stale = fakeWppClient('59170000001');
    attempts[0].resolve(stale);
    await tick(0);
    expect(stale.close).toHaveBeenCalled();
    expect(current().status).toBe('INITIALIZING');

    attempts[1].resolve(fakeWppClient('59170000001'));
    await tick(0);
    expect(current().status).toBe('CONNECTED');
  });

  it('falso "Session Unpaired" de wppconnect al mostrar el primer QR → se ignora', async () => {
    // wppconnect arranca su vigilante con connected = null: la primera página
    // de QR (sin registrar) dispara disconnectedMobile sin que nadie haya
    // desvinculado nada. Pasaba en cada "Conectar" en producción.
    await start();
    last().options.statusFind('disconnectedMobile');
    await tick(1_500);
    expect(current().status).toBe('INITIALIZING');

    await showQrFor(20_000);
    last().options.statusFind('disconnectedMobile');
    await tick(1_500);
    expect(current().status).toBe('QRCODE');
    expect(fs.existsSync(path.join(USER_DATA_ROOT, SESSION))).toBe(true);
  });

  it('desvinculado durante la sincronización, antes de terminar create() (bug original) → CLOSED y sin huérfanos', async () => {
    await start();
    await showQrFor(20_000);
    last().options.statusFind('inChat');
    last().options.statusFind('disconnectedMobile');
    await tick(1_500);
    expect(current().status).toBe('CLOSED');
    expect(current().closedReason).toBe('UNLINKED');
    expect(await profileWiped()).toBe(true);

    // Ese browser sigue mostrando QR: escanearlo ya no "conecta" nada.
    attempts[0].options.catchQR(QR, '', 1, 'orphan');
    attempts[0].options.statusFind('inChat');
    expect(current().status).toBe('CLOSED');
  });

  it('conectado → desvinculan desde el teléfono → CLOSED, login borrado', async () => {
    await start();
    const wpp = fakeWppClient('59170000001');
    last().resolve(wpp);
    await tick(0);
    expect(current().status).toBe('CONNECTED');

    last().options.statusFind('disconnectedMobile');
    await tick(1_500);
    expect(wpp.close).toHaveBeenCalled();
    expect(current().status).toBe('CLOSED');
    expect(current().closedReason).toBe('UNLINKED');
    expect(await profileWiped()).toBe(true);
  });

  it('cambiar número: logout → Conectar → QR nuevo → otro número', async () => {
    await start();
    last().resolve(fakeWppClient('59170000001'));
    await tick(0);
    expect(current().connectedNumber).toBe('59170000001');

    const reset = resetSession(SESSION, { reason: 'LOGOUT', wipeAuth: true });
    // Un "Conectar" inmediato espera a que termine el borrado del perfil.
    const req = fakeReq({ manualStart: true });
    new CreateSessionUtil().opendata(req as any, SESSION);
    await tick(1_500);
    await reset;
    await tick(0);
    expect(await profileWiped()).toBe(true);
    expect(attempts).toHaveLength(2);

    await showQrFor(20_000);
    expect(current().status).toBe('QRCODE');
    last().resolve(fakeWppClient('59170000002'));
    await tick(0);
    expect(current().status).toBe('CONNECTED');
    expect(current().connectedNumber).toBe('59170000002');
    expect(req.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('59170000001 → 59170000002')
    );
  });

  it('browser se cae estando conectado → reinicio automático (sin QR)', async () => {
    await start();
    last().resolve(fakeWppClient('59170000001'));
    await tick(0);

    last().options.statusFind('browserClose');
    await tick(3_100);
    expect(attempts).toHaveLength(2);
    expect(fs.existsSync(path.join(USER_DATA_ROOT, SESSION))).toBe(true);
  });

  it('falla al iniciar: el cooldown frena reintentos automáticos, no los manuales', async () => {
    await start();
    last().reject(new Error('browser no lanza'));
    await tick(0);
    expect(current().status).toBe('CLOSED');
    expect(current().closedReason).toBe('START_FAILED');

    await start();
    expect(attempts).toHaveLength(1);

    await start(fakeReq({ manualStart: true }));
    expect(attempts).toHaveLength(2);
  });

  it('"Conectar" dos veces no lanza dos browsers', async () => {
    await start();
    await start(fakeReq({ manualStart: true }));
    expect(attempts).toHaveLength(1);
  });
});
