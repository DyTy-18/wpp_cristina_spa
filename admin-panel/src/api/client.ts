import axios from 'axios';

export const TOKEN_STORAGE_KEY = 'wpp_admin_token';

// En producción el panel vive bajo /admin (servido por el mismo backend);
// en dev vive en la raíz del servidor de Vite.
const BASE_PATH = import.meta.env.PROD ? '/admin' : '';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || undefined,
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      if (window.location.pathname !== `${BASE_PATH}/login`) {
        window.location.assign(`${BASE_PATH}/login`);
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
