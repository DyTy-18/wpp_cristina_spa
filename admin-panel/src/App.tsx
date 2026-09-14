import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { AuthProvider } from './auth/AuthContext';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import ProtectedRoute from './routes/ProtectedRoute';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
