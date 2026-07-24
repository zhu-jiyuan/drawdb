import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useLayoutEffect } from "react";
import Editor from "./pages/Editor";
import BugReport from "./pages/BugReport";
import Templates from "./pages/Templates";
import Home from "./pages/Home";
import SettingsContextProvider from "./context/SettingsContext";
import NotFound from "./pages/NotFound";
import CloudProvider from "./cloud/CloudProvider";

export default function App() {
  return (
    <BrowserRouter>
      <SettingsContextProvider>
        <CloudProvider>
          <RestoreScroll />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/editor" element={<Editor />} />
            <Route path="/editor/diagrams/:id" element={<Editor />} />
            <Route path="/editor/templates/:id" element={<Editor />} />
            <Route path="/login" element={<Home />} />
            <Route path="/bug-report" element={<BugReport />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </CloudProvider>
      </SettingsContextProvider>
    </BrowserRouter>
  );
}

function RestoreScroll() {
  const location = useLocation();
  useLayoutEffect(() => {
    window.scroll(0, 0);
  }, [location.pathname]);
  return null;
}
