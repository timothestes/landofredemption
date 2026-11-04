import { NATIONALS_CONFIG } from "../config/nationals";

export const metadata = {
  title: "Tournament Registration",
  description: `Register for the ${NATIONALS_CONFIG.year} National Redemption Tournament, ${NATIONALS_CONFIG.dates}.`,
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
