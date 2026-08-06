import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator, Alert, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchWithAuth } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';

export default function ScanScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const colors = useColors();
  const queryClient = useQueryClient();

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const takePhoto = async () => {
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission Denied', 'Camera access is required to take photos.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setImageUri(result.assets[0].uri);
    }
  };

  const pickImage = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission Denied', 'Gallery access is required to select photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setImageUri(result.assets[0].uri);
    }
  };

  const uploadPhoto = async () => {
    if (!imageUri || !sessionId) return;
    
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('sessionId', sessionId);
      
      const filename = imageUri.split('/').pop() || 'photo.jpg';
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : `image`;

      // @ts-ignore: React Native FormData accepts an object with uri, name, type
      formData.append('image', { uri: imageUri, name: filename, type });

      await fetchWithAuth('/api/mobile/sweep-scan', {
        method: 'POST',
        body: formData,
      });

      queryClient.invalidateQueries({ queryKey: ['sessionItems', sessionId] });
      
      Alert.alert('Success', 'Image processed successfully', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (err: any) {
      Alert.alert('Upload Failed', err.message || 'Could not process the image.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} disabled={isUploading}>
          <Feather name="x" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Sweep Scan</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>
        {!imageUri ? (
          <View style={styles.placeholderContainer}>
            <View style={[styles.iconCircle, { backgroundColor: colors.primary + '1a' }]}>
              <Feather name="camera" size={48} color={colors.primary} />
            </View>
            <Text style={[styles.instructions, { color: colors.text }]}>
              Take a clear photo of the shelf, rack, or items you want to count. The AI will automatically identify and count the items.
            </Text>
            
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.primary }]} onPress={takePhoto} testID="take-photo-btn">
              <Feather name="camera" size={20} color={colors.primaryForeground} />
              <Text style={[styles.actionBtnText, { color: colors.primaryForeground }]}>Take Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.secondaryBtn, { borderColor: colors.border, backgroundColor: colors.card }]} onPress={pickImage} testID="choose-gallery-btn">
              <Feather name="image" size={20} color={colors.text} />
              <Text style={[styles.secondaryBtnText, { color: colors.text }]}>Choose from Gallery</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.previewContainer}>
            <Image source={{ uri: imageUri }} style={styles.previewImage} resizeMode="contain" />
            
            <View style={styles.previewActions}>
              <TouchableOpacity 
                style={[styles.retakeBtn, { borderColor: colors.border, backgroundColor: colors.card }]} 
                onPress={() => setImageUri(null)}
                disabled={isUploading}
              >
                <Text style={[styles.retakeBtnText, { color: colors.text }]}>Retake</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.uploadBtn, { backgroundColor: colors.primary }]} 
                onPress={uploadPhoto}
                disabled={isUploading}
              >
                {isUploading ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <>
                    <Feather name="upload-cloud" size={20} color={colors.primaryForeground} />
                    <Text style={[styles.uploadBtnText, { color: colors.primaryForeground }]}>Process Image</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
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
  backBtn: { padding: 8, marginLeft: -8 },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  content: { flex: 1, padding: 24 },
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  instructions: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 24,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 56,
    borderRadius: 12,
    marginBottom: 16,
  },
  actionBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    marginLeft: 12,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
  },
  secondaryBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    marginLeft: 12,
  },
  previewContainer: {
    flex: 1,
  },
  previewImage: {
    flex: 1,
    width: '100%',
    borderRadius: 12,
    marginBottom: 24,
  },
  previewActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  retakeBtn: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  retakeBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  uploadBtn: {
    flex: 2,
    flexDirection: 'row',
    height: 56,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  uploadBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    marginLeft: 8,
  },
});
