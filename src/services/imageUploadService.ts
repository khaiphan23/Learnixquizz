// Image Upload Service - Upload images to Supabase Storage
import { supabase } from './supabase';

const BUCKET_NAME = 'question-images';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export interface UploadResult {
  url: string;
  path: string;
}

export interface UploadError {
  message: string;
  code: string;
}

/**
 * Validate file before upload
 */
function validateFile(file: File): void {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error(`Chỉ chấp nhận file: JPG, PNG, GIF, WebP`);
  }
  
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File quá lớn (tối đa 5MB). File hiện tại: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
  }
}

/**
 * Upload image to Supabase Storage
 */
export async function uploadImage(file: File, userId: string): Promise<UploadResult> {
  validateFile(file);
  
  console.log('[uploadImage] Starting upload:', file.name, 'Size:', (file.size / 1024).toFixed(2), 'KB', 'Type:', file.type);
  
  try {
    // Create unique filename
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const filename = `${userId}/${timestamp}-${randomString}.${extension}`;
    
    console.log('[uploadImage] Uploading to bucket:', BUCKET_NAME, 'Filename:', filename);
    
    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filename, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type,
      });
    
    if (error) {
      console.error('[uploadImage] Upload error:', error);
      if (error.message?.includes('bucket')) {
        throw new Error(`Bucket '${BUCKET_NAME}' chưa được tạo trong Supabase. Vui lòng tạo bucket và cấu hình RLS policy.`);
      }
      if (error.message?.includes('row-level security')) {
        throw new Error(`RLS policy chưa cho phép upload. Vui lòng cấu hình RLS trong Supabase.`);
      }
      throw new Error(`Lỗi upload: ${error.message}`);
    }
    
    console.log('[uploadImage] Upload success, getting public URL...');
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filename);
    
    if (!urlData?.publicUrl) {
      throw new Error('Không thể tạo URL công khai cho hình ảnh');
    }
    
    console.log('[uploadImage] Success! URL:', urlData.publicUrl);
    
    return {
      url: urlData.publicUrl,
      path: filename,
    };
  } catch (error: any) {
    console.error('[uploadImage] Failed:', error);
    throw error;
  }
}

/**
 * Delete image from Supabase Storage
 */
export async function deleteImage(path: string): Promise<void> {
  try {
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([path]);
    
    if (error) {
      console.error('[deleteImage] Delete error:', error);
      throw new Error(`Lỗi xóa hình: ${error.message}`);
    }
  } catch (error: any) {
    console.error('[deleteImage] Failed:', error);
    throw error;
  }
}

/**
 * Convert file to base64 for preview
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
