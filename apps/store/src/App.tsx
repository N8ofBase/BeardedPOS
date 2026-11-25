import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router";
import { DataProvider } from "./api/data.tsx";
import { BuddyProvider } from "./buddy/BuddyProvider.tsx";
import { CartProvider } from "./cart/CartProvider.tsx";
import { CartDrawer } from "./components/CartDrawer.tsx";
import { AccountPage } from "./pages/AccountPage.tsx";
import { BeardPage } from "./pages/BeardPage.tsx";
import { BundlePage } from "./pages/BundlePage.tsx";
import { CartPage } from "./pages/CartPage.tsx";
import { CheckoutPreviewPage } from "./pages/CheckoutPreviewPage.tsx";
import { GamePage } from "./pages/GamePage.tsx";
import { Home } from "./pages/Home.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { ReviewsPage } from "./pages/ReviewsPage.tsx";
import { SoccerBlockerRulesPage } from "./pages/RulesPage.tsx";
import { ShopPage } from "./pages/ShopPage.tsx";
import { ThanksPage } from "./pages/ThanksPage.tsx";
import { UnsubscribePage } from "./pages/UnsubscribePage.tsx";
import { VideosPage } from "./pages/VideosPage.tsx";
import { WholesalePage } from "./pages/WholesalePage.tsx";
import { Footer } from "./sections/Footer.tsx";
import { Header } from "./sections/Header.tsx";
import { NoticeBar, PreviewBar, SiteProvider } from "./content/SiteProvider.tsx";
import { BehindTheBeard } from "./staff/BehindTheBeard.tsx";
import { TrackerProvider } from "./track/Tracker.tsx";
import { BuddyPopup } from "./buddy/BuddyPopup.tsx";

/** On a new page, start at the top, or at the section a link like /#buddy points to. */
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
    <SiteProvider>
      <TrackerProvider>
        <DataProvider>
          <CartProvider>
            <BuddyProvider>
              <div className="bbg">
                <a className="skip" href="#main">
                  Skip to content
                </a>
                <ScrollOnNavigate />
                <PreviewBar />
                <NoticeBar />
                <Header />
                <main id="main">
                  <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/shop" element={<ShopPage />} />
                    <Route path="/bundle" element={<BundlePage />} />
                    <Route path="/games/:slug" element={<GamePage />} />
                    <Route path="/beards/:id" element={<BeardPage />} />
                    <Route path="/soccerblocker" element={<SoccerBlockerRulesPage />} />
                    <Route path="/reviews" element={<ReviewsPage />} />
                    <Route path="/videos" element={<VideosPage />} />
                    <Route path="/cart" element={<CartPage />} />
                    <Route path="/account" element={<AccountPage />} />
                    <Route path="/checkout-preview/:id" element={<CheckoutPreviewPage />} />
                    <Route path="/thanks" element={<ThanksPage />} />
                    <Route path="/unsubscribe" element={<UnsubscribePage />} />
                    <Route path="/wholesale" element={<WholesalePage />} />
                    <Route path="/behind-the-beard" element={<BehindTheBeard />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </main>
                <Footer />
                <CartDrawer />
                <BuddyPopup />
              </div>
            </BuddyProvider>
          </CartProvider>
        </DataProvider>
      </TrackerProvider>
    </SiteProvider>
  );
}
