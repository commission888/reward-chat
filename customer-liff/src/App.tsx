import { LanguageProvider } from "@/i18n/LanguageProvider";
import { CustomerProvider } from "@/customer/CustomerProvider";
import CardPage from "@/routes/CardPage";

function App() {
  return (
    <LanguageProvider>
      <CustomerProvider>
        <CardPage />
      </CustomerProvider>
    </LanguageProvider>
  );
}

export default App;
