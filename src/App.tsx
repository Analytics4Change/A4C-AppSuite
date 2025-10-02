import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { LoginPage } from '@/pages/auth/LoginPage';
import { AuthCallback } from '@/pages/auth/AuthCallback';
import { MainLayout } from '@/components/layouts/MainLayout';
import { ClientListPage } from '@/pages/clients/ClientListPage';
import { ClientDetailLayout } from '@/pages/clients/ClientDetailLayout';
import { ClientOverviewPage } from '@/pages/clients/ClientOverviewPage';
import { ClientMedicationsPage } from '@/pages/clients/ClientMedicationsPage';
import { MedicationManagementPage } from '@/pages/medications/MedicationManagementPage';
import { ProviderListPage } from '@/pages/providers/ProviderListPage';
import { ProviderCreatePage } from '@/pages/providers/ProviderCreatePage';
import { ProviderDetailPage } from '@/pages/providers/ProviderDetailPage';
import { BootstrapPage } from '@/pages/admin/BootstrapPage';
import { DebugControlPanel } from '@/components/debug/DebugControlPanel';
import { LogOverlay } from '@/components/debug/LogOverlay';
import { DiagnosticsProvider } from '@/contexts/DiagnosticsContext';
import { Logger } from '@/utils/logger';
import './index.css';

const log = Logger.getLogger('main');

const MedicationsPage = () => (
  <div>
    <h1 className="text-2xl font-bold mb-4">Medications Library</h1>
    <p>Coming soon...</p>
  </div>
);

const ReportsPage = () => (
  <div>
    <h1 className="text-2xl font-bold mb-4">Reports</h1>
    <p>Coming soon...</p>
  </div>
);

const SettingsPage = () => (
  <div>
    <h1 className="text-2xl font-bold mb-4">Settings</h1>
    <p>Coming soon...</p>
  </div>
);

function App() {
  log.info('Application starting');
  return (
    <DiagnosticsProvider>
      {/* Debug Control Panel and Log Overlay */}
      <DebugControlPanel />
      <LogOverlay />
      
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            {/* Protected Routes */}
            <Route element={<ProtectedRoute />}>
              {/* Redirect root to clients */}
              <Route path="/" element={<Navigate to="/clients" replace />} />
              
              {/* Main app layout with sidebar */}
              <Route element={<MainLayout />}>
                {/* Client routes */}
                <Route path="/clients" element={<ClientListPage />} />
                <Route path="/clients/:clientId" element={<ClientDetailLayout />}>
                  <Route index element={<ClientOverviewPage />} />
                  <Route path="medications" element={<ClientMedicationsPage />} />
                  <Route path="medications/add" element={<MedicationManagementPage />} />
                  <Route path="history" element={<div>Client History - Coming Soon</div>} />
                  <Route path="documents" element={<div>Client Documents - Coming Soon</div>} />
                </Route>

                {/* Provider Management routes */}
                <Route path="/providers" element={<ProviderListPage />} />
                <Route path="/providers/create" element={<ProviderCreatePage />} />
                <Route path="/providers/:id/view" element={<ProviderDetailPage />} />
                <Route path="/providers/:id/edit" element={<div>Provider Edit - Coming Soon</div>} />

                {/* Other main sections */}
                <Route path="/medications" element={<MedicationsPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/settings" element={<SettingsPage />} />

                {/* Admin section */}
                <Route path="/admin/bootstrap" element={<BootstrapPage />} />
              </Route>
            </Route>
            
            {/* 404 */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </DiagnosticsProvider>
  );
}

export default App;