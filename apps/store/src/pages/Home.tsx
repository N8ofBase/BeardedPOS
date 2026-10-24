import { Beards } from "../sections/Beards.tsx";
import { Hero } from "../sections/Hero.tsx";
import { Retailers } from "../sections/Retailers.tsx";
import { Shelf } from "../sections/Shelf.tsx";
import { Shop } from "../sections/Shop.tsx";
import { VipBand } from "../sections/VipBand.tsx";

export function Home() {
  return (
    <>
      <Hero />
      <Shelf />
      <Shop />
      <VipBand />
      <Beards />
      <Retailers />
    </>
  );
}
