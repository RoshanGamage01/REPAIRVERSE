import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AdminShell, ConsumerShell, ProShell } from './shells';
import { RequireAuth } from '../lib/auth';
import { FullPageSpinner, PageHeader } from '../ui';
import { Login, Register } from '../features/auth/AuthPages';

const L = (f: () => Promise<{ default: any }>) => lazy(f);
const C = {
  Home: L(() => import('../features/consumer/Home')),
  Identify: L(() => import('../features/consumer/Identify')),
  Diagnose: L(() => import('../features/consumer/Diagnose')),
  StartDiagnosis: L(() => import('../features/consumer/StartDiagnosis')),
  Guide: L(() => import('../features/consumer/Guide')),
  Decision: L(() => import('../features/consumer/Decision')),
  Discover: L(() => import('../features/consumer/Discover')),
  ProductProfile: L(() => import('../features/consumer/ProductProfile')),
  ComponentProfile: L(() => import('../features/consumer/ComponentProfile')),
  Procedure: L(() => import('../features/consumer/Procedure')),
  PartsDiscovery: L(() => import('../features/consumer/PartsDiscovery')),
  PartDetail: L(() => import('../features/consumer/PartDetail')),
  Devices: L(() => import('../features/consumer/Devices')),
  DeviceDetail: L(() => import('../features/consumer/DeviceDetail')),
  History: L(() => import('../features/consumer/History')),
  Saved: L(() => import('../features/consumer/Saved')),
  Profile: L(() => import('../features/consumer/Profile')),
  Technicians: L(() => import('../features/consumer/Technicians')),
  Developers: L(() => import('../features/shared/Developers')),
};
const P = {
  Overview: L(() => import('../features/pro/Overview')),
  Jobs: L(() => import('../features/pro/Jobs')),
  NewJob: L(() => import('../features/pro/NewJob')),
  JobDetail: L(() => import('../features/pro/JobDetail')),
  Diagnostics: L(() => import('../features/pro/Diagnostics')),
  Products: L(() => import('../features/pro/Products')),
  Parts: L(() => import('../features/pro/Parts')),
  Contributions: L(() => import('../features/pro/Contributions')),
  Settings: L(() => import('../features/pro/Settings')),
};
const A = {
  Overview: L(() => import('../features/admin/Overview')),
  Knowledge: L(() => import('../features/admin/Knowledge')),
  Products: L(() => import('../features/admin/Products')),
  Components: L(() => import('../features/admin/Components')),
  Repairs: L(() => import('../features/admin/Repairs')),
  Contributions: L(() => import('../features/admin/Contributions')),
  Verification: L(() => import('../features/admin/Verification')),
  Users: L(() => import('../features/admin/Users')),
  AI: L(() => import('../features/admin/AI')),
  Api: L(() => import('../features/admin/Api')),
  System: L(() => import('../features/admin/System')),
};

const auth = (el: JSX.Element, roles?: any[]) => <RequireAuth roles={roles}>{el}</RequireAuth>;

export function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route element={<ConsumerShell />}>
          <Route index element={<C.Home />} />
          <Route path="identify" element={auth(<C.Identify />)} />
          <Route path="diagnose/new" element={auth(<C.StartDiagnosis />)} />
          <Route path="diagnose/:id" element={auth(<C.Diagnose />)} />
          <Route path="diagnose/:id/guide/:fmId" element={auth(<C.Guide />)} />
          <Route path="diagnose/:id/decision" element={auth(<C.Decision />)} />
          <Route path="discover" element={<C.Discover />} />
          <Route path="products/:slug" element={<C.ProductProfile />} />
          <Route path="components/:id" element={<C.ComponentProfile />} />
          <Route path="procedures/:id" element={<C.Procedure />} />
          <Route path="parts" element={<C.PartsDiscovery />} />
          <Route path="parts/:id" element={<C.PartDetail />} />
          <Route path="technicians" element={<C.Technicians />} />
          <Route path="developers" element={auth(<C.Developers />)} />
          <Route path="devices" element={auth(<C.Devices />)} />
          <Route path="devices/:id" element={auth(<C.DeviceDetail />)} />
          <Route path="history" element={auth(<C.History />)} />
          <Route path="saved" element={auth(<C.Saved />)} />
          <Route path="profile" element={auth(<C.Profile />)} />
        </Route>
        <Route path="/pro" element={auth(<ProShell />, ['technician', 'admin'])}>
          <Route index element={<P.Overview />} />
          <Route path="jobs" element={<P.Jobs />} />
          <Route path="jobs/new" element={<P.NewJob />} />
          <Route path="jobs/:id" element={<P.JobDetail />} />
          <Route path="diagnostics" element={<P.Diagnostics />} />
          <Route path="products" element={<P.Products />} />
          <Route path="parts" element={<P.Parts />} />
          <Route path="contributions" element={<P.Contributions />} />
          <Route path="settings" element={<P.Settings />} />
        </Route>
        <Route path="/admin" element={auth(<AdminShell />, ['admin', 'moderator'])}>
          <Route index element={<A.Overview />} />
          <Route path="knowledge" element={<A.Knowledge />} />
          <Route path="products" element={<A.Products />} />
          <Route path="components" element={<A.Components />} />
          <Route path="repairs" element={<A.Repairs />} />
          <Route path="contributions" element={<A.Contributions />} />
          <Route path="verification" element={<A.Verification />} />
          <Route path="users" element={<A.Users />} />
          <Route path="ai" element={<A.AI />} />
          <Route path="api" element={<A.Api />} />
          <Route path="system" element={<A.System />} />
        </Route>
        <Route path="*" element={<div className="container-page py-20"><PageHeader title="Not found" description="This page doesn't exist." /></div>} />
      </Routes>
    </Suspense>
  );
}
