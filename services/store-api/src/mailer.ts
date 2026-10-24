// Email to staff and reviewers. Offline it only logs; a real sender comes with hosting (step 5).
export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

export const logMailer = (log: (line: string) => void = console.log): Mailer => ({
  async send(to, subject) {
    log(`[store mail] to ${to}: ${subject}`);
  },
});
