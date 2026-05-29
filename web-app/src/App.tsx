import DesktopApp from "./DesktopApp";
import MobileApp from "./MobileApp";
import { AuthGate } from "./components/AuthGate";
import { Toast } from "./components/Toast";

export default function App() {
  return (
    <AuthGate>
      <div className="hidden md:contents">
        <DesktopApp />
      </div>
      <div className="contents md:hidden">
        <MobileApp />
      </div>
      <Toast />
    </AuthGate>
  );
}
