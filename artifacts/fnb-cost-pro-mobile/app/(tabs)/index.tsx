import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Modal, TextInput, ActivityIndicator, Alert } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useDashboard, useActiveSessions, useAssignedStores, useCreateSession } from '@/hooks/useApi';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

export default function DashboardScreen() {
  const colors = useColors();
  const router = useRouter();
  
  const { data: dashboard, isLoading: dashLoading, refetch: refetchDash } = useDashboard();
  const { data: activeSessions, isLoading: activeLoading, refetch: refetchActive } = useActiveSessions();
  const { data: stores, isLoading: storesLoading } = useAssignedStores();
  const createSession = useCreateSession();

  const [modalVisible, setModalVisible] = useState(false);
  const [storeId, setStoreId] = useState('');
  const [name, setName] = useState('');

  const refreshing = dashLoading || activeLoading;

  const onRefresh = () => {
    refetchDash();
    refetchActive();
  };

  const handleCreate = () => {
    if (!storeId) {
      Alert.alert('Choose a store', 'Select one of your assigned stores before starting a count.');
      return;
    }
    createSession.mutate(
      { storeId, name: name.trim() || undefined },
      {
        onSuccess: (res) => {
          setModalVisible(false);
          setName('');
          if (res && res.id) {
            router.push(`/session/${res.id}`);
          }
        },
        onError: (error: Error) => Alert.alert('Could not start count', error.message),
      }
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Dashboard</Text>
          <TouchableOpacity 
            style={[styles.newBtn, { backgroundColor: colors.primary }]}
            onPress={() => setModalVisible(true)}
            testID="start-count-button"
          >
            <Feather name="plus" size={20} color={colors.primaryForeground} />
            <Text style={[styles.newBtnText, { color: colors.primaryForeground }]}>Start Count</Text>
          </TouchableOpacity>
        </View>

        {/* Dashboard summary stats if any */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statValue, { color: colors.primary }]}>
              {dashboard?.activeCount || activeSessions?.length || 0}
            </Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Active Counts</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {dashboard?.recentCount || 0}
            </Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Recent Completed</Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Active Sessions</Text>
        
        {(!activeSessions || activeSessions.length === 0) && !activeLoading && (
          <View style={[styles.emptyBox, { borderColor: colors.border }]}>
            <Feather name="inbox" size={32} color={colors.mutedForeground} style={{ marginBottom: 12 }} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No active sessions</Text>
            <Text style={[styles.emptySubText, { color: colors.mutedForeground }]}>Start a new count to begin.</Text>
          </View>
        )}

        {activeSessions?.map((session: any) => (
          <TouchableOpacity 
            key={session.id}
            style={[styles.sessionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push(`/session/${session.id}`)}
          >
            <View style={styles.sessionHeader}>
              <Text style={[styles.sessionName, { color: colors.text }]}>
                {session.name || session.locationName || `Session #${session.id.substring(0,6)}`}
              </Text>
              <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
            </View>
            <Text style={[styles.sessionDate, { color: colors.mutedForeground }]}>
              {new Date(session.createdAt || Date.now()).toLocaleDateString()}
            </Text>
            <View style={[styles.badge, { backgroundColor: colors.accent + '20' }]}>
              <Text style={[styles.badgeText, { color: colors.accent }]}>In Progress</Text>
            </View>
          </TouchableOpacity>
        ))}
        
        {/* Padding for tab bar */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Start Count Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Start New Count</Text>
            
            <Text style={[styles.label, { color: colors.text }]}>Assigned store</Text>
            {storesLoading ? (
              <ActivityIndicator color={colors.primary} style={styles.storeLoader} />
            ) : stores && stores.length > 0 ? (
              <View style={styles.storeList}>
                {stores.map((store) => {
                  const selected = store.id === storeId;
                  return (
                    <TouchableOpacity
                      key={store.id}
                      style={[styles.storeOption, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary + '14' : colors.background }]}
                      onPress={() => setStoreId(store.id)}
                    >
                      <Feather name={selected ? 'check-circle' : 'circle'} size={18} color={selected ? colors.primary : colors.mutedForeground} />
                      <Text style={[styles.storeOptionText, { color: colors.text }]}>{store.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <Text style={[styles.noStoresText, { color: colors.mutedForeground }]}>No stores are assigned to your account. Ask an administrator for access.</Text>
            )}

            <Text style={[styles.label, { color: colors.text }]}>Count name (optional)</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.text, backgroundColor: colors.background }]}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Morning inventory"
              placeholderTextColor={colors.mutedForeground}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={[styles.modalBtn, { backgroundColor: colors.secondary }]}
                onPress={() => setModalVisible(false)}
              >
                <Text style={[styles.modalBtnText, { color: colors.secondaryForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalBtn, { backgroundColor: colors.primary, marginLeft: 12 }]}
                onPress={handleCreate}
                disabled={createSession.isPending || !storeId}
              >
                <Text style={[styles.modalBtnText, { color: colors.primaryForeground }]}>Start</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    marginTop: 40,
  },
  title: { fontSize: 28, fontFamily: 'Inter_700Bold' },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  newBtnText: {
    fontFamily: 'Inter_600SemiBold',
    marginLeft: 8,
    fontSize: 14,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  statCard: {
    flex: 1,
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 32,
    fontFamily: 'Inter_700Bold',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  sectionTitle: {
    fontSize: 20,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 16,
  },
  emptyBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    marginBottom: 4,
  },
  emptySubText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  sessionCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  sessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sessionName: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  sessionDate: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginBottom: 12,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    borderWidth: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    marginBottom: 20,
  },
  label: { fontSize: 14, marginBottom: 8, fontFamily: 'Inter_500Medium' },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    marginBottom: 20,
    fontFamily: 'Inter_400Regular',
  },
  storeLoader: { marginVertical: 16 },
  storeList: { marginBottom: 20, gap: 8 },
  storeOption: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  storeOptionText: { marginLeft: 10, fontSize: 15, fontFamily: 'Inter_500Medium' },
  noStoresText: { fontSize: 14, lineHeight: 20, marginBottom: 20, fontFamily: 'Inter_400Regular' },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  modalBtn: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBtnText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
});
