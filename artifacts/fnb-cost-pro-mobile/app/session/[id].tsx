import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useSessionItems, useUpdateItemQuantity } from '@/hooks/useApi';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const router = useRouter();
  
  const { data: items, isLoading, refetch } = useSessionItems(id!);
  const updateQty = useUpdateItemQuantity();

  const [search, setSearch] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  useEffect(() => {
    if (items) {
      const q: Record<string, string> = {};
      items.forEach((item: any) => {
        q[item.id] = item.quantity?.toString() || '0';
      });
      setQuantities(q);
    }
  }, [items]);

  const handleQtyChange = (itemId: string, text: string) => {
    setQuantities(prev => ({ ...prev, [itemId]: text }));
  };

  const handleQtyBlur = (itemId: string) => {
    const val = parseFloat(quantities[itemId]);
    if (!isNaN(val)) {
      updateQty.mutate({ sessionId: id!, itemId, qty: val });
    }
  };

  const filteredItems = items?.filter((item: any) => 
    item.name?.toLowerCase().includes(search.toLowerCase()) || 
    item.sku?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Count Session</Text>
        <TouchableOpacity 
          style={styles.scanBtn}
          onPress={() => router.push(`/scan?sessionId=${id}`)}
        >
          <Feather name="camera" size={20} color={colors.primary} />
          <Text style={[styles.scanBtnText, { color: colors.primary }]}>Scan</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchContainer}>
        <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={18} color={colors.mutedForeground} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search items..."
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (!items || items.length === 0) ? (
        <View style={styles.center}>
          <Feather name="package" size={48} color={colors.mutedForeground} style={{ marginBottom: 16 }} />
          <Text style={[styles.emptyText, { color: colors.text }]}>No items in this session.</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Use the scan button to add items via camera, or they will appear here once added.</Text>
        </View>
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.itemInfo}>
                <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={[styles.itemMeta, { color: colors.mutedForeground }]}>
                  {item.sku ? `SKU: ${item.sku} • ` : ''}{item.unit || 'Unit'}
                </Text>
              </View>
              <View style={styles.qtyContainer}>
                <TextInput
                  style={[styles.qtyInput, { 
                    borderColor: colors.border, 
                    color: colors.text,
                    backgroundColor: colors.background
                  }]}
                  keyboardType="numeric"
                  value={quantities[item.id] || '0'}
                  onChangeText={(val) => handleQtyChange(item.id, val)}
                  onBlur={() => handleQtyBlur(item.id)}
                />
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    padding: 8,
    marginLeft: -8,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    marginRight: -8,
  },
  scanBtnText: {
    fontFamily: 'Inter_600SemiBold',
    marginLeft: 6,
    fontSize: 14,
  },
  searchContainer: {
    padding: 16,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  list: {
    padding: 16,
    paddingTop: 0,
    paddingBottom: 40,
  },
  itemCard: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemInfo: {
    flex: 1,
    paddingRight: 16,
  },
  itemName: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 4,
  },
  itemMeta: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  qtyContainer: {
    width: 80,
  },
  qtyInput: {
    borderWidth: 1,
    borderRadius: 8,
    height: 40,
    textAlign: 'center',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
});
