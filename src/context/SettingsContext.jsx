import { createContext, useEffect, useState, useLayoutEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { tableWidth } from "../data/constants";
import { queryConfig } from "../utils/queryConfig";

const defaultSettings = {
  strictMode: false,
  showFieldSummary: true,
  showGrid: true,
  snapToGrid: false,
  showDataTypes: true,
  mode: "light",
  autosave: true,
  showCardinality: true,
  showRelationshipLabels: true,
  tableWidth: tableWidth,
  showDebugCoordinates: false,
  showComments: false,
  sketchMode: true,
};

export const SettingsContext = createContext({
  settings: defaultSettings,
  setSettings: () => {},
});

export default function SettingsContextProvider({ children }) {
  const [searchParams] = useSearchParams();

  const [settings, setSettings] = useState(() => {
    const savedSettings = localStorage.getItem("settings");
    let baseSettings = savedSettings
      ? { ...defaultSettings, ...JSON.parse(savedSettings) }
      : defaultSettings;

    // One-time flip to the Excalidraw look for settings saved before it
    // became the default; the user's explicit choice sticks afterwards.
    if (!localStorage.getItem("sketchDefaultApplied")) {
      baseSettings = { ...baseSettings, sketchMode: true };
      localStorage.setItem("sketchDefaultApplied", "1");
    }

    const theme = searchParams.get(queryConfig.theme.key);
    if (queryConfig.theme.isValid(theme)) {
      baseSettings = { ...baseSettings, mode: theme };
    }

    return baseSettings;
  });

  // Before paint, so a dark-mode reload never flashes the light theme. This
  // used to be duplicated by a useThemedPage hook that pages called on top of
  // the provider; the provider is the only writer now.
  useLayoutEffect(() => {
    document.body.setAttribute("theme-mode", settings.mode);
  }, [settings.mode]);

  useEffect(() => {
    localStorage.setItem("settings", JSON.stringify(settings));
  }, [settings]);

  return (
    <SettingsContext.Provider value={{ settings, setSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}
