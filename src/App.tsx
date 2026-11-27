import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAdmin, RequireAuth } from './auth/guards';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import ProfilePage from './pages/ProfilePage';
import AdminUsersPage from './pages/admin/AdminUsersPage';
import AdminLogsPage from './pages/admin/AdminLogsPage';
import NotFoundPage from './pages/NotFoundPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="register" element={<RegisterPage />} />
            <Route path="reset-password" element={<ResetPasswordPage />} />
            <Route path="profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
            <Route path="admin/users" element={<RequireAdmin><AdminUsersPage /></RequireAdmin>} />
            <Route path="admin/logs" element={<RequireAdmin><AdminLogsPage /></RequireAdmin>} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
