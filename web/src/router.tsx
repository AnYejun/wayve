// Route table. Every page is lazy so the phone pages never download dashboard code.
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router';
import { Toaster } from '@/components/ui/sonner';

const HomePage = lazy(() => import('./pages/HomePage.tsx'));
const SetupPage = lazy(() => import('./pages/SetupPage.tsx'));
const DevicePage = lazy(() => import('./pages/DevicePage.tsx'));
const StaffPage = lazy(() => import('./pages/StaffPage.tsx'));
const JoinPage = lazy(() => import('./pages/JoinPage.tsx'));
const AdminClaimPage = lazy(() => import('./pages/AdminClaimPage.tsx'));
const ChatPage = lazy(() => import('./pages/ChatPage.tsx'));
const ScribePage = lazy(() => import('./pages/ScribePage.tsx'));
const LoginPage = lazy(() => import('./pages/LoginPage.tsx'));
const ScanPage = lazy(() => import('./pages/ScanPage.tsx'));
const AppShell = lazy(() => import('./shell/AppShell.tsx'));
const SlotSetupPage = lazy(() => import('./pages/SlotSetupPage.tsx'));
const InvitePage = lazy(() => import('./pages/InvitePage.tsx'));
const LatestEvent = lazy(() => import('./shell/LatestEvent.tsx'));

/** Old per-page URLs → the one app shell. */
function ToShell({ section }: { section: string }) {
  const { eventId } = useParams();
  return <Navigate to={eventId ? `/e/${eventId}/${section}` : '/'} replace />;
}

function Blank() {
  return <div className="min-h-dvh bg-canvas" aria-busy="true" />;
}

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Blank />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/setup/:eventId" element={<ToShell section="settings" />} />
          <Route path="/dashboard" element={<LatestEvent />} />
          <Route path="/dashboard/:eventId" element={<ToShell section="map" />} />
          <Route path="/device/:id" element={<DevicePage />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="/j/:code" element={<JoinPage />} />
          <Route path="/s/:code/:slotId" element={<SlotSetupPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/ops" element={<LatestEvent />} />
          <Route path="/ops/:eventId" element={<ToShell section="dashboard" />} />
          <Route path="/scribe/:id" element={<ScribePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<LoginPage />} />
          <Route path="/data/:eventId" element={<ToShell section="database" />} />
          <Route path="/e/:eventId" element={<AppShell />} />
          <Route path="/e/:eventId/:section" element={<AppShell />} />
          <Route path="/scan/:eventId" element={<ScanPage />} />
          <Route path="/a/:eventId" element={<AdminClaimPage />} />
          <Route path="/i/:token" element={<InvitePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <Toaster position="top-center" />
    </BrowserRouter>
  );
}
