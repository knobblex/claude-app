// Radar mobile entry. The shell hands us `onBack` to return to the projects hub.

import { RadarScreen } from "./RadarScreen";

export default function MobileRadar({ onBack }: { onBack: () => void }) {
  return <RadarScreen onBack={onBack} />;
}
