-- ============================================
-- FIX: Leaderboard shows different data for different users
-- ============================================
-- 
-- Vấn đề: RLS policy chỉ cho phép mỗi user xem attempts của chính mình
-- Giải pháp: Thêm policy cho phép xem tất cả attempts

-- Bước 1: Xóa policy cũ nếu tồn tại (tránh lỗi duplicate)
DROP POLICY IF EXISTS "Anyone can view all attempts for leaderboard" ON public.attempts;

-- Bước 2: Tạo policy mới cho phép tất cả users xem tất cả attempts
CREATE POLICY "Anyone can view all attempts for leaderboard"
  ON public.attempts FOR SELECT
  USING (TRUE);

-- ============================================
-- Hướng dẫn:
-- 1. Vào Supabase Dashboard → SQL Editor
-- 2. Tạo New Query
-- 3. Copy và paste đoạn SQL trên
-- 4. Click Run
-- 5. Kiểm tra leaderboard lại
-- ============================================
