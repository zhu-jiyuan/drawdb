import { createContext, useContext } from "react";

// status: "loading" | "cloud" (logged in) | "anon" (backend up, not logged in)
//       | "off" (no cloud backend reachable)
// expired: session died mid-use; extensions stay mounted so no edits get
// rerouted to local storage — the overlay shows a re-login dialog instead.
export const CloudAuthContext = createContext({
  status: "off",
  expired: false,
  onLoggedIn: () => {},
  onLoggedOut: () => {},
});

export const useCloudAuth = () => useContext(CloudAuthContext);
