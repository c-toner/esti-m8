import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Workspace from "../../src/components/workspace";
import Login from "../../src/app/login/page";
import "../../src/app/globals.css";
function App() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return path === "/login" ? (
    <Login />
  ) : (
    <Workspace email="fixture@example.test" />
  );
}
createRoot(document.getElementById("root")!).render(<App />);
