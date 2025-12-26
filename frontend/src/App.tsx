import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { RequirePermission } from '@/components/auth/RequirePermission';
import { LoginPage } from '@/pages/auth/LoginPage';
import { AuthCallback } from '@/pages/auth/AuthCallback';
import { MainLayout } from '@/components/layouts/MainLayout';
import { ClientListPage } from '@/pages/clients/ClientListPage';
import { ClientDetailLayout } from '@/pages/clients/ClientDetailLayout';
import { ClientOverviewPage } from '@/pages/clients/ClientOverviewPage';
import { ClientMedicationsPage } from '@/pages/clients/ClientMedicationsPage';
import { MedicationManagementPage } from '@/pages/medications/MedicationManagementPage';
import { OrganizationListPage } from '@/pages/organizations/OrganizationListPage';
import { OrganizationCreatePage } from '@/pages/organizations/OrganizationCreatePage';
import { OrganizationBootstrapStatusPage } from '@/pages/organizations/OrganizationBootstrapStatusPage';
import { OrganizationDashboard } from '@/pages/organizations/OrganizationDashboard';
import { AcceptInvitationPage } from '@/pages/organizations/AcceptInvitationPage';
import {
  OrganizationUnitsListPage,
  OrganizationUnitsManagePage,
} from '@/pages/organization-units';
import { RolesPage, RolesManagePage } from '@/pages/roles';
import { DebugControlPanel } from '@/components/debug/DebugControlPanel';
import { LogOverlay } from '@/components/debug/LogOverlay';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Logger } from '@/utils/logger';
import { Toaster } from 'sonner';
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
    <ErrorBoundary>
      {/* Debug Control Panel and Log Overlay */}
      <DebugControlPanel />
      <LogOverlay />

      {/* Toast notifications */}
      <Toaster richColors position="top-right" />

      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/accept-invitation" element={<AcceptInvitationPage />} />

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

                {/* Organization Management routes */}
                <Route path="/organizations" element={<OrganizationListPage />} />
                <Route path="/organizations/create" element={
                  <RequirePermission permission="organization.create" fallback="/clients">
                    <OrganizationCreatePage />
                  </RequirePermission>
                } />
                <Route path="/organizations/:organizationId/bootstrap" element={<OrganizationBootstrapStatusPage />} />
                <Route path="/organizations/:orgId/dashboard" element={<OrganizationDashboard />} />
                <Route path="/organizations/:orgId/edit" element={<div>Organization Edit - Coming Soon</div>} />

                {/* Organization Units routes (internal hierarchy management) */}
                <Route path="/organization-units" element={
                  <RequirePermission permission="organization.view_ou" fallback="/clients">
                    <OrganizationUnitsListPage />
                  </RequirePermission>
                } />
                <Route path="/organization-units/manage" element={
                  <RequirePermission permission="organization.view_ou" fallback="/clients">
                    <OrganizationUnitsManagePage />
                  </RequirePermission>
                } />
                {/* Create and Edit routes removed - functionality consolidated into ManagePage */}

                {/* Role Management routes */}
                <Route path="/roles" element={
                  <RequirePermission permission="role.create" fallback="/clients">
                    <RolesPage />
                  </RequirePermission>
                } />
                <Route path="/roles/manage" element={
                  <RequirePermission permission="role.create" fallback="/clients">
                    <RolesManagePage />
                  </RequirePermission>
                } />

                {/* Other main sections */}
                <Route path="/medications" element={<MedicationsPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
            </Route>
            
            {/* 404 */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;