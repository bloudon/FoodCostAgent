import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";
import type { CompanyStore } from "@shared/schema";

interface StoreContextType {
  selectedStoreId: string;
  setSelectedStoreId: (storeId: string) => void;
  selectedStore: CompanyStore | undefined;
  stores: CompanyStore[];
  isLoading: boolean;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export function StoreProvider({ children }: { children: ReactNode }) {
  const { data: stores = [] as CompanyStore[], isLoading } = useAccessibleStores();
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");

  useEffect(() => {
    // Auto-select first store when stores load and no store selected
    if (stores.length > 0 && !selectedStoreId) {
      setSelectedStoreId(stores[0].id);
    }
    
    // Reset selection if current store is no longer accessible (e.g., company switch)
    if (selectedStoreId && stores.length > 0 && !stores.find(s => s.id === selectedStoreId)) {
      setSelectedStoreId(stores[0].id);
    }
  }, [stores, selectedStoreId]);

  const selectedStore: CompanyStore | undefined = stores.find(s => s.id === selectedStoreId);

  return (
    <StoreContext.Provider value={{ selectedStoreId, setSelectedStoreId, selectedStore, stores, isLoading }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStoreContext() {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error("useStoreContext must be used within StoreProvider");
  }
  return context;
}
