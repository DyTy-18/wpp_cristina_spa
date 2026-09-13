import { useState, type FormEvent } from 'react';

import apiClient from '../api/client';

const TEMPLATES = [
  { value: 'default', label: 'General' },
  { value: 'recordatorio_24h', label: 'Recordatorio 24h antes' },
  { value: 'recordatorio_1h', label: 'Recordatorio 1h antes' },
  { value: 'confirmacion', label: 'Confirmación' },
  { value: 'cancelacion', label: 'Cancelación' },
  { value: 'reagendacion', label: 'Reagendación' },
];

const initialForm = {
  nombre: '',
  apellido: '',
  telefono: '',
  fecha: '',
  hora: '',
  servicios: '',
  citaId: '',
  template: 'default',
};

export default function SendReminderPanel() {
  const [form, setForm] = useState(initialForm);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<
    { type: 'success' | 'error'; text: string } | null
  >(null);

  const update = (field: keyof typeof initialForm) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setFeedback(null);

    try {
      await apiClient.post('/api/admin/citas/send-reminder', {
        cita: {
          id: form.citaId || undefined,
          fecha: form.fecha,
          hora: form.hora,
          cliente: {
            nombre: form.nombre,
            apellido: form.apellido,
            telefono: form.telefono,
          },
          servicios: form.servicios
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        },
        template: form.template,
      });

      setFeedback({ type: 'success', text: 'Mensaje enviado correctamente.' });
      setForm(initialForm);
      window.dispatchEvent(new Event('citas:sent'));
    } catch (err: any) {
      const message =
        err?.response?.data?.message ?? 'No se pudo enviar el mensaje.';
      setFeedback({ type: 'error', text: message });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <svg
          className="panel-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path
            d="M4 4.5 20 12 4 19.5l3-7.5-3-7.5Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <h2>Enviar recordatorio manual</h2>
      </div>
      <p className="panel-subtitle">
        Manda un mensaje ahora mismo, sin esperar a Laravel.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="field">
            Nombre
            <input value={form.nombre} onChange={update('nombre')} required />
          </label>
          <label className="field">
            Apellido
            <input value={form.apellido} onChange={update('apellido')} required />
          </label>
          <label className="field">
            Teléfono
            <input value={form.telefono} onChange={update('telefono')} required />
          </label>
          <label className="field">
            Cita ID (opcional)
            <input value={form.citaId} onChange={update('citaId')} />
          </label>
          <label className="field">
            Fecha
            <input type="date" value={form.fecha} onChange={update('fecha')} required />
          </label>
          <label className="field">
            Hora
            <input type="time" value={form.hora} onChange={update('hora')} required />
          </label>
          <label className="field field--wide">
            Servicios (separados por coma)
            <input value={form.servicios} onChange={update('servicios')} />
          </label>
          <label className="field">
            Plantilla
            <select value={form.template} onChange={update('template')}>
              {TEMPLATES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="form-actions">
          <button type="submit" disabled={sending}>
            {sending ? 'Enviando…' : 'Enviar'}
          </button>
          {feedback && (
            <p
              className={`form-feedback ${
                feedback.type === 'error' ? 'error-text' : 'success-text'
              }`}
            >
              {feedback.text}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
