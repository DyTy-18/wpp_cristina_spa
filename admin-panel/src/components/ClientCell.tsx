interface ClientCellProps {
  nombre?: string;
  phone: string;
}

/**
 * Muestra el nombre del cliente como dato principal y el teléfono como
 * referencia secundaria — para alguien no técnico, un nombre se reconoce
 * mucho más rápido que una fila de dígitos. Si no hay nombre guardado
 * (recordatorios viejos, de antes de este cambio) solo se ve el teléfono.
 */
export default function ClientCell({ nombre, phone }: ClientCellProps) {
  if (!nombre) return <>{phone}</>;

  return (
    <div>
      <div>{nombre}</div>
      <div className="cell-sub">{phone}</div>
    </div>
  );
}
