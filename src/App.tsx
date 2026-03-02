import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import NotFound from "./pages/NotFound";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Orders from "./pages/Orders";
import ImportOrders from "./pages/ImportOrders";
import DeliveryNote from "./pages/DeliveryNote";
import ReturnNote from "./pages/ReturnNote";
import DeliveryServices from "./pages/DeliveryServices";
import Payments from "./pages/Payments";
import Transactions from "./pages/Transactions";
import Products from "./pages/Products";
import Accessories from "./pages/Accessories";
import Status from "./pages/Status";
import Analytics from "./pages/Analytics";
import SalesChannels from "./pages/SalesChannels";
import Customers from "./pages/Customers";
import Users from "./pages/Users";
import AdsHistory from "./pages/AdsHistory";
import ExpensesDetails from "./pages/ExpensesDetails";
import ExpensesTypes from "./pages/ExpensesTypes";
import Cities from "./pages/Cities";
import Zones from "./pages/Zones";
import Profile from "./pages/Profile";
import Webhooks from "./pages/Webhooks";
import AiKeys from "./pages/AiKeys";
import OwnerBusinesses from "./pages/owner/Businesses";
import OwnerSelectBusiness from "./pages/owner/SelectBusiness";
import OwnerUsers from "./pages/owner/Users";
import OwnerPlans from "./pages/owner/Plans";
import OwnerPayments from "./pages/owner/Payments";
import OwnerLayout from "./components/layout/OwnerLayout";
import Calculator from "./pages/Calculator";
import AdminDemands from "./pages/Demands";
import AdminSalaries from "./pages/Salaries";
import AdminSellers from "./pages/Sellers";
import SellerDashboard from "./pages/seller/Dashboard";
import SellerOrders from "./pages/seller/Orders";
import SellerPayments from "./pages/seller/Payments";
import SellerProfile from "./pages/seller/Profile";
import SellerStatistics from "./pages/seller/Statistics";
import SellerWallet from "./pages/seller/Wallet";
import SellerDemands from "./pages/seller/Demands";
import AppLayout from "./components/layout/AppLayout";
import SellerLayout from "./components/layout/SellerLayout";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { Loader2 } from "lucide-react";
import SuspensionOverlay from "./components/layout/SuspensionOverlay";

const BusinessGuard = ({ children }: { children: React.ReactNode }) => {
  const [ready, setReady] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const qsId = params.get('businessId');
    if (qsId) {
      localStorage.setItem('activeBusinessId', qsId);
      window.history.replaceState({}, '', window.location.pathname);
      return true;
    }
    return !!localStorage.getItem('activeBusinessId');
  });
  const [businessStatus, setBusinessStatus] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);

  useEffect(() => {
    const resolve = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('users')
        .select('"DigiCom Business", role')
        .eq('id', user.id)
        .single();

      if (profile?.role) setUserRole(profile.role);

      if (!ready && profile?.['DigiCom Business']) {
        localStorage.setItem('activeBusinessId', profile['DigiCom Business']);
      }

      const bid = localStorage.getItem('activeBusinessId');
      if (bid) {
        setBusinessId(bid);
        const { data: business } = await supabase
          .from('businesses')
          .select('status')
          .eq('id', bid)
          .single();

        setBusinessStatus(business?.status || 'active');
      }

      setReady(true);
    };

    resolve();
  }, [ready]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-white">
        <Loader2 className="w-10 h-10 animate-spin text-brand-navy" />
      </div>
    );
  }

  const isSuspended = businessStatus && businessStatus !== 'active' && userRole !== 'owner';

  return (
    <>
      {children}
      {isSuspended && businessId && (
        <SuspensionOverlay role="admin" businessId={businessId} />
      )}
    </>
  );
};

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          {/* Owner Routes */}
          <Route path="/owner/select-business" element={
            <ProtectedRoute allowedRoles={['owner']}>
              <OwnerSelectBusiness />
            </ProtectedRoute>
          } />
          <Route path="/owner/*" element={
            <ProtectedRoute allowedRoles={['owner']}>
              <OwnerLayout>
                <Routes>
                  <Route path="businesses" element={<OwnerBusinesses />} />
                  <Route path="plans" element={<OwnerPlans />} />
                  <Route path="payments" element={<OwnerPayments />} />
                  <Route path="users" element={<OwnerUsers />} />
                  <Route path="" element={<Navigate to="businesses" replace />} />
                </Routes>
              </OwnerLayout>
            </ProtectedRoute>
          } />

          {/* Seller Routes */}
          <Route path="/seller/*" element={
            <ProtectedRoute allowedRoles={['seller', 'commercial']}>
              <SellerLayout>
                <Routes>
                  <Route path="dashboard" element={<SellerDashboard />} />
                  <Route path="orders" element={<SellerOrders />} />
                  <Route path="payments" element={<SellerPayments />} />
                  <Route path="profile" element={<SellerProfile />} />
                  <Route path="statistics" element={<SellerStatistics />} />
                  <Route path="wallet" element={<SellerWallet />} />
                  <Route path="demands" element={<SellerDemands />} />
                  <Route path="" element={<Navigate to="dashboard" replace />} />
                </Routes>
              </SellerLayout>
            </ProtectedRoute>
          } />

          {/* Admin Routes (owner can access via new tab) */}
          <Route path="*" element={
            <ProtectedRoute allowedRoles={['super admin', 'admin', 'mediabuyer', 'delivery person', 'owner']}>
              <BusinessGuard>
                <AppLayout>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    {/* ... other routes ... */}
                    <Route path="/orders" element={<Orders />} />
                    <Route path="/import-orders" element={<ImportOrders />} />
                    <Route path="/delivery-note" element={<DeliveryNote />} />
                    <Route path="/return-note" element={<ReturnNote />} />
                    <Route path="/delivery-services" element={<DeliveryServices />} />
                    <Route path="/payments" element={<Payments />} />
                    <Route path="/webhooks" element={<Webhooks />} />
                    <Route path="/ai-keys" element={<AiKeys />} />
                    <Route path="/transactions" element={<Transactions />} />
                    <Route path="/products" element={<Products />} />
                    <Route path="/accessories" element={<Accessories />} />
                    <Route path="/status" element={<Status />} />
                    <Route path="/analytics" element={<Analytics />} />
                    <Route path="/sales-channels" element={<SalesChannels />} />
                    <Route path="/customers" element={<Customers />} />
                    <Route path="/users" element={<Users />} />
                    <Route path="/ads-history" element={<AdsHistory />} />
                    <Route path="/expenses-details" element={<ExpensesDetails />} />
                    <Route path="/expenses-types" element={<ExpensesTypes />} />
                    <Route path="/cities" element={<Cities />} />
                    <Route path="/zones" element={<Zones />} />
                    <Route path="/calculator" element={<Calculator />} />
                    <Route path="/demands" element={<AdminDemands />} />
                    <Route path="/salaries" element={<AdminSalaries />} />
                    <Route path="/sellers" element={<AdminSellers />} />
                    <Route path="/profile" element={<Profile />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </AppLayout>
              </BusinessGuard>
            </ProtectedRoute>
          } />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
