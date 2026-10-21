import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

/** An optional button on the toast, like Undo. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

type Show = (message: string, action?: ToastAction) => void;

const ToastContext = createContext<Show>(() => {});

/** Short confirmation at the bottom of the screen, as in the prototype ("Product saved"). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; action?: ToastAction } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<Show>((message, action) => {
    setToast({ message, action });
    if (timer.current) clearTimeout(timer.current);
    // A toast with Undo stays longer, so there's time to tap it.
    timer.current = setTimeout(() => setToast(null), action ? 7000 : 2600);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast.message}
          {toast.action && (
            <>
              {" · "}
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  toast.action!.onClick();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            </>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): Show {
  return useContext(ToastContext);
}
