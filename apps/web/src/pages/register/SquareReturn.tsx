import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { readSquarePosAnswer } from "@bearded/core";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { rememberHandoff, waitingHandoff } from "./squareHandoff.ts";

/** Where the register picks a sale back up after Square's app answered. */
export interface CardReturn {
  saleId: string;
  message: string | null;
}

/**
 * The page the Square POS app sends the browser back to. The server checks Square's answer with
 * Square before anything is paid, then the register opens on the same sale.
 */
export function SquareReturn() {
  const { api } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const answer = useMemo(() => readSquarePosAnswer(location.search), [location.search]);
  const [waiting] = useState(waitingHandoff);

  const finish = useQuery({
    queryKey: ["square-return", location.search],
    queryFn: () => api.call("finishCardHandoff", answer!),
    enabled: !!answer,
    retry: false,
    gcTime: 0,
  });

  useEffect(() => {
    const back = (r: CardReturn) => navigate("/register", { replace: true, state: { cardReturn: r } });
    if (!answer) {
      if (waiting)
        back({
          saleId: waiting.saleId,
          message: "Square didn't send an answer back. Tap Find it in Square.",
        });
      return;
    }
    if (finish.data) {
      if (finish.data.status !== "pending") rememberHandoff(null);
      back({ saleId: finish.data.saleId, message: finish.data.message ?? null });
    } else if (finish.error && waiting) {
      back({ saleId: waiting.saleId, message: errorMessage(finish.error) });
    }
  }, [answer, waiting, finish.data, finish.error, navigate]);

  return (
    <div className="center">
      <p className="muted" role="status">
        {finish.error && !waiting
          ? errorMessage(finish.error)
          : !answer && !waiting
            ? "This page is for answers from the Square app."
            : "Checking the card payment with Square…"}
      </p>
      {((finish.error && !waiting) || (!answer && !waiting)) && (
        <button type="button" onClick={() => navigate("/register", { replace: true })}>
          Back to the register
        </button>
      )}
    </div>
  );
}
