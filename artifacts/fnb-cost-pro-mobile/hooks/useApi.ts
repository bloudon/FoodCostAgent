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

export function useUpdateItemQuantity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, itemId, qty }: { sessionId: string; itemId: string; qty: number }) =>
      fetchWithAuth(`/api/mobile/sessions/${sessionId}/inventory/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ qty }),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sessionItems', variables.sessionId] });
    },
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
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
