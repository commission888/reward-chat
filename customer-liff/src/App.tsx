import { CustomerProvider } from "@/customer/CustomerProvider";
import CardPage from "@/routes/CardPage";

function App() {
  return (
    <CustomerProvider>
      <CardPage />
    </CustomerProvider>
  );
}

export default App;
