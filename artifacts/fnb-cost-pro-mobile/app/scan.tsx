import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator, Alert, FlatList, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchWithAuth } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { CountLine, SweepScanResult, useSessionItems } from '@/hooks/useApi';

type ReviewItem = {
  key: string;
  detectedName: string;
  qty: string;
  lineId: string | null;
  confidence?: number;
};

const normalized = (value: string) => value.trim().toLowerCase();

export default function ScanScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const colors = useColors();
  const queryClient = useQueryClient();
  const { data: sessionItems } = useSessionItems(sessionId ?? '');

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [reviewItems, setReviewItems] = useState<ReviewItem[] | null>(null);

  const availableLines = useMemo(() => (sessionItems ?? []) as Array<CountLine & { id?: string; name?: string; quantity?: number }>, [sessionItems]);

  const pickPhoto = async (source: 'camera' | 'library') => {
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission denied', `${source === 'camera' ? 'Camera' : 'Gallery'} access is required.`);
      return;
    }
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.8 });
    if (!result.canceled && result.assets?.[0]) setImageUri(result.assets[0].uri);
  };

  const matchLine = (name: string) => {
    const target = normalized(name);
    const exact = availableLines.find((line) => normalized(line.itemName ?? line.name ?? '') === target);
    return exact ?? availableLines.find((line) => normalized(line.itemName ?? line.name ?? '').includes(target) || target.includes(normalized(line.itemName ?? line.name ?? '')));
  };

  const uploadPhoto = async () => {
    if (!imageUri || !sessionId) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('sessionId', sessionId);
      const filename = imageUri.split('/').pop() || 'photo.jpg';
      const extension = /\.(\w+)$/.exec(filename)?.[1] ?? 'jpeg';
      // React Native accepts a file descriptor object in FormData.
      formData.append('image', { uri: imageUri, name: filename, type: `image/${extension}` } as never);
      const result = await fetchWithAuth('/api/mobile/sweep-scan', { method: 'POST', body: formData }) as SweepScanResult;
      const recognized = result.items ?? [];
      setReviewItems(recognized.map((item, index) => {
        const line = matchLine(item.name);
        return {
          key: `${index}-${item.name}`,
          detectedName: item.name,
          qty: String(item.quantity ?? item.estimatedQty ?? 0),
          lineId: line?.lineId ?? line?.id ?? null,
          confidence: item.confidence,
        };
      }));
    } catch (error: any) {
      Alert.alert('Upload failed', error.message || 'Could not process the image.');
    } finally {
      setIsUploading(false);
    }
  };

  const applyResults = async () => {
    if (!sessionId || !reviewItems) return;
    const lines = reviewItems
      .map((item) => ({ lineId: item.lineId, qty: Number(item.qty) }))
      .filter((item): item is { lineId: string; qty: number } => !!item.lineId && Number.isFinite(item.qty) && item.qty >= 0 && item.qty > 0);
    if (lines.length === 0) {
      Alert.alert('Nothing to apply', 'Match at least one recognized item to a count line and enter a quantity greater than zero.');
      return;
    }
    setIsApplying(true);
    try {
      await fetchWithAuth(`/api/mobile/sessions/${sessionId}/apply-scan`, {
        method: 'POST',
        body: JSON.stringify({ lines, mode: 'add' }),
      });
      await queryClient.invalidateQueries({ queryKey: ['sessionItems', sessionId] });
      Alert.alert('Scan applied', `${lines.length} reviewed item${lines.length === 1 ? '' : 's'} added to this count.`, [{ text: 'Done', onPress: () => router.back() }]);
    } catch (error: any) {
      Alert.alert('Could not apply scan', error.message || 'Please review your matches and try again.');
    } finally {
      setIsApplying(false);
    }
  };

  const updateReview = (key: string, patch: Partial<ReviewItem>) => {
    setReviewItems((current) => current?.map((item) => item.key === key ? { ...item, ...patch } : item) ?? null);
  };

  if (reviewItems) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setReviewItems(null)} disabled={isApplying}><Feather name="arrow-left" size={24} color={colors.text} /></TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Review scan</Text>
          <View style={{ width: 40 }} />
        </View>
        <Text style={[styles.reviewHelp, { color: colors.mutedForeground }]}>AI suggestions never change a count until you review the item match and quantity below.</Text>
        <FlatList
          data={reviewItems}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.reviewList}
          ListEmptyComponent={<Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No countable items were recognized. Go back and try another photo.</Text>}
          renderItem={({ item }) => (
            <View style={[styles.reviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.detectedName, { color: colors.text }]}>{item.detectedName}</Text>
              {item.confidence != null && <Text style={[styles.confidence, { color: colors.mutedForeground }]}>AI confidence: {Math.round(item.confidence * 100)}%</Text>}
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Add quantity</Text>
              <TextInput value={item.qty} onChangeText={(qty) => updateReview(item.key, { qty })} keyboardType="decimal-pad" style={[styles.qtyInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]} />
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Count line</Text>
              <View style={styles.matchList}>
                {availableLines.map((line) => {
                  const lineId = line.lineId ?? line.id!;
                  const selected = item.lineId === lineId;
                  const title = line.itemName ?? line.name ?? 'Unnamed item';
                  return <TouchableOpacity key={lineId} onPress={() => updateReview(item.key, { lineId })} style={[styles.matchOption, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary + '14' : colors.background }]}><Feather name={selected ? 'check-circle' : 'circle'} color={selected ? colors.primary : colors.mutedForeground} size={17} /><Text style={[styles.matchText, { color: colors.text }]} numberOfLines={1}>{title}</Text></TouchableOpacity>;
                })}
              </View>
              {!item.lineId && <Text style={[styles.unmatched, { color: colors.destructive }]}>Choose a count line before applying this item.</Text>}
            </View>
          )}
        />
        <View style={[styles.applyBar, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
          <TouchableOpacity onPress={applyResults} disabled={isApplying || reviewItems.length === 0} style={[styles.applyButton, { backgroundColor: colors.primary }]}>
            {isApplying ? <ActivityIndicator color={colors.primaryForeground} /> : <><Feather name="check" size={20} color={colors.primaryForeground} /><Text style={[styles.applyText, { color: colors.primaryForeground }]}>Apply reviewed results</Text></>}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}><TouchableOpacity style={styles.backBtn} onPress={() => router.back()} disabled={isUploading}><Feather name="x" size={24} color={colors.text} /></TouchableOpacity><Text style={[styles.headerTitle, { color: colors.text }]}>Sweep scan</Text><View style={{ width: 40 }} /></View>
      <View style={styles.content}>
        {!imageUri ? <View style={styles.placeholderContainer}><View style={[styles.iconCircle, { backgroundColor: colors.primary + '1a' }]}><Feather name="camera" size={48} color={colors.primary} /></View><Text style={[styles.instructions, { color: colors.text }]}>Photograph a shelf or rack. You will review every AI suggestion before it is added to the count.</Text><TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.primary }]} onPress={() => pickPhoto('camera')} testID="take-photo-btn"><Feather name="camera" size={20} color={colors.primaryForeground} /><Text style={[styles.actionBtnText, { color: colors.primaryForeground }]}>Take photo</Text></TouchableOpacity><TouchableOpacity style={[styles.secondaryBtn, { borderColor: colors.border, backgroundColor: colors.card }]} onPress={() => pickPhoto('library')} testID="choose-gallery-btn"><Feather name="image" size={20} color={colors.text} /><Text style={[styles.secondaryBtnText, { color: colors.text }]}>Choose from gallery</Text></TouchableOpacity></View> : <View style={styles.previewContainer}><Image source={{ uri: imageUri }} style={styles.previewImage} resizeMode="contain" /><View style={styles.previewActions}><TouchableOpacity style={[styles.retakeBtn, { borderColor: colors.border, backgroundColor: colors.card }]} onPress={() => setImageUri(null)} disabled={isUploading}><Text style={[styles.retakeBtnText, { color: colors.text }]}>Retake</Text></TouchableOpacity><TouchableOpacity style={[styles.uploadBtn, { backgroundColor: colors.primary }]} onPress={uploadPhoto} disabled={isUploading}>{isUploading ? <ActivityIndicator color={colors.primaryForeground} /> : <><Feather name="upload-cloud" size={20} color={colors.primaryForeground} /><Text style={[styles.uploadBtnText, { color: colors.primaryForeground }]}>Review image</Text></>}</TouchableOpacity></View></View>}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 }, backBtn: { padding: 8, marginLeft: -8 }, headerTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' }, content: { flex: 1, padding: 24 }, placeholderContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' }, iconCircle: { width: 120, height: 120, borderRadius: 60, justifyContent: 'center', alignItems: 'center', marginBottom: 24 }, instructions: { fontSize: 16, fontFamily: 'Inter_400Regular', textAlign: 'center', marginBottom: 40, lineHeight: 24 }, actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%', height: 56, borderRadius: 12, marginBottom: 16 }, actionBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginLeft: 12 }, secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%', height: 56, borderRadius: 12, borderWidth: 1 }, secondaryBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginLeft: 12 }, previewContainer: { flex: 1 }, previewImage: { flex: 1, width: '100%', borderRadius: 12, marginBottom: 24 }, previewActions: { flexDirection: 'row', justifyContent: 'space-between' }, retakeBtn: { flex: 1, height: 56, borderRadius: 12, borderWidth: 1, justifyContent: 'center', alignItems: 'center', marginRight: 8 }, retakeBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 16 }, uploadBtn: { flex: 2, flexDirection: 'row', height: 56, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginLeft: 8 }, uploadBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginLeft: 8 }, reviewHelp: { padding: 16, fontSize: 14, lineHeight: 20, fontFamily: 'Inter_400Regular' }, reviewList: { padding: 16, paddingTop: 0, paddingBottom: 110 }, reviewCard: { borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 12 }, detectedName: { fontSize: 16, fontFamily: 'Inter_600SemiBold' }, confidence: { marginTop: 4, fontSize: 12, fontFamily: 'Inter_400Regular' }, fieldLabel: { marginTop: 14, marginBottom: 6, fontSize: 12, fontFamily: 'Inter_500Medium' }, qtyInput: { height: 44, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontSize: 16, fontFamily: 'Inter_600SemiBold' }, matchList: { gap: 6 }, matchOption: { minHeight: 40, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center' }, matchText: { marginLeft: 8, flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' }, unmatched: { marginTop: 8, fontSize: 12, fontFamily: 'Inter_500Medium' }, applyBar: { borderTopWidth: 1, padding: 16 }, applyButton: { height: 52, borderRadius: 10, justifyContent: 'center', alignItems: 'center', flexDirection: 'row' }, applyText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginLeft: 8 }, emptyText: { padding: 24, textAlign: 'center', fontFamily: 'Inter_400Regular' },
});