<p align="center">
  <img src="./frontend/public/TBS-Logo.webp" alt="TBS Marketing Logo" width="180px" />
</p>

# TBS Web Analysis & SEO Platform

A premium, full-stack SEO powerhouse and web analysis platform. It combines AI-powered website insights (Knowledge Graphs, Topical Mapping) with real-time Google Search Console analytics to provide a comprehensive view of digital performance.

![Premium Dashboard](./frontend/public/ReadMe.png)

## 🌟 Core Features

### 📊 SEO Analytics Dashboard (New)
- **Direct GSC Integration**: Securely connect Google Search Console properties.
- **Performance Metrics**: Real-time tracking of Clicks, Impressions, Avg. CTR, and Avg. Position.
- **Interactive Visualization**: Dynamic historical bar charts with daily/weekly/monthly grouping.
- **Smart Classification**: Automated ranking of pages into categories like "Quick Wins," "Opportunities," "Top Results," and "Decaying."
- **Entity Clustering**: Intelligent keyword clustering to identify semantic search trends.
- **Excel Export**: Generate comprehensive SEO reports with a single click.

### 🧠 AI Web Analysis
- **Knowledge Graph**: Interactive 3D/2D visualization of entity relationships and service maps.
- **Topical Mapping**: Semantic depth analysis, audience segmentation, and search intent discovery.
- **Competitive Comparison**: Side-by-side analysis of business models, tech stacks, and geographic reach.
- **Multi-URL Processing**: Analyze up to 5 competitors simultaneously.

### ⚡ Real-Time Progress Engine
- **SSE-Powered Tracking**: Watch the AI work in real-time with step-by-step progress updates.
- **Background Processing**: Heavy analysis tasks run asynchronously, allowing you to browse while the AI thinks.

## 🛠️ Tech Stack

### Backend
- **FastAPI**: Ultra-fast Python framework with async capabilities.
- **SQLAlchemy & PostgreSQL**: Robust data persistence for user history and tokens.
- **Google OAuth 2.0**: Secure authentication for user accounts and Search Console access.
- **OpenAI/Anthropic**: Powering the semantic analysis and knowledge extraction.

### Frontend
- **React 18**: Built for performance and reliability.
- **Vite**: Modern build orchestration.
- **Recharts**: Professional, interactive data visualization.
- **Framer Motion**: Smooth, high-end micro-animations and transitions.
- **Tailwind CSS**: Custom "Glassmorphism" design system.

## 🚀 Getting Started

### Prerequisites
- Python 3.9+ 
- Node.js 18+
- PostgreSQL database
- Google Cloud Console Project (with Search Console API enabled)

### 1. Environment Configuration

#### Backend (`backend/.env`)
```env
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
SECRET_KEY=your_jwt_secret
ALLOWED_ORIGINS=http://localhost:5173
```

#### Frontend (`frontend/.env`)
```env
VITE_GOOGLE_CLIENT_ID=your_client_id
VITE_API_BASE_URL=http://localhost:8000
```

### 2. Installation

**Backend Setup:**
```bash
cd backend
python -m venv venv
pip install -r requirements.txt
source venv/bin/activate && uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**Frontend Setup:**
```bash
cd frontend
npm install
npm run dev
```

## 🔐 Google OAuth Configuration

To enable fully functional Search Console integration, ensure your Google Cloud project is configured with:

1.  **Scopes**: 
    - `https://www.googleapis.com/auth/userinfo.email`
    - `https://www.googleapis.com/auth/userinfo.profile`
    - `https://www.googleapis.com/auth/webmasters.readonly` (Search Console)
2.  **Redirect URIs**:
    - `http://localhost:5173/auth/callback`
3.  **Client Configuration**: Set `Access Type` to `Offline` to allow the platform to refresh tokens in the background.

## 📁 Project Structure

```text
web/
├── backend/
│   ├── api/routes.py          # SSE Progress & GSC Endpoints
│   ├── services/gsc_service.py # Search Console Integration logic
│   ├── utils/progress_tracker.py # Real-time status management
│   └── database.py            # PostgreSQL configuration
└── frontend/
    ├── src/pages/SEOAnalytics.jsx # Massive data-dense dashboard
    ├── src/components/ui/      # High-end glassmorphism components
    └── src/context/AuthContext.jsx # Global auth & GSC state
```

## 📄 License
MIT © TBS Marketing

## 🤝 Support
For technical support or feature requests, contact the development lead or open an internal issue.

