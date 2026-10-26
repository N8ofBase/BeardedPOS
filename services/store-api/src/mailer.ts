// Email to staff and reviewers. Offline it only logs; a real sender comes with hosting (step 5).
export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

export const logMailer = (log: (line: string) => void = console.log): Mailer => ({
  async send(to, subject) {
    log(`[store mail] to ${to}: ${subject}`);
  },
});

/** Sends through Amazon SES (hosted). `send` is the SES call, so tests can pass their own. */
export function sesMailer(from: string, send: (input: SesEmail) => Promise<unknown>): Mailer {
  return {
    async send(to, subject, text) {
      await send({
        FromEmailAddress: from,
        Destination: { ToAddresses: [to] },
        Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
      });
    },
  };
}

export interface SesEmail {
  FromEmailAddress: string;
  Destination: { ToAddresses: string[] };
  Content: { Simple: { Subject: { Data: string }; Body: { Text: { Data: string } } } };
}
