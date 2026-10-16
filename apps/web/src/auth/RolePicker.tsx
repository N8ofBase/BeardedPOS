import { ROLE_LABEL, type Role } from "@pet-pos/core";
import type { DemoStaff } from "@pet-pos/db";

const WHAT: Record<Role, string> = {
  owner: "Everything: prices, staff, settings, reports and refunds.",
  manager: "Inventory, schedules and refunds up to a limit.",
  cashier: "Ring sales, look up and add customers, check in grooms.",
  groomer: "Own schedule, grooming notes and photos.",
};

/** Demo sign-in: pick who's using the register. Hosted mode replaces this with Cognito sign-in. */
export function RolePicker({ staff, onPick }: { staff: DemoStaff[]; onPick: (s: DemoStaff) => void }) {
  return (
    <div className="center">
      <div className="card">
        <h1>Who's using the register?</h1>
        <p className="muted">
          This is a demo with sample data. Pick a role to see what that person can do. You can switch any
          time.
        </p>
        <div className="roles">
          {staff.map((s) => (
            <button key={s.id} type="button" className="role" onClick={() => onPick(s)}>
              <b>{ROLE_LABEL[s.role]}</b>
              <span>{s.name}</span>
              <span>{WHAT[s.role]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
