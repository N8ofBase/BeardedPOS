import { Beards } from "../sections/Beards.tsx";
import { Hero } from "../sections/Hero.tsx";
import { Retailers } from "../sections/Retailers.tsx";
import { Shelf } from "../sections/Shelf.tsx";
import { Shop } from "../sections/Shop.tsx";
import { Songs } from "../sections/Songs.tsx";
import { VipBand } from "../sections/VipBand.tsx";
import { WhatPlayersSay } from "../sections/WhatPlayersSay.tsx";

export function Home() {
  return (
    <>
      <Hero />
      <Shelf />
      <WhatPlayersSay />
      <Shop />
      <Songs />
      <VipBand />
      <Beards />
      <Retailers />
    </>
  );
}
