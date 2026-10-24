import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router";
import { DataProvider } from "./api/data.tsx";
import { CartProvider } from "./cart/CartProvider.tsx";
import { CartDrawer } from "./components/CartDrawer.tsx";
import { CartPage } from "./pages/CartPage.tsx";
import { GamePage } from "./pages/GamePage.tsx";
import { Home } from "./pages/Home.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { ReviewsPage } from "./pages/ReviewsPage.tsx";
import { ShopPage } from "./pages/ShopPage.tsx";
import { ThanksPage } from "./pages/ThanksPage.tsx";
import { WholesalePage } from "./pages/WholesalePage.tsx";
import { Footer } from "./sections/Footer.tsx";
import { Header } from "./sections/Header.tsx";
import { VipPopup } from "./vip/VipPopup.tsx";

/** On a new page, start at the top, or at the section a link like /#vip points to. */
function ScrollOnNavigate() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
    if (target) target.scrollIntoView?.();
    else window.scrollTo?.(0, 0);
  }, [pathname, hash]);
  return null;
}

export function App() {
  return (
    <DataProvider>
      <CartProvider>
        <div className="bbg">
          <a className="skip" href="#main">
            Skip to content
          </a>
          <ScrollOnNavigate />
          <Header />
          <main id="main">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/shop" element={<ShopPage />} />
              <Route path="/games/:slug" element={<GamePage />} />
              <Route path="/reviews" element={<ReviewsPage />} />
              <Route path="/cart" element={<CartPage />} />
              <Route path="/thanks" element={<ThanksPage />} />
              <Route path="/wholesale" element={<WholesalePage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
          <Footer />
          <CartDrawer />
          <VipPopup />
        </div>
      </CartProvider>
    </DataProvider>
  );
}
