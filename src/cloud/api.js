import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_CLOUD_API_URL || "/api",
  withCredentials: true,
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (
      err?.response?.status === 401 &&
      !err.config?.url?.startsWith("/auth/")
    ) {
      window.dispatchEvent(new CustomEvent("cloud:unauthorized"));
    }
    return Promise.reject(err);
  },
);

export const isNetworkError = (err) => !!err && !err.response;

export const login = (password) => api.post("/auth/login", { password });
export const logout = () => api.post("/auth/logout");
export const me = (config) => api.get("/auth/me", config);

export const getMcpKeyStatus = () => api.get("/mcp-key");
export const generateMcpKey = () => api.post("/mcp-key");
export const revokeMcpKey = () => api.delete("/mcp-key");

export const listDiagrams = () => api.get("/diagrams");
export const getDiagram = (id) => api.get(`/diagrams/${id}`);
export const putDiagram = (id, body) => api.put(`/diagrams/${id}`, body);
export const deleteDiagram = (id) => api.delete(`/diagrams/${id}`);
