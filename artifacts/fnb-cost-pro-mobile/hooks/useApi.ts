import { fetchWithAuth } from '@/lib/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => fetchWithAuth('/api/mobile/dashboard'),
  });
}

export function useActiveSessions() {
  return useQuery({
    queryKey: ['activeSessions'],
    queryFn: () => fetchWithAuth('/api/mobile/sessions/active'),
  });
}

export function useSessionItems(id: string) {
  return useQuery({
    queryKey: ['sessionItems', id],
    queryFn: () => fetchWithAuth(`/api/mobile/sessions/${id}/items`),
    enabled: !!id,
  });
}

export type CountLine = {
  lineId: string;
  inventoryItemId: string;
  itemName: string;
  unitAbbr: string;
  qty: number;
  locationName: string;
};

export type AssignedStore = {
  id: string;
  name: string;
};

export type SweepScanResult = {
  items: Array<{
    name: string;
    estimatedQty?: number;
    quantity?: number;
    unit?: string;
    confidence?: number;
  }>;
  frameCount: number;
  notes: string[];
};

export function useUpdateItemQuantity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, lineId, qty }: { sessionId: string; lineId: string; qty: number }) =>
      fetchWithAuth(`/api/mobile/sessions/${sessionId}/lines/${lineId}`, {
        method: 'PATCH',
        body: JSON.stringify({ qty }),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sessionItems', variables.sessionId] });
    },
  });
}

export function useAssignedStores() {
  return useQuery<AssignedStore[]>({
    queryKey: ['assignedStores'],
    queryFn: () => fetchWithAuth('/api/mobile/stores'),
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { storeId: string; name?: string; countDate?: string }) =>
      fetchWithAuth('/api/mobile/sessions', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activeSessions'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
