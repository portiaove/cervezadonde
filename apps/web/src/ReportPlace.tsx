import type { PlaceReport } from '@cervezadonde/shared';
import { useState } from 'react';
import { reportPlace } from './api.js';

const OPTIONS: Array<[PlaceReport['kind'], string]> = [
  ['closed_now', 'Está cerrado ahora'],
  ['closed_permanently', 'Ha cerrado definitivamente'],
  ['no_beer', 'No vende ni sirve cerveza'],
  ['wrong_hours', 'El horario es incorrecto'],
];
export function ReportPlace({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [kind, setKind] = useState<PlaceReport['kind']>('wrong_hours');
  return (
    <div className="place-report">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}>
          Avisar de un dato incorrecto
        </button>
      ) : (
        <>
          <label>
            ¿Qué has observado?{' '}
            <select
              value={kind}
              disabled={state === 'sending' || state === 'sent'}
              onChange={(e) => setKind(e.target.value as PlaceReport['kind'])}
            >
              {OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p>
            El aviso se revisa antes de cambiar la ficha. No necesitas enviar ubicación, fotos ni
            datos personales.
          </p>
          {state === 'sent' ? (
            <output>Gracias. Aviso recibido, pendiente de revisión.</output>
          ) : (
            <button
              type="button"
              disabled={state === 'sending'}
              onClick={async () => {
                setState('sending');
                try {
                  await reportPlace(id, kind);
                  setState('sent');
                } catch {
                  setState('error');
                }
              }}
            >
              {state === 'sending' ? 'Enviando…' : 'Enviar aviso'}
            </button>
          )}
          {state === 'error' && (
            <p role="alert">No se ha podido enviar. Espera unos minutos y vuelve a intentarlo.</p>
          )}
        </>
      )}
    </div>
  );
}
