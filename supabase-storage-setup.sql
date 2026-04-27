-- ============================================
-- SUPABASE STORAGE SETUP FOR IMAGE UPLOAD
-- ============================================
-- Run this SQL in Supabase SQL Editor to enable image uploads

-- 1. Create the storage bucket (skip if already exists)
INSERT INTO storage.buckets (id, name, public, avif_autodetection)
VALUES ('question-images', 'question-images', true, false)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 2. Create RLS Policies for the bucket
-- ============================================

-- Policy: Allow authenticated users to upload images
CREATE POLICY "Allow authenticated uploads" ON storage.objects
  FOR INSERT 
  TO authenticated 
  WITH CHECK (bucket_id = 'question-images');

-- Policy: Allow authenticated users to read images
CREATE POLICY "Allow authenticated read" ON storage.objects
  FOR SELECT 
  TO authenticated 
  USING (bucket_id = 'question-images');

-- Policy: Allow public read access (for viewing images without auth)
CREATE POLICY "Allow public read" ON storage.objects
  FOR SELECT 
  TO anon 
  USING (bucket_id = 'question-images');

-- Policy: Allow users to delete their own images
CREATE POLICY "Allow authenticated delete" ON storage.objects
  FOR DELETE 
  TO authenticated 
  USING (bucket_id = 'question-images');

-- Policy: Allow users to update their own images
CREATE POLICY "Allow authenticated update" ON storage.objects
  FOR UPDATE 
  TO authenticated 
  USING (bucket_id = 'question-images');

-- ============================================
-- ALTERNATIVE: Allow all operations for authenticated users
-- ============================================
-- Uncomment the following if you want simpler permissions:

-- CREATE POLICY "Enable all for authenticated" ON storage.objects
--   FOR ALL
--   TO authenticated
--   USING (bucket_id = 'question-images')
--   WITH CHECK (bucket_id = 'question-images');
