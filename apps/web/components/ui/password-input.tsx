"use client";

import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export interface PasswordInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /**
   * Estado inicial del toggle. Default: contraseña oculta.
   * Casi nunca hay razon para cambiarlo — la contraseña arranca oculta
   * y el usuario decide si mostrarla.
   */
  defaultVisible?: boolean;
  /** Clase para el wrapper (default = ancho completo). */
  wrapperClassName?: string;
}

/**
 * PasswordInput — input tipo password con toggle 'ojito' para mostrar/ocultar.
 *
 * Estandar de UX moderno (usado por Google, GitHub, Vercel, Linear, todos):
 * la persona ve puntitos por default, y con un click puede verificar que
 * tipeo lo correcto. Reduce login fails y aumenta velocidad de tipeo.
 *
 * Accesibilidad:
 *   - El boton toggle no participa del tab order (tabIndex=-1) porque el
 *     Enter debe enviar el form, no togglear la visibilidad.
 *   - aria-label describe la accion.
 *   - autoComplete se preserva (current-password, new-password) para que
 *     los password managers funcionen sin cambios.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, wrapperClassName, defaultVisible = false, ...props }, ref) => {
    const [visible, setVisible] = useState(defaultVisible);
    return (
      <div className={cn("relative w-full", wrapperClassName)}>
        <input
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn(
            "flex h-11 w-full rounded-lg border border-slate-300 bg-white pl-4 pr-11 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:opacity-50",
            className,
          )}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          tabIndex={-1}
          aria-label={visible ? "Ocultar contrasena" : "Mostrar contrasena"}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";
