import Dashboard from "./components/Dashboard";

// FX-SENTINEL operations console (SPEC §5.14): all six demo beats run from this screen —
// no terminal visible. Live data via polling + SSE (api) and WS (bridge device state).
export default function Home() {
  return <Dashboard />;
}
