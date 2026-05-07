# LearnixQuizz

**AI-Powered Multilingual Quiz Platform**

LearnixQuizz is a production-grade quiz platform that enables users to create, share, and take quizzes with AI-assisted content generation and multilingual support.

---

## ✨ Features

### Core Features
- 🎯 **Quiz Creation**: Create quizzes with multiple question types (multiple choice, true/false, essay)
- 🤖 **AI-Powered Generation**: Auto-generate quizzes from documents (PDF, Word, images) using Google Gemini
- 🌍 **Multilingual Support**: Translate quizzes between Vietnamese and English with AI
- 📚 **Public Quiz Discovery**: Browse and take public quizzes from the community
- 📊 **Analytics & Leaderboard**: Track quiz performance with detailed statistics
- 💾 **Autosave**: Never lose progress with automatic draft saving

### Advanced Features
- 🔒 **Secure Authentication**: Supabase Auth with email/password and magic links
- ☁️ **Cloud Storage**: Image uploads with Supabase Storage
- 📱 **Responsive Design**: Mobile-first UI with Tailwind CSS
- ⚡ **Real-time Updates**: Live collaboration and status updates
- 🔄 **Offline Support**: Queue mutations and recover when back online

---

## 🏗️ Architecture

### Tech Stack
| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| State Management | TanStack Query (React Query) + Zustand |
| Backend | Supabase (PostgreSQL + Auth + Storage) |
| AI Processing | Google Gemini API |
| Deployment | Vercel |

### System Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                          │
│  ├─ React Query (Server State)                                  │
│  ├─ Zustand (Client State)                                      │
│  ├─ Distributed Mutation System                                 │
│  └─ Real-time Subscriptions                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTP / WebSocket
┌─────────────────────────────────────────────────────────────────┐
│                      SUPABASE PLATFORM                             │
│  ├─ PostgreSQL Database (RLS enabled)                           │
│  ├─ Supabase Auth (JWT-based)                                   │
│  ├─ Supabase Storage (Images)                                   │
│  ├─ Edge Functions (AI processing)                              │
│  └─ Realtime (WebSocket subscriptions)                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTPS
┌─────────────────────────────────────────────────────────────────┐
│                      EXTERNAL SERVICES                           │
│  ├─ Google Gemini API (AI generation/translation)                  │
│  └─ Vercel Edge Network (CDN + Serverless)                     │
└─────────────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

1. **Supabase-First**: No dedicated backend server - all business logic in frontend + edge functions
2. **Distributed Consistency**: Mutation log, optimistic updates, offline replay
3. **Multilingual Design**: UI language and content language are independent
4. **N+1 Prevention**: RPC functions for complex queries
5. **Security**: Row Level Security (RLS) on all tables

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Supabase account
- Google Gemini API key

### Installation

```bash
# Clone repository
git clone https://github.com/khaiphan23/Learnixquizz.git
cd Learnixquizz

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
```

### Environment Variables

Create `.env` file:

```env
# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Google Gemini
VITE_GEMINI_API_KEY=your-gemini-api-key
```

### Database Setup

1. Run SQL migrations in Supabase SQL Editor:
   - `schema.sql` - Base schema
   - `supabase-storage-setup.sql` - Storage configuration
   - `leaderboard-rls-fix.sql` - Leaderboard policies
   - `supabase/migrations/20250107_distributed_consistency.sql` - Distributed consistency

2. Deploy Edge Functions:
```bash
supabase functions deploy ai-jobs
```

### Development

```bash
# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Lint code
npm run lint
```

---

## 📁 Project Structure

```
Learnixquizz/
├── src/
│   ├── components/         # React components
│   │   ├── Navbar.tsx
│   │   ├── QuizCard.tsx
│   │   └── ...
│   ├── pages/              # Page components
│   │   ├── Home.tsx
│   │   ├── CreateQuiz.tsx
│   │   ├── Quiz.tsx
│   │   └── ...
│   ├── services/           # External service integrations
│   │   ├── supabase.ts     # Supabase client
│   │   ├── geminiService.ts # AI generation
│   │   ├── fileParser.ts   # Document parsing
│   │   └── imageUploadService.ts
│   ├── store/              # State management
│   │   ├── AuthContext.tsx
│   │   ├── QuizContext.tsx
│   │   └── LangContext.tsx
│   ├── mutations/          # NEW: Distributed mutation system
│   ├── concurrency/          # NEW: Multi-tab coordination
│   ├── offline/              # NEW: Offline support
│   ├── cache/                # NEW: Cache synchronization
│   ├── realtime/             # NEW: Realtime management
│   ├── ai/                   # NEW: AI pipeline
│   ├── types/                # TypeScript types
│   └── ...
├── supabase/
│   ├── migrations/           # SQL migrations
│   └── functions/            # Edge functions
├── public/                   # Static assets
└── ...config files
```

---

## 🗄️ Database Schema

### Core Tables

**quizzes**
- `id` (UUID, PK)
- `title`, `description`, `topic`
- `questions` (JSONB)
- `author_id` (FK to auth.users)
- `is_public`, `moderation_status`
- `version`, `last_modified_at` (optimistic locking)

**questions** (separate table for large quizzes)
- `id` (UUID, PK)
- `quiz_id` (FK)
- `type`, `text`, `options`
- `correct_answer_index`, `explanation`
- `question_order`

**translations**
- `id` (UUID, PK)
- `quiz_id` / `question_id` (polymorphic)
- `language`, `content` (JSONB)
- `status` (draft/pending_review/approved)
- `translated_by`, `ai_model`

**attempts**
- `id` (UUID, PK)
- `quiz_id`, `user_id`
- `answers`, `score`, `essay_grades`
- `timestamp`, `status`

---

## 🔒 Security

### Authentication
- Supabase Auth with JWT tokens
- Email/password + magic link support
- Password reset flow

### Authorization (RLS)
- Users can only access their own quizzes
- Public quizzes visible to all authenticated users
- RLS policies on all tables

### API Security
- Gemini API key stored in environment variables
- Edge Functions for sensitive operations
- Request signing (JWT verification)

---

## 🌐 Deployment

### Vercel (Recommended)
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

### Environment Setup on Vercel
1. Add environment variables in Vercel dashboard
2. Configure custom domains if needed
3. Set up Supabase webhook URLs

---

## 📝 Documentation

- [ARCHITECTURE_SUMMARY.md](./ARCHITECTURE_SUMMARY.md) - Detailed architecture decisions
- [CONTENT_GENERATION.md](./CONTENT_GENERATION.md) - AI content generation guide

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -m "feat: add my feature"`
4. Push to branch: `git push origin feature/my-feature`
5. Open a Pull Request

---

## 📄 License

MIT License - see LICENSE file for details

---

## 👨‍💻 Author

**Khai Phan**

---

## 🙏 Acknowledgments

- [Supabase](https://supabase.com/) for the amazing backend platform
- [Google Gemini](https://gemini.google.com/) for AI capabilities
- [React](https://react.dev/) and [Vite](https://vitejs.dev/) for the frontend stack
- [Tailwind CSS](https://tailwindcss.com/) for styling

