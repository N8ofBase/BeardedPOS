import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "../src/App.tsx";
import { offlineStore, StoreContext, type StoreApi } from "../src/api/store.ts";

/** Renders the whole store at `path` with a fake store api. */
export function renderStore(path = "/", store: Partial<StoreApi> = {}) {
  return render(
    <StoreContext.Provider value={{ ...offlineStore, ...store }}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </StoreContext.Provider>,
  );
}
