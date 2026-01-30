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
import ImportStatus from "./pages/ImportStatus";
import DeliveryNote from "./pages/DeliveryNote";
import ReturnNote from "./pages/ReturnNote";
import DeliveryServices from "./pages/DeliveryServices";
import Payments from "./pages/Payments";
import Transactions from "./pages/Transactions";
import Products from "./pages/Products";
import Status from "./pages/Status";
import Analytics from "./pages/Analytics";
import SalesChannels from "./pages/SalesChannels";
import Customers from "./pages/Customers";
import Users from "./pages/Users";
import ExpensesDetails from "./pages/ExpensesDetails";
import ExpensesTypes from "./pages/ExpensesTypes";
import Cities from "./pages/Cities";
import Zones from "./pages/Zones";
import Profile from "./pages/Profile";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/import-orders" element={<ImportOrders />} />
          <Route path="/import-status" element={<ImportStatus />} />
          <Route path="/delivery-note" element={<DeliveryNote />} />
          <Route path="/return-note" element={<ReturnNote />} />
          <Route path="/delivery-services" element={<DeliveryServices />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/products" element={<Products />} />
          <Route path="/status" element={<Status />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/sales-channels" element={<SalesChannels />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/users" element={<Users />} />
          <Route path="/expenses-details" element={<ExpensesDetails />} />
          <Route path="/expenses-types" element={<ExpensesTypes />} />
          <Route path="/cities" element={<Cities />} />
          <Route path="/zones" element={<Zones />} />
          <Route path="/profile" element={<Profile />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
