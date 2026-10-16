import { useEffect, useState } from "react";

/** For reversible actions (archive, reset demo): the first tap asks, the second does it. */
export function TwoTapButton({
  label,
  confirmLabel,
  onConfirm,
  className,
  disabled,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 8000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        void onConfirm();
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
